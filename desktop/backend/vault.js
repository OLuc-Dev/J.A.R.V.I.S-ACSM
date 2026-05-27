const fs   = require('fs');
const path = require('path');

const CACHE_TTL = 20 * 60 * 1000; // 20 min

class Vault {
  constructor(dataPath) {
    this.dataPath  = dataPath;
    this.cacheFile = path.join(dataPath, 'vault-cache.json');
    this._cache    = this._loadCache();
    this._vaultPath = this._cache.vaultPath || '';
  }

  _loadCache() {
    try { return JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')); }
    catch { return { vaultPath: '', ts: 0, files: [], content: '' }; }
  }

  _saveCache() {
    fs.writeFileSync(this.cacheFile, JSON.stringify(this._cache, null, 2));
  }

  setVaultPath(p) {
    if (p && p !== this._vaultPath) {
      this._vaultPath = p;
      this._cache.vaultPath = p;
      this._cache.ts = 0; // force refresh
      this._saveCache();
    }
  }

  /* ── Read vault ── */
  async refresh() {
    if (!this._vaultPath || !fs.existsSync(this._vaultPath)) return;

    const mdFiles = this._walkMd(this._vaultPath);
    const contents = [];

    for (const fp of mdFiles.slice(0, 60)) {
      try {
        const text = fs.readFileSync(fp, 'utf8');
        const rel  = path.relative(this._vaultPath, fp);
        contents.push(`### ${rel}\n${text.slice(0, 1500)}`);
      } catch {}
    }

    this._cache.content   = contents.join('\n\n').slice(0, 18000);
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

  /* ── Get context for Claude ── */
  async getContext() {
    if (!this._vaultPath) return '';
    const stale = Date.now() - (this._cache.ts || 0) > CACHE_TTL;
    if (stale) await this.refresh();
    return this._cache.content || '';
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

    const today   = new Date();
    const name    = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const folder  = path.join(this._vaultPath, 'JARVIS', 'Diário');

    try {
      fs.mkdirSync(folder, { recursive: true });
      const file = path.join(folder, `${name}.md`);
      const content = `# Diário — ${today.toLocaleDateString('pt-BR')}\n\n${entry}\n`;
      fs.writeFileSync(file, content, 'utf8');
      this._cache.ts = 0; // invalidate cache
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
