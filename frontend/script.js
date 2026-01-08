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

// --- Event Listeners ---

uploadBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    fileStatus.textContent = `Uploading ${file.name}...`;

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
        renderSections(data.sections);
    } catch (err) {
        fileStatus.textContent = "Error uploading file.";
        console.error(err);
    }
});

function renderSections(sections) {
    sectionsList.innerHTML = '';
    sections.forEach(sec => {
        const div = document.createElement('div');
        div.className = 'section-item';
        div.textContent = sec.title;
        div.onclick = () => loadSection(sec.id);
        sectionsList.appendChild(div);
    });
}

async function loadSection(id) {
    currentSectionId = id;

    // UI Update
    document.querySelectorAll('.section-item').forEach(el => el.classList.remove('active'));
    // Ideally find the one with this text or index, but for now simple

    // Fetch content
    try {
        const res = await fetch(`${API_BASE}/section/${id}`);
        const data = await res.json();

        sectionTitle.textContent = data.title;
        sectionContent.textContent = data.content;

        // Trigger AI Explanation
        analysisPanel.classList.remove('hidden');
        aiExplanation.textContent = "Analyzing section...";
        aiCritique.textContent = "";

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

        aiExplanation.textContent = data.explanation;
        aiCritique.textContent = data.critique;
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

    // Loading state
    const loadingId = appendMessage('bot', 'Thinking...');

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

        // Update bot message
        const replyText = `${data.answer}\n\nSources: ${data.sources.join(', ')}`;
        updateMessage(loadingId, replyText);

    } catch (err) {
        updateMessage(loadingId, "Sorry, I encountered an error.");
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
