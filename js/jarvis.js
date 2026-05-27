/* JARVIS — boot, state machine, conversation */
(function () {
  /* ── DOM references ── */
  const bootOverlay = document.getElementById('boot-overlay');
  const bootLog     = document.getElementById('boot-log');
  const bootBarFill = document.getElementById('boot-bar-fill');
  const convFeed    = document.getElementById('conv-feed');
  const inputField  = document.getElementById('input-field');
  const btnSend     = document.getElementById('btn-send');
  const btnMic      = document.getElementById('btn-mic');
  const srArc       = document.getElementById('sr-arc');
  const srState     = document.getElementById('sr-state');
  const srFreq      = document.getElementById('sr-freq');
  const smNeural    = document.getElementById('sm-neural');
  const smVoice     = document.getElementById('sm-voice');
  const smLatency   = document.getElementById('sm-latency');
  const smTime      = document.getElementById('sm-time');
  const navStateTxt = document.getElementById('nav-state-txt');

  /* ── State ── */
  let busy      = false;
  let listening = false;
  const CIRC    = 515.22;

  /* ── Clock ── */
  function tickClock() {
    if (smTime) smTime.textContent = new Date().toTimeString().slice(0, 8);
  }
  setInterval(tickClock, 1000);
  tickClock();

  /* ── Ring ── */
  function setRing(progress) {
    if (srArc) srArc.style.strokeDashoffset = CIRC * (1 - Math.max(0, Math.min(1, progress)));
  }

  /* ── System states ── */
  const STATES = {
    idle:       { label: 'IDLE',        ring: 0.08, neural: 18, voice: 6,  latency: 28 },
    processing: { label: 'PROCESSANDO', ring: 0.50, neural: 88, voice: 35, latency: 72 },
    thinking:   { label: 'PENSANDO',    ring: 0.38, neural: 72, voice: 20, latency: 55 },
    speaking:   { label: 'FALANDO',     ring: 0.92, neural: 62, voice: 95, latency: 60 },
    listening:  { label: 'OUVINDO',     ring: 0.60, neural: 44, voice: 72, latency: 22 },
  };

  function setState(name) {
    const s = STATES[name] || STATES.idle;
    if (srState)     srState.textContent    = s.label;
    if (navStateTxt) navStateTxt.textContent = name.toUpperCase();
    setRing(s.ring);
    if (smNeural)  smNeural.style.width  = s.neural  + '%';
    if (smVoice)   smVoice.style.width   = s.voice   + '%';
    if (smLatency) smLatency.style.width = s.latency + '%';
  }

  setState('idle');

  /* ── Message helpers ── */
  function makeShell(role) {
    const wrap   = document.createElement('div');
    wrap.className = `msg msg--${role}`;
    const roleEl = document.createElement('div');
    roleEl.className   = 'msg-role';
    roleEl.textContent = role === 'jarvis' ? 'JARVIS' : 'VOCÊ';
    const body   = document.createElement('div');
    body.className = 'msg-body';
    const txt    = document.createElement('div');
    txt.className  = 'msg-text';
    body.appendChild(txt);
    wrap.appendChild(roleEl);
    wrap.appendChild(body);
    convFeed.appendChild(wrap);
    scrollConv();
    return txt;
  }

  function addMessage(role, text) {
    const txt = makeShell(role);
    if (role === 'jarvis') typewrite(txt, text);
    else txt.textContent = text;
    return txt;
  }

  function addStreamMessage() {
    const txt    = makeShell('jarvis');
    const cursor = document.createElement('span');
    cursor.className = 'type-cursor';
    txt.appendChild(cursor);
    return txt;
  }

  function appendChunk(el, chunk) {
    const cursor = el.querySelector('.type-cursor');
    if (cursor) cursor.insertAdjacentText('beforebegin', chunk);
    else el.textContent += chunk;
    scrollConv();
  }

  function typewrite(el, text) {
    const cursor = document.createElement('span');
    cursor.className = 'type-cursor';
    el.appendChild(cursor);
    let i = 0;
    (function next() {
      if (i < text.length) {
        cursor.insertAdjacentText('beforebegin', text[i++]);
        setTimeout(next, 18 + Math.random() * 18);
      } else {
        cursor.remove();
      }
      scrollConv();
    })();
  }

  function scrollConv() {
    const conv = document.getElementById('conversation');
    if (conv) conv.scrollTop = conv.scrollHeight;
  }

  /* ── Speak (TTS) ── */
  function speak(text, onDone) {
    setState('speaking');
    if (window.JARVIS_VOICE) {
      window.JARVIS_VOICE.speak(text, () => { setState('idle'); onDone?.(); });
    } else {
      setTimeout(() => { setState('idle'); onDone?.(); }, 1500);
    }
  }

  function jarvisSpeak(text) {
    addMessage('jarvis', text);
    speak(text, () => { busy = false; });
  }

  /* ── Fallback responses (no API key) ── */
  const RULES = [
    { re: /^(oi|olá|ol[áa]|hello|hey|hi\b)/i,
      replies: ['Olá. Todos os sistemas operacionais. Como posso ajudá-lo?', 'Saudações. Canal seguro estabelecido.'] },
    { re: /(quem|o que) (é|você|vc)/i,
      replies: ['Sou J.A.R.V.I.S — Just A Rather Very Intelligent System. IA de elite à sua disposição.'] },
    { re: /status|sistemas?/i,
      replies: ['Todos os sistemas nominais. Núcleo neural: 87%. Síntese vocal: online.'] },
    { re: /(que horas|hora)/i,
      replies: [`São ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`] },
    { re: /(obrigad|valeu)/i,
      replies: ['Sempre. Para isso estou aqui.', 'De nada. Alguma outra necessidade?'] },
    { re: /(tchau|bye|encerrar)/i,
      replies: ['Até logo. Sistemas em stand-by.'] },
  ];
  const FALLBACKS = [
    'Módulo de IA não ativado. Configure sua API key com Ctrl+Shift+J para inteligência completa.',
    'Aguardando configuração do núcleo neural. Pressione Ctrl+Shift+J para ativar.',
  ];
  function getReply(input) {
    for (const { re, replies } of RULES)
      if (re.test(input)) return replies[Math.floor(Math.random() * replies.length)];
    return FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
  }

  /* ── Handle input ── */
  async function handleInput(text) {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    setState('processing');
    addMessage('user', text);
    if (inputField) inputField.value = '';

    if (window.JARVIS_BRAIN?.hasApiKey()) {
      setState('thinking');
      const msgEl = addStreamMessage();
      let streaming = false;

      const fullText = await JARVIS_BRAIN.ask(text, chunk => {
        if (!streaming) { setState('processing'); streaming = true; }
        appendChunk(msgEl, chunk);
      });

      const cursor = msgEl.querySelector('.type-cursor');
      if (cursor) cursor.remove();

      if (fullText) {
        const clean = fullText.replace(/\s*\[MEMORIZAR:.*?\]/g, '').trim();
        if (msgEl.textContent.replace(/\s*\[MEMORIZAR:.*?\]/g, '').trim() !== clean) {
          msgEl.textContent = clean;
        }
        speak(clean, () => { busy = false; });
      } else {
        setState('idle');
        busy = false;
      }
      return;
    }

    setTimeout(() => jarvisSpeak(getReply(text)), 500 + Math.random() * 700);
  }

  /* ── Input events ── */
  btnSend?.addEventListener('click', () => handleInput(inputField?.value || ''));
  inputField?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleInput(inputField.value); }
  });

  btnMic?.addEventListener('click', () => {
    if (!window.JARVIS_VOICE?.hasRecognition) {
      jarvisSpeak('Reconhecimento de voz não disponível neste navegador. Por favor, use texto.');
      return;
    }
    if (listening) {
      window.JARVIS_VOICE.stopListening();
      listening = false;
      btnMic.classList.remove('active');
      setState('idle');
      return;
    }
    listening = true;
    btnMic.classList.add('active');
    setState('listening');
    let finalText = '';
    window.JARVIS_VOICE.listen(
      (t, isFinal) => { if (inputField) inputField.value = t; if (isFinal) finalText = t; },
      () => {
        listening = false;
        btnMic.classList.remove('active');
        const t = finalText || inputField?.value || '';
        if (t) handleInput(t); else { setState('idle'); busy = false; }
      }
    );
  });

  /* ── Config panel ── */
  const configPanel = document.getElementById('config-panel');

  function openConfig() {
    if (!configPanel) return;
    const brain    = window.JARVIS_BRAIN;
    const keyIn    = document.getElementById('cfg-api-key');
    const repoIn   = document.getElementById('cfg-obsidian-repo');
    const branchIn = document.getElementById('cfg-obsidian-branch');
    const modelIn  = document.getElementById('cfg-model');
    const factsEl  = document.getElementById('cfg-facts-preview');
    if (keyIn)    keyIn.value    = brain?.cfg.apiKey ? '••••••••' : '';
    if (repoIn)   repoIn.value   = brain?.cfg.obsidianRepo || '';
    if (branchIn) branchIn.value = brain?.cfg.obsidianBranch || 'main';
    if (modelIn)  modelIn.value  = brain?.cfg.model || 'claude-opus-4-7';
    if (factsEl)  factsEl.textContent = brain?.loadFacts() || '(nenhum fato memorizado ainda)';
    configPanel.classList.add('open');
    configPanel.setAttribute('aria-hidden', 'false');
  }

  function closeConfig() {
    configPanel?.classList.remove('open');
    configPanel?.setAttribute('aria-hidden', 'true');
  }

  function showCfgStatus(msg, color) {
    const s = document.getElementById('config-status');
    if (!s) return;
    s.textContent = msg;
    s.style.color = color || '';
    setTimeout(() => { s.textContent = ''; s.style.color = ''; }, 3000);
  }

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'J') {
      e.preventDefault(); openConfig();
    }
    if (e.key === 'Escape' && configPanel?.classList.contains('open')) closeConfig();
  });

  document.getElementById('config-close')?.addEventListener('click', closeConfig);
  document.getElementById('config-backdrop')?.addEventListener('click', closeConfig);

  document.getElementById('cfg-save')?.addEventListener('click', () => {
    const brain = window.JARVIS_BRAIN;
    if (!brain) return;
    const key    = document.getElementById('cfg-api-key')?.value?.trim() || '';
    const repo   = document.getElementById('cfg-obsidian-repo')?.value?.trim() || '';
    const branch = document.getElementById('cfg-obsidian-branch')?.value?.trim() || 'main';
    const model  = document.getElementById('cfg-model')?.value?.trim() || 'claude-opus-4-7';
    if (key && key !== '••••••••') brain.cfg.apiKey = key;
    brain.cfg.obsidianRepo   = repo;
    brain.cfg.obsidianBranch = branch;
    brain.cfg.model          = model;
    brain.clearKnowledge();
    showCfgStatus('✓ Salvo. Base de conhecimento recarregada.', 'var(--accent)');
  });

  document.getElementById('cfg-reload-knowledge')?.addEventListener('click', () => {
    window.JARVIS_BRAIN?.clearKnowledge();
    showCfgStatus('Base de conhecimento será recarregada na próxima mensagem.', 'var(--t1)');
  });

  document.getElementById('cfg-clear-memory')?.addEventListener('click', () => {
    window.JARVIS_BRAIN?.clearHistory();
    window.JARVIS_BRAIN?.clearFacts();
    const factsEl = document.getElementById('cfg-facts-preview');
    if (factsEl) factsEl.textContent = '(nenhum fato memorizado ainda)';
    showCfgStatus('Memória apagada.', 'var(--danger)');
  });

  /* ── Boot sequence ── */
  const BOOT_LINES = [
    'Inicializando núcleo neural...',
    'Carregando módulos de resposta...',
    'Calibrando síntese vocal...',
    'Verificando base de conhecimento...',
    'Estabelecendo canal seguro...',
    'Sistemas nominais. Pronto.',
  ];

  function runBoot() {
    if (!bootLog) { finishBoot(); return; }
    BOOT_LINES.forEach((line, i) => {
      setTimeout(() => {
        const el = document.createElement('div');
        el.className = 'bl-line';
        el.textContent = line;
        bootLog.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        if (bootBarFill) bootBarFill.style.width = ((i + 1) / BOOT_LINES.length * 100) + '%';
        if (i > 0) { const prev = bootLog.children[i - 1]; if (prev) prev.classList.add('done'); }
      }, i * 360 + 200);
    });
    setTimeout(finishBoot, BOOT_LINES.length * 360 + 800);
  }

  function finishBoot() {
    bootOverlay?.classList.add('done');
    setTimeout(() => {
      const hasKey = window.JARVIS_BRAIN?.hasApiKey();
      const greeting = hasKey
        ? 'Boa noite. Módulo de inteligência ativo. Base de conhecimento sincronizada. Como posso ajudá-lo?'
        : 'Boa noite. Sistemas operacionais. Para ativar inteligência completa, configure sua API key com Ctrl+Shift+J.';
      jarvisSpeak(greeting);
    }, 600);
  }

  runBoot();
})();
