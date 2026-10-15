// SANO Restaurant — Aplicación de escritorio para Windows.
// Carga la versión publicada en Firebase Hosting: cada despliegue actualiza el programa.
const { app, BrowserWindow, shell, Menu, session } = require('electron');
const path = require('path');

const APP_URL = 'https://sano-restaurant.web.app';
const INTERNAL = ['sano-restaurant.web.app', 'sano-restaurant.firebaseapp.com'];
let win;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function isInternal(url) {
  try { return INTERNAL.includes(new URL(url).hostname); } catch (_) { return false; }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 860, minWidth: 980, minHeight: 640,
    backgroundColor: '#0d0b09', title: 'SANO Restaurant', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, 'offline-logo.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadURL(APP_URL);

  // Sin conexión la primera vez: pantalla propia con botón de reintento
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'));
  });
  // WhatsApp y otros enlaces externos se abren en el navegador
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url) && !url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); }
  });
  // Atajos: F5 recarga, F11 pantalla completa, Ctrl+Shift+I herramientas
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') { win.webContents.reloadIgnoringCache(); e.preventDefault(); }
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['clipboard-sanitized-write', 'notifications', 'fullscreen'].includes(permission)));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
