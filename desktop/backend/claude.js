const fs   = require('fs');
const path = require('path');

const DEFAULTS = {
  apiKey:      '',
  model:       'google/gemini-2.0-flash-exp:free',
  vaultPath:   '',
  journalTime: '08:00',
  startWithWindows: false,
  userName: '',
  voiceEnabled: false,
  voiceURI: '',
  groqKey: '',
};

const JOURNAL_PROMPTS = [
  'Como você está se sentindo hoje? O que está ocupando sua mente?',
  'Qual foi sua maior conquista ou aprendizado da semana?',
  'Existe alguma decisão que você está evitando? Por quê?',
  'O que você faria diferente se pudesse recomeçar hoje?',
  'Quais são suas 3 prioridades para os próximos 7 dias?',
  'Tem algo que está consumindo sua energia sem valer a pena?',
  'O que você está grato hoje?',
];

class Claude {
  constructor(dataPath) {
    this.configFile = path.join(dataPath, 'config.json');
    this.memoryFile = path.join(dataPath, 'memory.json');
    this._cfg    = this._loadConfig();
    this._memory = this._loadMemory();
  }

  /* ── Config ── */
  _loadConfig() {
    try {
      const raw = fs.readFileSync(this.configFile, 'utf8');
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch { return { ...DEFAULTS }; }
  }

  _saveConfig() {
    fs.writeFileSync(this.configFile, JSON.stringify(this._cfg, null, 2));
  }

  getConfig()    { return { ...this._cfg }; }
  setConfig(cfg) {
    this._cfg = { ...this._cfg, ...cfg };
    this._saveConfig();
  }

  /* ── Memory (facts) ── */
  _loadMemory() {
    try {
      return JSON.parse(fs.readFileSync(this.memoryFile, 'utf8'));
    } catch { return { facts: [], history: [] }; }
  }

  _saveMemory() {
    fs.writeFileSync(this.memoryFile, JSON.stringify(this._memory, null, 2));
  }

  getMemory() {
    return this._memory.facts.join('\n');
  }

  addFact(fact) {
    const entry = `- ${fact} (${new Date().toLocaleDateString('pt-BR')})`;
    this._memory.facts.push(entry);
    if (this._memory.facts.length > 200) this._memory.facts.shift();
    this._saveMemory();
  }

  getHistory()     { return this._memory.history.slice(-20); }
  pushHistory(msg) {
    this._memory.history.push(msg);
    if (this._memory.history.length > 40) this._memory.history.splice(0, 2);
    this._saveMemory();
  }
  clearHistory() { this._memory.history = []; this._saveMemory(); }
  clearMemory()  { this._memory = { facts: [], history: [] }; this._saveMemory(); }

  /* ── System prompt ── */
  _buildSystem(vaultCtx, memoryCtx) {
    const name = this._cfg.userName ? `Usuário: ${this._cfg.userName}.` : '';
    let s = `Você é J.A.R.V.I.S — assistente de IA pessoal de elite. ${name} Responda em português brasileiro com precisão e elegância. Seja conciso (até 4 frases) mas elabore quando necessário. Data/hora: ${new Date().toLocaleString('pt-BR')}.`;

    if (memoryCtx) {
      s += `\n\n## MEMÓRIA PERSISTENTE:\n${memoryCtx}`;
    }

    if (vaultCtx) {
      s += `\n\n## BASE DE CONHECIMENTO (vault Obsidian do usuário):\n${vaultCtx}`;
    }

    s += `\n\nQuando o usuário mencionar informações importantes (projetos, metas, preferências, fatos pessoais), adicione ao FINAL da resposta:\n[MEMORIZAR: fato objetivo]\nAo detectar uma TAREFA ou LEMBRETE na fala do usuário, adicione:\n[TAREFA: descrição | prazo opcional]\nEssas linhas serão processadas automaticamente.`;

    return s;
  }

  /* ── Ask Claude (streaming) ── */
  async ask(userMessage, vaultCtx, memoryCtx, onChunk) {
    const apiKey = this._cfg.apiKey;
    if (!apiKey) throw new Error('API key não configurada. Vá em Configurações.');

    const history  = this.getHistory();
    const system   = this._buildSystem(vaultCtx, memoryCtx);
    const messages = [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: userMessage },
    ];

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/OLuc-Dev/J.A.R.V.I.S-ACSM',
        'X-Title': 'JARVIS Desktop',
      },
      body: JSON.stringify({
        model: this._cfg.model,
        max_tokens: 900,
        messages,
        stream: true,
      }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const msg = j.error?.message || res.status;
      if (res.status === 401) throw new Error('API key inválida. Verifique sua chave OpenRouter.');
      throw new Error(`Erro ${res.status}: ${msg}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buf  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const evt = JSON.parse(raw);
          const text = evt.choices?.[0]?.delta?.content;
          if (text) {
            full += text;
            onChunk?.(text);
          }
        } catch {}
      }
    }

    /* Save history */
    this.pushHistory({ role: 'user',      content: userMessage });
    this.pushHistory({ role: 'assistant', content: full });

    /* Extract [MEMORIZAR:] */
    const mems = [...full.matchAll(/\[MEMORIZAR:\s*(.+?)\]/g)];
    for (const m of mems) this.addFact(m[1].trim());

    /* Extract [TAREFA:] — returned for main process to handle */
    const tasks = [...full.matchAll(/\[TAREFA:\s*(.+?)\]/g)].map(m => m[1].trim());

    /* Clean response */
    full = full.replace(/\s*\[(MEMORIZAR|TAREFA):.*?\]/g, '').trim();
    return full;
  }

  /* ── Journal ── */
  getJournalPrompt() {
    const day = new Date().getDay();
    return JOURNAL_PROMPTS[day % JOURNAL_PROMPTS.length];
  }
}

module.exports = Claude;
