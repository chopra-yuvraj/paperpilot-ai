const API_BASE = "";

// DOM Elements
const uploadBtn = document.getElementById('upload-btn');
const fileInput = document.getElementById('file-input');
const sectionsList = document.getElementById('sections-list');
const fileStatus = document.getElementById('file-status');
const readerView = document.getElementById('reader-view');

// Content Areas
const sectionTitle = document.getElementById('section-title');
const sectionContent = document.getElementById('section-content');
const analysisPanel = document.getElementById('analysis-panel');
const aiExplanation = document.getElementById('ai-explanation');
const aiCritique = document.getElementById('ai-critique');

// Chat
const chatQuery = document.getElementById('chat-query');
const sendChatBtn = document.getElementById('send-chat');
const chatHistory = document.getElementById('chat-history');

let currentSectionId = null;

// --- Helper: Typewriter Effect ---
async function typeText(element, text, speed = 10) {
    element.textContent = "";
    element.classList.add('typing');

    // Process markdown-like bolding if needed, but simple for now
    // We will just type raw text or html? Let's type raw text then render HTML
    // Ideally we type visible chars.

    // For simplicity, we just type content directly. 
    // If it has HTML tags, typing is harder. 
    // We'll just type the whole block if it's markdown-ish.
    // Actually, let's just do a simple interval.

    return new Promise(resolve => {
        let i = 0;
        const interval = setInterval(() => {
            element.textContent += text.charAt(i);
            i++;
            // Scroll to bottom if in chat
            if (element.classList.contains('msg')) {
                chatHistory.scrollTop = chatHistory.scrollHeight;
            }
            if (i >= text.length) {
                clearInterval(interval);
                element.classList.remove('typing');
                resolve();
            }
        }, speed);
    });
}

// --- Event Listeners ---

uploadBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    fileStatus.textContent = `Uploading ${file.name}...`;
    fileStatus.classList.add('loading-text');

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Upload failed');

        const data = await response.json();
        fileStatus.textContent = data.filename;
        fileStatus.classList.remove('loading-text');
        renderSections(data.sections);
    } catch (err) {
        fileStatus.textContent = "Error uploading file.";
        fileStatus.classList.remove('loading-text');
        console.error(err);
    }
});

function renderSections(sections) {
    sectionsList.innerHTML = '';
    sections.forEach((sec, index) => {
        const div = document.createElement('div');
        div.className = 'section-item';
        div.textContent = sec.title;
        div.onclick = () => loadSection(sec.id);

        // Stagger Animation
        div.style.animationDelay = `${index * 50}ms`;

        sectionsList.appendChild(div);
    });
}

async function loadSection(id) {
    currentSectionId = id;

    document.querySelectorAll('.section-item').forEach(el => el.classList.remove('active'));
    // Find active element logic can be improved later

    try {
        // Skeleton / Loading State
        sectionTitle.classList.add('skeleton-text');
        sectionContent.textContent = '';
        sectionContent.classList.add('skeleton-text');
        sectionContent.style.height = '200px';

        const res = await fetch(`${API_BASE}/section/${id}`);
        const data = await res.json();

        // Reveal
        sectionTitle.classList.remove('skeleton-text');
        sectionContent.classList.remove('skeleton-text');
        sectionContent.style.height = 'auto';

        sectionTitle.textContent = data.title;
        typeText(sectionContent, data.content, 1); // Fast typing for content

        // AI Params
        analysisPanel.classList.remove('hidden');
        aiExplanation.className = 'ai-box skeleton-text';
        aiExplanation.textContent = '';
        aiCritique.innerHTML = '';

        fetchExplanation(id);

    } catch (err) {
        console.error(err);
    }
}

async function fetchExplanation(id) {
    try {
        const res = await fetch(`${API_BASE}/explain_section`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section_id: id })
        });
        const data = await res.json();

        aiExplanation.className = 'ai-box';
        // Type the explanation
        await typeText(aiExplanation, data.explanation, 20);

        // Render Critique (HTML) directly since it has structure
        aiCritique.innerHTML = data.critique;
        // Fade in critique
        aiCritique.style.animation = 'fadeIn 1s ease';

    } catch (err) {
        aiExplanation.textContent = "Error generating explanation.";
    }
}

// Chat Logic
sendChatBtn.addEventListener('click', sendMessage);
chatQuery.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

async function sendMessage() {
    const text = chatQuery.value.trim();
    if (!text) return;

    appendMessage('user', text);
    chatQuery.value = '';

    // Loading placeholder
    const loadingId = appendMessage('bot', '...');
    const loadingEl = document.getElementById(loadingId);
    loadingEl.classList.add('loading-text');

    try {
        const res = await fetch(`${API_BASE}/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: text,
                section_id: currentSectionId
            })
        });
        const data = await res.json();

        // Remove loading state
        loadingEl.classList.remove('loading-text');

        const replyText = `${data.answer}\n\nSources: ${data.sources.join(', ')}`;

        // Type out the response
        await typeText(loadingEl, replyText, 30);

    } catch (err) {
        loadingEl.textContent = "Sorry, I encountered an error.";
        loadingEl.classList.remove('loading-text');
    }
}

function appendMessage(role, text) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.textContent = text;
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    div.id = `msg-${Date.now()}`;
    return div.id;
}

function updateMessage(id, text) {
    const msg = document.getElementById(id);
    if (msg) {
        msg.textContent = text;
    }
}
