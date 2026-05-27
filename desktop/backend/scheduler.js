const cron = require('node-cron');

class Scheduler {
  constructor({ tasks, vault, claude, notify, mainWindow }) {
    this.tasks      = tasks;
    this.vault      = vault;
    this.claude     = claude;
    this.notify     = notify;
    this.mainWindow = mainWindow; // function returning current window
    this._jobs      = [];
  }

  start() {
    /* Check due tasks every 5 minutes */
    this._jobs.push(
      cron.schedule('*/5 * * * *', () => this._checkDueTasks())
    );

    /* Vault refresh every 30 minutes */
    this._jobs.push(
      cron.schedule('*/30 * * * *', () => this.vault.refresh())
    );

    /* Daily journal prompt — check every minute, fire once at configured time */
    this._journalFired = '';
    this._jobs.push(
      cron.schedule('* * * * *', () => this._checkJournal())
    );

    /* Morning briefing — every day at 08:00 */
    this._jobs.push(
      cron.schedule('0 8 * * *', () => this._morningBriefing())
    );
  }

  setJournalTime(timeStr) {
    this._journalTime = timeStr || '08:00';
  }

  _checkDueTasks() {
    const due = this.tasks.getDueSoon(10);
    for (const t of due) {
      this.notify('JARVIS — Lembrete', t.title);
      const win = this.mainWindow();
      if (win) win.webContents.send('reminder:due', t);
    }
  }

  _checkJournal() {
    const cfg  = this.claude.getConfig();
    const time = cfg.journalTime || '08:00';
    const now  = new Date();
    const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const today = now.toISOString().slice(0, 10);

    if (hhmm === time && this._journalFired !== today) {
      this._journalFired = today;
      const prompt = this.claude.getJournalPrompt();
      this.notify('JARVIS — Hora do diário', prompt.slice(0, 80));
      const win = this.mainWindow();
      if (win) win.webContents.send('journal:ready', prompt);
    }
  }

  async _morningBriefing() {
    try {
      const due    = this.tasks.getDue();
      const count  = due.length;
      if (count === 0) return;

      const msg = count === 1
        ? `Você tem 1 tarefa pendente: "${due[0].title}"`
        : `Você tem ${count} tarefas pendentes hoje.`;

      this.notify('JARVIS — Bom dia', msg);
    } catch {}
  }

  stop() {
    this._jobs.forEach(j => j.stop());
    this._jobs = [];
  }
}

module.exports = Scheduler;
