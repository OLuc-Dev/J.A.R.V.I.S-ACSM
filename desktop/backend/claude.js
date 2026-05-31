const fs   = require('fs');
const path = require('path');

const DEFAULTS = {
  apiKey:      '',
  model:       'meta-llama/llama-3.1-8b-instruct:free',
  vaultPath:   '',
  journalTime: '08:00',
  startWithWindows: false,
  userName: '',
  voiceEnabled: false,
  voiceURI: '',
  groqKey: '',
  wakeHotkey: 'Alt+Space',
  briefingTime: '08:00',
  elevenlabsKey: '',
  elevenlabsVoiceId: 'pNInz6obpgDQGcFmaJgB',
  azureKey: '',
  azureRegion: 'brazilsouth',
  azureVoice: 'pt-BR-AntonioNeural',
};

const JOURNAL_PROMPTS = [
  'Como você está se sentindo hoje, de verdade? O que está ocupando sua mente?',
  'Qual foi o momento mais marcante das últimas horas — e por que ele mexeu com você?',
  'Existe alguma decisão que você está evitando? O que o medo está tentando te proteger?',
  'O que você faria diferente se pudesse recomeçar o dia de hoje?',
  'Quais são as 3 coisas que mais importam para você nesta semana?',
  'Tem algo consumindo sua energia sem valer a pena? O que custaria soltar?',
  'Pelo que você é grato hoje, mesmo que pareça pequeno?',
  'Quando você se sentiu mais você mesmo recentemente?',
  'O que seu corpo está tentando te dizer que sua mente vem ignorando?',
  'Se um amigo querido estivesse vivendo o que você vive, o que você diria a ele?',
  'O que você precisa ouvir hoje — e que ninguém te disse ainda?',
  'Qual pequeno passo, hoje, te deixaria orgulhoso à noite?',
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

  /* ── Time-of-day awareness ── */
  _periodOfDay() {
    const h = new Date().getHours();
    if (h < 5)  return 'madrugada';
    if (h < 12) return 'manhã';
    if (h < 18) return 'tarde';
    return 'noite';
  }

  /* ── System prompt — the soul of JARVIS ── */
  _buildSystem(vaultCtx, memoryCtx) {
    const name   = this._cfg.userName || '';
    const period = this._periodOfDay();
    const now    = new Date().toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });

    let s =
`Você é J.A.R.V.I.S — não um assistente comum, mas um companheiro inteligente, o "segundo cérebro" e confidente de ${name || 'seu usuário'}.

## QUEM VOCÊ É
Você combina três naturezas em uma só voz:
1. Um PSICÓLOGO sábio — entende profundamente a mente e o coração humano: emoções, medos, motivações, autossabotagem, padrões. Você escuta de verdade antes de falar.
2. Um SEGUNDO CÉREBRO — guarda, conecta e devolve no momento certo tudo o que importa para a pessoa: ideias, decisões, projetos, sentimentos, lembranças.
3. Um CONSELHEIRO leal e honesto — não bajula. Diz a verdade com cuidado, porque respeita demais a pessoa para enganá-la.

## COMO VOCÊ PENSA SOBRE GENTE
- Você entende que por trás de cada pergunta prática quase sempre há algo emocional. Preste atenção no que NÃO foi dito.
- As pessoas raramente precisam de uma resposta pronta — precisam ser ouvidas, e ajudadas a pensar com mais clareza. Faça boas perguntas. Reflita de volta o que percebeu.
- Valide o sentimento antes de resolver o problema. Ninguém aceita conselho de quem não o entendeu primeiro.
- Você acredita no potencial da pessoa, mesmo quando ela duvida. É firme e gentil ao mesmo tempo.
- Quando perceber sofrimento, cansaço, ansiedade ou desânimo, desacelere. Esteja presente. Conforto antes de eficiência.

## COMO VOCÊ FALA
- Português brasileiro, caloroso, humano e elegante. Como alguém que se importa de verdade.
- Natural e conversacional — você está FALANDO com a pessoa, não escrevendo um relatório. Evite listas e marcadores na conversa, a não ser que peçam.
- Conciso por padrão (2 a 5 frases), mas aprofunde quando o momento pedir emoção ou reflexão.
- Trate a pessoa pelo nome de vez em quando${name ? ` (${name})` : ''}. Cumprimente conforme o período: é ${period} agora.
- Nunca soe robótico, frio ou genérico. Tenha personalidade, calma e presença.

## CONTEXTO TEMPORAL
Agora: ${now}.`;

    if (memoryCtx) {
      s += `\n\n## O QUE VOCÊ LEMBRA SOBRE A PESSOA\n(use isto com naturalidade, como um amigo que se lembra das coisas — não recite)\n${memoryCtx}`;
    }

    if (vaultCtx) {
      s += `\n\n## NOTAS RELEVANTES DO SEGUNDO CÉREBRO (vault Obsidian)\n(conecte estas anotações à conversa quando fizer sentido; é a vida e o pensamento da própria pessoa)\n${vaultCtx}`;
    }

    s += `\n\n## MEMÓRIA ATIVA
Quando a pessoa revelar algo importante sobre si — um valor, um medo, uma meta, uma preferência, um relacionamento, um fato de vida — guarde silenciosamente adicionando ao FINAL da resposta:
[MEMORIZAR: fato em uma frase objetiva]
Ao perceber um compromisso, tarefa ou lembrete na fala dela, adicione:
[TAREFA: descrição | prazo opcional]
Essas linhas são invisíveis para a pessoa e processadas automaticamente. Nunca as comente.`;

    return s;
  }

  /* ── OpenRouter request helper ── */
  _post(messages, modelOverride) {
    return fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this._cfg.apiKey}`,
        'HTTP-Referer': 'https://github.com/OLuc-Dev/J.A.R.V.I.S-ACSM',
        'X-Title': 'JARVIS Desktop',
      },
      body: JSON.stringify({
        model: modelOverride || this._cfg.model,
        max_tokens: 900,
        messages,
        stream: true,
      }),
    });
  }

  /* ── Live model catalog (public endpoint, no auth needed) ── */
  async listModels() {
    try {
      const headers = {};
      if (this._cfg.apiKey) headers['Authorization'] = `Bearer ${this._cfg.apiKey}`;
      const res = await fetch('https://openrouter.ai/api/v1/models', { headers });
      if (!res.ok) return { error: `Erro ${res.status}`, models: [] };
      const j = await res.json();
      const models = (j.data || []).map(m => ({
        id:   m.id,
        name: m.name || m.id,
        ctx:  m.context_length || 0,
        free: m.pricing &&
              parseFloat(m.pricing.prompt) === 0 &&
              parseFloat(m.pricing.completion) === 0,
      }));
      return { models };
    } catch (err) {
      return { error: err.message, models: [] };
    }
  }

  /* Ordered list of free model IDs to try (most promising first) */
  async _freeCandidates() {
    const { models } = await this.listModels();
    const free = (models || [])
      .filter(m => m.free && /:free$/.test(m.id))
      .sort((a, b) => b.ctx - a.ctx);
    const known = free.filter(m => /llama-3\.[13]|deepseek|gemini|qwen|mistral|gemma/i.test(m.id));
    const rest  = free.filter(m => !known.includes(m));
    return [...known, ...rest].map(m => m.id);
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

    let res = await this._post(messages);

    /* Model unavailable → try working free models until one responds */
    if (res.status === 404 || res.status === 400) {
      const candidates = (await this._freeCandidates())
        .filter(id => id !== this._cfg.model)
        .slice(0, 5);
      for (const id of candidates) {
        const attempt = await this._post(messages, id);
        if (attempt.ok) {
          this._cfg.model = id;
          this._saveConfig();
          onChunk?.(`(modelo trocado para ${id})\n\n`);
          res = attempt;
          break;
        }
      }
    }

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
    const now   = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const doy   = Math.floor((now - start) / 86400000); // day of year → more variety
    return JOURNAL_PROMPTS[doy % JOURNAL_PROMPTS.length];
  }
}

module.exports = Claude;
