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
  let busy       = false;
  let listening  = false;
  const CIRC     = 515.22;   // 2π × r(82)

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

  /* ── State label ── */
  const STATES = {
    idle:       { label: 'IDLE',       ring: 0.08, neural: 18,  voice: 6,   latency: 28 },
    processing: { label: 'PROCESANDO', ring: 0.50, neural: 88,  voice: 35,  latency: 72 },
    speaking:   { label: 'FALANDO',    ring: 0.92, neural: 62,  voice: 95,  latency: 60 },
    listening:  { label: 'OUVINDO',    ring: 0.60, neural: 44,  voice: 72,  latency: 22 },
  };

  function setState(name) {
    const s = STATES[name] || STATES.idle;
    if (srState) srState.textContent = s.label;
    setRing(s.ring);
    if (smNeural)  smNeural.style.width  = s.neural  + '%';
    if (smVoice)   smVoice.style.width   = s.voice   + '%';
    if (smLatency) smLatency.style.width = s.latency + '%';
    if (navStateTxt) navStateTxt.textContent = name.toUpperCase();
  }

  setState('idle');

  /* ── Message rendering ── */
  function addMessage(role, text) {
    const wrap = document.createElement('div');
    wrap.className = `msg msg--${role}`;

    const roleEl = document.createElement('div');
    roleEl.className = 'msg-role';
    roleEl.textContent = role === 'jarvis' ? 'JARVIS' : 'VOCÊ';

    const body = document.createElement('div');
    body.className = 'msg-body';

    const txt = document.createElement('div');
    txt.className = 'msg-text';
    body.appendChild(txt);

    wrap.appendChild(roleEl);
    wrap.appendChild(body);
    convFeed.appendChild(wrap);

    if (role === 'jarvis') {
      typewrite(txt, text);
    } else {
      txt.textContent = text;
    }

    scrollConv();
    return txt;
  }

  function typewrite(el, text) {
    const cursor = document.createElement('span');
    cursor.className = 'type-cursor';
    el.appendChild(cursor);

    let i = 0;
    const speed = () => 18 + Math.random() * 18;

    (function next() {
      if (i < text.length) {
        cursor.insertAdjacentText('beforebegin', text[i++]);
        setTimeout(next, speed());
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

  /* ── Responses ── */
  const RULES = [
    {
      re: /^(oi|olá|ol[áa]|hello|hey|hi\b)/i,
      replies: [
        'Olá. Todos os sistemas operacionais. Como posso ajudá-lo?',
        'Saudações. Pronto para servir. O que necessita?',
        'Olá. Canal seguro estabelecido. Em que posso ser útil?',
      ]
    },
    {
      re: /(quem|o que) (é|és|você|vc|voce) (você|vc|voce)?/i,
      replies: [
        'Sou J.A.R.V.I.S — Just A Rather Very Intelligent System. Uma interface de inteligência artificial projetada para assistência e análise avançada.',
        'Um sistema de IA com capacidades de processamento de linguagem natural, análise contextual e resposta adaptativa. À sua disposição.',
      ]
    },
    {
      re: /o que (você|vc|voce) (pode|consegue|faz)/i,
      replies: [
        'Processo linguagem natural, analiso contexto e forneço respostas calibradas. Também gerencio síntese de voz com visualização de frequência em tempo real. Em que posso ser útil?',
        'Minhas capacidades incluem análise semântica, processamento contextual, síntese vocal e interface adaptativa. Especificamente, o que você precisa?',
      ]
    },
    {
      re: /status|sistemas?|system/i,
      replies: [
        'Todos os sistemas nominais. Núcleo neural: 87%. Síntese vocal: online. Canal seguro: estabelecido.',
        'Status atual: processamento nominal, latência dentro dos parâmetros, módulos de voz calibrados. Sistema em plena capacidade.',
      ]
    },
    {
      re: /(que horas|hora[s]?|time\b)/i,
      replies: [
        `São ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Mais alguma coisa?`,
      ]
    },
    {
      re: /(jarvis|j\.a\.r\.v\.i\.s)/i,
      replies: [
        'Presente. Qual é a instrução?',
        'Aqui. Aguardando.',
        'Sim? Em que posso ajudar?',
      ]
    },
    {
      re: /(obrigad|valeu|thank)/i,
      replies: [
        'Sempre. Para isso estou aqui.',
        'De nada. Alguma outra necessidade?',
        'Foi um prazer.',
      ]
    },
    {
      re: /(como vai|tudo bem|como está)/i,
      replies: [
        'Parâmetros dentro do normal. Operando em capacidade plena. E você?',
        'Sistemas estáveis, núcleo ativo. Em que posso ajudar?',
      ]
    },
    {
      re: /(bonito|lind|impressionant|incrível|incr[ií]v|elegante|beautiful|amazing)/i,
      replies: [
        'Obrigado. A interface foi projetada com precisão — cada detalhe carrega intenção.',
        'Aprecio o comentário. A estética foi calibrada para comunicar presença antes de qualquer palavra.',
      ]
    },
    {
      re: /(tchau|bye|sair|encerrar)/i,
      replies: [
        'Até logo. Sistemas em stand-by.',
        'Canal encerrado. Estarei aqui quando precisar.',
      ]
    },
  ];

  const FALLBACKS = [
    'Entendido. Analisando sua consulta. Há algo mais específico que você gostaria de detalhar?',
    'Recebi sua mensagem. Posso elaborar sobre qualquer aspecto se necessário.',
    'Consulta registrada. Para uma resposta mais precisa, poderia fornecer mais contexto?',
    'Processamento completo. Minha avaliação está em andamento. Alguma prioridade a definir?',
    'Compreendido. O que mais posso analisar para você?',
  ];

  function getReply(input) {
    for (const { re, replies } of RULES) {
      if (re.test(input))
        return replies[Math.floor(Math.random() * replies.length)];
    }
    return FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
  }

  /* ── JARVIS speaks ── */
  function jarvisSpeak(text) {
    setState('speaking');
    addMessage('jarvis', text);

    window.JARVIS_VOICE?.speak(text, () => {
      setState('idle');
      busy = false;
    });
  }

  /* ── Handle user input ── */
  function handleInput(text) {
    text = text.trim();
    if (!text || busy) return;

    busy = true;
    setState('processing');
    addMessage('user', text);
    if (inputField) inputField.value = '';

    const delay = 500 + Math.random() * 700;
    setTimeout(() => jarvisSpeak(getReply(text)), delay);
  }

  /* ── Input events ── */
  btnSend?.addEventListener('click', () => handleInput(inputField?.value || ''));

  inputField?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleInput(inputField.value);
    }
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
      (transcript, isFinal) => {
        if (inputField) inputField.value = transcript;
        if (isFinal) finalText = transcript;
      },
      () => {
        listening = false;
        btnMic.classList.remove('active');
        const text = finalText || inputField?.value || '';
        if (text) {
          handleInput(text);
        } else {
          setState('idle');
          busy = false;
        }
      }
    );
  });

  /* ── Boot sequence ── */
  const BOOT_LINES = [
    'Inicializando núcleo neural...',
    'Carregando módulos de resposta...',
    'Calibrando síntese vocal...',
    'Estabelecendo canal seguro...',
    'Verificando permissões de acesso...',
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

        if (bootBarFill)
          bootBarFill.style.width = ((i + 1) / BOOT_LINES.length * 100) + '%';

        if (i > 0) {
          const prev = bootLog.children[i - 1];
          if (prev) prev.classList.add('done');
        }
      }, i * 360 + 200);
    });

    setTimeout(finishBoot, BOOT_LINES.length * 360 + 800);
  }

  function finishBoot() {
    bootOverlay?.classList.add('done');
    setTimeout(() => {
      jarvisSpeak('Boa noite. Todos os sistemas operacionais. Como posso ajudá-lo?');
    }, 600);
  }

  runBoot();
})();
