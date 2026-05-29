const fs   = require('fs');
const path = require('path');

const CACHE_TTL   = 20 * 60 * 1000; // 20 min
const MAX_FILES   = 80;
const MAX_CHARS   = 2000; // per file
const TOTAL_CAP   = 24000;
const RECENT_HOURS = 24;

class Vault {
  constructor(dataPath) {
    this.dataPath  = dataPath;
    this.cacheFile = path.join(dataPath, 'vault-cache.json');
    this._cache    = this._loadCache();
    this._vaultPath = this._cache.vaultPath || '';
  }

  _loadCache() {
    try { return JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')); }
    catch { return { vaultPath: '', ts: 0, notes: [], content: '' }; }
  }

  _saveCache() {
    fs.writeFileSync(this.cacheFile, JSON.stringify(this._cache, null, 2));
  }

  setVaultPath(p) {
    if (p && p !== this._vaultPath) {
      this._vaultPath = p;
      this._cache.vaultPath = p;
      this._cache.ts = 0;
      this._saveCache();
    }
  }

  /* ── Read vault ── */
  async refresh() {
    if (!this._vaultPath || !fs.existsSync(this._vaultPath)) return;

    const mdFiles = this._walkMd(this._vaultPath).slice(0, MAX_FILES);
    const notes   = [];

    for (const fp of mdFiles) {
      try {
        const stat = fs.statSync(fp);
        const text = fs.readFileSync(fp, 'utf8');
        const rel  = path.relative(this._vaultPath, fp);
        const title = path.basename(fp, '.md');
        notes.push({
          title,
          path: rel,
          content: text.slice(0, MAX_CHARS),
          mtime: stat.mtimeMs,
          words: text.toLowerCase().split(/\W+/).filter(w => w.length > 3),
        });
      } catch {}
    }

    this._cache.notes     = notes;
    this._cache.content   = notes.map(n => `### ${n.path}\n${n.content}`).join('\n\n').slice(0, TOTAL_CAP);
    this._cache.files     = mdFiles.map(f => path.relative(this._vaultPath, f));
    this._cache.ts        = Date.now();
    this._cache.vaultPath = this._vaultPath;
    this._saveCache();
  }

  _walkMd(dir, results = []) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return results; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) this._walkMd(full, results);
      else if (e.name.endsWith('.md')) results.push(full);
    }
    return results;
  }

  async _ensureFresh() {
    if (!this._vaultPath) return;
    const stale = Date.now() - (this._cache.ts || 0) > CACHE_TTL;
    if (stale) await this.refresh();
  }

  /* Full vault context (for general conversations) */
  async getContext() {
    await this._ensureFresh();
    return this._cache.content || '';
  }

  /* Relevant context: score notes against the user's query, return top matches */
  async getRelevantContext(query = '') {
    await this._ensureFresh();
    const notes = this._cache.notes || [];
    if (!notes.length) return '';
    if (!query.trim()) return this._cache.content || '';

    const queryWords = query.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    if (!queryWords.length) return this._cache.content || '';

    const scored = notes.map(n => {
      const titleLower = n.title.toLowerCase();
      let score = 0;
      for (const w of queryWords) {
        if (titleLower.includes(w)) score += 5;                 // title hit = high value
        const hits = (n.words || []).filter(nw => nw === w).length;
        score += hits;
      }
      return { ...n, score };
    });

    const relevant = scored.filter(n => n.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 7);

    // If nothing matched, fall back to the most recently modified notes
    const top = relevant.length > 0
      ? relevant
      : [...notes].sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).slice(0, 4);

    return top.map(n => `### ${n.path}\n${n.content}`).join('\n\n---\n\n').slice(0, TOTAL_CAP);
  }

  /* Notes modified in last N hours (for proactive insights) */
  async getRecentNotes(hoursAgo = RECENT_HOURS) {
    await this._ensureFresh();
    const cutoff = Date.now() - hoursAgo * 3600000;
    return (this._cache.notes || [])
      .filter(n => (n.mtime || 0) > cutoff && !n.path.startsWith('JARVIS/'))
      .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  }

  getStats() {
    return {
      vaultPath: this._vaultPath,
      fileCount: (this._cache.files || []).length,
      lastSync:  this._cache.ts ? new Date(this._cache.ts).toLocaleString('pt-BR') : 'nunca',
    };
  }

  /* ── Write to vault ── */
  saveJournalEntry(entry) {
    if (!this._vaultPath) return false;
    const today  = new Date();
    const name   = today.toISOString().slice(0, 10);
    const folder = path.join(this._vaultPath, 'JARVIS', 'Diário');
    try {
      fs.mkdirSync(folder, { recursive: true });
      const file    = path.join(folder, `${name}.md`);
      const content = `# Diário — ${today.toLocaleDateString('pt-BR')}\n\n${entry}\n`;
      fs.writeFileSync(file, content, 'utf8');
      this._cache.ts = 0;
      return true;
    } catch { return false; }
  }

  saveNote(title, content) {
    if (!this._vaultPath) return false;
    try {
      const folder = path.join(this._vaultPath, 'JARVIS', 'Notas');
      fs.mkdirSync(folder, { recursive: true });
      const file = path.join(folder, `${title}.md`);
      fs.writeFileSync(file, content, 'utf8');
      this._cache.ts = 0;
      return true;
    } catch { return false; }
  }
}

module.exports = Vault;
