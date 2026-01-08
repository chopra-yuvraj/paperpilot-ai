# 📑 PaperPilot -> AI Research Paper Explainer & Critic

PaperPilot is a "Research Copilot" web application that helps students understand complex technical papers. It parses PDFs, segments them into logical sections, provides simplified explanations, and critiques the content using an AI pipeline.

## 🚀 Features

- **Section-Aware Analysis**: Automatically splits papers into Abstract, Introduction, Methods, etc.
- **Simplified Explanations**: "Explain Like I'm 5" mode for complex math and theories.
- **AI Critic**: Identifies assumptions, weaknesses, and potential improvements (Critic Mode).
- **RAG Pipeline**: Retrieves relevant context from the paper to answer questions grounded in facts.
- **Free Tech Stack**: Uses open-source Mistral-7B via HuggingFace Inference API (No paid keys required).

## 🛠️ Tech Stack

**Backend**
- Python 3.9+
- **FastAPI**: High-performance API server.
- **PyPDF2/pdfplumber**: PDF text extraction.
- **SentenceTransformers**: `all-MiniLM-L6-v2` for embeddings.
- **FAISS**: Vector database for efficient retrieval.
- **HuggingFace Hub**: LLM Inference.

**Frontend**
- Plain HTML5, CSS3, Vanilla JavaScript.
- Clean, academic-style UI.

## 📦 Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/chopra-yuvraj/paperpilot-ai
    cd paperpilot-ai
    ```

2.  **Install Dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

3.  **Environment Setup**:
    - (Optional) detailed critique works better with a HuggingFace Token.
    - Set `HF_TOKEN` in your environment variables if you hit rate limits.

## 🏃‍♂️ Usage

1.  **Run the Server**:
    ```bash
    uvicorn backend.main:app --reload
    ```

2.  **Open the App**:
    - Go to `http://localhost:8000` in your browser.

3.  **Upload & Analyze**:
    - Upload a research paper (PDF).
    - Click on sections to read them and see AI explanations.
    - Use the Chat panel to ask specific questions.

## 📁 Project Structure

```
/paperpilot-ai
├── backend/
│   ├── main.py          # FastAPI Entry Point
│   ├── pdf_parser.py    # Text Extraction
│   ├── sectioner.py     # Content Segmentation
│   ├── embeddings.py    # Vector Search Engine
│   ├── rag.py           # LLM Pipeline
│   └── critic.py        # Critique Logic
├── frontend/
│   ├── index.html       # UI Layout
│   ├── style.css        # Styling
│   └── script.js        # Logic & Fetch calls
├── data/
│   └── papers/          # Uploaded files
└── requirements.txt
```

## ⚠️ Notes & Limitations
- **Free API Limits**: The default HuggingFace Inference API may rate limit usage. For production, add a pro token or swap the LLM endpoint.
- **Parsing**: Complex layouts (two-column) are handled by `pdfplumber`, but very old headers might need regex tuning.

## 🔮 Future Improvements
- **Knowledge Graph Visualization**: Visual node-link diagram of concepts.
- **Citation Graph**: Automatic extraction of references.
- **Local LLM Support**: Run LLaMA-2 locally with `llama.cpp` for offline privacy.
