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
  setStatus('PROCESSANDO');
  const vt = document.getElementById('vm-transcript');
  if (vt && voiceModeOn) {
    const clean = currentMsg.textContent.replace(/\s*\[(MEMORIZAR|TAREFA):.*?\]/g, '');
    vt.textContent = clean;
  }
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

j.onWakeWord(() => {
  // Switch to chat view first
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelector('.nav-item[data-view="chat"]')?.classList.add('active');
  document.getElementById('view-chat')?.classList.add('active');
  // Enter voice mode and auto-start recording after a short delay
  if (!voiceModeOn) enterVoiceMode();
  setTimeout(() => { if (!listening) startRecording(); }, 500);
});

j.onProactive(msg => {
  if (!msg || !msg.text) return;
  addMsg('jarvis', msg.text);
  setStatus('ALERTA');
  setTimeout(() => setStatus('ONLINE'), 4000);
  if (voiceEnabled || voiceModeOn) speak(msg.text);
});

/* ════════════════════ CORE + VOICE MODE ════════════════════ */
let core = null;
let voiceModeOn = false;
let micStream = null, audioCtx = null, analyser = null, ampRAF = null;

function initCore() {
  const canvas = document.getElementById('vm-core');
  if (canvas && window.JarvisCore && !core) {
    core = new JarvisCore(canvas, { particles: 1000 });
  }
}

async function startMicAnalyser() {
  if (analyser) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(micStream);
    analyser  = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      if (core) core.setAmplitude(Math.min(1, rms * 3.2));
      ampRAF = requestAnimationFrame(tick);
    };
    tick();
  } catch { /* mic unavailable */ }
}

function stopMicAnalyser() {
  if (ampRAF) cancelAnimationFrame(ampRAF);
  ampRAF = null;
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (audioCtx) audioCtx.close().catch(() => {});
  micStream = null; audioCtx = null; analyser = null;
  if (core) core.setAmplitude(0);
}

function enterVoiceMode() {
  initCore();
  voiceModeOn = true;
  document.getElementById('voice-mode')?.classList.add('active');
  if (core) { core._resize(); core.start(); }
  startMicAnalyser();
  const vt = document.getElementById('vm-transcript');
  if (vt) vt.textContent = 'Toque em Falar ou pressione Alt+Space de qualquer lugar.';
  setStatus('ONLINE');
}

function exitVoiceMode() {
  voiceModeOn = false;
  document.getElementById('voice-mode')?.classList.remove('active');
  if (core) core.stop();
  stopMicAnalyser();
  if (listening) stopRecording();
}

document.getElementById('btn-voice-mode')?.addEventListener('click', enterVoiceMode);
document.getElementById('vm-exit')?.addEventListener('click', exitVoiceMode);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && voiceModeOn) exitVoiceMode(); });

/* ════════════════════ VOICE — TTS ════════════════════ */
let voiceEnabled    = false;
let selectedVoice   = '';     // voiceURI (browser fallback)
let availableVoices = [];
let _elEnabled      = false;  // true when ElevenLabs key is configured

/* ── Browser TTS helpers (fallback) ── */
function voiceScore(v) {
  let s = 0;
  const name = v.name.toLowerCase();
  if (v.lang === 'pt-BR') s += 100;
  else if (v.lang.startsWith('pt')) s += 60;
  if (/natural|neural|online|premium|enhanced/.test(name)) s += 40;
  if (/francisca|thalita|brenda|maria|luciana|google/.test(name)) s += 25;
  if (/antonio|daniel|ricardo|felipe|google.*português/.test(name)) s += 15;
  if (!v.localService) s += 10;
  return s;
}

function loadVoices() {
  availableVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const sel = document.getElementById('cfg-voice-select');
  if (!sel) return;
  sel.querySelectorAll('option:not(:first-child)').forEach(o => o.remove());
  const sorted = [...availableVoices].sort((a, b) => voiceScore(b) - voiceScore(a));
  for (const v of sorted) {
    const o = document.createElement('option');
    o.value = v.voiceURI;
    const star = voiceScore(v) >= 100 ? ' ⭐' : '';
    o.textContent = `${v.name} (${v.lang})${star}`;
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
  return [...availableVoices].sort((a, b) => voiceScore(b) - voiceScore(a))[0] || null;
}

/* Strip markdown/symbols so speech sounds natural */
function cleanForSpeech(text) {
  return text
    .replace(/\[(MEMORIZAR|TAREFA):.*?\]/g, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\(modelo.*?\)/gi, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text) {
  return text.match(/[^.!?…]+[.!?…]+|\S[^.!?…]*$/g) || [text];
}

/* ── ElevenLabs TTS ── */
let _elAudio  = null;
let _elQueue  = [];
let _elBusy   = false;

function _elChunk(text, maxLen = 1800) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let cur = '';
  for (const s of (splitSentences(text) || [text])) {
    if (cur.length + s.length > maxLen && cur) { chunks.push(cur.trim()); cur = s; }
    else cur += (cur ? ' ' : '') + s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

async function _elPlayNext() {
  if (_elBusy || !_elQueue.length) return;
  const chunk = _elQueue.shift();
  if (!chunk.trim()) { _elPlayNext(); return; }
  _elBusy = true;

  try {
    const result = await j.speakEL(chunk);
    if (result && result.audio) {
      const bytes = Uint8Array.from(atob(result.audio), c => c.charCodeAt(0));
      const blob  = new Blob([bytes], { type: 'audio/mpeg' });
      const url   = URL.createObjectURL(blob);
      _elAudio = new Audio(url);
      _elAudio.onended = () => {
        URL.revokeObjectURL(url);
        _elAudio = null;
        _elBusy  = false;
        if (_elQueue.length) _elPlayNext();
        else if (!listening) setStatus('ONLINE');
      };
      _elAudio.onerror = () => {
        URL.revokeObjectURL(url);
        _elAudio = null;
        _elBusy  = false;
        _elPlayNext();
      };
      _elAudio.play().catch(err => {
        _elBusy = false;
        addMsg('jarvis', `Voz: erro ao reproduzir áudio — ${err.message}`);
        _elPlayNext();
      });
    } else if (result && result.error) {
      _elBusy = false;
      _elEnabled = false; // desativa para não ficar tentando sem parar
      addMsg('jarvis', `Voz ElevenLabs: ${result.error}. Verifique sua chave em Configurações.`);
      setStatus('ONLINE');
    } else {
      _elBusy = false;
      if (_elQueue.length) _elPlayNext();
      else if (!listening) setStatus('ONLINE');
    }
  } catch (err) {
    _elBusy = false;
    addMsg('jarvis', `Voz: erro inesperado — ${err.message}`);
    if (_elQueue.length) _elPlayNext();
    else if (!listening) setStatus('ONLINE');
  }
}

/* ── Browser TTS queue ── */
let _speakQueue = [];

function _speakNext(voice) {
  if (!_speakQueue.length) { if (!listening) setStatus('ONLINE'); return; }
  const chunk = _speakQueue.shift().trim();
  if (!chunk) return _speakNext(voice);
  const u = new SpeechSynthesisUtterance(chunk);
  if (voice) { u.voice = voice; u.lang = voice.lang; }
  else u.lang = 'pt-BR';
  u.rate  = 0.94;
  u.pitch = 0.93;
  u.onend   = () => _speakNext(voice);
  u.onerror = () => _speakNext(voice);
  window.speechSynthesis.speak(u);
}

/* ── Main speak entry point ── */
function speak(text) {
  if (!voiceEnabled && !voiceModeOn) return;
  const clean = cleanForSpeech(text);
  if (!clean) return;
  stopSpeaking();
  setStatus('FALANDO');

  if (_elEnabled) {
    _elQueue = _elChunk(clean);
    _elBusy  = false;
    _elPlayNext();
  } else {
    if (!window.speechSynthesis) return;
    _speakQueue = splitSentences(clean);
    _speakNext(pickVoice());
  }
}

function stopSpeaking() {
  _elQueue = [];
  _elBusy  = false;
  if (_elAudio) { try { _elAudio.pause(); } catch {} _elAudio = null; }
  _speakQueue = [];
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

/* ════════════════════ VOICE — STT (Groq Whisper) ════════════════════ */
let listening = false;
let mediaRecorder = null, recChunks = [], recStream = null;
const btnMic = document.getElementById('btn-mic');
const vmTalk = document.getElementById('vm-talk');

function setListenUI(on) {
  listening = on;
  btnMic?.classList.toggle('listening', on);
  vmTalk?.classList.toggle('listening', on);
}

function vmSay(text) {
  const vt = document.getElementById('vm-transcript');
  if (vt && voiceModeOn) vt.textContent = text;
}

async function startRecording() {
  if (listening) return;
  const cfg = await j.getConfig();
  if (!cfg.groqKey) {
    addMsg('jarvis', 'Para falar comigo, configure sua chave Groq (grátis) em Configurações → console.groq.com/keys');
    vmSay('Configure a chave Groq nas Configurações.');
    return;
  }
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    addMsg('jarvis', 'Não consegui acessar o microfone. Verifique as permissões do Windows.');
    return;
  }
  stopSpeaking();
  recChunks = [];
  mediaRecorder = new MediaRecorder(recStream);
  mediaRecorder.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };
  mediaRecorder.onstop = onRecordingStop;
  mediaRecorder.start();
  setListenUI(true);
  setStatus('OUVINDO');
  vmSay('Ouvindo… (toque novamente para parar)');
}

function stopRecording() {
  if (mediaRecorder && listening) mediaRecorder.stop();
  setListenUI(false);
}

async function onRecordingStop() {
  if (recStream) recStream.getTracks().forEach(t => t.stop());
  recStream = null;
  const blob = new Blob(recChunks, { type: 'audio/webm' });
  recChunks = [];
  if (blob.size < 1500) { setStatus('ONLINE'); vmSay('Não ouvi nada. Toque em Falar e fale.'); return; }

  setStatus('PROCESSANDO');
  vmSay('Transcrevendo…');
  try {
    const buf = await blob.arrayBuffer();
    const res = await j.transcribe(buf);
    if (res && res.text) {
      chatInput.value = res.text;
      autoResize(chatInput);
      vmSay(res.text);
      sendMessage();
    } else {
      const msg = (res && res.error) || 'Não entendi o áudio.';
      addMsg('jarvis', msg);
      vmSay(msg);
      setStatus('ONLINE');
    }
  } catch (err) {
    addMsg('jarvis', `Erro na transcrição: ${err.message}`);
    setStatus('ONLINE');
  }
}

const toggleListen = () => (listening ? stopRecording() : startRecording());
btnMic?.addEventListener('click', toggleListen);
vmTalk?.addEventListener('click', toggleListen);

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
  el('cfg-groq')?.setAttribute('placeholder', cfg.groqKey ? '••••••••' : 'gsk_…');
  if (cfg.groqKey) el('cfg-groq').value = '';
  el('cfg-elevenlabs')?.setAttribute('placeholder', cfg.elevenlabsKey ? '••••••••' : 'sk_…');
  if (cfg.elevenlabsKey) el('cfg-elevenlabs').value = '';
  if (el('cfg-el-voice') && cfg.elevenlabsVoiceId) el('cfg-el-voice').value = cfg.elevenlabsVoiceId;
  _elEnabled = !!cfg.elevenlabsKey;
  el('cfg-name').value         = cfg.userName    || '';
  el('cfg-model').value        = cfg.model       || 'meta-llama/llama-3.1-8b-instruct:free';
  if (el('cfg-model-custom')) el('cfg-model-custom').value = '';
  el('cfg-vault').value        = cfg.vaultPath   || '';
  el('cfg-journal-time').value = cfg.journalTime || '08:00';
  if (el('cfg-startup')) el('cfg-startup').checked = !!cfg.startWithWindows;
  if (el('cfg-hotkey')) el('cfg-hotkey').value = cfg.wakeHotkey || 'Alt+Space';
  if (el('cfg-voice'))   el('cfg-voice').checked   = !!cfg.voiceEnabled;
  loadVoices();
  if (el('cfg-voice-select') && cfg.voiceURI) el('cfg-voice-select').value = cfg.voiceURI;

  /* Memory preview — fetch from main */
  const memPreview = document.getElementById('cfg-memory-preview');
  if (memPreview) memPreview.textContent = cfg.memoryFacts || '(nenhum fato memorizado ainda)';

  /* Populate model list live from OpenRouter */
  populateModels(cfg.model);
}

let _modelsLoaded = false;
async function populateModels(currentModel) {
  const sel = document.getElementById('cfg-model');
  if (!sel || _modelsLoaded) { if (sel && currentModel) sel.value = currentModel; return; }

  const res = await j.listModels();
  const models = (res && res.models) || [];
  if (!models.length) return; // keep static fallback options

  const free = models.filter(m => m.free).sort((a, b) => a.name.localeCompare(b.name));
  const paid = models.filter(m => !m.free &&
    /(anthropic\/claude|openai\/gpt|google\/gemini)/i.test(m.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  sel.innerHTML = '';
  const addGroup = (label, list) => {
    if (!list.length) return;
    const og = document.createElement('optgroup');
    og.label = label;
    for (const m of list) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.free ? `${m.name} (grátis)` : m.name;
      og.appendChild(o);
    }
    sel.appendChild(og);
  };
  addGroup(`── GRATUITOS ✓ (${free.length}) ──`, free);
  addGroup('── Populares (pago) ──', paid);

  // ensure current model is selectable even if not in filtered lists
  if (currentModel && !sel.querySelector(`option[value="${CSS.escape(currentModel)}"]`)) {
    const o = document.createElement('option');
    o.value = currentModel; o.textContent = currentModel + ' (atual)';
    sel.insertBefore(o, sel.firstChild);
  }
  if (currentModel) sel.value = currentModel;
  _modelsLoaded = true;
}

document.getElementById('btn-browse-vault')?.addEventListener('click', async () => {
  const p = await j.browseVault();
  if (p) document.getElementById('cfg-vault').value = p;
});

document.getElementById('btn-save-cfg')?.addEventListener('click', async () => {
  const el = n => document.getElementById(n);
  const key    = el('cfg-key')?.value?.trim();
  const groq   = el('cfg-groq')?.value?.trim();
  const elKey  = el('cfg-elevenlabs')?.value?.trim();
  const status = document.getElementById('cfg-status');

  const cfg = {
    userName:            el('cfg-name')?.value?.trim()         || '',
    model:               el('cfg-model-custom')?.value?.trim() || el('cfg-model')?.value || 'meta-llama/llama-3.1-8b-instruct:free',
    vaultPath:           el('cfg-vault')?.value?.trim()        || '',
    journalTime:         el('cfg-journal-time')?.value         || '08:00',
    wakeHotkey:          el('cfg-hotkey')?.value?.trim()       || 'Alt+Space',
    startWithWindows:    el('cfg-startup')?.checked            || false,
    voiceEnabled:        el('cfg-voice')?.checked              || false,
    voiceURI:            el('cfg-voice-select')?.value         || '',
    elevenlabsVoiceId:   el('cfg-el-voice')?.value             || 'onwK4e9ZLuTAKqWW03F9',
  };

  if (key)   cfg.apiKey        = key;
  if (groq)  cfg.groqKey       = groq;
  if (elKey) cfg.elevenlabsKey = elKey;

  await j.setConfig(cfg);

  /* apply voice settings live */
  voiceEnabled  = cfg.voiceEnabled;
  selectedVoice = cfg.voiceURI;

  /* ElevenLabs: se a chave foi informada, ativa a voz automaticamente */
  if (elKey) {
    _elEnabled = true;
    voiceEnabled = true;
    el('cfg-voice').checked = true;
  }

  /* Testa a voz ao salvar se ElevenLabs ou voz do sistema estiver ativa */
  if (_elEnabled || voiceEnabled) speak('Olá! Minha voz está funcionando.');

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
const CORE_STATE = {
  INICIALIZANDO: 'idle', ONLINE: 'idle',
  PROCESSANDO: 'thinking',
  FALANDO: 'speaking',
  OUVINDO: 'listening',
  ALERTA: 'alert', ERRO: 'alert',
};
function setStatus(s) {
  const el = document.getElementById('tb-status');
  if (el) el.textContent = s;
  const vm = document.getElementById('vm-status');
  if (vm) vm.textContent = s === 'ONLINE' ? 'JARVIS' : s;
  if (core) core.setState(CORE_STATE[s] || 'idle');
}

/* ── Helpers ── */
function esc(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* Warm, time-aware greeting */
function greeting(name) {
  const h = new Date().getHours();
  const nm = name ? `, ${name}` : '';
  let saud;
  if (h < 5)       saud = `Ainda acordado${nm}? Estou aqui com você.`;
  else if (h < 12) saud = `Bom dia${nm}. Como você amanheceu?`;
  else if (h < 18) saud = `Boa tarde${nm}. Como está o seu dia até agora?`;
  else             saud = `Boa noite${nm}. Como foi o seu dia?`;
  return saud;
}

/* ── Init ── */
(async () => {
  setStatus('INICIALIZANDO');
  try {
    const cfg = await j.getConfig();
    voiceEnabled  = !!cfg.voiceEnabled;
    selectedVoice = cfg.voiceURI || '';
    _elEnabled    = !!cfg.elevenlabsKey;
    if (!cfg.apiKey) {
      addMsg('jarvis', 'Olá. Para eu pensar de verdade com você, configure sua API key do OpenRouter em Configurações. Estarei aqui.');
    } else {
      addMsg('jarvis', greeting(cfg.userName));
    }
    setStatus('ONLINE');
  } catch {
    addMsg('jarvis', 'Erro ao inicializar. Verifique as configurações.');
    setStatus('ERRO');
  }
})();
