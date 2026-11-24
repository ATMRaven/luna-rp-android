/* -------------------------------------------------------------
   Luna RP Web App - Mobile-First Client State & Interactions
   ------------------------------------------------------------- */

const DEFAULT_CLOUD_API_BASE = 'https://luna-rp.atmr.workers.dev';
const APK_MANIFEST_URL = 'https://github.com/ATMRaven/luna-rp-android/releases/latest/download/latest.json';

function isNativeApp() {
    try {
        return Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    } catch {
        return false;
    }
}

const API_BASE = isNativeApp() ? DEFAULT_CLOUD_API_BASE : '';

function apiUrl(path) {
    if (!path) return path;
    if (/^https?:\/\//i.test(path)) return path;
    return `${API_BASE}${path}`;
}

const STORAGE_SESSIONS = 'luna_rp_sessions_v2';
const STORAGE_ACTIVE_SESSION = 'luna_rp_active_session_v2';
const STORAGE_LEGACY_CHAT = 'luna_rp_chat_history_v1';
const STORAGE_PERSONA = 'luna_rp_user_persona_v1';
const STORAGE_SETTINGS = 'luna_rp_settings_v1';

const state = {
    models: [],
    characters: [],
    activeChar: null,
    activeCharId: 'luna',
    activeScenarioIdx: 0,
    activeModelId: 'nvidia/nemotron-3-ultra-550b-a55b',
    useCustomApi: false,
    temperature: 0.85,
    maxTokens: 1024,
    customApi: { url: '', key: '', model: '' },
    userPersona: {
        name: 'Aymen',
        description: "Luna's loving boyfriend and Favorite Person. Gentle, grounding, deeply affectionate, protective during her anxiety spirals."
    },
    sessions: {},
    activeSessionId: null,
    messages: [],
    diskScenes: [],
    isStreaming: false,
    abortController: null,
    editingMsgId: null,
    confirmCallback: null,
    lightboxFilename: null
};

// DOM Elements
const chatMessagesEl = document.getElementById('chat-messages');
const chatViewportEl = document.getElementById('chat-viewport');
const chatInputEl = document.getElementById('chat-input');
const btnSendEl = document.getElementById('btn-send');
const iconSendEl = document.getElementById('icon-send');
const iconStopEl = document.getElementById('icon-stop');
const btnScrollBottomEl = document.getElementById('btn-scroll-bottom');
const btnQuickIllustrateEl = document.getElementById('btn-quick-illustrate');

const activeModelNameEl = document.getElementById('active-model-name');
const activeModelDotEl = document.getElementById('active-model-dot');
const headerAvatarEl = document.getElementById('header-avatar');
const headerCharNameEl = document.getElementById('header-char-name');
const headerScenarioBadgeEl = document.getElementById('header-scenario-badge');
const headerStatusTextEl = document.getElementById('header-status-text');

const lightboxModalEl = document.getElementById('lightbox-modal');
const lightboxImgEl = document.getElementById('lightbox-img');
const lightboxPromptEl = document.getElementById('lightbox-prompt');
const lightboxDownloadEl = document.getElementById('lightbox-download');
const lightboxCloseEl = document.getElementById('lightbox-close');
const lightboxDeleteEl = document.getElementById('lightbox-delete');

let toastTimer = null;
let lastNativeBackAt = 0;

// Utilities
function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showToast(message) {
    const toast = document.getElementById('toast-banner');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 2400);
}

function showConfirm(title, message, onConfirm, confirmLabel = 'Confirm') {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('btn-confirm-ok').textContent = confirmLabel;
    state.confirmCallback = onConfirm;
    openOverlay('modal-confirm');
}

// 1. Initialization
async function init() {
    registerServiceWorker();
    setupMobileViewportFix();
    initNativeCapacitorBridge();
    loadLocalSettings();
    await fetchConfig();
    await fetchCharacters();
    setupEventListeners();
    setupTextareaAutoResize();
    renderChat();
    hideNativeSplash();
}

function registerServiceWorker() {
    if (!isNativeApp() && 'serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
}

function hideNativeSplash() {
    try {
        window.Capacitor?.Plugins?.SplashScreen?.hide?.();
    } catch {}
}

function initNativeCapacitorBridge() {
    if (!isNativeApp()) return;
    const cap = window.Capacitor;
    const AppPlugin = cap?.Plugins?.App;
    const KeyboardPlugin = cap?.Plugins?.Keyboard;
    const StatusBarPlugin = cap?.Plugins?.StatusBar;

    try {
        StatusBarPlugin?.setStyle?.({ style: 'DARK' });
        StatusBarPlugin?.setBackgroundColor?.({ color: '#0c0d0e' });
    } catch {}

    if (AppPlugin) {
        AppPlugin.addListener('backButton', async () => {
            const open = getOpenOverlays();
            if (open.length > 0) {
                closeOverlay(open[0]);
                return;
            }
            if (document.activeElement === chatInputEl) {
                chatInputEl.blur();
                try { await KeyboardPlugin?.hide?.(); } catch {}
                return;
            }
            const now = Date.now();
            if (now - lastNativeBackAt < 2000) {
                AppPlugin.exitApp();
            } else {
                lastNativeBackAt = now;
                showToast('Press back again to exit');
            }
        });

        // Background update check on launch & resume
        checkNativeApkUpdate(true);
        let lastCheck = Date.now();
        AppPlugin.addListener('appStateChange', (s) => {
            if (s.isActive && Date.now() - lastCheck > 3600000) {
                lastCheck = Date.now();
                checkNativeApkUpdate(true);
            }
        });
    }

    document.addEventListener('check-for-updates', () => {
        checkNativeApkUpdate(false);
    });
}

async function checkNativeApkUpdate(silent = true) {
    if (!isNativeApp()) return;
    const cap = window.Capacitor;
    const AppPlugin = cap?.Plugins?.App;
    const FilesystemPlugin = cap?.Plugins?.Filesystem;
    const ApkInstallerPlugin = cap?.Plugins?.ApkInstaller;
    if (!AppPlugin) return;

    try {
        const info = await AppPlugin.getInfo();
        const currentCode = parseInt(info.build, 10) || 1;
        const res = await fetch(`${APK_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) {
            if (!silent) showToast('No newer APK release available yet');
            return;
        }
        const manifest = await res.json();
        if (!manifest?.versionCode || manifest.versionCode <= currentCode) {
            if (!silent) showToast(`You are on the latest version (v${info.version})`);
            return;
        }

        showConfirm(
            `Update Available (v${manifest.versionName})`,
            manifest.releaseNotes || 'A new signed APK update is ready to install.',
            async () => {
                if (!ApkInstallerPlugin || !FilesystemPlugin) {
                    window.open(manifest.apkUrl, '_system');
                    return;
                }
                try {
                    const perm = await ApkInstallerPlugin.canRequestPackageInstalls();
                    if (!perm?.value) {
                        showToast('Allow unknown app installs for Luna RP, then retry');
                        await ApkInstallerPlugin.openInstallPermissionSettings();
                        return;
                    }
                    showToast('Downloading APK update...');
                    const dlRes = await fetch(manifest.apkUrl);
                    if (!dlRes.ok) throw new Error(`HTTP ${dlRes.status}`);
                    const buf = await dlRes.arrayBuffer();
                    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
                    const shaHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
                    if (manifest.sha256 && shaHex.toLowerCase() !== manifest.sha256.toLowerCase()) {
                        throw new Error('APK checksum mismatch');
                    }
                    const bytes = new Uint8Array(buf);
                    let bin = '';
                    const chunk = 0x8000;
                    for (let i = 0; i < bytes.length; i += chunk) {
                        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
                    }
                    const writeRes = await FilesystemPlugin.writeFile({
                        path: `update-${manifest.versionCode}.apk`,
                        data: btoa(bin),
                        directory: 'CACHE'
                    });
                    showToast('Android will ask you to confirm installation.');
                    await ApkInstallerPlugin.installApk({ filePath: writeRes.uri });
                } catch (err) {
                    showToast(`Update failed: ${err.message}`);
                }
            },
            'Update Now'
        );
    } catch (err) {
        if (!silent) showToast(`Update check failed: ${err.message}`);
    }
}

function setupMobileViewportFix() {
    const updateHeight = () => {
        if (window.visualViewport) {
            document.documentElement.style.setProperty('--vvh', `${window.visualViewport.height}px`);
            if (document.activeElement === chatInputEl) {
                scrollToBottom(false);
            }
        }
    };
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateHeight);
        updateHeight();
    }
}

function loadLocalSettings() {
    try {
        const savedPersona = localStorage.getItem(STORAGE_PERSONA);
        if (savedPersona) state.userPersona = JSON.parse(savedPersona);

        const savedSettings = localStorage.getItem(STORAGE_SETTINGS);
        if (savedSettings) {
            const parsed = JSON.parse(savedSettings);
            state.activeModelId = parsed.activeModelId || state.activeModelId;
            state.useCustomApi = Boolean(parsed.useCustomApi);
            if (typeof parsed.temperature === 'number') state.temperature = parsed.temperature;
            if (typeof parsed.maxTokens === 'number') state.maxTokens = parsed.maxTokens;
            state.customApi = parsed.customApi || state.customApi;
            state.activeCharId = parsed.activeCharId || 'luna';
            state.activeScenarioIdx = parsed.activeScenarioIdx || 0;
        }

        const savedSessions = localStorage.getItem(STORAGE_SESSIONS);
        if (savedSessions) {
            state.sessions = JSON.parse(savedSessions) || {};
            state.activeSessionId = localStorage.getItem(STORAGE_ACTIVE_SESSION);
        } else {
            // Migrate legacy single-chat storage if present
            const legacyChat = localStorage.getItem(STORAGE_LEGACY_CHAT);
            if (legacyChat) {
                const legacyMsgs = JSON.parse(legacyChat);
                if (Array.isArray(legacyMsgs) && legacyMsgs.length > 0) {
                    const sid = 'sess-' + Date.now();
                    state.sessions[sid] = {
                        id: sid,
                        charId: state.activeCharId,
                        scenarioIdx: state.activeScenarioIdx,
                        updatedAt: Date.now(),
                        messages: legacyMsgs
                    };
                    state.activeSessionId = sid;
                }
            }
        }
    } catch (e) {
        console.warn('Failed loading local state:', e);
    }
}

function saveLocalState() {
    try {
        if (state.activeSessionId) {
            state.sessions[state.activeSessionId] = {
                id: state.activeSessionId,
                charId: state.activeCharId,
                scenarioIdx: state.activeScenarioIdx,
                updatedAt: Date.now(),
                messages: state.messages
            };
        }

        localStorage.setItem(STORAGE_SETTINGS, JSON.stringify({
            activeModelId: state.activeModelId,
            useCustomApi: state.useCustomApi,
            temperature: state.temperature,
            maxTokens: state.maxTokens,
            customApi: state.customApi,
            activeCharId: state.activeCharId,
            activeScenarioIdx: state.activeScenarioIdx
        }));
        localStorage.setItem(STORAGE_PERSONA, JSON.stringify(state.userPersona));
        localStorage.setItem(STORAGE_SESSIONS, JSON.stringify(state.sessions));
        if (state.activeSessionId) {
            localStorage.setItem(STORAGE_ACTIVE_SESSION, state.activeSessionId);
        }
    } catch (e) {
        console.warn('Failed saving local state:', e);
    }
}

async function fetchConfig() {
    try {
        const res = await fetch(apiUrl('/api/config'));
        const data = await res.json();
        state.models = data.models || [];

        const netCard = document.getElementById('network-info-card');
        const lanUrlsEl = document.getElementById('network-urls');
        if (data.deployed || isNativeApp()) {
            netCard?.classList.add('hidden');
        } else if (lanUrlsEl) {
            const ips = data.lanIps || [];
            const port = data.port || 3000;
            lanUrlsEl.textContent = ips.length
                ? ips.map(ip => `http://${ip}:${port}`).join('  •  ')
                : `http://localhost:${port}`;
        }

        renderModelsList();
        updateActiveModelPill();
    } catch (e) {
        console.error('Config fetch failed:', e);
    }
}

async function fetchCharacters() {
    try {
        const res = await fetch(apiUrl('/api/characters'));
        const data = await res.json();
        state.characters = data || [];

        // Restore active session if valid
        if (state.activeSessionId && state.sessions[state.activeSessionId]) {
            const sess = state.sessions[state.activeSessionId];
            state.activeCharId = sess.charId || state.activeCharId;
            state.activeScenarioIdx = sess.scenarioIdx || 0;
            state.messages = sess.messages || [];
        }

        state.activeChar = state.characters.find(c => c._id === state.activeCharId) || state.characters[0] || null;
        if (state.activeChar) {
            state.activeCharId = state.activeChar._id;
            updateCharacterUI();

            if (!state.messages || state.messages.length === 0) {
                startNewSession(state.activeScenarioIdx, false);
            }
        }
    } catch (e) {
        console.error('Characters fetch failed:', e);
    }
}

function updateCharacterUI() {
    if (!state.activeChar) return;
    const d = state.activeChar.data || state.activeChar;
    const name = state.activeChar.name || d.name || 'Character';
    const avatar = apiUrl(state.activeChar._avatar || '/avatars/luna.png');
    const tags = Array.isArray(d.tags) ? d.tags : (Array.isArray(state.activeChar.tags) ? state.activeChar.tags : []);
    const tagline = d.creator_notes || state.activeChar.creatorcomment || `${tags.slice(0, 3).join(' • ') || 'Roleplay Character'}`;

    headerAvatarEl.src = avatar;
    headerCharNameEl.textContent = name;
    headerScenarioBadgeEl.textContent = `Scenario ${state.activeScenarioIdx + 1}`;
    headerStatusTextEl.textContent = `${tags[0] ? tags[0] : 'Online'} • Tap for chats & scenes`;

    document.getElementById('card-char-avatar').src = avatar;
    document.getElementById('card-char-name').textContent = name;
    document.getElementById('card-char-tagline').textContent = tagline;

    const tagsEl = document.getElementById('card-char-tags');
    tagsEl.innerHTML = tags.slice(0, 5).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');

    renderCharactersStrip();
    renderScenariosList();
    renderSessionsList();
}

// 2. Character & Scenario Handlers
function getScenarios() {
    if (!state.activeChar) return [];
    const d = state.activeChar.data || state.activeChar;
    const firstMes = state.activeChar.first_mes || d.first_mes || '';
    const altGreetings = state.activeChar.alternate_greetings || d.alternate_greetings || [];
    const isLuna = (state.activeChar._id === 'luna');

    const lunaMeta = [
        { title: 'Scenario 1: Rainy Evening Reunion', badge: 'Sofa Anxiety Spiral' },
        { title: 'Scenario 2: 2:40 AM Nightmare', badge: 'Night Terror & Touch' },
        { title: 'Scenario 3: Homecoming Ambush', badge: 'Doorway Tackling' },
        { title: 'Scenario 4: Lazy Sunday Cuddle', badge: 'Morning Bed Romance' }
    ];

    const list = [{
        title: isLuna ? lunaMeta[0].title : 'Scenario 1: Opening Greeting',
        badge: isLuna ? lunaMeta[0].badge : 'Primary',
        preview: firstMes.replace(/\s+/g, ' ').slice(0, 120),
        content: firstMes
    }];

    altGreetings.forEach((greeting, i) => {
        const meta = isLuna && lunaMeta[i + 1] ? lunaMeta[i + 1] : null;
        list.push({
            title: meta ? meta.title : `Scenario ${i + 2}: Alternate Hook`,
            badge: meta ? meta.badge : `Alt ${i + 1}`,
            preview: String(greeting || '').replace(/\s+/g, ' ').slice(0, 120),
            content: greeting
        });
    });

    return list;
}

function startNewSession(scenarioIdx = 0, closeDrawersAfter = true) {
    const scenarios = getScenarios();
    const selected = scenarios[scenarioIdx] || scenarios[0] || { content: 'Hello.' };
    state.activeScenarioIdx = scenarioIdx;
    headerScenarioBadgeEl.textContent = `Scenario ${scenarioIdx + 1}`;

    const charName = state.activeChar?.name || 'Character';
    const greetingContent = String(selected.content || '')
        .replace(/\{\{user\}\}/gi, state.userPersona.name)
        .replace(/\{\{char\}\}/gi, charName);

    const newId = 'sess-' + Date.now();
    state.activeSessionId = newId;
    state.messages = [
        {
            id: 'msg-' + Date.now(),
            role: 'assistant',
            content: greetingContent,
            swipes: [greetingContent],
            swipeIndex: 0,
            timestamp: Date.now()
        }
    ];

    saveLocalState();
    updateCharacterUI();
    renderChat();
    if (closeDrawersAfter) closeAllOverlays();
}

function switchSession(sessionId) {
    const sess = state.sessions[sessionId];
    if (!sess) return;
    state.activeSessionId = sessionId;
    state.activeCharId = sess.charId || state.activeCharId;
    state.activeChar = state.characters.find(c => c._id === state.activeCharId) || state.characters[0];
    state.activeScenarioIdx = sess.scenarioIdx || 0;
    state.messages = sess.messages || [];

    saveLocalState();
    updateCharacterUI();
    renderChat();
    closeAllOverlays();
}

// 3. Renderers
function renderCharactersStrip() {
    const strip = document.getElementById('characters-strip');
    if (!strip) return;
    strip.innerHTML = '';

    state.characters.forEach(char => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `char-chip ${char._id === state.activeCharId ? 'active' : ''}`;
        btn.innerHTML = `
            <img src="${escapeHtml(apiUrl(char._avatar || '/avatars/luna.png'))}" alt="">
            <span>${escapeHtml(char.name || char._id)}</span>
        `;
        btn.addEventListener('click', () => {
            if (char._id === state.activeCharId) return;
            state.activeChar = char;
            state.activeCharId = char._id;

            // Load most recent session for this character, or start a new one
            const existing = Object.values(state.sessions)
                .filter(s => s.charId === char._id)
                .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];

            if (existing) {
                switchSession(existing.id);
            } else {
                startNewSession(0, false);
            }
            showToast(`Switched to ${char.name}`);
        });
        strip.appendChild(btn);
    });
}

function renderModelsList() {
    const listEl = document.getElementById('models-list');
    listEl.innerHTML = '';

    state.models.forEach(model => {
        const isActive = !state.useCustomApi && model.id === state.activeModelId;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `model-option ${isActive ? 'active' : ''} ${model.hasKey ? '' : 'disabled'}`;
        item.innerHTML = `
            <div class="model-option-left">
                <div class="model-title-row">
                    <span class="model-title">${escapeHtml(model.name)}</span>
                    <span class="model-badge">${escapeHtml(model.badge)}</span>
                </div>
                <span class="model-desc">${escapeHtml(model.description)}</span>
            </div>
            ${isActive ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
        `;
        item.addEventListener('click', () => {
            if (!model.hasKey) {
                showToast(`Missing API key for ${model.provider}`);
                return;
            }
            state.useCustomApi = false;
            state.activeModelId = model.id;
            updateActiveModelPill();
            renderModelsList();
            saveLocalState();
            closeAllOverlays();
            showToast(`Model: ${model.name}`);
        });
        listEl.appendChild(item);
    });
}

function updateActiveModelPill() {
    activeModelDotEl.className = 'pill-dot';
    if (state.useCustomApi && state.customApi.url) {
        activeModelNameEl.textContent = state.customApi.model || 'Custom API';
        activeModelDotEl.classList.add('custom');
        return;
    }

    const active = state.models.find(m => m.id === state.activeModelId);
    if (active) {
        activeModelNameEl.textContent = active.name;
        if (active.provider === 'llmsrelay') activeModelDotEl.classList.add('frontier');
    } else {
        activeModelNameEl.textContent = state.activeModelId || 'Model';
    }
}

function renderScenariosList() {
    const listEl = document.getElementById('scenarios-list');
    listEl.innerHTML = '';
    const scenarios = getScenarios();

    scenarios.forEach((sc, idx) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `scenario-option ${idx === state.activeScenarioIdx ? 'active' : ''}`;
        item.innerHTML = `
            <div class="scenario-header-row">
                <span class="scenario-title">${escapeHtml(sc.title)}</span>
                <span class="tag">${escapeHtml(sc.badge)}</span>
            </div>
            <span class="scenario-preview">${escapeHtml(sc.preview)}</span>
        `;
        item.addEventListener('click', () => {
            showConfirm(
                'Start New Scenario?',
                `Begin "${sc.title}" in a fresh session? Your current chat stays saved in Saved Sessions below.`,
                () => startNewSession(idx, true),
                'Start Scenario'
            );
        });
        listEl.appendChild(item);
    });
}

function renderSessionsList() {
    const listEl = document.getElementById('sessions-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const sessions = Object.values(state.sessions)
        .filter(s => s.messages && s.messages.length > 0)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (sessions.length === 0) {
        listEl.innerHTML = '<p class="section-desc">No saved sessions yet.</p>';
        return;
    }

    sessions.forEach(sess => {
        const charObj = state.characters.find(c => c._id === sess.charId);
        const charName = charObj?.name || sess.charId || 'Luna';
        const lastMsg = sess.messages[sess.messages.length - 1]?.content || '';
        const preview = lastMsg.replace(/\s+/g, ' ').slice(0, 58);

        const row = document.createElement('div');
        row.className = `session-item ${sess.id === state.activeSessionId ? 'active' : ''}`;

        const mainBtn = document.createElement('div');
        mainBtn.className = 'session-main';
        mainBtn.innerHTML = `
            <span class="session-title">${escapeHtml(charName)} • Scenario ${(sess.scenarioIdx || 0) + 1} (${sess.messages.length} msgs)</span>
            <span class="session-meta">${escapeHtml(preview || 'Empty chat')}</span>
        `;
        mainBtn.addEventListener('click', () => switchSession(sess.id));

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'session-del-btn';
        delBtn.title = 'Delete session';
        delBtn.setAttribute('aria-label', 'Delete saved session');
        delBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showConfirm('Delete Saved Chat?', 'Remove this saved conversation from device storage?', () => {
                delete state.sessions[sess.id];
                if (state.activeSessionId === sess.id) {
                    const remaining = Object.keys(state.sessions);
                    if (remaining.length > 0) {
                        switchSession(remaining[0]);
                    } else {
                        startNewSession(0, false);
                    }
                } else {
                    saveLocalState();
                    renderSessionsList();
                }
                showToast('Session deleted');
            }, 'Delete');
        });

        row.appendChild(mainBtn);
        row.appendChild(delBtn);
        listEl.appendChild(row);
    });
}

function formatMessageContent(rawText) {
    if (!rawText) return '';
    let escaped = escapeHtml(rawText);
    escaped = escaped.replace(/\*([^\*\n]+)\*/g, '<span class="action-text">*$1*</span>');
    const paragraphs = escaped.split(/\n\n+/).filter(p => p.trim());
    return paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

function renderChat() {
    chatMessagesEl.innerHTML = '';

    state.messages.forEach((msg, idx) => {
        const group = document.createElement('div');
        group.className = `msg-group ${msg.role === 'assistant' ? 'char' : 'user'}`;
        group.id = msg.id;

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';
        bubble.innerHTML = formatMessageContent(msg.content);
        group.appendChild(bubble);

        const toolbar = document.createElement('div');
        toolbar.className = 'msg-toolbar';

        if (msg.role === 'assistant') {
            const isLastAssistant = idx === state.messages.length - 1;
            const swipes = Array.isArray(msg.swipes) ? msg.swipes : [msg.content];
            const swipeIdx = msg.swipeIndex || 0;

            let swipeHtml = '';
            if (swipes.length > 1) {
                swipeHtml = `
                    <div class="swipe-controls">
                        <button type="button" class="swipe-btn btn-swipe-prev" data-msg-id="${escapeHtml(msg.id)}" ${swipeIdx <= 0 ? 'disabled' : ''} aria-label="Previous variation">&lsaquo;</button>
                        <span class="swipe-counter">${swipeIdx + 1}/${swipes.length}</span>
                        <button type="button" class="swipe-btn btn-swipe-next" data-msg-id="${escapeHtml(msg.id)}" ${swipeIdx >= swipes.length - 1 ? 'disabled' : ''} aria-label="Next variation">&rsaquo;</button>
                    </div>
                `;
            }

            toolbar.innerHTML = `
                ${swipeHtml}
                ${isLastAssistant && idx > 0 ? `
                    <button type="button" class="tool-btn btn-regen" data-msg-id="${escapeHtml(msg.id)}" title="Regenerate response">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                        <span>Regen</span>
                    </button>
                ` : ''}
                <button type="button" class="tool-btn btn-illustrate" data-msg-id="${escapeHtml(msg.id)}" title="Illustrate scene (2x)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    <span>Scene</span>
                </button>
                <button type="button" class="tool-btn btn-edit" data-msg-id="${escapeHtml(msg.id)}" title="Edit message">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    <span>Edit</span>
                </button>
                <button type="button" class="tool-btn btn-copy" data-msg-id="${escapeHtml(msg.id)}" title="Copy message">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                    <span>Copy</span>
                </button>
                ${idx > 0 ? `
                    <button type="button" class="tool-btn danger btn-delete" data-msg-id="${escapeHtml(msg.id)}" title="Rewind / Delete">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                    </button>
                ` : ''}
            `;
        } else {
            toolbar.innerHTML = `
                <button type="button" class="tool-btn btn-edit" data-msg-id="${escapeHtml(msg.id)}" title="Edit message">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    <span>Edit</span>
                </button>
                <button type="button" class="tool-btn btn-copy" data-msg-id="${escapeHtml(msg.id)}" title="Copy message">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                    <span>Copy</span>
                </button>
                <button type="button" class="tool-btn danger btn-delete" data-msg-id="${escapeHtml(msg.id)}" title="Delete from here">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                </button>
            `;
        }

        group.appendChild(toolbar);

        if (msg.role === 'assistant' && msg.sceneVisuals) {
            renderSceneVisualsCard(group, msg.sceneVisuals);
        }

        chatMessagesEl.appendChild(group);
    });

    scrollToBottom();
}

function renderSceneVisualsCard(msgGroupEl, sceneData) {
    const existing = msgGroupEl.querySelector('.scene-visuals-card');
    if (existing) existing.remove();

    const safePrompt = escapeHtml(sceneData.prompt || '');
    const img1 = escapeHtml(apiUrl(sceneData.images[0] || ''));
    const img2 = escapeHtml(apiUrl(sceneData.images[1] || sceneData.images[0] || ''));

    const card = document.createElement('div');
    card.className = 'scene-visuals-card';
    card.innerHTML = `
        <div class="scene-visuals-header">
            <span class="scene-badge">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                Scene Visuals
            </span>
            <span class="scene-prompt-preview" title="${safePrompt}">${safePrompt ? safePrompt.slice(0, 48) + '...' : ''}</span>
        </div>
        <div class="scene-images-grid">
            <div class="scene-img-wrapper" data-src="${img1}" data-prompt="${safePrompt}">
                <img src="${img1}" alt="Scene Variation A" class="scene-img" loading="lazy">
                <span class="variation-tag">Variation A</span>
            </div>
            <div class="scene-img-wrapper" data-src="${img2}" data-prompt="${safePrompt}">
                <img src="${img2}" alt="Scene Variation B" class="scene-img" loading="lazy">
                <span class="variation-tag">Variation B</span>
            </div>
        </div>
    `;

    card.querySelectorAll('.scene-img-wrapper').forEach(wrapper => {
        wrapper.addEventListener('click', () => {
            openLightbox(wrapper.getAttribute('data-src'), wrapper.getAttribute('data-prompt'));
        });
    });

    msgGroupEl.appendChild(card);
}

function scrollToBottom(smooth = true) {
    setTimeout(() => {
        chatViewportEl.scrollTo({
            top: chatViewportEl.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto'
        });
    }, 40);
}

function setStreamingUI(active) {
    state.isStreaming = active;
    if (active) {
        btnSendEl.classList.add('streaming');
        btnSendEl.disabled = false;
        btnSendEl.title = 'Stop generating';
        btnSendEl.setAttribute('aria-label', 'Stop generating');
        iconSendEl.classList.add('hidden');
        iconStopEl.classList.remove('hidden');
    } else {
        btnSendEl.classList.remove('streaming');
        btnSendEl.disabled = !chatInputEl.value.trim();
        btnSendEl.title = 'Send message';
        btnSendEl.setAttribute('aria-label', 'Send message');
        iconSendEl.classList.remove('hidden');
        iconStopEl.classList.add('hidden');
    }
}

// 4. Send Message, Regenerate & Streaming
async function handleSendMessage() {
    if (state.isStreaming) {
        state.abortController?.abort();
        return;
    }

    const text = chatInputEl.value.trim();
    if (!text) return;

    chatInputEl.value = '';
    chatInputEl.style.height = 'auto';

    const userMsg = {
        id: 'msg-' + Date.now(),
        role: 'user',
        content: text,
        timestamp: Date.now()
    };
    state.messages.push(userMsg);

    const assistantMsg = {
        id: 'msg-' + (Date.now() + 1),
        role: 'assistant',
        content: '',
        swipes: [],
        swipeIndex: 0,
        timestamp: Date.now()
    };
    state.messages.push(assistantMsg);

    renderChat();
    await streamAssistantMessage(assistantMsg);
}

async function handleRegenerate(msgId) {
    if (state.isStreaming) return;
    const msgIdx = state.messages.findIndex(m => m.id === msgId);
    if (msgIdx <= 0) return;

    const assistantMsg = state.messages[msgIdx];
    if (!Array.isArray(assistantMsg.swipes)) {
        assistantMsg.swipes = assistantMsg.content ? [assistantMsg.content] : [];
    }

    await streamAssistantMessage(assistantMsg, true);
}

async function streamAssistantMessage(assistantMsg, isSwipe = false) {
    const targetGroup = document.getElementById(assistantMsg.id);
    const bubble = targetGroup?.querySelector('.msg-bubble');
    const charName = state.activeChar?.name || 'Luna';

    if (bubble) {
        bubble.innerHTML = `<span class="typing-pulse">${escapeHtml(charName)} is typing <span class="typing-dots"><span></span><span></span><span></span></span></span>`;
    }
    scrollToBottom();

    state.abortController = new AbortController();
    setStreamingUI(true);

    let accumulated = '';
    try {
        const msgIdx = state.messages.findIndex(m => m.id === assistantMsg.id);
        const contextMessages = state.messages.slice(0, msgIdx);

        const payload = {
            modelId: state.activeModelId,
            useCustomApi: state.useCustomApi,
            customUrl: state.useCustomApi ? state.customApi.url : '',
            customKey: state.useCustomApi ? state.customApi.key : '',
            messages: contextMessages,
            character: state.activeChar,
            userPersona: state.userPersona,
            temperature: state.temperature,
            maxTokens: state.maxTokens,
            stream: true
        };

        const response = await fetch(apiUrl('/api/chat'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: state.abortController.signal,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data:')) continue;

                const jsonStr = trimmed.replace(/^data:\s*/, '');
                if (jsonStr === '[DONE]') break;

                let parsed;
                try {
                    parsed = JSON.parse(jsonStr);
                } catch {
                    continue;
                }

                if (parsed.error) {
                    throw new Error(parsed.error);
                }

                const deltaObj = parsed.choices?.[0]?.delta;
                if (deltaObj?.reasoning_content && !accumulated && bubble) {
                    if (!bubble.dataset.thinkingShown) {
                        bubble.dataset.thinkingShown = '1';
                        bubble.innerHTML = `<span class="typing-pulse">${escapeHtml(charName)} is thinking <span class="typing-dots"><span></span><span></span><span></span></span></span>`;
                    }
                }

                const delta = deltaObj?.content || '';
                if (delta) {
                    accumulated += delta;
                    assistantMsg.content = accumulated;
                    if (bubble) bubble.innerHTML = formatMessageContent(accumulated);
                    scrollToBottom(false);
                }
            }
        }

        if (!accumulated) {
            throw new Error('Model returned an empty response. Try another model or regenerate.');
        }

        if (isSwipe || Array.isArray(assistantMsg.swipes)) {
            if (!Array.isArray(assistantMsg.swipes)) assistantMsg.swipes = [];
            assistantMsg.swipes.push(accumulated);
            assistantMsg.swipeIndex = assistantMsg.swipes.length - 1;
        }

        saveLocalState();
        renderChat();
    } catch (err) {
        if (err.name === 'AbortError') {
            if (accumulated.trim()) {
                assistantMsg.content = accumulated;
                if (Array.isArray(assistantMsg.swipes)) {
                    assistantMsg.swipes.push(accumulated);
                    assistantMsg.swipeIndex = assistantMsg.swipes.length - 1;
                }
                showToast('Generation stopped');
            } else {
                // Remove empty aborted placeholder
                if (!isSwipe) {
                    state.messages = state.messages.filter(m => m.id !== assistantMsg.id);
                }
                showToast('Cancelled');
            }
            saveLocalState();
            renderChat();
        } else {
            console.error('Chat generation error:', err);
            if (!isSwipe) {
                assistantMsg.content = `[Error: ${err.message}]`;
            }
            if (bubble) {
                bubble.innerHTML = `<span style="color:var(--accent-red);">Error: ${escapeHtml(err.message)}</span>`;
            }
            showToast(err.message);
            saveLocalState();
            renderChat();
        }
    } finally {
        state.abortController = null;
        setStreamingUI(false);
    }
}

// 5. Smart Scene Image Generator
async function triggerSceneGeneration(msgId) {
    const targetGroup = document.getElementById(msgId);
    if (!targetGroup) return;

    const existingCard = targetGroup.querySelector('.scene-visuals-card');
    if (existingCard) existingCard.remove();

    const skeletonCard = document.createElement('div');
    skeletonCard.className = 'scene-visuals-card';
    skeletonCard.innerHTML = `
        <div class="scene-visuals-header">
            <span class="scene-badge">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                Synthesizing 2 Scene Visuals...
            </span>
        </div>
        <div class="scene-images-grid">
            <div class="skeleton-box">Synthesizing Scene A...</div>
            <div class="skeleton-box">Synthesizing Scene B...</div>
        </div>
    `;
    targetGroup.appendChild(skeletonCard);
    scrollToBottom();

    try {
        const msgIndex = state.messages.findIndex(m => m.id === msgId);
        const contextSlice = msgIndex >= 0
            ? state.messages.slice(Math.max(0, msgIndex - 3), msgIndex + 1)
            : state.messages.slice(-4);

        const res = await fetch(apiUrl('/api/generate-scene'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                character: state.activeChar,
                userPersona: state.userPersona,
                messages: contextSlice
            })
        });

        const data = await res.json();
        if (!data.success || !data.images || data.images.length === 0) {
            throw new Error(data.error || 'Failed to synthesize images');
        }

        const sceneVisuals = {
            prompt: data.prompt,
            images: data.images,
            timestamp: data.timestamp
        };

        const msg = state.messages.find(m => m.id === msgId);
        if (msg) {
            msg.sceneVisuals = sceneVisuals;
            saveLocalState();
        }

        renderSceneVisualsCard(targetGroup, sceneVisuals);
        scrollToBottom();
    } catch (err) {
        console.error('Scene generation error:', err);
        skeletonCard.innerHTML = `<span style="color:var(--accent-red); font-size:12px;">Failed to illustrate scene: ${escapeHtml(err.message)}</span>`;
    }
}

// 6. Gallery & Lightbox
async function loadAndRenderGallery() {
    const gridEl = document.getElementById('gallery-grid');
    gridEl.innerHTML = '<p class="empty-gallery-text">Loading saved visuals...</p>';

    try {
        const res = await fetch(apiUrl('/api/scenes'));
        if (res.ok) {
            state.diskScenes = await res.json();
        }
    } catch {
        state.diskScenes = [];
    }

    // Collect URLs + prompts from all saved sessions so prompts stay mapped
    const promptByUrl = new Map();
    Object.values(state.sessions).forEach(sess => {
        (sess.messages || []).forEach(m => {
            if (m.sceneVisuals?.images) {
                m.sceneVisuals.images.forEach(u => promptByUrl.set(u, m.sceneVisuals.prompt || ''));
            }
        });
    });

    const items = [];
    const seen = new Set();

    state.diskScenes.forEach(s => {
        const fullUrl = apiUrl(s.url);
        seen.add(s.url);
        seen.add(fullUrl);
        items.push({ url: fullUrl, filename: s.filename, prompt: promptByUrl.get(s.url) || promptByUrl.get(fullUrl) || 'Generated Scene Visual' });
    });

    promptByUrl.forEach((prompt, url) => {
        const fullUrl = apiUrl(url);
        if (!seen.has(url) && !seen.has(fullUrl)) {
            items.push({ url: fullUrl, filename: null, prompt });
        }
    });

    if (items.length === 0) {
        gridEl.innerHTML = '<p class="empty-gallery-text">No scenes illustrated yet. Tap the camera icon on any message to generate 2 scene visuals.</p>';
        return;
    }

    gridEl.innerHTML = '';
    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'gallery-item';
        div.innerHTML = `<img src="${escapeHtml(item.url)}" alt="Scene Visual" loading="lazy">`;
        div.addEventListener('click', () => {
            openLightbox(item.url, item.prompt, item.filename);
        });
        gridEl.appendChild(div);
    });
}

function openLightbox(imgSrc, promptText, filename = null) {
    const resolvedSrc = apiUrl(imgSrc);
    lightboxImgEl.src = resolvedSrc;
    lightboxPromptEl.textContent = promptText || 'Scene Visual';
    lightboxDownloadEl.href = resolvedSrc;

    const detectedName = filename || ((imgSrc.includes('/generated_scenes/') || imgSrc.includes('/api/scenes/file/')) ? imgSrc.split('/').pop() : null);
    state.lightboxFilename = detectedName;
    if (detectedName) {
        lightboxDeleteEl.classList.remove('hidden');
    } else {
        lightboxDeleteEl.classList.add('hidden');
    }

    openOverlay('lightbox-modal');
}

// 7. Overlays & Android Back Button (LIFO Stack)
const OVERLAY_IDS = [
    'modal-confirm',
    'lightbox-modal',
    'modal-edit',
    'drawer-models',
    'drawer-character',
    'drawer-persona',
    'drawer-gallery'
];

function getOpenOverlays() {
    return OVERLAY_IDS.filter(id => !document.getElementById(id)?.classList.contains('hidden'));
}

function openOverlay(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (id.startsWith('drawer-')) {
        OVERLAY_IDS.filter(x => x.startsWith('drawer-')).forEach(d => document.getElementById(d)?.classList.add('hidden'));
    }
    el.classList.remove('hidden');
    try {
        history.pushState({ overlay: id }, '');
    } catch {}
}

function closeOverlay(id) {
    document.getElementById(id)?.classList.add('hidden');
}

function closeAllOverlays() {
    OVERLAY_IDS.forEach(id => closeOverlay(id));
}

// 8. Event Listeners & Wire-ups
function setupEventListeners() {
    btnSendEl.addEventListener('click', handleSendMessage);

    chatInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 768) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    chatInputEl.addEventListener('input', () => {
        if (!state.isStreaming) {
            btnSendEl.disabled = !chatInputEl.value.trim();
        }
    });

    btnQuickIllustrateEl.addEventListener('click', () => {
        const lastAssistantMsg = [...state.messages].reverse().find(m => m.role === 'assistant');
        if (lastAssistantMsg) {
            triggerSceneGeneration(lastAssistantMsg.id);
        } else {
            showToast('Start chatting first to illustrate a scene');
        }
    });

    // Message Toolbar Delegation
    chatMessagesEl.addEventListener('click', (e) => {
        const regenBtn = e.target.closest('.btn-regen');
        if (regenBtn) {
            handleRegenerate(regenBtn.getAttribute('data-msg-id'));
            return;
        }

        const prevSwipe = e.target.closest('.btn-swipe-prev');
        if (prevSwipe) {
            const msg = state.messages.find(m => m.id === prevSwipe.getAttribute('data-msg-id'));
            if (msg && msg.swipeIndex > 0) {
                msg.swipeIndex -= 1;
                msg.content = msg.swipes[msg.swipeIndex];
                saveLocalState();
                renderChat();
            }
            return;
        }

        const nextSwipe = e.target.closest('.btn-swipe-next');
        if (nextSwipe) {
            const msg = state.messages.find(m => m.id === nextSwipe.getAttribute('data-msg-id'));
            if (msg && msg.swipeIndex < msg.swipes.length - 1) {
                msg.swipeIndex += 1;
                msg.content = msg.swipes[msg.swipeIndex];
                saveLocalState();
                renderChat();
            }
            return;
        }

        const illustrateBtn = e.target.closest('.btn-illustrate');
        if (illustrateBtn) {
            triggerSceneGeneration(illustrateBtn.getAttribute('data-msg-id'));
            return;
        }

        const editBtn = e.target.closest('.btn-edit');
        if (editBtn) {
            const msg = state.messages.find(m => m.id === editBtn.getAttribute('data-msg-id'));
            if (msg) {
                state.editingMsgId = msg.id;
                document.getElementById('edit-message-textarea').value = msg.content;
                const regenEditBtn = document.getElementById('btn-save-edit-regen');
                if (msg.role === 'user') {
                    regenEditBtn.classList.remove('hidden');
                } else {
                    regenEditBtn.classList.add('hidden');
                }
                openOverlay('modal-edit');
            }
            return;
        }

        const copyBtn = e.target.closest('.btn-copy');
        if (copyBtn) {
            const msg = state.messages.find(m => m.id === copyBtn.getAttribute('data-msg-id'));
            if (msg) {
                navigator.clipboard.writeText(msg.content);
                copyBtn.classList.add('active');
                showToast('Copied to clipboard');
                setTimeout(() => copyBtn.classList.remove('active'), 1200);
            }
            return;
        }

        const deleteBtn = e.target.closest('.btn-delete');
        if (deleteBtn) {
            const msgId = deleteBtn.getAttribute('data-msg-id');
            const idx = state.messages.findIndex(m => m.id === msgId);
            if (idx <= 0) return;
            showConfirm(
                'Rewind Conversation?',
                'Delete this message and any messages after it?',
                () => {
                    state.messages = state.messages.slice(0, idx);
                    saveLocalState();
                    renderChat();
                    showToast('Rewound conversation');
                },
                'Delete'
            );
        }
    });

    // Scroll to bottom visibility
    chatViewportEl.addEventListener('scroll', () => {
        const distFromBottom = chatViewportEl.scrollHeight - chatViewportEl.scrollTop - chatViewportEl.clientHeight;
        btnScrollBottomEl.classList.toggle('hidden', distFromBottom <= 140);
    });
    btnScrollBottomEl.addEventListener('click', () => scrollToBottom(true));

    // Drawer openers
    document.getElementById('btn-open-models').addEventListener('click', () => openOverlay('drawer-models'));
    document.getElementById('btn-open-character').addEventListener('click', () => {
        renderSessionsList();
        openOverlay('drawer-character');
    });
    document.getElementById('btn-open-settings').addEventListener('click', () => openOverlay('drawer-persona'));
    document.getElementById('btn-open-gallery').addEventListener('click', () => {
        loadAndRenderGallery();
        openOverlay('drawer-gallery');
    });

    // Close buttons & backdrops
    document.querySelectorAll('.drawer-close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-close');
            if (targetId) closeOverlay(targetId);
        });
    });

    document.querySelectorAll('.drawer-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeOverlay(overlay.id);
        });
    });

    // Android / Browser Back Gesture closes topmost overlay
    window.addEventListener('popstate', () => {
        const open = getOpenOverlays();
        if (open.length > 0) {
            closeOverlay(open[0]);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const open = getOpenOverlays();
            if (open.length > 0) closeOverlay(open[0]);
        }
    });

    // Sliders
    const sliderTemp = document.getElementById('slider-temp');
    sliderTemp.value = state.temperature;
    document.getElementById('val-temp').textContent = state.temperature;
    sliderTemp.addEventListener('input', (e) => {
        state.temperature = parseFloat(e.target.value);
        document.getElementById('val-temp').textContent = state.temperature;
        saveLocalState();
    });

    const sliderTokens = document.getElementById('slider-tokens');
    sliderTokens.value = state.maxTokens;
    document.getElementById('val-tokens').textContent = state.maxTokens;
    sliderTokens.addEventListener('input', (e) => {
        state.maxTokens = parseInt(e.target.value, 10);
        document.getElementById('val-tokens').textContent = state.maxTokens;
        saveLocalState();
    });

    // Persona form
    const personaNameInput = document.getElementById('persona-name');
    const personaDescInput = document.getElementById('persona-desc');
    personaNameInput.value = state.userPersona.name;
    personaDescInput.value = state.userPersona.description;

    document.getElementById('btn-save-persona').addEventListener('click', () => {
        state.userPersona.name = personaNameInput.value.trim() || 'Aymen';
        state.userPersona.description = personaDescInput.value.trim();
        saveLocalState();
        closeAllOverlays();
        showToast('Persona saved');
    });

    // Custom API form
    const customUrlInput = document.getElementById('custom-api-url');
    const customKeyInput = document.getElementById('custom-api-key');
    const customModelInput = document.getElementById('custom-model-id');
    customUrlInput.value = state.customApi.url || '';
    customKeyInput.value = state.customApi.key || '';
    customModelInput.value = state.customApi.model || '';

    document.getElementById('btn-save-custom-api').addEventListener('click', () => {
        const url = customUrlInput.value.trim();
        const key = customKeyInput.value.trim();
        const model = customModelInput.value.trim();
        if (!url || !key) {
            showToast('Enter both Custom API URL and Key');
            return;
        }
        state.customApi = { url, key, model };
        state.useCustomApi = true;
        if (model) state.activeModelId = model;
        updateActiveModelPill();
        renderModelsList();
        saveLocalState();
        closeAllOverlays();
        showToast('Custom API enabled');
    });

    document.getElementById('btn-clear-custom-api').addEventListener('click', () => {
        state.useCustomApi = false;
        state.customApi = { url: '', key: '', model: '' };
        customUrlInput.value = '';
        customKeyInput.value = '';
        customModelInput.value = '';
        if (state.models.length > 0) {
            state.activeModelId = state.models[0].id;
        }
        updateActiveModelPill();
        renderModelsList();
        saveLocalState();
        showToast('Reverted to preset models');
    });

    // Import SillyTavern Card (.png or .json)
    document.getElementById('input-import-card').addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('card', file);

        try {
            showToast('Importing character card...');
            const res = await fetch(apiUrl('/api/characters/import'), {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Import failed');
            }
            await fetchCharacters();
            state.activeChar = state.characters.find(c => c._id === data.character._id) || data.character;
            state.activeCharId = state.activeChar._id;
            startNewSession(0, true);
            showToast(`Imported ${data.character.name}`);
        } catch (err) {
            showToast(err.message);
        } finally {
            e.target.value = '';
        }
    });

    // New Chat & Export
    document.getElementById('btn-new-chat').addEventListener('click', () => {
        showConfirm(
            'Start Fresh Chat?',
            'Start a new conversation with the active scenario? Your current chat stays saved below.',
            () => startNewSession(state.activeScenarioIdx, true),
            'New Chat'
        );
    });

    document.getElementById('btn-export-chat').addEventListener('click', () => {
        const charName = state.activeChar?.name || 'Character';
        const lines = [`# ${charName} — Scenario ${state.activeScenarioIdx + 1}\n`];
        state.messages.forEach(m => {
            const who = m.role === 'assistant' ? charName : state.userPersona.name;
            lines.push(`**${who}**\n\n${m.content}\n`);
        });
        const blob = new Blob([lines.join('\n---\n\n')], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${charName.toLowerCase().replace(/\s+/g, '_')}_chat.md`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Exported chat to Markdown');
    });

    // Edit Modal
    document.getElementById('btn-close-edit').addEventListener('click', () => closeOverlay('modal-edit'));
    document.getElementById('btn-save-edit').addEventListener('click', () => {
        const msg = state.messages.find(m => m.id === state.editingMsgId);
        const updated = document.getElementById('edit-message-textarea').value.trim();
        if (msg && updated) {
            msg.content = updated;
            if (Array.isArray(msg.swipes)) {
                msg.swipes[msg.swipeIndex || 0] = updated;
            }
            saveLocalState();
            renderChat();
            showToast('Message updated');
        }
        closeOverlay('modal-edit');
    });

    document.getElementById('btn-save-edit-regen').addEventListener('click', async () => {
        const idx = state.messages.findIndex(m => m.id === state.editingMsgId);
        const updated = document.getElementById('edit-message-textarea').value.trim();
        if (idx === -1 || !updated) return;

        state.messages[idx].content = updated;
        state.messages = state.messages.slice(0, idx + 1);
        const assistantMsg = {
            id: 'msg-' + (Date.now() + 1),
            role: 'assistant',
            content: '',
            swipes: [],
            swipeIndex: 0,
            timestamp: Date.now()
        };
        state.messages.push(assistantMsg);
        closeOverlay('modal-edit');
        renderChat();
        await streamAssistantMessage(assistantMsg);
    });

    // Confirm Modal
    document.getElementById('btn-confirm-cancel').addEventListener('click', () => closeOverlay('modal-confirm'));
    document.getElementById('btn-confirm-cancel-x').addEventListener('click', () => closeOverlay('modal-confirm'));
    document.getElementById('btn-confirm-ok').addEventListener('click', () => {
        const cb = state.confirmCallback;
        state.confirmCallback = null;
        closeOverlay('modal-confirm');
        if (cb) cb();
    });

    // Lightbox
    lightboxCloseEl.addEventListener('click', () => closeOverlay('lightbox-modal'));
    lightboxModalEl.addEventListener('click', (e) => {
        if (e.target === lightboxModalEl) closeOverlay('lightbox-modal');
    });
    document.getElementById('lightbox-copy-prompt').addEventListener('click', () => {
        navigator.clipboard.writeText(lightboxPromptEl.textContent || '');
        showToast('Prompt copied');
    });
    lightboxDeleteEl.addEventListener('click', () => {
        const fname = state.lightboxFilename;
        if (!fname) return;
        showConfirm('Delete Scene Image?', 'Permanently delete this generated image from disk?', async () => {
            try {
                const res = await fetch(apiUrl(`/api/scenes/${encodeURIComponent(fname)}`), { method: 'DELETE' });
                if (res.ok) {
                    closeOverlay('lightbox-modal');
                    loadAndRenderGallery();
                    showToast('Image deleted');
                }
            } catch {
                showToast('Failed to delete image');
            }
        }, 'Delete');
    });
}

function setupTextareaAutoResize() {
    chatInputEl.addEventListener('input', () => {
        chatInputEl.style.height = 'auto';
        chatInputEl.style.height = Math.min(chatInputEl.scrollHeight, 132) + 'px';
    });
}

init();
