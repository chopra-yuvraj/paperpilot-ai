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

// State
let appSections = [];

// --- Helper: Typewriter Effect ---
function typeText(element, text, speed = 10) {
    element.textContent = "";
    element.classList.add('typing');
    return new Promise(resolve => {
        let i = 0;
        
        // Handle undefined text
        if (!text) {
             element.classList.remove('typing');
             resolve();
             return;
        }

        const interval = setInterval(() => {
            element.textContent += text.charAt(i);
            i++;
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
        
        // Save sections to state
        appSections = data.sections || [];
        
        fileStatus.textContent = data.filename;
        fileStatus.classList.remove('loading-text');
        
        renderSections(appSections);
        
        // Open first section if available
        if(appSections.length > 0) {
            loadSection(0);
        }
        
    } catch (err) {
        fileStatus.textContent = "Error uploading.";
        fileStatus.classList.remove('loading-text');
        console.error(err);
        alert("Upload failed. Make sure backend is running and keys are set.");
    }
});

function renderSections(sections) {
    sectionsList.innerHTML = '';
    sections.forEach((sec, index) => {
        const div = document.createElement('div');
        div.className = 'section-item';
        div.textContent = sec.title;
        div.onclick = () => loadSection(index);
        div.dataset.index = index;

        // Stagger Animation
        div.style.animationDelay = `${index * 50}ms`;
        sectionsList.appendChild(div);
    });
}

async function loadSection(index) {
    // UI Update
    document.querySelectorAll('.section-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.querySelector(`.section-item[data-index='${index}']`);
    if(activeItem) activeItem.classList.add('active');

    const section = appSections[index];
    if(!section) return;

    // Reset Analysis Panel
    analysisPanel.classList.add('hidden');
    aiExplanation.textContent = '';
    aiCritique.innerHTML = '';

    // Animate Content Transition
    sectionContent.style.opacity = '0';
    sectionTitle.style.opacity = '0';
    
    setTimeout(() => {
        sectionTitle.textContent = section.title;
        sectionContent.textContent = section.content;
        sectionContent.style.opacity = '1';
        sectionTitle.style.opacity = '1';
        
        // Trigger Explanation
        analysisPanel.classList.remove('hidden');
        aiExplanation.textContent = 'Generating...';
        aiExplanation.classList.add('loading-text');
        
        fetchExplanation(section.title, section.content);
    }, 200);
}

async function fetchExplanation(title, content) {
    try {
        // Send text to backend for explanation
        const res = await fetch(`${API_BASE}/explain_text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                text: content,
                title: title
            })
        });
        
        if(!res.ok) throw new Error("Explanation failed");
        
        const data = await res.json();

        aiExplanation.classList.remove('loading-text');
        
        // Type the explanation
        await typeText(aiExplanation, data.explanation, 10);

        // Render Critique
        aiCritique.innerHTML = data.critique;
        aiCritique.style.animation = 'fadeIn 1s ease';

    } catch (err) {
        aiExplanation.textContent = "Error: " + err.message;
        aiExplanation.classList.remove('loading-text');
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

    const loadingId = appendMessage('bot', 'Thinking...');
    const loadingEl = document.getElementById(loadingId);
    loadingEl.classList.add('loading-text');

    try {
        const res = await fetch(`${API_BASE}/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: text
            })
        });
        const data = await res.json();

        loadingEl.classList.remove('loading-text');
        
        // Format sources
        let sourceText = "";
        if (data.sources && data.sources.length > 0) {
            sourceText = "\n\nSources: " + data.sources.join(', ');
        }
        
        const fullReply = data.answer + sourceText;
        await typeText(loadingEl, fullReply, 20);

    } catch (err) {
        loadingEl.textContent = "Error: " + err.message;
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
