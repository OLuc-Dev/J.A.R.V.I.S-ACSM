/* JARVIS Brain — Claude API + Obsidian knowledge + persistent memory */
(function () {
  const S = {
    apiKey:         'jarvis_api_key',
    obsidianRepo:   'jarvis_obsidian_repo',
    obsidianBranch: 'jarvis_obsidian_branch',
    knowledgeCache: 'jarvis_knowledge_cache',
    knowledgeTs:    'jarvis_knowledge_ts',
    history:        'jarvis_history',
    facts:          'jarvis_facts',
    model:          'jarvis_model',
  };

  const KNOWLEDGE_TTL = 30 * 60 * 1000;
  const MAX_HISTORY   = 24;
  const MAX_KNOWLEDGE = 14000;

  /* ── Config ── */
  const cfg = {
    get apiKey()         { return localStorage.getItem(S.apiKey) || ''; },
    get obsidianRepo()   { return localStorage.getItem(S.obsidianRepo) || ''; },
    get obsidianBranch() { return localStorage.getItem(S.obsidianBranch) || 'main'; },
    get model()          { return localStorage.getItem(S.model) || 'claude-opus-4-7'; },
    set apiKey(v)         { localStorage.setItem(S.apiKey, v); },
    set obsidianRepo(v)   { localStorage.setItem(S.obsidianRepo, v); },
    set obsidianBranch(v) { localStorage.setItem(S.obsidianBranch, v); },
    set model(v)          { localStorage.setItem(S.model, v); },
  };

  /* ── History ── */
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(S.history) || '[]'); }
    catch { return []; }
  }
  function saveHistory(h) {
    localStorage.setItem(S.history, JSON.stringify(h.slice(-MAX_HISTORY)));
  }

  /* ── Facts (long-term memory) ── */
  function loadFacts() { return localStorage.getItem(S.facts) || ''; }
  function saveFacts(f) { localStorage.setItem(S.facts, f); }

  /* ── Obsidian / GitHub knowledge ── */
  async function fetchKnowledge() {
    const repo = cfg.obsidianRepo;
    if (!repo) return '';

    const ts = parseInt(localStorage.getItem(S.knowledgeTs) || '0');
    if (Date.now() - ts < KNOWLEDGE_TTL) {
      const cached = localStorage.getItem(S.knowledgeCache);
      if (cached) return cached;
    }

    try {
      const branch = cfg.obsidianBranch;
      const r = await fetch(
        `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`
      );
      if (!r.ok) return '';

      const { tree = [] } = await r.json();
      const files = tree
        .filter(f => f.path.endsWith('.md') && f.type === 'blob')
        .slice(0, 40);

      const settled = await Promise.allSettled(
        files.map(f =>
          fetch(`https://raw.githubusercontent.com/${repo}/${branch}/${encodeURIComponent(f.path)}`)
            .then(r => r.ok ? r.text() : '')
            .then(text => text ? `### ${f.path}\n${text.slice(0, 1200)}` : '')
        )
      );

      const knowledge = settled
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value)
        .join('\n\n')
        .slice(0, MAX_KNOWLEDGE);

      localStorage.setItem(S.knowledgeCache, knowledge);
      localStorage.setItem(S.knowledgeTs, String(Date.now()));
      return knowledge;
    } catch { return ''; }
  }

  /* ── System prompt ── */
  function buildSystem(knowledge, facts) {
    let s = `Você é J.A.R.V.I.S (Just A Rather Very Intelligent System) — assistente de IA de elite com síntese de voz e interface holográfica. Responda sempre em português brasileiro, com precisão e elegância formal. Seja conciso (máximo 3–4 frases) mas elabore quando o contexto exigir. Data/hora atual: ${new Date().toLocaleString('pt-BR')}.`;

    if (facts) {
      s += `\n\n## MEMÓRIA PERSISTENTE (fatos aprendidos sobre o usuário):\n${facts}`;
    }

    if (knowledge) {
      s += `\n\n## BASE DE CONHECIMENTO — vault Obsidian do usuário:\n${knowledge}`;
    }

    s += `\n\nSempre que o usuário mencionar informações relevantes sobre si mesmo, projetos, preferências ou fatos importantes, adicione ao FINAL da sua resposta (em linha separada):\n[MEMORIZAR: descrição objetiva do fato]\nEssa linha será extraída automaticamente e removida da resposta exibida.`;

    return s;
  }

  /* ── Claude API (streaming) ── */
  async function ask(userMessage, onChunk) {
    if (!cfg.apiKey) return null;

    const history   = loadHistory();
    const knowledge = await fetchKnowledge();
    const facts     = loadFacts();
    const system    = buildSystem(knowledge, facts);
    const messages  = [...history, { role: 'user', content: userMessage }];

    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 1024,
          system,
          messages,
          stream: true,
        }),
      });
    } catch (e) { return `Falha de rede: ${e.message}`; }

    if (!res.ok) {
      let msg = String(res.status);
      try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
      if (res.status === 401) msg = 'API key inválida. Verifique em Ctrl+Shift+J.';
      return `Erro: ${msg}`;
    }

    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let full     = '';
    let buf      = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const evt = JSON.parse(raw);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            const t = evt.delta.text;
            full += t;
            onChunk?.(t);
          }
        } catch {}
      }
    }

    /* save to history */
    history.push({ role: 'user', content: userMessage });
    history.push({ role: 'assistant', content: full });
    saveHistory(history);

    /* extract [MEMORIZAR:...] */
    const m = full.match(/\[MEMORIZAR:\s*(.+?)\]/);
    if (m) {
      const line = `- ${m[1].trim()} (${new Date().toLocaleDateString('pt-BR')})`;
      const existing = loadFacts();
      saveFacts(existing ? existing + '\n' + line : line);
      full = full.replace(/\s*\[MEMORIZAR:.*?\]/g, '').trim();
    }

    return full;
  }

  window.JARVIS_BRAIN = {
    ask,
    cfg,
    clearHistory()  { localStorage.removeItem(S.history); },
    clearKnowledge(){ localStorage.removeItem(S.knowledgeCache); localStorage.removeItem(S.knowledgeTs); },
    clearFacts()    { localStorage.removeItem(S.facts); },
    hasApiKey()     { return !!cfg.apiKey; },
    loadFacts,
    loadHistory,
  };
})();
