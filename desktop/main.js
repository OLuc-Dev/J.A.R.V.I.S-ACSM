const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, shell, dialog } = require('electron');
const path  = require('path');
const cron  = require('node-cron');
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
    { label: 'Abrir JARVIS',   click: () => mainWindow.show() },
    { label: 'Separador', type: 'separator' },
    { label: 'Encerrar',  click: () => { app.quit(); } },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => mainWindow.show());
}

/* ── IPC Handlers ── */
function registerIPC() {

  /* Config */
  ipcMain.handle('cfg:get',  () => ({ ...claude.getConfig(), memoryFacts: claude.getMemory() }));
  ipcMain.handle('cfg:set',  (_, cfg) => {
    if (cfg.clearMemory)  { claude.clearMemory();  return { ok: true }; }
    if (cfg.clearHistory) { claude.clearHistory(); return { ok: true }; }
    claude.setConfig(cfg);
    if (cfg.vaultPath   !== undefined) vault.setVaultPath(cfg.vaultPath);
    if (cfg.journalTime !== undefined) scheduler.setJournalTime(cfg.journalTime);
    if (cfg.startWithWindows !== undefined) {
      app.setLoginItemSettings({ openAtLogin: cfg.startWithWindows, name: 'JARVIS' });
    }
    return { ok: true };
  });

  /* Chat */
  ipcMain.handle('chat:send', async (_, text) => {
    const vaultCtx  = await vault.getContext();
    const memoryCtx = claude.getMemory();
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
});

app.on('window-all-closed', e => e.preventDefault());
app.on('activate', () => mainWindow.show());
