/* PaperPilot AI — UI Controller v2
 * Multi-session management, API key modal, PDF viewer, premium UI.
 * Everything runs client-side via PaperPilotEngine.
 */
"use strict";

// ─── DEFAULT TRIAL KEY (shared, rate-limited) ───────────────────────────────
// This tells engine.js to use the Vercel backend proxy for the trial key.
const TRIAL_API_KEY = "trial";
const TRIAL_KEY_LABEL = "trial"; // marker to know it's the built-in key

const Engine = window.PaperPilotEngine;

// ─── DOM ─────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// API Key Modal
const apiKeyModal       = $("api-key-modal");
const tabTrial          = $("tab-trial");
const tabPremium        = $("tab-premium");
const tabOwn            = $("tab-own");
const panelTrial        = $("panel-trial");
const panelPremium      = $("panel-premium");
const panelOwn          = $("panel-own");
const modalKeyInput     = $("modal-key-input");
const modalKeyToggle    = $("modal-key-toggle");
const premiumKeyInput   = $("premium-key-input");
const premiumKeyToggle  = $("premium-key-toggle");
const modalProceedBtn   = $("modal-proceed-btn");
const upgradeBanner     = $("upgrade-banner");
const upgradeBannerBtn  = $("upgrade-banner-btn");

// Sidebar
const uploadBtn         = $("upload-btn");
const fileInput         = $("file-input");
const sessionsList      = $("sessions-list");
const placeholderMsg    = $("placeholder-msg");
const clearSessionsBtn  = $("clear-sessions-btn");
const apiKeySettingsBtn = $("api-key-settings-btn");
const keyStatusFooter   = $("key-status-footer");

// Main
const welcomeState      = $("welcome-state");
const welcomeUploadBtn  = $("welcome-upload-btn");
const sessionView       = $("session-view");
const sessionFilename   = $("session-filename");
const sessionSectionCount = $("session-section-count");

// View tabs
const tabReader         = $("tab-reader");
const tabPdf            = $("tab-pdf");
const readerSplit       = $("reader-split");
const pdfViewPanel      = $("pdf-view-panel");

// Sections
const sectionsList      = $("sections-list");

// Reader
const readingPlaceholder = $("reading-placeholder");
const readingView       = $("reading-view");
const sectionNumber     = $("section-number");
const sectionTitle      = $("section-title");
const sectionContent    = $("section-content");
const analysisPanel     = $("analysis-panel");
const aiExplanation     = $("ai-explanation");
const aiCritique        = $("ai-critique");

// PDF viewer
const pdfCanvas         = $("pdf-canvas");
const pdfCanvasContainer= $("pdf-canvas-container");
const pdfPrevBtn        = $("pdf-prev");
const pdfNextBtn        = $("pdf-next");
const pdfPageNum        = $("pdf-page-num");
const pdfPageCount      = $("pdf-page-count");
const pdfZoomOut        = $("pdf-zoom-out");
const pdfZoomIn         = $("pdf-zoom-in");
const pdfZoomLabel      = $("pdf-zoom-label");
const pdfToolbarFilename= $("pdf-toolbar-filename");

// Chat
const chatQuery         = $("chat-query");
const sendChatBtn       = $("send-chat");
const chatHistory       = $("chat-history");
const chatStatus        = $("chat-status");
const chatClearBtn      = $("chat-clear-btn");
const chatToggleBtn     = $("chat-toggle-btn");
const modelSelect       = $("model-select");

// Overlays
const uploadOverlay     = $("upload-overlay");
const uploadStatusTitle = $("upload-status-title");
const uploadStatusDetail= $("upload-status-detail");

// ─── STORAGE SCHEMA ──────────────────────────────────────────────────────────
const SK = {
    sessions:   "pp2.sessions",      // array of session metadata objects
    activeId:   "pp2.activeSession",  // currently active session id
    model:      "pp2.model",          // chosen model
    apiKey:     "pp2.apiKey",         // user's own key (or TRIAL_KEY_LABEL)
    chat:       (id) => `pp2.chat.${id}`,
    analysis:   (id) => `pp2.analysis.${id}`,
    paper:      (id) => `pp2.paper.${id}`,
};

function ls_get(key) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
    catch { return null; }
}
function ls_set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ }
}
function ls_del(key) {
    try { localStorage.removeItem(key); } catch { }
}

// ─── APP STATE ───────────────────────────────────────────────────────────────
let groqApiKey        = "";
let isTrialKey        = true;
let selectedModel     = ls_get(SK.model) || "auto";
let sessions          = [];          // [{id, filename, sectionCount, createdAt}]
let activeSessionId   = null;
let activeSectionIdx  = -1;
let isProcessing      = false;

// Per-session state (loaded when switching sessions)
let appSections       = [];
let currentView       = "reader";    // "reader" | "pdf"

// PDF viewer
let pdfDocRef         = null;
let pdfCurrentPage    = 1;
let pdfZoomScale      = 1.5;
let pdfRendering      = false;

// ─── ANALYSIS IN-FLIGHT GUARD ─────────────────────────────────────────────────
const analysisInFlight = new Set();

// ─────────────────────────────────────────────────────────────────────────────
//  TOASTS
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
//  MARKDOWN
// ─────────────────────────────────────────────────────────────────────────────
function renderMarkdown(container, text) {
    const src = text || "";
    try {
        const html = typeof marked !== "undefined" ? marked.parse(src) : src;
        container.innerHTML = typeof DOMPurify !== "undefined" ? DOMPurify.sanitize(html) : html;
    } catch { container.textContent = src; }
    container.classList.add("markdown-body");
}

const SKELETON_HTML =
    '<div class="skeleton-block"><div class="skeleton-line skeleton-line--full"></div>' +
    '<div class="skeleton-line skeleton-line--80"></div><div class="skeleton-line skeleton-line--60"></div></div>';

// ─────────────────────────────────────────────────────────────────────────────
//  API KEY MODAL
// ─────────────────────────────────────────────────────────────────────────────
let activeModalTab = "trial";

function openApiKeyModal(forceShow = false) {
    apiKeyModal.classList.remove("hidden");
    // Pre-fill based on stored key type
    const stored = ls_get(SK.apiKey);
    if (stored && stored !== TRIAL_KEY_LABEL) {
        // Check if it looks like it came from premium flow vs. own-key
        const isPremiumStored = ls_get(SK.apiKey + "_type") === "premium";
        if (isPremiumStored) {
            switchModalTab("premium");
            premiumKeyInput.value = stored;
        } else {
            switchModalTab("own");
            modalKeyInput.value = stored;
        }
    } else {
        switchModalTab("trial");
    }
}

function closeApiKeyModal() {
    apiKeyModal.classList.add("hidden");
}

function switchModalTab(tab) {
    activeModalTab = tab;
    tabTrial.classList.toggle("active", tab === "trial");
    tabPremium.classList.toggle("active", tab === "premium");
    tabOwn.classList.toggle("active", tab === "own");
    panelTrial.classList.toggle("active", tab === "trial");
    panelPremium.classList.toggle("active", tab === "premium");
    panelOwn.classList.toggle("active", tab === "own");
    // Update proceed button label
    const proceedSpan = modalProceedBtn.querySelector("span");
    if (proceedSpan) {
        if (tab === "premium") proceedSpan.textContent = "Activate Premium Key";
        else if (tab === "own") proceedSpan.textContent = "Save & Launch";
        else proceedSpan.textContent = "Launch PaperPilot";
    }
}

tabTrial.addEventListener("click",   () => switchModalTab("trial"));
tabPremium.addEventListener("click", () => switchModalTab("premium"));
tabOwn.addEventListener("click",     () => switchModalTab("own"));

// Eye toggles
modalKeyToggle.addEventListener("click", () => {
    const show = modalKeyInput.type === "password";
    modalKeyInput.type = show ? "text" : "password";
});
premiumKeyToggle.addEventListener("click", () => {
    const show = premiumKeyInput.type === "password";
    premiumKeyInput.type = show ? "text" : "password";
});

modalProceedBtn.addEventListener("click", () => {
    if (activeModalTab === "trial") {
        groqApiKey  = TRIAL_API_KEY;
        isTrialKey  = true;
        ls_set(SK.apiKey, TRIAL_KEY_LABEL);
        ls_del(SK.apiKey + "_type");
    } else if (activeModalTab === "premium") {
        const key = premiumKeyInput.value.trim();
        if (!key) {
            showToast("Paste your premium key to activate it.", "error");
            premiumKeyInput.focus();
            return;
        }
        if (!key.startsWith("gsk_")) {
            showToast("Premium key should be a valid Groq API key (starts with gsk_).", "error");
            premiumKeyInput.focus();
            return;
        }
        groqApiKey  = key;
        isTrialKey  = false;
        ls_set(SK.apiKey, key);
        ls_set(SK.apiKey + "_type", "premium");
    } else {
        // own tab
        const key = modalKeyInput.value.trim();
        if (!key || !key.startsWith("gsk_")) {
            showToast("Please enter a valid Groq API key (starts with gsk_).", "error");
            modalKeyInput.focus();
            return;
        }
        groqApiKey  = key;
        isTrialKey  = false;
        ls_set(SK.apiKey, key);
        ls_del(SK.apiKey + "_type");
    }
    updateKeyStatusFooter();
    closeApiKeyModal();
    const messages = {
        trial:   "Using built-in trial key \u26a1",
        premium: "\u2b50 Premium key activated!",
        own:     "Your API key saved \u2713",
    };
    showToast(messages[activeModalTab] || "Key saved", "success", 3000);
});

// API key settings button in sidebar footer
apiKeySettingsBtn.addEventListener("click", () => openApiKeyModal(true));

// Upgrade banner button → open modal on premium tab
if (upgradeBannerBtn) {
    upgradeBannerBtn.addEventListener("click", () => {
        apiKeyModal.classList.remove("hidden");
        switchModalTab("premium");
    });
}

function updateKeyStatusFooter() {
    if (!keyStatusFooter) return;
    const type = ls_get(SK.apiKey + "_type");
    if (isTrialKey) {
        keyStatusFooter.textContent = "Trial Key";
        keyStatusFooter.classList.remove("key-status--premium");
        // Show upgrade banner for trial users
        if (upgradeBanner) upgradeBanner.classList.remove("hidden");
    } else if (type === "premium") {
        keyStatusFooter.textContent = "\u2b50 Premium";
        keyStatusFooter.classList.add("key-status--premium");
        if (upgradeBanner) upgradeBanner.classList.add("hidden");
    } else {
        keyStatusFooter.textContent = "My Key \u2713";
        keyStatusFooter.classList.remove("key-status--premium");
        if (upgradeBanner) upgradeBanner.classList.add("hidden");
    }
}

function initApiKey() {
    const stored = ls_get(SK.apiKey);
    if (!stored) {
        // First visit — show modal
        openApiKeyModal(true);
        return;
    }
    if (stored === TRIAL_KEY_LABEL) {
        groqApiKey = TRIAL_API_KEY;
        isTrialKey = true;
    } else {
        groqApiKey = stored;
        isTrialKey = false;
    }
    updateKeyStatusFooter();
}

// ─────────────────────────────────────────────────────────────────────────────
//  MODEL SELECTOR
// ─────────────────────────────────────────────────────────────────────────────
function initModelSelector() {
    if (!modelSelect) return;
    modelSelect.innerHTML = "";
    Engine.MODELS.forEach(({ id, label, description }) => {
        const opt = document.createElement("option");
        opt.value = id; opt.textContent = label;
        if (description) opt.title = description;
        modelSelect.appendChild(opt);
    });
    const ids = new Set(Engine.MODELS.map((m) => m.id));
    selectedModel = ids.has(selectedModel) ? selectedModel : "auto";
    modelSelect.value = selectedModel;
    modelSelect.addEventListener("change", () => {
        selectedModel = modelSelect.value;
        ls_set(SK.model, selectedModel);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  SESSION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────
function loadSessions() {
    sessions = ls_get(SK.sessions) || [];
}

function saveSessions() {
    ls_set(SK.sessions, sessions);
}

function generateSessionId() {
    return "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
}

function createSession(filename, sectionCount, rawSections) {
    const id = generateSessionId();
    const session = {
        id, filename, sectionCount,
        createdAt: new Date().toISOString(),
    };
    sessions.unshift(session); // newest first
    saveSessions();

    // Persist paper data
    const totalChars = rawSections.reduce((n, s) => n + (s.content || "").length, 0);
    if (totalChars < 3 * 1024 * 1024) {
        ls_set(SK.paper(id), { filename, sections: rawSections });
    }
    return session;
}

function deleteSession(id) {
    sessions = sessions.filter((s) => s.id !== id);
    saveSessions();
    ls_del(SK.paper(id));
    ls_del(SK.chat(id));
    ls_del(SK.analysis(id));
    if (activeSessionId === id) {
        activeSessionId = null;
        activeSectionIdx = -1;
        appSections = [];
        pdfDocRef = null;
        showWelcomeState();
    }
    renderSessionSidebar();
}

function clearAllSessions() {
    sessions.forEach((s) => {
        ls_del(SK.paper(s.id));
        ls_del(SK.chat(s.id));
        ls_del(SK.analysis(s.id));
    });
    sessions = [];
    saveSessions();
    activeSessionId = null;
    activeSectionIdx = -1;
    appSections = [];
    pdfDocRef = null;
    showWelcomeState();
    renderSessionSidebar();
}

clearSessionsBtn.addEventListener("click", () => {
    if (!sessions.length) return;
    if (confirm("Clear all sessions? This cannot be undone.")) clearAllSessions();
});

// ─────────────────────────────────────────────────────────────────────────────
//  RENDER SESSION SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────
function renderSessionSidebar() {
    sessionsList.innerHTML = "";
    if (!sessions.length) {
        sessionsList.appendChild(placeholderMsg);
        placeholderMsg.style.display = "";
        return;
    }
    placeholderMsg.style.display = "none";

    sessions.forEach((sess, i) => {
        const isActive = sess.id === activeSessionId;
        const card = document.createElement("div");
        card.className = "session-card" + (isActive ? " active" : "");
        card.style.animationDelay = `${i * 40}ms`;
        card.dataset.id = sess.id;

        const date = new Date(sess.createdAt);
        const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

        card.innerHTML = `
            <div class="session-card-inner">
                <div class="session-card-icon">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4 1a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V5.5L9.5 1H4zm5.5 1.5L13 6H10a.5.5 0 01-.5-.5V2.5z"/>
                    </svg>
                </div>
                <div class="session-card-meta">
                    <div class="session-card-name" title="${sess.filename}">${sess.filename}</div>
                    <div class="session-card-info">${sess.sectionCount} sections · ${dateStr}</div>
                </div>
                <button class="session-card-delete" data-id="${sess.id}" title="Delete session">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>`;

        // If active, render section list inside card
        if (isActive && appSections.length) {
            const secList = document.createElement("div");
            secList.className = "session-sections-list";
            appSections.forEach((sec, idx) => {
                const item = document.createElement("div");
                item.className = "session-section-item" + (idx === activeSectionIdx ? " active" : "");
                item.textContent = sec.title;
                item.addEventListener("click", (e) => {
                    e.stopPropagation();
                    switchToView("reader");
                    loadSection(idx);
                });
                secList.appendChild(item);
            });
            card.appendChild(secList);
        }

        card.querySelector(".session-card-inner").addEventListener("click", () => {
            activateSession(sess.id);
        });
        card.querySelector(".session-card-delete").addEventListener("click", (e) => {
            e.stopPropagation();
            deleteSession(sess.id);
        });

        sessionsList.appendChild(card);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  ACTIVATE A SESSION
// ─────────────────────────────────────────────────────────────────────────────
function activateSession(id) {
    if (activeSessionId === id) return;

    // Save current session state (section index)
    if (activeSessionId) {
        ls_set(SK.activeId + "_" + activeSessionId, activeSectionIdx);
    }

    activeSessionId = id;
    ls_set(SK.activeId, id);

    const session = sessions.find((s) => s.id === id);
    if (!session) return;

    // Load paper data
    const paper = ls_get(SK.paper(id));
    if (!paper || !paper.sections || !paper.sections.length) {
        showToast("Session data not found. Please re-upload the PDF.", "error");
        return;
    }
    appSections   = paper.sections;
    activeSectionIdx = -1;
    pdfDocRef     = null;
    pdfCurrentPage = 1;

    // Restore PDF if stored as base64
    const pdfData = ls_get(SK.paper(id) + "_pdf");
    if (pdfData) {
        loadPdfFromBase64(pdfData, session.filename);
    }

    // Update top bar
    sessionFilename.textContent = session.filename;
    sessionSectionCount.textContent = `${session.sectionCount} sections`;
    pdfToolbarFilename.textContent = session.filename;

    // Show session view
    showSessionView();
    switchToView("reader");

    // Render sections in the sections sidebar
    renderSectionsSidebar(appSections);

    // Restore chat
    restoreChatForSession(id);

    // Restore last viewed section
    const lastIdx = ls_get(SK.activeId + "_" + id);
    if (typeof lastIdx === "number" && lastIdx >= 0 && lastIdx < appSections.length) {
        loadSection(lastIdx);
    } else if (appSections.length) {
        loadSection(0);
    }

    renderSessionSidebar();
}

// ─────────────────────────────────────────────────────────────────────────────
//  VIEW SWITCHING
// ─────────────────────────────────────────────────────────────────────────────
function showWelcomeState() {
    welcomeState.classList.remove("hidden");
    sessionView.classList.add("hidden");
}
function showSessionView() {
    welcomeState.classList.add("hidden");
    sessionView.classList.remove("hidden");
}

function switchToView(view) {
    currentView = view;
    tabReader.classList.toggle("active", view === "reader");
    tabPdf.classList.toggle("active", view === "pdf");
    readerSplit.classList.toggle("hidden", view !== "reader");
    pdfViewPanel.classList.toggle("hidden", view !== "pdf");
    if (view === "pdf" && pdfDocRef) renderPdfPage(pdfCurrentPage);
    if (view === "pdf" && !pdfDocRef) {
        showToast("PDF viewer: upload the paper again to see it here.", "info", 4000);
        switchToView("reader");
    }
}

tabReader.addEventListener("click", () => switchToView("reader"));
tabPdf.addEventListener("click",   () => switchToView("pdf"));

// ─────────────────────────────────────────────────────────────────────────────
//  UPLOAD FLOW
// ─────────────────────────────────────────────────────────────────────────────
[uploadBtn, welcomeUploadBtn].forEach((btn) => {
    btn.addEventListener("click", () => { if (!isProcessing) fileInput.click(); });
});

fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
        showToast("Please upload a PDF file.", "error");
        fileInput.value = ""; return;
    }
    if (file.size > 50 * 1024 * 1024) {
        showToast("File too large. Maximum size is 50 MB.", "error");
        fileInput.value = ""; return;
    }

    isProcessing = true;
    uploadOverlay.classList.remove("hidden");
    uploadStatusTitle.textContent = "Processing Paper";
    uploadStatusDetail.textContent = `Reading ${file.name} in your browser...`;

    try {
        const buffer = await file.arrayBuffer();

        // ── Clone the buffer BEFORE extractPdfText so PDF.js doesn't detach it ──
        // PDF.js transfers (detaches) the underlying ArrayBuffer when it calls
        // getDocument({data}), making any subsequent use of `buffer` throw
        // "Cannot perform Construct on a detached ArrayBuffer".
        // We keep one pristine copy for the PDF viewer.
        const pdfViewerBuffer = buffer.slice(0);   // independent clone

        // Extract text for AI (uses buffer — may get detached, that's fine)
        const rawText = await Engine.extractPdfText(new Uint8Array(buffer));
        if (!rawText) throw new Error("Could not extract text — the PDF may be scanned or image-only.");

        uploadStatusDetail.textContent = "Splitting into sections...";
        const sections = Engine.extractSections(rawText);
        if (!sections.length) throw new Error("No recognizable sections found in this paper.");

        await new Promise((r) => setTimeout(r, 300));

        // Store PDF bytes as base64 for future session restores (use the clone)
        uploadStatusDetail.textContent = "Preparing PDF viewer...";
        try {
            // Use a chunked approach to avoid call-stack overflow on large files
            const pdfBytes = new Uint8Array(pdfViewerBuffer.slice(0));
            const maxBytes = Math.min(pdfBytes.length, 4 * 1024 * 1024); // cap at 4 MB
            let binary = "";
            const chunkSize = 8192;
            for (let i = 0; i < maxBytes; i += chunkSize) {
                binary += String.fromCharCode(...pdfBytes.subarray(i, Math.min(i + chunkSize, maxBytes)));
            }
            window._pendingPdfBase64 = btoa(binary);
        } catch { window._pendingPdfBase64 = null; }

        // Create session
        const session = createSession(file.name, sections.length, sections);

        // Persist base64 PDF for future session restores
        if (window._pendingPdfBase64) {
            try { ls_set(SK.paper(session.id) + "_pdf", window._pendingPdfBase64); }
            catch { /* localStorage quota exceeded — PDF viewer won't persist */ }
            window._pendingPdfBase64 = null;
        }

        // Activate session
        activeSessionId = session.id;
        appSections     = sections;
        activeSectionIdx = -1;

        // Load PDF viewer from the dedicated cloned buffer (never touched by extractPdfText)
        await loadPdfFromBuffer(pdfViewerBuffer, file.name);

        // Update UI
        sessionFilename.textContent = file.name;
        sessionSectionCount.textContent = `${sections.length} sections`;
        pdfToolbarFilename.textContent = file.name;

        showSessionView();
        switchToView("reader");
        renderSectionsSidebar(appSections);
        clearChatHistory();
        renderSessionSidebar();

        showToast(`✓ Loaded "${file.name}" (${sections.length} sections)`, "success");
        if (sections.length) loadSection(0);

    } catch (err) {
        console.error("Upload error:", err);
        showToast(err.message || "Could not read this PDF.", "error");
    } finally {
        isProcessing = false;
        uploadOverlay.classList.add("hidden");
        fileInput.value = "";
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//  PDF VIEWER
// ─────────────────────────────────────────────────────────────────────────────
async function loadPdfFromBuffer(buffer, filename) {
    try {
        const lib = window.pdfjsLib;
        if (!lib) return;
        if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
            lib.GlobalWorkerOptions.workerSrc =
                "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
        }
        const bytes = new Uint8Array(buffer);
        pdfDocRef = await lib.getDocument({ data: bytes }).promise;
        pdfCurrentPage = 1;
        pdfPageCount.textContent = pdfDocRef.numPages;
        pdfPageNum.textContent   = 1;
        pdfToolbarFilename.textContent = filename;
        if (currentView === "pdf") renderPdfPage(1);
    } catch (err) {
        console.warn("PDF viewer init error:", err);
        pdfDocRef = null;
    }
}

async function loadPdfFromBase64(base64, filename) {
    try {
        const lib = window.pdfjsLib;
        if (!lib || !base64) return;
        if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
            lib.GlobalWorkerOptions.workerSrc =
                "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
        }
        const binary = atob(base64);
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        pdfDocRef = await lib.getDocument({ data: bytes }).promise;
        pdfCurrentPage = 1;
        pdfPageCount.textContent = pdfDocRef.numPages;
        pdfPageNum.textContent   = 1;
        pdfToolbarFilename.textContent = filename;
    } catch (err) {
        console.warn("PDF base64 load error:", err);
        pdfDocRef = null;
    }
}

async function renderPdfPage(pageNum) {
    if (!pdfDocRef || pdfRendering) return;
    pdfRendering = true;
    try {
        const page    = await pdfDocRef.getPage(pageNum);
        const viewport= page.getViewport({ scale: pdfZoomScale });
        pdfCanvas.width  = viewport.width;
        pdfCanvas.height = viewport.height;
        const ctx = pdfCanvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        pdfPageNum.textContent = pageNum;
    } catch (err) {
        console.warn("PDF render error:", err);
    } finally {
        pdfRendering = false;
    }
}

pdfPrevBtn.addEventListener("click", () => {
    if (pdfCurrentPage > 1) { pdfCurrentPage--; renderPdfPage(pdfCurrentPage); }
});
pdfNextBtn.addEventListener("click", () => {
    if (pdfDocRef && pdfCurrentPage < pdfDocRef.numPages) { pdfCurrentPage++; renderPdfPage(pdfCurrentPage); }
});
pdfZoomIn.addEventListener("click", () => {
    pdfZoomScale = Math.min(pdfZoomScale + 0.25, 4);
    pdfZoomLabel.textContent = Math.round(pdfZoomScale * 100) + "%";
    renderPdfPage(pdfCurrentPage);
});
pdfZoomOut.addEventListener("click", () => {
    pdfZoomScale = Math.max(pdfZoomScale - 0.25, 0.5);
    pdfZoomLabel.textContent = Math.round(pdfZoomScale * 100) + "%";
    renderPdfPage(pdfCurrentPage);
});

// ─────────────────────────────────────────────────────────────────────────────
//  RENDER SECTIONS SIDEBAR (inside reader)
// ─────────────────────────────────────────────────────────────────────────────
function renderSectionsSidebar(sections) {
    sectionsList.innerHTML = "";
    sections.forEach((sec, idx) => {
        const item = document.createElement("div");
        item.className = "section-item";
        item.textContent = sec.title;
        item.dataset.index = idx;
        item.style.animationDelay = `${idx * 40}ms`;
        item.addEventListener("click", () => {
            loadSection(idx);
            if (window.innerWidth <= 768) {
                $("sidebar").classList.remove("open");
            }
        });
        sectionsList.appendChild(item);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOAD SECTION
// ─────────────────────────────────────────────────────────────────────────────
async function loadSection(index) {
    if (index === activeSectionIdx) return;
    activeSectionIdx = index;

    // Sync both sections sidebars
    document.querySelectorAll(".section-item").forEach((el) => el.classList.remove("active"));
    document.querySelectorAll(`.section-item[data-index='${index}']`).forEach((el) => el.classList.add("active"));
    document.querySelectorAll(".session-section-item").forEach((el, i) => {
        el.classList.toggle("active", i === index);
    });

    const section = appSections[index];
    if (!section) return;

    // Switch to reading view
    readingPlaceholder.classList.add("hidden");
    readingView.classList.remove("hidden");

    // Clear & animate
    analysisPanel.classList.add("hidden");
    aiExplanation.innerHTML = SKELETON_HTML;
    aiCritique.innerHTML = "";
    readingView.style.opacity = "0";
    readingView.style.transform = "translateY(10px)";

    await new Promise((r) => setTimeout(r, 100));

    sectionNumber.textContent = `Section ${index + 1} of ${appSections.length}`;
    sectionTitle.textContent  = section.title;
    sectionContent.textContent = section.content;

    readingView.style.transition = "opacity 0.4s ease, transform 0.4s ease";
    readingView.style.opacity    = "1";
    readingView.style.transform  = "translateY(0)";

    analysisPanel.classList.remove("hidden");
    fetchAnalysis(section, index);

    // Persist last viewed section
    if (activeSessionId) ls_set(SK.activeId + "_" + activeSessionId, index);
}

// ─────────────────────────────────────────────────────────────────────────────
//  AI ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────
function getCachedAnalysis(index) {
    if (!activeSessionId) return null;
    const store = ls_get(SK.analysis(activeSessionId));
    if (!store || !store[index]) return null;
    return store[index];
}
function setCachedAnalysis(index, data) {
    if (!activeSessionId) return;
    const store = ls_get(SK.analysis(activeSessionId)) || {};
    store[index] = { explanation: data.explanation || "", critique: data.critique || "" };
    ls_set(SK.analysis(activeSessionId), store);
}

function renderAnalysis(explanation, critique) {
    renderMarkdown(aiExplanation, explanation || "No explanation available.");
    if (critique) {
        renderMarkdown(aiCritique, critique);
    } else {
        aiCritique.innerHTML = '<p class="ai-muted">No critique available for this section.</p>';
    }
}

function showAnalysisError(section, index, message) {
    aiExplanation.innerHTML = "";
    aiCritique.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "ai-error";
    const span = document.createElement("span");
    span.textContent = message || "Analysis could not be generated.";
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "retry-btn"; btn.textContent = "Retry";
    btn.addEventListener("click", () => {
        aiExplanation.innerHTML = SKELETON_HTML;
        fetchAnalysis(section, index, true);
    });
    wrap.appendChild(span); wrap.appendChild(btn);
    aiExplanation.appendChild(wrap);
}

async function fetchAnalysis(section, index, force = false) {
    if (activeSectionIdx !== index) return;
    if (!force) {
        const cached = getCachedAnalysis(index);
        if (cached) { renderAnalysis(cached.explanation, cached.critique); return; }
    }
    if (analysisInFlight.has(index)) return;

    if (!groqApiKey) {
        showAnalysisError(section, index, "Set your Groq API key to enable AI analysis.");
        return;
    }

    analysisInFlight.add(index);
    try {
        const data = await Engine.analyzeSection({
            key: groqApiKey, title: section.title,
            content: section.content, model: selectedModel,
        });
        setCachedAnalysis(index, data);
        if (activeSectionIdx !== index) return;
        aiExplanation.innerHTML = "";
        renderAnalysis(data.explanation, data.critique);
    } catch (err) {
        console.error("Analysis error:", err);
        if (activeSectionIdx !== index) return;
        showAnalysisError(section, index, err.message);
    } finally {
        analysisInFlight.delete(index);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CHAT
// ─────────────────────────────────────────────────────────────────────────────
function clearChatHistory() {
    const toRemove = chatHistory.querySelectorAll(".msg:not(#welcome-msg)");
    toRemove.forEach((el) => el.remove());
    if (activeSessionId) ls_del(SK.chat(activeSessionId));
}

function persistChatHistory() {
    if (!activeSessionId) return;
    const msgs = [];
    chatHistory.querySelectorAll(".msg").forEach((el) => {
        if (el.id === "welcome-msg") return;
        const role = el.classList.contains("msg--user") ? "user" : "bot";
        const body = el.querySelector(".msg-content");
        const text = ((el.dataset.raw || body?.innerText) || "").trim();
        if (text) msgs.push({ role, text });
    });
    ls_set(SK.chat(activeSessionId), msgs.slice(-50));
}

function restoreChatForSession(id) {
    chatHistory.querySelectorAll(".msg:not(#welcome-msg)").forEach((el) => el.remove());
    const msgs = ls_get(SK.chat(id));
    if (!Array.isArray(msgs)) return;
    msgs.forEach(({ role, text }) => {
        if ((role === "user" || role === "bot") && typeof text === "string") {
            const msg = appendMessage(role, text);
            if (role === "bot") renderMarkdown(msg.querySelector(".msg-content"), text);
        }
    });
}

chatClearBtn.addEventListener("click", () => {
    clearChatHistory();
    showToast("Chat cleared", "info", 2000);
});

sendChatBtn.addEventListener("click", sendMessage);
chatQuery.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
chatQuery.addEventListener("input", () => {
    chatQuery.style.height = "34px";
    chatQuery.style.height = Math.min(chatQuery.scrollHeight, 110) + "px";
});

async function sendMessage() {
    const text = chatQuery.value.trim();
    if (!text || isProcessing) return;

    if (!appSections.length) {
        showToast("Upload a PDF first to start chatting.", "info");
        return;
    }
    if (!groqApiKey) {
        showToast("Set your Groq API key to enable chat.", "error");
        openApiKeyModal(true);
        return;
    }

    appendMessage("user", text);
    chatQuery.value = "";
    chatQuery.style.height = "34px";

    chatStatus.textContent = "Thinking...";
    chatStatus.style.color = "var(--warning)";

    const botMsg = appendMessage("bot", "");
    const contentEl = botMsg.querySelector(".msg-content");
    contentEl.innerHTML = '<span class="loading-text" style="color:var(--text-muted)">Analyzing...</span>';

    try {
        const { answer, sources } = await Engine.askAboutPaper({
            key: groqApiKey, query: text,
            sections: appSections, model: selectedModel,
        });
        let reply = answer || "I couldn't generate a response.";
        if (sources && sources.length) reply += "\n\n**Sources:** " + sources.join(", ");
        botMsg.dataset.raw = reply;
        renderMarkdown(contentEl, reply);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    } catch (err) {
        console.error("Chat error:", err);
        botMsg.dataset.raw = "";
        contentEl.innerHTML = "";
        const errSpan = document.createElement("span");
        errSpan.style.color = "var(--error)";
        errSpan.textContent = err.message || "Something went wrong.";
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
        ? '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zm1 4.5a1 1 0 11-2 0 1 1 0 012 0zM6.5 7A.5.5 0 017 6.5h1a.5.5 0 01.5.5v3.5a.5.5 0 01-1 0V7.5H7a.5.5 0 01-.5-.5z"/></svg>'
        : '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 100-6 3 3 0 000 6zm-5 6s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3z"/></svg>';

    const content = document.createElement("div");
    content.className = "msg-content";
    if (text) {
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

// Chat panel toggle (mobile)
chatToggleBtn.addEventListener("click", () => {
    const chatPanel = $("chat-panel");
    chatPanel.classList.toggle("open");
});

// ─────────────────────────────────────────────────────────────────────────────
//  SIDEBAR (mobile toggle + collapse)
// ─────────────────────────────────────────────────────────────────────────────
$("sidebar-toggle").addEventListener("click", () => {
    $("sidebar").classList.toggle("open");
});
document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "u") { e.preventDefault(); fileInput.click(); }
    if (e.key === "Escape") { $("sidebar").classList.remove("open"); closeApiKeyModal(); }
});

// ─────────────────────────────────────────────────────────────────────────────
//  RESTORE SESSION ON LOAD
// ─────────────────────────────────────────────────────────────────────────────
function restoreActiveSession() {
    const lastId = ls_get(SK.activeId);
    if (!lastId) return;
    const session = sessions.find((s) => s.id === lastId);
    if (session) activateSession(lastId);
}

// ─────────────────────────────────────────────────────────────────────────────
//  STARTUP
// ─────────────────────────────────────────────────────────────────────────────
initModelSelector();
initApiKey();
loadSessions();
renderSessionSidebar();

if (sessions.length) {
    restoreActiveSession();
} else {
    showWelcomeState();
}
