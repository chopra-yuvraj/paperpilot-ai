# PaperPilot AI - Intelligent Research Assistant
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.95%2B-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Hugging Face](https://img.shields.io/badge/Hugging_Face-Powered-FFD21E?style=for-the-badge&logo=huggingface&logoColor=black)](https://huggingface.co/)
[![JavaScript](https://img.shields.io/badge/Vanilla_JS-ES6%2B-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

---

## Why PaperPilot AI?
As a **B.Tech CSE student at VIT** and **B.S. Data Science student at IIT Madras**, I realized that understanding complex research papers is a barrier for many students and researchers.
This project bridges the gap between **academic density** and **accessible knowledge**. It uses advanced Retrieval-Augmented Generation (RAG) to not just summarize, but *explain* and *critique* papers section-by-section using a modern, "Glassmorphism" UI.

### Key Features
- **Smart Sectioning** - Automatically parses PDF research papers and breaks them down into logical sections (Abstract, Methodology, Experiments).
- **Context-Aware RAG** - Uses vector embeddings (FAISS) to ground every answer in the specific text of the paper.
- **AI Critic** - A dedicated "Critic" agent that identifies weak assumptions, missing citations, and potential methodological flaws.
- **"Glass" Aesthetic** - A premium, dark-mode interface with frosted glass effects and smooth transitions.
- **Free-Tier Optimized** - Engineered to run efficiently on low-memory environments (512MB RAM) using API-based inference.

---

### Application Interaction
| Feature | Action | Experience |
|---------|--------|------------|
| **Paper Upload** | Drag & Drop PDF | System parses structure, indexing content into vector space in seconds. |
| **Section Deep Dive** | Click any Section | The AI "reads" that specific section and explains it in simple terms. |
| **Critical Analysis** | "Critique" Button | The AI switches modes to become a reviewer, highlighting flaws and gaps. |
| **Interactive Q&A** | Ask a Question | RAG pipeline retrieves relevant chunks and synthesizes a grounded answer. |

### Engineering Highlights
- **Backend**: Built on **FastAPI** for high-performance, asynchronous request handling.
- **AI Engine**: Leverages **Hugging Face Inference API** (Mistral-7B / MiniLM) for embeddings and generation without local hardware overhead.
- **Vector DB**: **FAISS** (Facebook AI Similarity Search) for millisecond-latency semantic retrieval.
- **Frontend**: Pure **HTML5/CSS3/JS** with no heavy frameworks, focusing on performance and raw DOM manipulation.

---

## Future Enhancements
Ideas for the next version:
- [ ] **Multi-Paper Chat** - Synthesize answers across multiple uploaded papers.
- [ ] **Citation Graph** - Visualize how the paper connects to other works.
- [ ] **Audio Overview** - Generate a podcast-style summary of the paper.
- [ ] **Highlighting** - Interactive text highlighting in the original PDF view.
- [ ] **User Accounts** - Save research libraries and chat history.

---

## License
This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for full details.

---

## Acknowledgments
Special recognition to:
- **My professors at VIT Vellore** for the strong foundational knowledge.
- **IIT Madras Data Science** curriculum for the deep dive into ML algorithms.
- **Hugging Face** for democratizing access to state-of-the-art models.

---

## About the Developer

**Yuvraj Chopra**  
*B.Tech Computer Science Engineering - VIT Vellore*  
*B.S. Data Science - IIT Madras*  
Vellore, Tamil Nadu, India

*Passionate about building AI tools that make knowledge more accessible. Currently exploring the intersection of Generative AI and Education.*

### Connect With Me

[![GitHub](https://img.shields.io/badge/GitHub-chopra--yuvraj-181717?style=for-the-badge&logo=github)](https://github.com/chopra-yuvraj)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-chopra--yuvraj-0A66C2?style=for-the-badge&logo=linkedin)](https://www.linkedin.com/in/chopra-yuvraj)
[![Email](https://img.shields.io/badge/Email-yuvrajchopra19%40gmail.com-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:yuvrajchopra19@gmail.com)

---

<div align="center">

**Made with ❤️ and ☕ by Yuvraj Chopra**

[ **View on GitHub**](https://github.com/chopra-yuvraj/paperpilot-ai)

</div>
