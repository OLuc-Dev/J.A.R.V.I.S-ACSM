const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  /* Config */
  getConfig: ()    => ipcRenderer.invoke('cfg:get'),
  setConfig: (cfg) => ipcRenderer.invoke('cfg:set', cfg),

  /* Chat */
  sendMessage: (text) => ipcRenderer.invoke('chat:send', text),
  onChunk: (cb) => ipcRenderer.on('chat:chunk', (_, t) => cb(t)),
  onDone:  (cb) => ipcRenderer.on('chat:done',  (_, t) => cb(t)),

  /* Speech-to-text (Groq Whisper) */
  transcribe: (buf) => ipcRenderer.invoke('stt:transcribe', buf),

  /* Text-to-speech (ElevenLabs) */
  speakEL: (text) => ipcRenderer.invoke('tts:speak', text),

  /* Models */
  listModels: () => ipcRenderer.invoke('models:list'),

  /* Tasks */
  listTasks:     ()   => ipcRenderer.invoke('tasks:list'),
  addTask:       (t)  => ipcRenderer.invoke('tasks:add', t),
  completeTask:  (id) => ipcRenderer.invoke('tasks:complete', id),
  deleteTask:    (id) => ipcRenderer.invoke('tasks:delete', id),

  /* Vault */
  getVaultStats:  () => ipcRenderer.invoke('vault:stats'),
  refreshVault:   () => ipcRenderer.invoke('vault:refresh'),
  browseVault:    () => ipcRenderer.invoke('vault:browse'),

  /* Window */
  minimize: () => ipcRenderer.send('win:minimize'),
  hide:     () => ipcRenderer.send('win:hide'),
  openUrl:  (url) => ipcRenderer.send('win:open-url', url),

  /* Journal */
  getJournalPrompt: () => ipcRenderer.invoke('journal:prompt'),
  saveJournalEntry: (e) => ipcRenderer.invoke('journal:save', e),

  /* Push events from main */
  onReminder:     (cb) => ipcRenderer.on('reminder:due',       (_, t) => cb(t)),
  onJournalReady: (cb) => ipcRenderer.on('journal:ready',      (_, t) => cb(t)),
  onWakeWord:     (cb) => ipcRenderer.on('wake:word',          ()     => cb()),
  onProactive:    (cb) => ipcRenderer.on('proactive:message',  (_, t) => cb(t)),
});
