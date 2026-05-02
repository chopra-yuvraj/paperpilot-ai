import os
import io
import uuid
import logging

from dotenv import load_dotenv

# Load environment variables BEFORE any module that reads them
load_dotenv()

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
from contextlib import asynccontextmanager

from backend.pdf_parser import parse_pdf
from backend.sectioner import Sectioner
from backend.embeddings import EmbeddingEngine
from backend.rag import RAGController
from backend.supabase_client import supabase

# --- Logging ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("paperpilot")

# --- Global Services ---
embedder: Optional[EmbeddingEngine] = None
rag: Optional[RAGController] = None
sectioner: Optional[Sectioner] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle: initialize services on startup, cleanup on shutdown."""
    global embedder, rag, sectioner

    logger.info("Starting PaperPilot AI...")

    try:
        sectioner = Sectioner()
        logger.info("✓ Sectioner initialized.")

        embedder = EmbeddingEngine()
        embedder.ensure_index_exists()
        logger.info("✓ Embedding engine initialized.")

        rag = RAGController()
        logger.info("✓ RAG controller initialized.")

    except Exception as e:
        logger.error(f"✗ Startup failed: {e}")
        logger.warning("Some features may be unavailable.")

    logger.info("PaperPilot AI is ready.")
    yield

    logger.info("Shutting down PaperPilot AI...")


app = FastAPI(
    title="PaperPilot AI",
    description="Intelligent Research Paper Analysis Assistant",
    version="1.0.0",
    lifespan=lifespan,
)

# TODO (Production): Replace "*" with your actual frontend domain(s)
# e.g. allow_origins=["https://paperpilot.yourdomain.com"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request / Response Models ---


class ChatRequest(BaseModel):
    query: str
    section_id: Optional[str] = None


class TextExplainRequest(BaseModel):
    text: str
    title: str = "Section"


# --- Health Check ---


@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring."""
    return {
        "status": "ok",
        "services": {
            "embedder": embedder is not None,
            "rag": rag is not None,
            "sectioner": sectioner is not None,
            "supabase": supabase is not None,
        },
    }


# --- API Endpoints ---


@app.post("/upload")
async def upload_paper(file: UploadFile = File(...), background_tasks: BackgroundTasks = BackgroundTasks()):
    """Upload and process a PDF research paper."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    if not sectioner or not embedder:
        raise HTTPException(
            status_code=503,
            detail="Backend services not ready. Please try again shortly.",
        )

    try:
        content = await file.read()

        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        file_obj = io.BytesIO(content)

        # 1. Upload to Supabase Storage (optional, non-blocking)
        storage_filename = f"{uuid.uuid4()}_{file.filename}"
        if supabase:
            try:
                supabase.storage.from_("papers").upload(storage_filename, content)
                logger.info(f"Uploaded to Supabase: {storage_filename}")
            except Exception as e:
                logger.warning(f"Supabase upload failed (non-fatal): {e}")

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
                detail="No recognizable sections found. The paper format may not be supported.",
            )

        # 4. Ingest into Pinecone (background to avoid HTTP timeout on large papers)
        background_tasks.add_task(embedder.ingest_sections, sections, file.filename)

        # 5. Return sections to frontend
        response_sections = [
            {"id": i, "title": sec["title"], "content": sec["content"]}
            for i, sec in enumerate(sections)
        ]

        return {
            "message": "Processing complete",
            "filename": file.filename,
            "section_count": len(response_sections),
            "sections": response_sections,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")


@app.post("/ask")
async def ask_question(req: ChatRequest):
    """Ask a question about uploaded papers using RAG."""
    if not embedder or not rag:
        raise HTTPException(
            status_code=503,
            detail="Backend services not ready. Please try again shortly.",
        )

    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    try:
        context = embedder.search(req.query, k=5)

        if not context:
            return {
                "answer": "I couldn't find any relevant information in the uploaded documents. "
                "Please make sure a paper has been uploaded first.",
                "sources": [],
            }

        answer = rag.generate_response(context, req.query, mode="explain")
        sources = list(set(s.get("title", "Untitled") for s in context))

        return {"answer": answer, "sources": sources}

    except Exception as e:
        logger.error(f"Ask failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/explain_text")
async def explain_text_endpoint(req: TextExplainRequest):
    """Explain and critique a specific section of text."""
    if not rag:
        raise HTTPException(
            status_code=503,
            detail="RAG service not ready. Please try again shortly.",
        )

    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    try:
        chunk = {"title": req.title, "content": req.text}

        explanation = rag.generate_response(
            [chunk], "Explain this section in simple terms.", mode="explain"
        )
        critique = rag.generate_response(
            [chunk], "Critique this section.", mode="critique"
        )

        return {"explanation": explanation, "critique": critique}

    except Exception as e:
        logger.error(f"Explain failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# --- Static Files ---
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="static")
elif os.path.exists("frontend"):
    app.mount("/", StaticFiles(directory="frontend", html=True), name="static")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
