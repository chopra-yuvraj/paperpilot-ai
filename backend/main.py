from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
import shutil
import os
import uuid

# importing my modules
from backend.pdf_parser import parse_pdf
from backend.sectioner import Sectioner
from backend.embeddings import EmbeddingEngine
from backend.rag import RAGController
from backend.critic import Critic

app = FastAPI()

# keeping the state here for the demo
class AppState:
    def __init__(self):
        self.sections = []
        self.embedder = EmbeddingEngine()
        self.rag = RAGController()
        self.critic = Critic(self.rag)
        self.current_filename = ""

state = AppState()

# request models
class SectionResponse(BaseModel):
    id: int
    title: str
    content: str

class ChatRequest(BaseModel):
    query: str
    section_id: Optional[int] = None 

class ExplainRequest(BaseModel):
    section_id: int

# --- API Endpoints ---

@app.post("/upload")
async def upload_paper(file: UploadFile = File(...)):
    global state
    
    # making sure folder exists
    upload_dir = "data/papers"
    if not os.path.exists(upload_dir):
        os.makedirs(upload_dir)
    
    # save file temp
    file_path = os.path.join(upload_dir, f"{uuid.uuid4()}_{file.filename}")
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    try:
        # 1. parse text
        raw_text = parse_pdf(file_path)
        if not raw_text:
            raise HTTPException(status_code=400, detail="Could not extract text from PDF.")
            
        # 2. split into sections
        sectioner = Sectioner()
        state.sections = sectioner.extract_sections(raw_text)
        
        # 3. create embeddings
        state.embedder.ingest_sections(state.sections)
        state.current_filename = file.filename
        
        # return list of sections
        res = []
        for i, s in enumerate(state.sections):
            res.append({"id": i, "title": s['title']})
            
        return {
            "filename": file.filename,
            "sections": res
        }
    except Exception as e:
        print(e)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/sections")
async def get_sections():
    # just return the list
    return [{"id": i, "title": s['title']} for i, s in enumerate(state.sections)]

@app.get("/section/{section_id}")
async def get_section_detail(section_id: int):
    # check bounds
    if section_id < 0 or section_id >= len(state.sections):
        raise HTTPException(status_code=404, detail="Section not found")
    return state.sections[section_id]

@app.post("/ask")
async def ask_question(req: ChatRequest):
    if not state.sections:
        raise HTTPException(status_code=400, detail="No paper uploaded.")
    
    # get context
    if req.section_id is not None:
        # focus on one section
        context = state.embedder.search(req.query, k=3)
        # make sure to add the current one
        focused_sec = state.sections[req.section_id]
        if focused_sec not in context:
            context.insert(0, focused_sec)
    else:
        # global search
        context = state.embedder.search(req.query, k=3)
        
    answer = state.rag.generate_response(context, req.query, mode="explain")
    
    # get sources
    sources = []
    for s in context:
        sources.append(s['title'])
    
    return {
        "answer": answer,
        "sources": list(set(sources))
    }

@app.post("/explain_section")
async def explain_section(req: ExplainRequest):
    if not state.sections:
        raise HTTPException(status_code=400, detail="No paper uploaded.")
        
    target = state.sections[req.section_id]
    
    # ask ai
    explanation = state.rag.generate_response([target], "Explain this section in simple terms.", mode="explain")
    critique = state.critic.critique_section(target)
    
    return {
        "explanation": explanation,
        "critique": critique
    }

# serve frontend
app.mount("/", StaticFiles(directory="frontend", html=True), name="static")
