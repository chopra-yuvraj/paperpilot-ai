// === Configuration ===
// Resolve the API origin:
// - Opened as a file or from a different local port (e.g. VS Code Live Server)
//   -> talk to the local backend on port 8000.
// - Otherwise (uvicorn serving the app, or a Vercel deployment) -> same origin.
const API_BASE = (() => {
    const { protocol, hostname, port, origin } = window.location;
    if (protocol === "file:") return "http://localhost:8000";
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
    if (isLocal && port !== "" && port !== "8000") return "http://localhost:8000";
    return origin;
})();

// === DOM References ===
const $ = (id) => document.getElementById(id);
const uploadBtn = $("upload-btn");
const fileInput = $("file-input");
const sectionsList = $("sections-list");
const fileStatus = $("file-status");
const fileStatusText = $("file-status-text");
const placeholderMsg = $("placeholder-msg");
const welcomeState = $("welcome-state");
const readingView = $("reading-view");
const sectionNumber = $("section-number");
const sectionTitle = $("section-title");
const sectionContent = $("section-content");
const analysisPanel = $("analysis-panel");
const aiExplanation = $("ai-explanation");
const aiCritique = $("ai-critique");
const chatQuery = $("chat-query");
const sendChatBtn = $("send-chat");
const chatHistory = $("chat-history");
const chatStatus = $("chat-status");
const uploadOverlay = $("upload-overlay");
const uploadStatusTitle = $("upload-status-title");
const uploadStatusDetail = $("upload-status-detail");
const sidebarToggle = $("sidebar-toggle");
const sidebar = $("sidebar");
const modelSelect = $("model-select");

// === State ===
let appSections = [];
let activeSectionIndex = -1;
let isProcessing = false;
let currentPaperKey = null;

function makePaperKey(filename, sectionCount) {
    return `${filename || "paper"}::${sectionCount}`;
}

// Analysis cache (per paper) - clicking a section again costs zero API calls
const analysisInFlight = new Set();

function getCachedAnalysis(index) {
    const store = storageGet(STORAGE_KEYS.analysis);
    if (!store || store.paperKey !== currentPaperKey || !store.sections) return null;
    return store.sections[index] || null;
}

function setCachedAnalysis(index, data) {
    let store = storageGet(STORAGE_KEYS.analysis);
    if (!store || store.paperKey !== currentPaperKey) {
        store = { paperKey: currentPaperKey, sections: {} };
    }
    store.sections[index] = {
        explanation: data.explanation || "",
        critique: data.critique || "",
    };
    storageSet(STORAGE_KEYS.analysis, store);
}

// === Local Persistence (browser localStorage — no cloud database) ===
const STORAGE_KEYS = {
    paper: "paperpilot.paper",
    chat: "paperpilot.chat",
    model: "paperpilot.model",
    analysis: "paperpilot.analysis",
};

function storageSet(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Quota exceeded or private browsing — persistence is best-effort.
    }
}

function storageGet(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function storageRemove(key) {
    try {
        localStorage.removeItem(key);
    } catch { /* ignore */ }
}

function persistPaper(filename) {
    // Cap stored content so we stay well under the ~5MB localStorage quota.
    const totalChars = appSections.reduce((n, s) => n + (s.content || "").length, 0);
    if (totalChars > 3 * 1024 * 1024) return;
    storageSet(STORAGE_KEYS.paper, { filename, sections: appSections });
}

function persistChatHistory() {
    const msgs = [];
    chatHistory.querySelectorAll(".msg").forEach((el) => {
        if (el.id === "welcome-msg") return;
        const role = el.classList.contains("msg--user") ? "user" : "bot";
        // Bots store the markdown source on the element; fall back to text
        const body = el.querySelector(".msg-content");
        const text = ((el.dataset.raw || body?.innerText) || "").trim();
        if (text) msgs.push({ role, text });
    });
    storageSet(STORAGE_KEYS.chat, msgs.slice(-50));
}

function restoreSession() {
    const paper = storageGet(STORAGE_KEYS.paper);
    if (paper && Array.isArray(paper.sections) && paper.sections.length > 0) {
        appSections = paper.sections;
        currentPaperKey = makePaperKey(paper.filename || "paper", appSections.length);
        fileStatusText.textContent = paper.filename || "Restored paper";
        fileStatus.classList.add("file-status--active");
        renderSections(appSections);
        showToast(`Restored "${paper.filename}" from local storage`, "info", 3000);
    }

    const chat = storageGet(STORAGE_KEYS.chat);
    if (Array.isArray(chat)) {
        chat.forEach(({ role, text }) => {
            if ((role === "user" || role === "bot") && typeof text === "string") {
                const msg = appendMessage(role, text);
                // Re-render stored bot replies as formatted markdown
                if (role === "bot") {
                    const body = msg.querySelector(".msg-content");
                    if (body) renderMarkdown(body, text);
                }
            }
        });
    }
}

// === Markdown Rendering (AI answers always render beautifully) ===
function renderMarkdown(container, text) {
    const source = text || "";
    try {
        const html = typeof marked !== "undefined" ? marked.parse(source) : source;
        container.innerHTML = typeof DOMPurify !== "undefined" ? DOMPurify.sanitize(html) : html;
    } catch {
        container.textContent = source;
    }
    container.classList.add("markdown-body");
}

const SKELETON_HTML =
    '<div class="skeleton-block"><div class="skeleton-line skeleton-line--full"></div>' +
    '<div class="skeleton-line skeleton-line--80"></div><div class="skeleton-line skeleton-line--60"></div></div>';

// === Model Selection ===
let selectedModel = storageGet(STORAGE_KEYS.model) || "auto";

async function initModelSelector() {
    const FALLBACK_MODELS = [
        { id: "auto", label: "Auto (recommended)" },
        { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
        { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
        { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B" },
        { id: "allam-2-7b", label: "ALLaM 2 7B" },
    ];

    let models = FALLBACK_MODELS;
    try {
        const res = await fetch(`${API_BASE}/api/models`);
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.models) && data.models.length) {
                models = data.models.map((m) => ({
                    id: m.id,
                    label: m.id === "auto" ? "Auto (recommended)" : m.label || m.id,
                }));
            }
        }
    } catch {
        // Backend not reachable yet — the fallback list keeps the UI usable.
    }

    if (!modelSelect) return;
    modelSelect.innerHTML = "";
    models.forEach(({ id, label }) => {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = label;
        modelSelect.appendChild(opt);
    });

    const ids = new Set(models.map((m) => m.id));
    selectedModel = ids.has(selectedModel) ? selectedModel : "auto";
    modelSelect.value = selectedModel;
}

if (modelSelect) {
    modelSelect.addEventListener("change", () => {
        selectedModel = modelSelect.value;
        storageSet(STORAGE_KEYS.model, selectedModel);
        const label = modelSelect.selectedOptions[0]?.textContent || selectedModel;
        showToast(`AI model: ${label}`, "info", 2500);
    });
}

// === Toast Notifications ===
function showToast(message, type = "info", duration = 4000) {
    const container = $("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add("removing");
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// === Auto-resize textarea ===
chatQuery.addEventListener("input", () => {
    chatQuery.style.height = "36px";
    chatQuery.style.height = Math.min(chatQuery.scrollHeight, 120) + "px";
});

// === Sidebar Toggle (mobile) ===
sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("open");
});

// Close sidebar on section click (mobile)
function closeSidebarMobile() {
    if (window.innerWidth <= 768) sidebar.classList.remove("open");
}

// === Upload Flow ===
uploadBtn.addEventListener("click", () => {
    if (isProcessing) return;
    fileInput.click();
});

fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
        showToast("Please upload a PDF file.", "error");
        fileInput.value = "";
        return;
    }

    if (file.size > 50 * 1024 * 1024) {
        showToast("File too large. Maximum size is 50MB.", "error");
        fileInput.value = "";
        return;
    }

    isProcessing = true;
    uploadOverlay.classList.remove("hidden");
    uploadStatusTitle.textContent = "Processing Paper";
    uploadStatusDetail.textContent = `Uploading ${file.name}...`;

    const formData = new FormData();
    formData.append("file", file);

    try {
        uploadStatusDetail.textContent = "Parsing PDF and extracting sections...";

        const response = await fetch(`${API_BASE}/api/upload`, {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            let message = err.detail || `Upload failed (${response.status})`;
            if (response.status === 404 && !err.detail) {
                message = "Upload failed (404): the API endpoint was not found. "
                    + "Is the backend running and up to date?";
            }
            throw new Error(message);
        }

        const data = await response.json();
        appSections = data.sections || [];

        uploadStatusDetail.textContent = "Indexing into vector database...";
        await new Promise((r) => setTimeout(r, 500));

        // Update UI
        fileStatusText.textContent = data.filename || file.name;
        fileStatus.classList.add("file-status--active");

        // New paper -> clear stale chat/analysis and persist the session locally
        chatHistory.querySelectorAll(".msg:not(#welcome-msg)").forEach((el) => el.remove());
        storageRemove(STORAGE_KEYS.chat);
        storageRemove(STORAGE_KEYS.analysis);
        currentPaperKey = makePaperKey(data.filename || file.name, appSections.length);
        persistPaper(data.filename || file.name);

        renderSections(appSections);
        showToast(`Loaded ${appSections.length} sections from ${file.name}`, "success");

        if (appSections.length > 0) loadSection(0);

    } catch (err) {
        console.error("Upload error:", err);
        showToast(err.message || "Upload failed. Check that the backend is running.", "error");
        fileStatusText.textContent = "Upload failed";
    } finally {
        isProcessing = false;
        uploadOverlay.classList.add("hidden");
        fileInput.value = "";
    }
});

// === Render Sections ===
function renderSections(sections) {
    sectionsList.innerHTML = "";
    if (placeholderMsg) placeholderMsg.style.display = "none";

    sections.forEach((sec, index) => {
        const div = document.createElement("div");
        div.className = "section-item";
        div.textContent = sec.title;
        div.dataset.index = index;
        div.style.animationDelay = `${index * 60}ms`;
        div.addEventListener("click", () => {
            loadSection(index);
            closeSidebarMobile();
        });
        sectionsList.appendChild(div);
    });
}

// === Load Section ===
async function loadSection(index) {
    if (index === activeSectionIndex) return;
    activeSectionIndex = index;

    // Update sidebar active
    document.querySelectorAll(".section-item").forEach((el) => el.classList.remove("active"));
    const activeEl = document.querySelector(`.section-item[data-index='${index}']`);
    if (activeEl) activeEl.classList.add("active");

    const section = appSections[index];
    if (!section) return;

    // Switch from welcome to reading view
    welcomeState.classList.add("hidden");
    readingView.classList.remove("hidden");

    // Reset analysis
    analysisPanel.classList.add("hidden");
    aiExplanation.innerHTML = SKELETON_HTML;
    aiCritique.innerHTML = "";

    // Animate content transition
    readingView.style.opacity = "0";
    readingView.style.transform = "translateY(8px)";

    await new Promise((r) => setTimeout(r, 150));

    sectionNumber.textContent = `Section ${index + 1} of ${appSections.length}`;
    sectionTitle.textContent = section.title;
    sectionContent.textContent = section.content;

    readingView.style.transition = "opacity 0.4s ease, transform 0.4s ease";
    readingView.style.opacity = "1";
    readingView.style.transform = "translateY(0)";

    // Show analysis panel and fetch AI analysis (cached when possible)
    analysisPanel.classList.remove("hidden");
    fetchAnalysis(section, index);
}

// === AI Section Analysis (cached, guarded, retryable) ===
function renderAnalysis(explanation, critique) {
    renderMarkdown(aiExplanation, explanation || "No explanation available.");
    if (critique) {
        renderMarkdown(aiCritique, critique);
    } else {
        aiCritique.innerHTML = '<p class="ai-muted">No critique available for this section.</p>';
    }
    aiCritique.style.animation = "fadeIn 0.6s ease";
}

function showAnalysisError(section, index, message) {
    const isRateLimit = /rate.?limit|429|busy/i.test(message || "");
    const friendly = isRateLimit
        ? "The AI is briefly at its free-tier limit. Wait a few seconds, then retry."
        : "The analysis could not be generated right now.";

    aiExplanation.innerHTML = "";
    aiCritique.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "ai-error";
    const span = document.createElement("span");
    span.textContent = friendly;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "retry-btn";
    btn.textContent = "Retry";
    btn.addEventListener("click", () => {
        aiExplanation.innerHTML = SKELETON_HTML;
        fetchAnalysis(section, index, true);
    });
    wrap.appendChild(span);
    wrap.appendChild(btn);
    aiExplanation.appendChild(wrap);
}

async function fetchAnalysis(section, index, force = false) {
    if (activeSectionIndex !== index) return;

    if (!force) {
        const cached = getCachedAnalysis(index);
        if (cached) {
            renderAnalysis(cached.explanation, cached.critique);
            return;
        }
    }
    if (analysisInFlight.has(index)) return; // avoid duplicate calls
    analysisInFlight.add(index);

    try {
        const res = await fetch(`${API_BASE}/api/explain_text`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text: section.content,
                title: section.title,
                model: selectedModel,
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `Analysis failed (${res.status})`);
        }

        const data = await res.json();
        setCachedAnalysis(index, data);
        if (activeSectionIndex !== index) return; // user moved to another section

        aiExplanation.innerHTML = "";
        renderAnalysis(data.explanation, data.critique);
    } catch (err) {
        console.error("Analysis error:", err);
        if (activeSectionIndex !== index) return;
        showAnalysisError(section, index, err.message);
    } finally {
        analysisInFlight.delete(index);
    }
}

// === Chat Logic ===
sendChatBtn.addEventListener("click", sendMessage);
chatQuery.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

async function sendMessage() {
    const text = chatQuery.value.trim();
    if (!text || isProcessing) return;

    appendMessage("user", text);
    chatQuery.value = "";
    chatQuery.style.height = "36px";

    chatStatus.textContent = "Thinking...";
    chatStatus.style.color = "var(--warning)";

    const botMsg = appendMessage("bot", "");
    const contentEl = botMsg.querySelector(".msg-content");
    contentEl.innerHTML = '<span class="loading-text" style="color:var(--text-muted)">Analyzing your question...</span>';

    // Send the paper context with the question so the backend can retrieve
    // relevant passages statelessly — no cloud vector database needed.
    const payload = { query: text, model: selectedModel };
    if (appSections.length > 0) {
        payload.sections = appSections.map(({ title, content }) => ({ title, content }));
    }

    try {
        const res = await fetch(`${API_BASE}/api/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const detail = typeof err.detail === "string" ? err.detail : "";
            throw new Error(detail || `The request failed (${res.status}). Please try again.`);
        }

        const data = await res.json();

        // Build reply (markdown) and render it formatted
        let reply = data.answer || "I couldn't generate a response.";
        if (data.sources && data.sources.length > 0) {
            reply += "\n\n**Sources:** " + data.sources.join(", ");
        }

        botMsg.dataset.raw = reply;
        renderMarkdown(contentEl, reply);
        chatHistory.scrollTop = chatHistory.scrollHeight;

    } catch (err) {
        console.error("Chat error:", err);
        const isRateLimit = /rate.?limit|429|busy/i.test(err.message || "");
        const friendly = isRateLimit
            ? "The AI is briefly at its free-tier limit. Please resend your question in a few seconds."
            : err.message || "Something went wrong. Please try again.";
        botMsg.dataset.raw = "";
        contentEl.innerHTML = "";
        const errSpan = document.createElement("span");
        errSpan.style.color = "var(--error)";
        errSpan.textContent = friendly;
        contentEl.appendChild(errSpan);
    } finally {
        chatStatus.textContent = "Ready";
        chatStatus.style.color = "var(--success)";
        persistChatHistory();
    }
}

function appendMessage(role, text) {
    const msg = document.createElement("div");
    msg.className = `msg msg--${role}`;

    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    avatar.innerHTML = role === "bot"
        ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zm1 4.5a1 1 0 11-2 0 1 1 0 012 0zM6.5 7A.5.5 0 017 6.5h1a.5.5 0 01.5.5v3.5a.5.5 0 01-1 0V7.5H7a.5.5 0 01-.5-.5z"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 100-6 3 3 0 000 6zm-5 6s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3z"/></svg>';

    const content = document.createElement("div");
    content.className = "msg-content";
    if (text) {
        // Split on newlines so multi-line messages render paragraphs correctly.
        text.split("\n").forEach((line) => {
            if (!line.trim()) return;
            const p = document.createElement("p");
            p.textContent = line;
            content.appendChild(p);
        });
    }

    msg.appendChild(avatar);
    msg.appendChild(content);
    chatHistory.appendChild(msg);
    chatHistory.scrollTop = chatHistory.scrollHeight;

    return msg;
}

// === Keyboard Shortcuts ===
document.addEventListener("keydown", (e) => {
    // Ctrl+U to upload
    if ((e.ctrlKey || e.metaKey) && e.key === "u") {
        e.preventDefault();
        uploadBtn.click();
    }
    // Escape to close sidebar on mobile
    if (e.key === "Escape") {
        sidebar.classList.remove("open");
    }
});

// === Startup: restore the previous session from local storage ===
restoreSession();
initModelSelector();
