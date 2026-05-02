// === Configuration ===
const API_BASE = window.location.protocol === 'file:'
    ? 'http://localhost:8000'
    : window.location.origin;

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

// === State ===
let appSections = [];
let activeSectionIndex = -1;
let isProcessing = false;

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

// === Typewriter Effect ===
function typeText(element, text, speed = 12) {
    return new Promise((resolve) => {
        if (!text) { element.textContent = ""; resolve(); return; }
        element.textContent = "";
        element.classList.add("typing");
        let i = 0;
        const interval = setInterval(() => {
            element.textContent += text.charAt(i);
            i++;
            // Auto-scroll chat if inside chat
            const parent = element.closest(".chat-history");
            if (parent) parent.scrollTop = parent.scrollHeight;
            if (i >= text.length) {
                clearInterval(interval);
                element.classList.remove("typing");
                resolve();
            }
        }, speed);
    });
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

        const response = await fetch(`${API_BASE}/upload`, {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `Upload failed (${response.status})`);
        }

        const data = await response.json();
        appSections = data.sections || [];

        uploadStatusDetail.textContent = "Indexing into vector database...";
        await new Promise((r) => setTimeout(r, 500));

        // Update UI
        fileStatusText.textContent = data.filename || file.name;
        fileStatus.classList.add("file-status--active");

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
    aiExplanation.innerHTML = '<div class="skeleton-block"><div class="skeleton-line skeleton-line--full"></div><div class="skeleton-line skeleton-line--80"></div><div class="skeleton-line skeleton-line--60"></div></div>';
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

    // Show analysis panel and fetch AI analysis
    analysisPanel.classList.remove("hidden");
    fetchExplanation(section.title, section.content);
}

// === Fetch AI Explanation ===
async function fetchExplanation(title, content) {
    try {
        const res = await fetch(`${API_BASE}/explain_text`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: content, title: title }),
        });

        if (!res.ok) throw new Error("Explanation request failed");

        const data = await res.json();

        // Render explanation with typewriter
        aiExplanation.innerHTML = "";
        const expSpan = document.createElement("span");
        aiExplanation.appendChild(expSpan);
        await typeText(expSpan, data.explanation || "No explanation available.", 8);

        // Render critique as markdown (sanitized)
        if (data.critique) {
            try {
                const rawHtml = marked.parse(data.critique);
                aiCritique.innerHTML = typeof DOMPurify !== 'undefined'
                    ? DOMPurify.sanitize(rawHtml)
                    : rawHtml;
            } catch {
                aiCritique.textContent = data.critique;
            }
        }
        aiCritique.style.animation = "fadeIn 0.6s ease";

    } catch (err) {
        console.error("Explanation error:", err);
        aiExplanation.innerHTML = `<span style="color:var(--error)">⚠️ ${err.message}</span>`;
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

    try {
        const res = await fetch(`${API_BASE}/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: text }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || "Request failed");
        }

        const data = await res.json();

        // Build reply
        let reply = data.answer || "I couldn't generate a response.";
        if (data.sources && data.sources.length > 0) {
            reply += "\n\n📎 Sources: " + data.sources.join(", ");
        }

        contentEl.innerHTML = "";
        const span = document.createElement("span");
        contentEl.appendChild(span);
        await typeText(span, reply, 15);

    } catch (err) {
        console.error("Chat error:", err);
        contentEl.innerHTML = `<span style="color:var(--error)">⚠️ ${err.message}</span>`;
    } finally {
        chatStatus.textContent = "Ready";
        chatStatus.style.color = "var(--success)";
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
        const p = document.createElement("p");
        p.textContent = text;
        content.appendChild(p);
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
