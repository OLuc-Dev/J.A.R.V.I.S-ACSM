const cron = require('node-cron');

class Scheduler {
  constructor({ tasks, vault, claude, notify, mainWindow }) {
    this.tasks      = tasks;
    this.vault      = vault;
    this.claude     = claude;
    this.notify     = notify;
    this.mainWindow = mainWindow;
    this._jobs      = [];
    this._journalFired  = '';
    this._insightFired  = '';
  }

  start() {
    /* Tasks due soon — every 5 minutes */
    this._jobs.push(cron.schedule('*/5 * * * *', () => this._checkDueTasks()));

    /* Vault refresh — every 30 minutes */
    this._jobs.push(cron.schedule('*/30 * * * *', () => this.vault.refresh()));

    /* Daily journal prompt — every minute, fires once at configured time */
    this._jobs.push(cron.schedule('* * * * *', () => this._checkJournal()));

    /* Morning briefing — configurable, defaults to 08:00 */
    this._jobs.push(cron.schedule('* * * * *', () => this._checkMorningBriefing()));

    /* Proactive vault insight — every day at 15:00 */
    this._jobs.push(cron.schedule('0 15 * * *', () => this._proactiveInsight()));
  }

  setJournalTime(t) { this._journalTime = t || '08:00'; }

  /* ── Private ── */

  _send(event, payload) {
    const win = this.mainWindow();
    if (win) win.webContents.send(event, payload);
  }

  _checkDueTasks() {
    const due = this.tasks.getDueSoon(10);
    for (const t of due) {
      this.notify('JARVIS — Lembrete', t.title);
      this._send('reminder:due', t);
    }
  }

  _checkJournal() {
    const cfg   = this.claude.getConfig();
    const time  = cfg.journalTime || '08:00';
    const now   = new Date();
    const hhmm  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const today = now.toISOString().slice(0, 10);
    if (hhmm === time && this._journalFired !== today) {
      this._journalFired = today;
      const prompt = this.claude.getJournalPrompt();
      this.notify('JARVIS — Hora do diário', prompt.slice(0, 80));
      this._send('journal:ready', prompt);
    }
  }

  _checkMorningBriefing() {
    const cfg   = this.claude.getConfig();
    const time  = cfg.briefingTime || '08:00';
    const now   = new Date();
    const hhmm  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const today = now.toISOString().slice(0, 10);
    const key   = `briefing-${today}`;
    if (hhmm === time && this._briefingFired !== key) {
      this._briefingFired = key;
      this._morningBriefing();
    }
  }

  async _morningBriefing() {
    try {
      const cfg  = this.claude.getConfig();
      const name = cfg.userName ? `, ${cfg.userName}` : '';
      const due  = this.tasks.getDue();
      const recent = await this.vault.getRecentNotes(24);

      const parts = [];

      if (due.length) {
        const taskList = due.slice(0, 5).map(t => `• ${t.title}`).join('\n');
        parts.push(`📋 Tarefas de hoje:\n${taskList}`);
      }

      if (recent.length) {
        const noteList = recent.slice(0, 3).map(n => `• ${n.title}`).join('\n');
        parts.push(`📖 Notas recentes no vault:\n${noteList}`);
      }

      const summary = parts.length
        ? parts.join('\n\n')
        : 'Nenhuma tarefa ou nota nova. Bom dia!';

      const msg = `Bom dia${name}!\n\n${summary}`;
      this.notify('JARVIS — Bom dia', parts.length ? `${due.length} tarefas • ${recent.length} notas recentes` : 'Tudo em dia.');
      this._send('proactive:message', { text: msg, type: 'briefing' });
    } catch {}
  }

  async _proactiveInsight() {
    try {
      const recent = await this.vault.getRecentNotes(48);
      if (!recent.length) return;

      // Pick the most recently modified note not from JARVIS/ folder
      const note = recent[0];
      const snippet = note.content.replace(/#+\s*/g, '').slice(0, 120).trim();
      const msg = `📖 Notei que você editou "${note.title}" recentemente.\n\n"${snippet}…"\n\nQuer conversar sobre isso?`;

      this.notify('JARVIS — Nota recente', `"${note.title}" foi editada. Quer conversar?`);
      this._send('proactive:message', { text: msg, type: 'insight', noteTitle: note.title });
    } catch {}
  }

  stop() {
    this._jobs.forEach(j => j.stop());
    this._jobs = [];
  }
}

module.exports = Scheduler;
