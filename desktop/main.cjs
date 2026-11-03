// Electron shell for Windows, macOS and Linux.
//
// The Angular build is served from a fixed loopback port instead of file:// so that
// client-side routing works and OAuth redirect URIs (http://localhost:<port>) can be
// registered with Google and Microsoft exactly like for the web version.

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyJwLibrary, locateJwLibrary, readJwLibrary } = require('./jwlibrary.cjs');

const PORT = Number(process.env.JW_NOTES_PORT || 47819);
const ROOT = path.join(__dirname, '..', 'dist', 'jw-notes', 'browser');
const AUTH_HOSTS = ['accounts.google.com', 'login.microsoftonline.com', 'login.live.com'];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.normalize(path.join(ROOT, urlPath));
      if (!file.startsWith(ROOT)) {
        res.writeHead(403).end();
        return;
      }
      // SPA fallback: unknown paths (client routes) get index.html.
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

async function createWindow() {
  await startServer();
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    title: 'Editor de Notas',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // OAuth popups must stay inside the app (they report back via window.opener);
  // every other link opens in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const host = new URL(url).hostname;
    if (AUTH_HOSTS.includes(host)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await win.loadURL(`http://localhost:${PORT}/`);
}

// JW Library without its "Criar backup" / "Restaurar backup" buttons: the renderer gets the raw
// database files, builds the .jwlibrary itself (see LocalJwLibrary) and, after a sync, sends the
// merged database back. Writing only happens on request, with JW Library closed.
ipcMain.handle('jwlibrary:locate', () => locateJwLibrary());
ipcMain.handle('jwlibrary:read', async () => {
  const dbPath = requireJwLibrary();
  return { ...(await readJwLibrary(dbPath)), deviceName: os.hostname() };
});
ipcMain.handle('jwlibrary:apply', (_e, database) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return applyJwLibrary(requireJwLibrary(), database, path.join(app.getPath('userData'), 'jwlibrary-backups', stamp));
});
// Backups with media (playlists) must go through JW Library's own restore, which also copies the media.
ipcMain.handle('jwlibrary:open-backup', async (_e, bytes, name) => {
  const file = path.join(app.getPath('temp'), path.basename(name));
  await fs.promises.writeFile(file, bytes);
  const error = await shell.openPath(file);
  if (error) throw new Error(`Não foi possível abrir o backup no JW Library: ${error}`);
});
ipcMain.handle('device:name', () => os.hostname());
// A click on a desktop notification brings the window back.
ipcMain.handle('window:focus', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win?.isMinimized()) win.restore();
  win?.show();
  win?.focus();
});

function requireJwLibrary() {
  const dbPath = locateJwLibrary();
  if (!dbPath) throw new Error('O JW Library não foi encontrado neste computador.');
  return dbPath;
}

// Windows only shows toast notifications for apps with an AppUserModelID.
if (process.platform === 'win32') app.setAppUserModelId('org.example.jwnotes');
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
