from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os
import uuid
import io

# Importing modules
from backend.pdf_parser import parse_pdf
from backend.sectioner import Sectioner
from backend.embeddings import EmbeddingEngine
from backend.rag import RAGController
from backend.supabase_client import supabase

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Services
embedder = EmbeddingEngine()
rag = RAGController()
sectioner = Sectioner()

# Request Models
class ChatRequest(BaseModel):
    query: str
    section_id: Optional[str] = None

class TextExplainRequest(BaseModel):
    text: str
    title: str = "Section"

# --- API Endpoints ---

@app.post("/upload")
async def upload_paper(file: UploadFile = File(...)):
    try:
        content = await file.read()
        file_obj = io.BytesIO(content)
        
        # 1. Upload to Supabase Storage
        filename = f"{uuid.uuid4()}_{file.filename}"
        if supabase:
            try:
                supabase.storage.from_("papers").upload(filename, content)
            except Exception as e:
                print(f"Supabase upload error: {e}")

        # 2. Parse text
        raw_text = parse_pdf(file_obj)
        if not raw_text:
            raise HTTPException(status_code=400, detail="Could not extract text from PDF.")
            
        # 3. Split into sections
        sections = sectioner.extract_sections(raw_text)
        
        # 4. Ingest into Pinecone
        # We process ingestion in background or await it. 
        # For responsiveness, awaiting is safer to ensure RAG works immediately.
        embedder.ingest_sections(sections, filename=file.filename)
        
        # 5. Return sections to Frontend (Stateless architecture: Client holds view state)
        # Add IDs for the frontend to use
        response_sections = []
        for i, sec in enumerate(sections):
            response_sections.append({
                "id": i, # Simple index-based ID for frontend
                "title": sec['title'],
                "content": sec['content']
            })
            
        return {
            "message": "Processing complete",
            "filename": file.filename,
            "sections": response_sections
        }
        
    except Exception as e:
        print(f"Upload failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ask")
async def ask_question(req: ChatRequest):
    try:
        context = embedder.search(req.query, k=5)
        
        if not context:
             return {
                 "answer": "I couldn't find any relevant information in the uploaded documents.",
                 "sources": []
             }

        answer = rag.generate_response(context, req.query, mode="explain")
        sources = list(set([s.get('title', 'Untitled') for s in context]))
        
        return {
            "answer": answer,
            "sources": sources
        }
    except Exception as e:
        print(f"Ask failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/explain_text")
async def explain_text_endpoint(req: TextExplainRequest):
    """
    Stateless explanation: Frontend sends the text, Backend explains it.
    """
    try:
        # Wrap text in a structure expected by RAG
        chunk = {"title": req.title, "content": req.text}
        
        explanation = rag.generate_response([chunk], "Explain this section in simple terms.", mode="explain")
        critique = rag.generate_response([chunk], "Critique this section.", mode="critique")
        
        return {
            "explanation": explanation,
            "critique": critique
        }
    except Exception as e:
         print(f"Explain failed: {e}")
         raise HTTPException(status_code=500, detail=str(e))

# Static Files
if os.path.exists("frontend"):
    app.mount("/", StaticFiles(directory="frontend", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
