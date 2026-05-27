const fs   = require('fs');
const path = require('path');

class Tasks {
  constructor(dataPath) {
    this.file = path.join(dataPath, 'tasks.json');
    this._data = this._load();
  }

  _load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch { return []; }
  }

  _save() {
    fs.writeFileSync(this.file, JSON.stringify(this._data, null, 2));
  }

  list() {
    return this._data.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
      return 0;
    });
  }

  add({ title, dueDate = null, notes = '' }) {
    const task = {
      id:        Date.now().toString(),
      title:     title.trim(),
      dueDate:   dueDate || null,
      notes:     notes.trim(),
      done:      false,
      createdAt: new Date().toISOString(),
    };
    this._data.push(task);
    this._save();
    return task;
  }

  complete(id) {
    const t = this._data.find(t => t.id === id);
    if (t) { t.done = true; t.completedAt = new Date().toISOString(); this._save(); }
    return t;
  }

  remove(id) {
    this._data = this._data.filter(t => t.id !== id);
    this._save();
  }

  /* Returns tasks due today or overdue (not done) */
  getDue() {
    const now  = new Date();
    const today = now.toISOString().slice(0, 10);
    return this._data.filter(t => !t.done && t.dueDate && t.dueDate <= today);
  }

  /* Returns tasks due in the next N minutes */
  getDueSoon(minutesAhead = 30) {
    const now    = Date.now();
    const limit  = now + minutesAhead * 60000;
    return this._data.filter(t => {
      if (t.done || !t.dueDate) return false;
      const due = new Date(t.dueDate).getTime();
      return due >= now && due <= limit;
    });
  }
}

module.exports = Tasks;
