/**
 * PaperPilot Engine — the entire stack, client-side.
 *
 * PDF parsing (PDF.js), section extraction, TF-IDF retrieval and Groq LLM
 * calls all run locally in the browser. No backend server required.
 */
(function () {
    "use strict";

    const root = typeof window !== "undefined" ? window : globalThis;

    // ------------------------------------------------------------------
    // Model registry (chat-capable models on Groq's free tier)
    // ------------------------------------------------------------------
    const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
    const DEFAULT_MODEL = "openai/gpt-oss-120b";
    const REQUEST_TIMEOUT_MS = 90000;

    const MODELS = [
        {
            id: "auto",
            label: "Auto (recommended)",
            description: "Picks the best model per task, with automatic fallbacks",
        },
        { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", description: "Best quality reasoning" },
        { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", description: "Fastest responses" },
        { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B", description: "Balanced quality and speed" },
        { id: "allam-2-7b", label: "ALLaM 2 7B", description: "Lightweight, very fast" },
    ];

    const AUTO_FALLBACKS = [
        "openai/gpt-oss-120b",
        "qwen/qwen3.8-27b",
        "openai/gpt-oss-20b",
        "allam-2-7b",
    ];

    const MAX_TOKENS = { analysis: 1100, chat: 700 };
    const MAX_CONTEXT_CHARS = 3000;
    const MAX_CHUNK_CHARS = 800;

    // ------------------------------------------------------------------
    // Errors (user-friendly, never raw provider JSON)
    // ------------------------------------------------------------------
    class EngineError extends Error {
        constructor(kind, message, status) {
            super(message);
            this.kind = kind;       // "auth" | "rate_limit" | "unavailable"
            this.status = status || 0;
        }
    }

    const ERR_RATE_LIMITED =
        "The AI is briefly at its free-tier rate limit. Please try again in a few seconds.";
    const ERR_UNAVAILABLE = "The AI service is temporarily unavailable. Please try again shortly.";
    const ERR_NO_KEY =
        "Add your free Groq API key in the sidebar to enable AI answers.";
    const ERR_BAD_KEY =
        "That Groq API key was rejected. Check it and paste a valid key (starts with gsk_...).";

    // ------------------------------------------------------------------
    // PDF parsing (PDF.js)
    // ------------------------------------------------------------------
    let _pdfLib = null;

    function setPdfLib(lib) {
        _pdfLib = lib; // test override; the browser uses window.pdfjsLib
    }

    function getPdfLib() {
        const lib = _pdfLib || root.pdfjsLib;
        if (!lib) {
            throw new EngineError(
                "unavailable",
                "The PDF library could not be loaded. Check your internet connection and refresh."
            );
        }
        return lib;
    }

    /**
     * Extract text from a PDF given as ArrayBuffer / Uint8Array.
     * @returns {Promise<string>}
     */
    async function extractPdfText(data) {
        const lib = getPdfLib();
        const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
        if (isBrowser && lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
            lib.GlobalWorkerOptions.workerSrc =
                "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
        }

        // Normalize to a genuine Uint8Array (PDF.js rejects Node's Buffer subclass)
        const bytes =
            data instanceof Uint8Array
                ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                : new Uint8Array(data);
        const doc = await lib.getDocument({ data: bytes }).promise;

        let text = "";
        for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const content = await page.getTextContent();
            let pageText = "";
            for (const item of content.items) {
                pageText += item.str;
                pageText += item.hasEOL ? "\n" : " ";
            }
            text += pageText + "\n";
            if (doc.cleanup) page.cleanup();
        }
        if (doc.destroy) doc.destroy();
        return text.trim();
    }

    // ------------------------------------------------------------------
    // Sectioner (port of backend/sectioner.py)
    // ------------------------------------------------------------------
    const DEFAULT_HEADERS = [
        "ABSTRACT", "INTRODUCTION", "RELATED WORK", "BACKGROUND",
        "LITERATURE REVIEW", "METHODOLOGY", "METHODS", "MATERIALS AND METHODS",
        "PROPOSED APPROACH", "PROPOSED METHOD", "SYSTEM DESIGN",
        "IMPLEMENTATION", "EXPERIMENTS", "EXPERIMENTAL SETUP",
        "RESULTS", "RESULTS AND DISCUSSION", "EVALUATION",
        "DISCUSSION", "ANALYSIS", "LIMITATIONS",
        "CONCLUSION", "CONCLUSIONS", "FUTURE WORK",
        "REFERENCES", "BIBLIOGRAPHY", "ACKNOWLEDGEMENTS", "APPENDIX",
    ];

    const HEADER_RE = new RegExp(
        "^\\s*(?:\\d+\\.?\\s*|[IVXLC]+\\.?\\s*)?(" +
        DEFAULT_HEADERS.join("|") +
        ")\\.?\\s*$",
        "i"
    );

    function titleCase(s) {
        return s
            .toLowerCase()
            .replace(/\b([a-z])/g, (m, c) => c.toUpperCase())
            .replace(/^([ivxlc]+)(\.)/i, (m, num, dot) => num.toUpperCase() + dot);
    }

    function extractSections(text) {
        if (!text || !text.trim()) return [];

        const lines = text.split("\n");
        const sections = [];
        let current = { title: "Preamble", content: "" };

        for (const line of lines) {
            const stripped = line.trim();
            if (!stripped) {
                current.content += "\n";
                continue;
            }
            if (HEADER_RE.test(stripped) && stripped.length < 60) {
                if (current.content.trim()) sections.push(current);
                current = { title: titleCase(stripped.replace(/\.$/, "")), content: "" };
            } else {
                current.content += line + "\n";
            }
        }
        if (current.content.trim()) sections.push(current);
        return sections;
    }

    // ------------------------------------------------------------------
    // TF-IDF retrieval (port of backend/embeddings.py)
    // ------------------------------------------------------------------
    const STOPWORDS = new Set(
        ("a an the and or but if then else when at by for with about into through " +
            "during before after above below to from up down in out on off over under " +
            "again further once here there all any both each few more most other some " +
            "such no nor not only own same so than too very can will just should now " +
            "is are was were be been being have has had having do does did doing would " +
            "could ought i you he she it we they this that these those am of as its " +
            "their his her our your my me him them us what which who whom").split(" ")
    );

    function tokenize(text) {
        return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => !STOPWORDS.has(t));
    }

    function chunkText(text, size = 1000, overlap = 150) {
        text = text.trim();
        if (text.length <= size) return text ? [text] : [];

        const chunks = [];
        let start = 0;
        while (start < text.length) {
            let end = Math.min(start + size, text.length);
            if (end < text.length) {
                const boundary = Math.max(
                    text.lastIndexOf("\n\n", end),
                    text.lastIndexOf("\n", end),
                    text.lastIndexOf(". ", end)
                );
                if (boundary > start + size / 2) end = boundary + 1;
            }
            const chunk = text.slice(start, end).trim();
            if (chunk) chunks.push(chunk);
            if (end >= text.length) break;
            start = Math.max(end - overlap, start + 1);
        }
        return chunks;
    }

    function sectionsToDocs(sections) {
        const docs = [];
        for (const sec of sections) {
            const title = sec.title || "Untitled";
            for (const chunk of chunkText(title + "\n" + (sec.content || ""))) {
                docs.push({ title, content: chunk });
            }
        }
        return docs;
    }

    function buildIndex(docs) {
        const docTokens = docs.map((d) => tokenize(d.content));
        const df = new Map();
        for (const tokens of docTokens) {
            for (const term of new Set(tokens)) df.set(term, (df.get(term) || 0) + 1);
        }
        const n = Math.max(docs.length, 1);
        const idf = new Map();
        for (const [term, count] of df) idf.set(term, Math.log((1 + n) / (1 + count)) + 1);

        const vectors = docTokens.map((tokens) => {
            if (!tokens.length) return new Map();
            const tf = new Map();
            for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
            const vec = new Map();
            for (const [term, count] of tf) vec.set(term, (count / tokens.length) * idf.get(term));
            const norm = Math.sqrt([...vec.values()].reduce((s, w) => s + w * w, 0)) || 1;
            for (const [term, w] of vec) vec.set(term, w / norm);
            return vec;
        });

        return { docs, idf, vectors };
    }

    function searchIndex(index, query, k = 4) {
        const tokens = tokenize(query);
        if (!tokens.length) return [];

        const tf = new Map();
        for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
        const qvec = new Map();
        for (const [term, count] of tf) {
            if (index.idf.has(term)) qvec.set(term, (count / tokens.length) * index.idf.get(term));
        }
        const qnorm = Math.sqrt([...qvec.values()].reduce((s, w) => s + w * w, 0)) || 1;
        for (const [term, w] of qvec) qvec.set(term, w / qnorm);

        const scored = [];
        index.vectors.forEach((dvec, i) => {
            let score = 0;
            for (const [term, w] of qvec) score += w * (dvec.get(term) || 0);
            if (score > 0) scored.push({ ...index.docs[i], score });
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, k);
    }

    function retrieve(query, sections, k = 4) {
        const docs = sectionsToDocs(sections || []);
        if (!docs.length) return [];
        return searchIndex(buildIndex(docs), query, k);
    }

    // ------------------------------------------------------------------
    // Groq client with retry / backoff / model fallback
    // ------------------------------------------------------------------
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function resolveChain(requested) {
        if (requested && requested !== "auto" && MODELS.some((m) => m.id === requested)) {
            return [requested];
        }
        return AUTO_FALLBACKS.slice(); // primary first, then fallbacks
    }

    async function singleCall(key, model, messages, maxTokens) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let res;
        try {
            const isTrial = key === "trial";
            const endpoint = isTrial ? "/api/groq" : GROQ_API_URL;
            const headers = { "Content-Type": "application/json" };
            if (!isTrial) {
                headers["Authorization"] = `Bearer ${key}`;
            }

            res = await fetch(endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: 0.3,
                    max_tokens: maxTokens,
                }),
                signal: controller.signal,
            });
        } catch (e) {
            clearTimeout(timer);
            throw new EngineError("unavailable", "Network error reaching the AI service.", 0);
        }
        clearTimeout(timer);

        if (res.ok) {
            const data = await res.json();
            return data.choices[0].message.content;
        }

        const detail = (await res.text().catch(() => "")).slice(0, 400);

        if (res.status === 429) {
            const m = /try again in ([\d.]+)\s*s/i.exec(detail);
            const err = new EngineError("rate_limit", "rate limited", 429);
            err.waitSeconds = m ? parseFloat(m[1]) : 0;
            throw err;
        }
        if (res.status === 401 || res.status === 403) {
            throw new EngineError("auth", ERR_BAD_KEY, res.status);
        }
        // 400/404 (unknown model) and 5xx -> let caller fall back / retry
        throw new EngineError("unavailable", `provider error ${res.status}`, res.status);
    }

    /**
     * Core call: tries each model in the chain; retries 429s with wait.
     */
    async function chatComplete(key, system, user, { mode = "chat", model = null } = {}) {
        if (!key) throw new EngineError("auth", ERR_NO_KEY, 401);

        const chain = resolveChain(model);
        const maxTokens = MAX_TOKENS[mode] || 700;
        const messages = [
            { role: "system", content: system },
            { role: "user", content: user },
        ];

        let lastErr = null;
        for (let mi = 0; mi < chain.length; mi++) {
            const current = chain[mi];
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const text = await singleCall(key, current, messages, maxTokens);
                    return { text: text.trim(), model: current };
                } catch (e) {
                    if (!(e instanceof EngineError)) throw e;
                    lastErr = e;
                    if (e.kind === "auth") throw e; // bad key — no point retrying
                    if (e.kind === "rate_limit") {
                        if (attempt < 2 && mi === 0) {
                            await sleep(Math.min((e.waitSeconds || 5) + 1.5, 30) * 1000);
                            continue;
                        }
                        break; // next model
                    }
                    // transient provider/network error
                    if (attempt < 2) {
                        await sleep(2000 * (attempt + 1));
                        continue;
                    }
                    break; // next model
                }
            }
        }

        if (lastErr && lastErr.kind === "rate_limit") {
            throw new EngineError("rate_limit", ERR_RATE_LIMITED, 429);
        }
        throw new EngineError("unavailable", ERR_UNAVAILABLE, 503);
    }

    // ------------------------------------------------------------------
    // Prompts: short, bulleted, no headings
    // ------------------------------------------------------------------
    const SYSTEM_CHAT =
        "You are an AI Research Copilot. Answer the question using ONLY the provided context chunks. " +
        "Rules: MAX 150 words. Use short bullet points. **Bold** key terms. No headings, no tables, " +
        "no code fences. If the context does not contain the answer, say so in one sentence.";

    const SYSTEM_ANALYSIS =
        "You are an expert academic tutor and peer reviewer. Analyze the provided section of a research " +
        "paper and respond with VALID JSON ONLY - no preamble, no code fences.\n\n" +
        "Use exactly this structure:\n" +
        "{\n" +
        '  "explanation": "Markdown string, MAX 150 words. Explain the section to an undergraduate CS ' +
        'student using 3-6 short bullet points. **Bold** key terms. No headings, no code blocks.",\n' +
        '  "summary": "1-2 sentence summary of the section",\n' +
        '  "strengths": ["short point", "short point"],\n' +
        '  "weaknesses": [{"point": "short name", "description": "one sentence why"}],\n' +
        '  "suggestions": ["short actionable suggestion", "short actionable suggestion"]\n' +
        "}\n" +
        "Keep every field concise. 2-4 items for strengths, weaknesses and suggestions.";

    function parseJsonResponse(text) {
        const src = (text || "").trim();
        try {
            const fence = /```(?:json)?\s*(\{[\s\S]*\})\s*```/.exec(src);
            if (fence) return JSON.parse(fence[1]);
            const match = /\{[\s\S]*\}/.exec(src);
            if (match) return JSON.parse(match[0]);
            return JSON.parse(src);
        } catch {
            return { error: "Invalid JSON format", raw_text: text };
        }
    }

    function formatCritique(data) {
        const parts = [];
        const summary = String(data.summary || "").trim();
        if (summary) parts.push(`**Summary:** ${summary}`);

        const strengths = Array.isArray(data.strengths) ? data.strengths.slice(0, 4) : [];
        if (strengths.length) parts.push("**Strengths**\n" + strengths.map((s) => `- ${s}`).join("\n"));

        const weaknesses = Array.isArray(data.weaknesses) ? data.weaknesses.slice(0, 4) : [];
        if (weaknesses.length) {
            const lines = weaknesses.map((w) =>
                typeof w === "object" && w !== null
                    ? `- **${w.point || "Issue"}** - ${w.description || ""}`
                    : `- ${w}`
            );
            parts.push("**Weaknesses**\n" + lines.join("\n"));
        }

        const suggestions = Array.isArray(data.suggestions) ? data.suggestions.slice(0, 4) : [];
        if (suggestions.length) {
            parts.push("**Suggestions**\n" + suggestions.map((s) => `- ${s}`).join("\n"));
        }
        return parts.join("\n\n");
    }

    /**
     * Combined explanation + critique in ONE provider call.
     * @returns {Promise<{explanation: string, critique: string}>}
     */
    async function analyzeSection({ key, title, content, model }) {
        const excerpt = String(content || "").slice(0, MAX_CONTEXT_CHARS);
        const user = `Section title: "${title}"\n\nSection content:\n${excerpt}`;
        const { text } = await chatComplete(key, SYSTEM_ANALYSIS, user, { mode: "analysis", model });

        const data = parseJsonResponse(text);
        if (data.error) {
            return { explanation: text.trim(), critique: "" };
        }
        return {
            explanation: String(data.explanation || "").trim() || "No explanation generated.",
            critique: formatCritique(data),
        };
    }

    /**
     * Grounded Q&A over the loaded paper.
     * @returns {Promise<{answer: string, sources: string[]}>}
     */
    async function askAboutPaper({ key, query, sections, model }) {
        const context = retrieve(query, sections, 4);
        if (!context.length) {
            return {
                answer: "I couldn't find relevant information in the paper for that question.",
                sources: [],
            };
        }

        const ctxText = context
            .map((c) => `${c.title}: ${String(c.content).slice(0, MAX_CHUNK_CHARS)}`)
            .join("\n\n")
            .slice(0, MAX_CONTEXT_CHARS);

        const user = `Context:\n${ctxText}\n\nQuestion: ${query}`;
        const { text } = await chatComplete(key, SYSTEM_CHAT, user, { mode: "chat", model });

        const sources = [...new Set(context.map((c) => c.title))];
        return { answer: text, sources };
    }

    // ------------------------------------------------------------------
    root.PaperPilotEngine = {
        MODELS,
        DEFAULT_MODEL,
        EngineError,
        setPdfLib,
        extractPdfText,
        extractSections,
        retrieve,
        analyzeSection,
        askAboutPaper,
        chatComplete, // exposed for testing
    };
})();
