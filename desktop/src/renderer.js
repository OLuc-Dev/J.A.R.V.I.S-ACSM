/* JARVIS Desktop — Renderer */
const j = window.jarvis;

/* ── Navigation ── */
document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`view-${view}`).classList.add('active');
    if (view === 'tasks')    loadTasks();
    if (view === 'vault')    loadVaultStats();
    if (view === 'settings') loadSettings();
    if (view === 'journal')  loadJournal();
  });
});

/* ── Window controls ── */
document.getElementById('btn-minimize')?.addEventListener('click', () => j.minimize());
document.getElementById('btn-hide')?.addEventListener('click',     () => j.hide());

/* ════════════════════ CHAT ════════════════════ */
const feed       = document.getElementById('chat-feed');
const chatInput  = document.getElementById('chat-input');
const btnSend    = document.getElementById('btn-send');
let   streaming  = false;
let   currentMsg = null;

function addMsg(role, text = '') {
  const wrap   = document.createElement('div');
  wrap.className = `msg msg--${role}`;
  const roleEl = document.createElement('div');
  roleEl.className   = 'msg-role';
  roleEl.textContent = role === 'jarvis' ? 'JARVIS' : 'VOCÊ';
  const body   = document.createElement('div');
  body.className = 'msg-body';
  const txt    = document.createElement('div');
  txt.className  = 'msg-text';
  txt.textContent = text;
  body.appendChild(txt);
  wrap.appendChild(roleEl);
  wrap.appendChild(body);
  feed.appendChild(wrap);
  scrollFeed();
  return txt;
}

function addStreamMsg() {
  const txt    = addMsg('jarvis');
  const cursor = document.createElement('span');
  cursor.className = 'type-cursor';
  txt.appendChild(cursor);
  return txt;
}

function scrollFeed() {
  feed.scrollTop = feed.scrollHeight;
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || streaming) return;

  streaming = true;
  chatInput.value = '';
  autoResize(chatInput);
  addMsg('user', text);

  setStatus('PROCESSANDO');
  currentMsg = addStreamMsg();

  try {
    await j.sendMessage(text);
  } catch (err) {
    const cursor = currentMsg?.querySelector('.type-cursor');
    if (cursor) cursor.remove();
    currentMsg.textContent = `Erro: ${err.message}`;
    streaming = false;
    currentMsg = null;
    setStatus('ONLINE');
  }
}

j.onChunk(chunk => {
  if (!currentMsg) return;
  const cursor = currentMsg.querySelector('.type-cursor');
  if (cursor) cursor.insertAdjacentText('beforebegin', chunk);
  else currentMsg.textContent += chunk;
  scrollFeed();
  setStatus('FALANDO');
});

j.onDone(fullText => {
  if (!currentMsg) return;
  const cursor = currentMsg.querySelector('.type-cursor');
  if (cursor) cursor.remove();
  const clean = fullText.replace(/\s*\[(MEMORIZAR|TAREFA):.*?\]/g, '').trim();
  if (currentMsg.textContent.trim() !== clean) currentMsg.textContent = clean;
  streaming = false;
  currentMsg = null;
  setStatus('ONLINE');
  scrollFeed();
  if (!/^Erro:/.test(clean)) speak(clean);
});

btnSend.addEventListener('click', sendMessage);

chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

chatInput.addEventListener('input', () => autoResize(chatInput));

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

document.getElementById('btn-clear-history')?.addEventListener('click', async () => {
  feed.innerHTML = '';
  const cfg = await j.getConfig();
  cfg.clearHistory = true;
  await j.setConfig(cfg);
});

/* Push events */
j.onReminder(task => {
  addMsg('jarvis', `🔔 Lembrete: ${task.title}`);
  setStatus('ALERTA');
  setTimeout(() => setStatus('ONLINE'), 3000);
});

j.onJournalReady(prompt => {
  addMsg('jarvis', `📝 Hora do seu diário!\n${prompt}\nAbra a aba "Diário" para escrever.`);
});

/* ════════════════════ VOICE — TTS (falar) ════════════════════ */
let voiceEnabled   = false;
let selectedVoice  = '';   // voiceURI
let availableVoices = [];

function loadVoices() {
  availableVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const sel = document.getElementById('cfg-voice-select');
  if (!sel) return;
  // keep first default option, repopulate the rest
  sel.querySelectorAll('option:not(:first-child)').forEach(o => o.remove());
  // pt voices first
  const sorted = [...availableVoices].sort((a, b) => {
    const ap = a.lang.startsWith('pt') ? 0 : 1;
    const bp = b.lang.startsWith('pt') ? 0 : 1;
    return ap - bp;
  });
  for (const v of sorted) {
    const o = document.createElement('option');
    o.value = v.voiceURI;
    o.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(o);
  }
  if (selectedVoice) sel.value = selectedVoice;
}

if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}

function pickVoice() {
  if (!availableVoices.length) availableVoices = window.speechSynthesis.getVoices();
  if (selectedVoice) {
    const v = availableVoices.find(v => v.voiceURI === selectedVoice);
    if (v) return v;
  }
  // fallback: first pt-BR / pt voice, else first voice
  return availableVoices.find(v => v.lang === 'pt-BR')
      || availableVoices.find(v => v.lang.startsWith('pt'))
      || availableVoices[0]
      || null;
}

function speak(text) {
  if (!voiceEnabled || !window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; }
  else u.lang = 'pt-BR';
  u.rate = 1.02;
  u.pitch = 1.0;
  window.speechSynthesis.speak(u);
}

function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

/* ════════════════════ VOICE — STT (ouvir) ════════════════════ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening   = false;
const btnMic    = document.getElementById('btn-mic');

if (SR) {
  recognition = new SR();
  recognition.lang           = 'pt-BR';
  recognition.continuous     = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    listening = true;
    btnMic?.classList.add('listening');
    setStatus('OUVINDO');
    stopSpeaking();
  };

  recognition.onresult = e => {
    let txt = '';
    for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
    chatInput.value = txt;
    autoResize(chatInput);
  };

  recognition.onerror = e => {
    listening = false;
    btnMic?.classList.remove('listening');
    setStatus('ONLINE');
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      addMsg('jarvis', 'Permissão de microfone negada. Habilite o microfone do Windows para usar comando de voz.');
    } else if (e.error === 'network') {
      addMsg('jarvis', 'Reconhecimento de voz indisponível (sem serviço de fala). Você ainda pode digitar — JARVIS responde por voz normalmente.');
    } else if (e.error === 'no-speech') {
      setStatus('ONLINE');
    }
  };

  recognition.onend = () => {
    listening = false;
    btnMic?.classList.remove('listening');
    if (chatInput.value.trim()) { setStatus('ONLINE'); sendMessage(); }
    else setStatus('ONLINE');
  };

  btnMic?.addEventListener('click', () => {
    if (listening) { recognition.stop(); return; }
    try { recognition.start(); } catch { /* already started */ }
  });
} else {
  // No speech recognition available
  btnMic?.addEventListener('click', () => {
    addMsg('jarvis', 'Reconhecimento de voz não disponível neste ambiente.');
  });
}

/* ════════════════════ TASKS ════════════════════ */
async function loadTasks() {
  const list  = document.getElementById('task-list');
  list.innerHTML = '';
  const tasks = await j.listTasks();

  if (!tasks.length) {
    list.innerHTML = '<div style="font-family:var(--f-mono);font-size:.62rem;color:var(--t2);padding:.8rem 0">Nenhuma tarefa ainda.</div>';
    return;
  }

  for (const t of tasks) {
    const item = document.createElement('div');
    item.className = `task-item${t.done ? ' done' : ''}`;
    item.dataset.id = t.id;

    const dueStr = t.dueDate ? formatDue(t.dueDate) : '';
    const isOverdue = t.dueDate && !t.done && new Date(t.dueDate) < new Date();

    item.innerHTML = `
      <div class="task-cb"></div>
      <div class="task-text">${esc(t.title)}</div>
      ${dueStr ? `<div class="task-due${isOverdue ? ' overdue' : ''}">${dueStr}</div>` : ''}
      <button class="task-del" title="Remover">✕</button>
    `;

    item.querySelector('.task-cb').addEventListener('click', async () => {
      await j.completeTask(t.id);
      loadTasks();
    });

    item.querySelector('.task-del').addEventListener('click', async () => {
      await j.deleteTask(t.id);
      loadTasks();
    });

    list.appendChild(item);
  }
}

document.getElementById('btn-add-task')?.addEventListener('click', async () => {
  const title = document.getElementById('task-title')?.value?.trim();
  const date  = document.getElementById('task-date')?.value;
  if (!title) return;

  await j.addTask({ title, dueDate: date || null });
  document.getElementById('task-title').value = '';
  document.getElementById('task-date').value  = '';
  loadTasks();
});

document.getElementById('task-title')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-add-task')?.click();
});

function formatDue(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
       + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/* ════════════════════ JOURNAL ════════════════════ */
async function loadJournal() {
  const prompt   = await j.getJournalPrompt();
  const dateEl   = document.getElementById('journal-date');
  const promptEl = document.getElementById('journal-prompt');

  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (promptEl) promptEl.textContent = prompt;
}

document.getElementById('btn-save-journal')?.addEventListener('click', async () => {
  const text   = document.getElementById('journal-editor')?.value?.trim();
  const status = document.getElementById('journal-status');

  if (!text) { if (status) { status.textContent = 'Escreva algo primeiro.'; setTimeout(() => status.textContent = '', 2000); } return; }

  const ok = await j.saveJournalEntry(text);
  if (status) {
    status.textContent = ok ? '✓ Salvo no vault.' : 'Vault não configurado.';
    setTimeout(() => status.textContent = '', 3000);
  }

  if (ok) document.getElementById('journal-editor').value = '';
});

/* ════════════════════ VAULT ════════════════════ */
async function loadVaultStats() {
  const stats = await j.getVaultStats();
  document.getElementById('vs-path').textContent  = stats.vaultPath || '(não configurado)';
  document.getElementById('vs-count').textContent = stats.fileCount || '0';
  document.getElementById('vs-sync').textContent  = stats.lastSync  || 'nunca';
}

document.getElementById('btn-refresh-vault')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-refresh-vault');
  btn.textContent = 'Sincronizando…';
  btn.disabled = true;
  const stats = await j.refreshVault();
  document.getElementById('vs-path').textContent  = stats.vaultPath || '(não configurado)';
  document.getElementById('vs-count').textContent = stats.fileCount || '0';
  document.getElementById('vs-sync').textContent  = stats.lastSync  || 'nunca';
  btn.textContent = 'Sincronizar agora';
  btn.disabled = false;
});

/* ════════════════════ SETTINGS ════════════════════ */
async function loadSettings() {
  const cfg = await j.getConfig();
  const mem = await j.getConfig(); // reuse — memory is inside config response

  const el = n => document.getElementById(n);
  el('cfg-key')?.setAttribute('placeholder', cfg.apiKey ? '••••••••' : 'sk-or-…');
  if (cfg.apiKey) el('cfg-key').value = '';
  el('cfg-name').value         = cfg.userName    || '';
  el('cfg-model').value        = cfg.model       || 'claude-opus-4-7';
  el('cfg-vault').value        = cfg.vaultPath   || '';
  el('cfg-journal-time').value = cfg.journalTime || '08:00';
  if (el('cfg-startup')) el('cfg-startup').checked = !!cfg.startWithWindows;
  if (el('cfg-voice'))   el('cfg-voice').checked   = !!cfg.voiceEnabled;
  loadVoices();
  if (el('cfg-voice-select') && cfg.voiceURI) el('cfg-voice-select').value = cfg.voiceURI;

  /* Memory preview — fetch from main */
  const memPreview = document.getElementById('cfg-memory-preview');
  if (memPreview) memPreview.textContent = cfg.memoryFacts || '(nenhum fato memorizado ainda)';
}

document.getElementById('btn-browse-vault')?.addEventListener('click', async () => {
  const p = await j.browseVault();
  if (p) document.getElementById('cfg-vault').value = p;
});

document.getElementById('btn-save-cfg')?.addEventListener('click', async () => {
  const el = n => document.getElementById(n);
  const key    = el('cfg-key')?.value?.trim();
  const status = document.getElementById('cfg-status');

  const cfg = {
    userName:         el('cfg-name')?.value?.trim()         || '',
    model:            el('cfg-model')?.value                || 'google/gemini-2.0-flash-exp:free',
    vaultPath:        el('cfg-vault')?.value?.trim()        || '',
    journalTime:      el('cfg-journal-time')?.value         || '08:00',
    startWithWindows: el('cfg-startup')?.checked            || false,
    voiceEnabled:     el('cfg-voice')?.checked              || false,
    voiceURI:         el('cfg-voice-select')?.value         || '',
  };

  if (key) cfg.apiKey = key;

  await j.setConfig(cfg);

  /* apply voice settings live */
  voiceEnabled  = cfg.voiceEnabled;
  selectedVoice = cfg.voiceURI;
  if (voiceEnabled) speak('Voz ativada.');

  if (status) {
    status.textContent = '✓ Configuração salva.';
    status.style.color = 'var(--accent)';
    setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 3000);
  }
});

document.getElementById('btn-clear-memory')?.addEventListener('click', async () => {
  await j.setConfig({ clearMemory: true, clearHistory: true });
  document.getElementById('cfg-memory-preview').textContent = '(memória apagada)';
  const status = document.getElementById('cfg-status');
  if (status) {
    status.textContent = 'Memória apagada.';
    status.style.color = 'var(--danger)';
    setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 2000);
  }
});

/* ── Status bar ── */
function setStatus(s) {
  const el = document.getElementById('tb-status');
  if (el) el.textContent = s;
}

/* ── Helpers ── */
function esc(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Init ── */
(async () => {
  setStatus('INICIALIZANDO');
  try {
    const cfg = await j.getConfig();
    voiceEnabled  = !!cfg.voiceEnabled;
    selectedVoice = cfg.voiceURI || '';
    if (!cfg.apiKey) {
      addMsg('jarvis', 'Olá. Para ativar inteligência completa, configure sua API key do OpenRouter em Configurações.');
    } else {
      addMsg('jarvis', `Sistemas online. ${cfg.userName ? `Olá, ${cfg.userName}.` : 'Como posso ajudá-lo hoje?'}`);
    }
    setStatus('ONLINE');
  } catch {
    addMsg('jarvis', 'Erro ao inicializar. Verifique as configurações.');
    setStatus('ERRO');
  }
})();
