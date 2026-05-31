const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, shell, dialog, globalShortcut } = require('electron');
const path  = require('path');
const Claude    = require('./backend/claude');
const Vault     = require('./backend/vault');
const Tasks     = require('./backend/tasks');
const Scheduler = require('./backend/scheduler');

const DATA_PATH = app.getPath('userData');

let mainWindow = null;
let tray       = null;
let claude, vault, tasks, scheduler;

/* ── Window ── */
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  920,
    height: 680,
    minWidth:  800,
    minHeight: 560,
    frame: false,
    backgroundColor: '#040404',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  /* Allow microphone + media for voice input */
  mainWindow.webContents.session.setPermissionRequestHandler((_, perm, cb) => {
    cb(['media', 'audioCapture', 'microphone'].includes(perm));
  });
  mainWindow.webContents.session.setPermissionCheckHandler(() => true);

  mainWindow.on('close', e => {
    e.preventDefault();
    mainWindow.hide();
  });
}

/* ── System Tray ── */
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  tray = new Tray(iconPath);
  tray.setToolTip('JARVIS — Online');

  const menu = Menu.buildFromTemplate([
    { label: 'Abrir JARVIS',  click: () => mainWindow.show() },
    { label: 'Modo Voz',      click: () => { mainWindow.show(); mainWindow.webContents.send('wake:word'); } },
    { type: 'separator' },
    { label: 'Encerrar',      click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => mainWindow.show());
}

/* ── Global hotkey (wake word) ── */
function registerHotkey(hotkey) {
  globalShortcut.unregisterAll();
  const combo = hotkey || 'Alt+Space';
  try {
    globalShortcut.register(combo, () => {
      mainWindow?.show();
      mainWindow?.webContents.send('wake:word');
    });
  } catch {}
}

/* ── IPC Handlers ── */
function registerIPC() {

  /* Config */
  ipcMain.handle('cfg:get', () => ({ ...claude.getConfig(), memoryFacts: claude.getMemory() }));
  ipcMain.handle('cfg:set', (_, cfg) => {
    if (cfg.clearMemory)  { claude.clearMemory();  return { ok: true }; }
    if (cfg.clearHistory) { claude.clearHistory(); return { ok: true }; }
    claude.setConfig(cfg);
    if (cfg.vaultPath    !== undefined) vault.setVaultPath(cfg.vaultPath);
    if (cfg.journalTime  !== undefined) scheduler.setJournalTime(cfg.journalTime);
    if (cfg.wakeHotkey   !== undefined) registerHotkey(cfg.wakeHotkey);
    if (cfg.startWithWindows !== undefined) {
      app.setLoginItemSettings({ openAtLogin: cfg.startWithWindows, name: 'JARVIS' });
    }
    return { ok: true };
  });

  /* Chat — use relevant vault context keyed by the user's message */
  ipcMain.handle('chat:send', async (_, text) => {
    const [vaultCtx, memoryCtx] = await Promise.all([
      vault.getRelevantContext(text),
      Promise.resolve(claude.getMemory()),
    ]);
    let full = '';
    try {
      full = await claude.ask(text, vaultCtx, memoryCtx, chunk => {
        mainWindow?.webContents.send('chat:chunk', chunk);
      });
    } catch (err) {
      mainWindow?.webContents.send('chat:chunk', `\nErro: ${err.message}`);
      full = `Erro: ${err.message}`;
    }
    mainWindow?.webContents.send('chat:done', full);
    return full;
  });

  /* Models — live OpenRouter catalog */
  ipcMain.handle('models:list', () => claude.listModels());

  /* Speech-to-text — Groq Whisper */
  ipcMain.handle('stt:transcribe', async (_, arrayBuffer) => {
    const cfg = claude.getConfig();
    if (!cfg.groqKey) return { error: 'Configure sua chave Groq em Configurações.' };
    try {
      const form = new FormData();
      const blob = new Blob([Buffer.from(arrayBuffer)], { type: 'audio/webm' });
      form.append('file', blob, 'audio.webm');
      form.append('model', 'whisper-large-v3-turbo');
      form.append('language', 'pt');
      form.append('response_format', 'json');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.groqKey}` },
        body: form,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        return { error: e.error?.message || `Erro ${res.status}` };
      }
      const j = await res.json();
      return { text: (j.text || '').trim() };
    } catch (err) {
      return { error: err.message };
    }
  });

  /* Tasks */
  ipcMain.handle('tasks:list',     () => tasks.list());
  ipcMain.handle('tasks:add',      (_, t) => tasks.add(t));
  ipcMain.handle('tasks:complete', (_, id) => tasks.complete(id));
  ipcMain.handle('tasks:delete',   (_, id) => tasks.remove(id));

  /* Vault */
  ipcMain.handle('vault:stats',   () => vault.getStats());
  ipcMain.handle('vault:refresh', async () => { await vault.refresh(); return vault.getStats(); });
  ipcMain.handle('vault:browse',  async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Selecione a pasta do Vault Obsidian',
    });
    return res.canceled ? null : res.filePaths[0];
  });

  /* Window controls */
  ipcMain.on('win:minimize', () => mainWindow.minimize());
  ipcMain.on('win:hide',     () => mainWindow.hide());
  ipcMain.on('win:open-url', (_, url) => shell.openExternal(url));

  /* Journal */
  ipcMain.handle('journal:prompt', () => claude.getJournalPrompt());
  ipcMain.handle('journal:save',   (_, entry) => vault.saveJournalEntry(entry));

  /* Text-to-speech — Azure Neural (primary) → ElevenLabs (fallback) */
  ipcMain.handle('tts:speak', async (_, text) => {
    const cfg = claude.getConfig();

    /* ── Azure Cognitive Services TTS (preferred) ── */
    if (cfg.azureKey) {
      const region = cfg.azureRegion || 'brazilsouth';
      const voice  = cfg.azureVoice  || 'pt-BR-AntonioNeural';
      const safe   = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const ssml   = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='pt-BR'><voice name='${voice}'>${safe}</voice></speak>`;
      try {
        const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': cfg.azureKey,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
          },
          body: ssml,
        });
        if (!res.ok) {
          const msg = await res.text().catch(() => '');
          return { error: `Azure ${res.status}: ${msg.slice(0, 120)}` };
        }
        const buf = Buffer.from(await res.arrayBuffer());
        return { audio: buf.toString('base64') };
      } catch (err) {
        return { error: err.message };
      }
    }

    /* ── ElevenLabs (fallback) ── */
    if (cfg.elevenlabsKey) {
      const voiceId = cfg.elevenlabsVoiceId || 'pNInz6obpgDQGcFmaJgB';
      try {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
            'xi-api-key': cfg.elevenlabsKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
          }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          return { error: e.detail?.message || `Erro ${res.status}` };
        }
        const buf = Buffer.from(await res.arrayBuffer());
        return { audio: buf.toString('base64') };
      } catch (err) {
        return { error: err.message };
      }
    }

    return { error: 'no_key' };
  });
}

/* ── Notifications ── */
function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => mainWindow.show());
  n.show();
}

/* ── App lifecycle ── */
app.whenReady().then(async () => {
  claude    = new Claude(DATA_PATH);
  vault     = new Vault(DATA_PATH);
  tasks     = new Tasks(DATA_PATH);
  scheduler = new Scheduler({ tasks, vault, claude, notify, mainWindow: () => mainWindow });

  registerIPC();
  createWindow();
  createTray();
  scheduler.start();

  /* Register default wake hotkey (or saved preference) */
  const cfg = claude.getConfig();
  registerHotkey(cfg.wakeHotkey || 'Alt+Space');
});

app.on('window-all-closed', e => e.preventDefault());
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('activate', () => mainWindow?.show());
