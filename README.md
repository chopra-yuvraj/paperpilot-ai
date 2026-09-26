# PaperPilot AI - Intelligent Research Assistant
[![No Backend](https://img.shields.io/badge/Backend-None%20Needed-34d399?style=for-the-badge&logo=googlechrome&logoColor=white)](#getting-started)
[![Groq](https://img.shields.io/badge/Groq-Powered-F55036?style=for-the-badge&logo=groq&logoColor=white)](https://groq.com/)
[![JavaScript](https://img.shields.io/badge/Vanilla_JS-ES6%2B-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

---

## Why PaperPilot AI?
As a **B.Tech CSE student at VIT** and **B.S. Data Science student at IIT Madras**, I realized that understanding complex research papers is a barrier for many students and researchers.
This project bridges the gap between **academic density** and **accessible knowledge**. It uses advanced Retrieval-Augmented Generation (RAG) to not just summarize, but *explain* and *critique* papers section-by-section using a modern, "Glassmorphism" UI.

### Key Features
- **Smart Sectioning** - Automatically parses PDF research papers and breaks them down into logical sections (Abstract, Methodology, Experiments).
- **Context-Aware RAG** - Lightweight built-in TF-IDF retrieval grounds every answer in the specific text of the paper.
- **AI Critic** - A dedicated "Critic" agent that identifies weak assumptions, missing citations, and potential methodological flaws.
- **"Glass" Aesthetic** - A premium, dark-mode interface with frosted glass effects and smooth transitions.
- **Model Switching** - Pick any available Groq model from the sidebar, or leave it on **Auto** to route each task to the best model with automatic fallbacks.
- **Rate-Limit Resilient** - Automatic retries with backoff, combined analysis calls, and client-side caching keep the app smooth on free-tier limits.
- **100% Free Forever** - No paid cloud services. Retrieval runs in-app, persistence uses the browser's local storage, and the LLM runs on Groq's free tier.

---

### Application Interaction
| Feature | Action | Experience |
|---------|--------|------------|
| **Paper Upload** | Drag & Drop PDF | System parses structure and indexes content in seconds. |
| **Section Deep Dive** | Click any Section | The AI "reads" that specific section and explains it in simple terms. |
| **Critical Analysis** | "Critique" Button | The AI switches modes to become a reviewer, highlighting flaws and gaps. |
| **Interactive Q&A** | Ask a Question | RAG pipeline retrieves relevant chunks and synthesizes a grounded answer. |

### Engineering Highlights
- **Fully Client-Side**: No backend server at all. PDF parsing (PDF.js), sectioning, retrieval, and AI calls all run locally in the user's browser.
- **AI Engine**: The browser talks directly to the **Groq API** (`openai/gpt-oss-120b` and friends) - fast, free-tier LLM generation.
- **Retrieval**: Zero-dependency **TF-IDF retrieval** in plain JavaScript - no vector database, no embeddings API.
- **Persistence**: The paper, chat history, model choice, and the user's Groq key live in the browser's **localStorage** - nothing is sent anywhere except Groq.
- **Frontend**: Pure **HTML5/CSS3/JS** with no heavy frameworks, focusing on performance and raw DOM manipulation.

---

## Getting Started

### Prerequisites
- A modern browser
- A free **[Groq API key](https://console.groq.com/keys)** (takes 30 seconds to create)

### Run Locally
No installation, no build step, no server:
```bash
git clone https://github.com/chopra-yuvraj/paperpilot-ai.git
cd paperpilot-ai/frontend
# Option A: just open index.html in your browser
# Option B: serve it statically (any static server works)
python -m http.server 8000   # then open http://localhost:8000
```
1. Paste your **Groq API key** in the sidebar (it is stored only in your browser).
2. Upload a PDF - it is parsed locally, never uploaded anywhere.
3. Chat, get explanations and critiques.

### Deploy to Vercel (or any static host)
1. Push this repo to GitHub and import it in Vercel - that's it.
2. No environment variables, no serverless functions. Each visitor adds their own free Groq key.
3. `vercel.json` serves the `frontend/` folder at the site root.

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
