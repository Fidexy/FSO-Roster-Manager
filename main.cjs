const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Persistent storage in the standard per-user app data directory ──────────
// e.g. %APPDATA%/roster-manager (Windows), ~/.config/roster-manager (Linux)
function storageDir() {
  const dir = path.join(app.getPath('userData'), 'roster-data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Keys are used as filenames — sanitize to prevent path traversal.
function fileForKey(key) {
  const safe = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(storageDir(), `${safe}.json`);
}

ipcMain.handle('storage:load', (_event, key) => {
  try {
    const file = fileForKey(key);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`storage:load failed for "${key}"`, err);
    return null;
  }
});

// Atomic write: write to a temp file in the same directory, then rename over
// the target. An interrupted write can never leave a truncated JSON file.
ipcMain.handle('storage:save', (_event, key, data) => {
  try {
    const file = fileForKey(key);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, String(data), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    console.error(`storage:save failed for "${key}"`, err);
    return false;
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'roster-flight-icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // ── Coordinated close: ask the renderer to flush pending saves and wait for
  // the acknowledgement before actually closing, so async IPC writes aren't
  // abandoned mid-teardown. A timeout guarantees the window always closes.
  let flushed = false;
  win.on('close', (event) => {
    if (flushed) return; // second pass — allow the close
    event.preventDefault();

    const finish = () => {
      if (flushed) return;
      flushed = true;
      ipcMain.removeListener('storage:flush-complete', finish);
      if (!win.isDestroyed()) win.close();
    };

    ipcMain.once('storage:flush-complete', finish);
    setTimeout(finish, 2000); // safety net if the renderer never responds
    win.webContents.send('storage:flush-request');
  });

  win.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
