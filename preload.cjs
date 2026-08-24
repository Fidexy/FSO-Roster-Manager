// Preload script — runs in an isolated context with access to Node APIs.
// Exposes a minimal, safe storage API to the renderer via contextBridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /** Load the raw string stored under `key`, or null if it doesn't exist. */
  loadData: (key) => ipcRenderer.invoke('storage:load', key),
  /** Persist a raw string under `key`. Resolves true on success. */
  saveData: (key, data) => ipcRenderer.invoke('storage:save', key, data),
  /** Main process asks the renderer to flush pending saves before closing. */
  onFlushRequest: (handler) => {
    const listener = () => { handler(); };
    ipcRenderer.on('storage:flush-request', listener);
    return () => ipcRenderer.removeListener('storage:flush-request', listener);
  },
  /** Renderer signals that the pre-close flush is done. */
  flushComplete: () => ipcRenderer.send('storage:flush-complete'),
});
