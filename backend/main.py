import os
import io
import logging

from dotenv import load_dotenv

# Load environment variables BEFORE any module that reads them.
# Try the repo-root .env explicitly, then fall back to the default search.
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))
load_dotenv()

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

from backend.pdf_parser import parse_pdf
from backend.sectioner import Sectioner
from backend.embeddings import EmbeddingEngine
from backend.rag import RAGController, GroqAPIError


# --- Logging ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("paperpilot")

# --- Lazy-Initialized Services ---
# Vercel serverless does NOT trigger FastAPI lifespan events.
# We use lazy initialization so services are created on first request
# and reused across warm invocations.

_embedder = None
_rag = None
_sectioner = None


def get_sectioner():
    global _sectioner
    if _sectioner is None:
        _sectioner = Sectioner()
        logger.info("✓ Sectioner initialized.")
    return _sectioner


def get_embedder():
    global _embedder
    if _embedder is None:
        _embedder = EmbeddingEngine()
        _embedder.ensure_index_exists()
        logger.info("✓ Embedding engine initialized.")
    return _embedder


def get_rag():
    global _rag
    if _rag is None:
        _rag = RAGController()
        logger.info("✓ RAG controller initialized.")
    return _rag


# --- App ---
app = FastAPI(
    title="PaperPilot AI",
    description="Intelligent Research Paper Analysis Assistant",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request Models ---

class SectionPayload(BaseModel):
    title: str = "Untitled"
    content: str = ""


class ChatRequest(BaseModel):
    query: str
    section_id: Optional[str] = None
    # Preferred Groq model id, or "auto"/null for automatic routing
    model: Optional[str] = None
    # Paper sections sent by the client so retrieval works statelessly,
    # with no external vector database required.
    sections: Optional[List[SectionPayload]] = None


class TextExplainRequest(BaseModel):
    text: str
    title: str = "Section"
    model: Optional[str] = None


# --- Health Check ---

@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "services": {
            "groq_key_configured": bool(os.getenv("GROQ_API_KEY")),
            "embedder": _embedder is not None,
            "rag": _rag is not None,
            "sectioner": _sectioner is not None,
        },
    }


# --- API Endpoints ---

@app.get("/api/models")
async def list_models():
    """Return the models the user can pick from (plus the 'auto' option)."""
    return RAGController.available_models_payload()


def _raise_clean_http(e: GroqAPIError):
    """Translate provider failures into clean, UI-safe HTTP errors."""
    status = 429 if e.status == 429 else 503
    raise HTTPException(status_code=status, detail=str(e))

@app.post("/api/upload")
async def upload_paper(
    file: UploadFile = File(...),
):
    """Upload and process a PDF research paper."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    try:
        sectioner = get_sectioner()
        embedder = get_embedder()
    except Exception as e:
        logger.error(f"Service init failed: {e}")
        raise HTTPException(status_code=503, detail=f"Backend services failed to start: {e}")

    try:
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        file_obj = io.BytesIO(content)


        # 2. Parse text from PDF
        raw_text = parse_pdf(file_obj)
        if not raw_text:
            raise HTTPException(
                status_code=400,
                detail="Could not extract text from PDF. The file may be scanned or corrupted.",
            )

        # 3. Split into sections
        sections = sectioner.extract_sections(raw_text)
        if not sections:
            raise HTTPException(
                status_code=400,
                detail="No recognizable sections found in the paper.",
            )

        # 4. Ingest into Pinecone (Must be synchronous on Vercel as background tasks freeze)
        embedder.ingest_sections(sections, filename=file.filename)

        # 5. Return sections
        return {
            "message": "Processing complete",
            "filename": file.filename,
            "section_count": len(sections),
            "sections": [
                {"id": i, "title": sec["title"], "content": sec["content"]}
                for i, sec in enumerate(sections)
            ],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")


@app.post("/api/ask")
async def ask_question(req: ChatRequest):
    """Ask a question about uploaded papers using RAG."""
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    try:
        embedder = get_embedder()
        rag = get_rag()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Services unavailable: {e}")

    try:
        # Prefer the paper context supplied by the client (stateless, works
        # on serverless); fall back to the in-process session index.
        if req.sections:
            context = embedder.search_sections(
                req.query,
                [s.model_dump() for s in req.sections],
                k=4,
            )
        else:
            context = embedder.search(req.query, k=4)

        if not context:
            return {
                "answer": "I couldn't find relevant information. Please upload a paper first.",
                "sources": [],
            }

        answer = rag.generate_response(context, req.query, mode="chat", model=req.model)
        # Deduplicate sources while preserving order
        sources = list(dict.fromkeys(s.get("title", "Untitled") for s in context))
        return {"answer": answer, "sources": sources}

    except GroqAPIError as e:
        _raise_clean_http(e)
    except Exception as e:
        logger.error(f"Ask failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Something went wrong while answering. Please try again.")


@app.post("/api/explain_text")
async def explain_text_endpoint(req: TextExplainRequest):
    """Explain and critique a section with ONE provider call (rate-limit friendly)."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    try:
        rag = get_rag()
    except Exception as e:
        raise HTTPException(status_code=503, detail="AI service is not configured on the server.")

    try:
        result = rag.analyze_section(req.title, req.text, model=req.model)
        return {"explanation": result["explanation"], "critique": result["critique"]}

    except GroqAPIError as e:
        _raise_clean_http(e)
    except Exception as e:
        logger.error(f"Explain failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Something went wrong during analysis. Please try again.")


# --- Static Files (local dev only, Vercel handles static separately) ---
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="static")
elif os.path.exists("frontend"):
    app.mount("/", StaticFiles(directory="frontend", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
