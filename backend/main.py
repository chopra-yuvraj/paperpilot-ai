from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
import shutil
import os
import uuid

# Import our modules
from backend.pdf_parser import parse_pdf
from backend.sectioner import Sectioner
from backend.embeddings import EmbeddingEngine
from backend.rag import RAGController
from backend.critic import Critic

app = FastAPI()

# Global state for the demo (single user session effectively)
class AppState:
    def __init__(self):
        self.sections = []
        self.embedder = EmbeddingEngine()
        self.rag = RAGController()
        self.critic = Critic(self.rag)
        self.current_filename = ""

state = AppState()

# Models
class SectionResponse(BaseModel):
    id: int
    title: str
    content: str # Truncated for preview if needed

class ChatRequest(BaseModel):
    query: str
    section_id: Optional[int] = None # If focused on a specific section

class ExplainRequest(BaseModel):
    section_id: int

# --- Endpoints ---

@app.post("/upload")
async def upload_paper(file: UploadFile = File(...)):
    global state
    
    upload_dir = "data/papers"
    os.makedirs(upload_dir, exist_ok=True)
    
    file_path = os.path.join(upload_dir, f"{uuid.uuid4()}_{file.filename}")
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # Process
    try:
        raw_text = parse_pdf(file_path)
        if not raw_text:
            raise HTTPException(status_code=400, detail="Could not extract text from PDF.")
            
        sectioner = Sectioner()
        state.sections = sectioner.extract_sections(raw_text)
        
        # Embed
        state.embedder.ingest_sections(state.sections)
        state.current_filename = file.filename
        
        return {
            "filename": file.filename,
            "sections": [{"id": i, "title": s['title']} for i, s in enumerate(state.sections)]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/sections")
async def get_sections():
    return [{"id": i, "title": s['title']} for i, s in enumerate(state.sections)]

@app.get("/section/{section_id}")
async def get_section_detail(section_id: int):
    if section_id < 0 or section_id >= len(state.sections):
        raise HTTPException(status_code=404, detail="Section not found")
    return state.sections[section_id]

@app.post("/ask")
async def ask_question(req: ChatRequest):
    if not state.sections:
        raise HTTPException(status_code=400, detail="No paper uploaded.")
    
    # Retrieval
    if req.section_id is not None:
        # Focused retrieval: just that section + maybe semantic search?
        # For simplicity, we prioritize that section but still perform search to see global context?
        # Actually user wants "Link answers back to original paper sections".
        # Let's use the semantic search primarily.
        context = state.embedder.search(req.query, k=3)
        # Force add the focused section if not present?
        focused_sec = state.sections[req.section_id]
        if focused_sec not in context:
            context.insert(0, focused_sec)
    else:
        context = state.embedder.search(req.query, k=3)
        
    answer = state.rag.generate_response(context, req.query, mode="explain")
    
    # Format sources
    sources = [s['title'] for s in context]
    
    return {
        "answer": answer,
        "sources": list(set(sources))
    }

@app.post("/explain_section")
async def explain_section(req: ExplainRequest):
    if not state.sections:
        raise HTTPException(status_code=400, detail="No paper uploaded.")
        
    target_section = state.sections[req.section_id]
    explanation = state.rag.generate_response([target_section], "Explain this section in simple terms.", mode="explain")
    critique = state.critic.critique_section(target_section)
    
    return {
        "explanation": explanation,
        "critique": critique
    }

# Mount frontend
app.mount("/", StaticFiles(directory="frontend", html=True), name="static")
