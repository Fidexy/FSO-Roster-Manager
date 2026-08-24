// Environment-aware storage utility.
//
// In the packaged Electron app, `window.electronAPI` is injected by preload.cjs
// and persists data as JSON files under app.getPath('userData').
// In the browser (dev / testing), it falls back to localStorage.
//
// Both paths expose the same async API so callers never need to care which
// environment they're in.

export interface ElectronAPI {
  loadData: (key: string) => Promise<string | null>;
  saveData: (key: string, data: string) => Promise<boolean>;
  /** Register a handler invoked when the main process requests a pre-close flush. Returns a dispose fn. */
  onFlushRequest?: (handler: () => void | Promise<void>) => () => void;
  /** Acknowledge that the pre-close flush finished so the window may close. */
  flushComplete?: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

function hasElectronAPI(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI;
}

/** Load a raw string value for `key`, or null if absent / on failure. */
export async function loadData(key: string): Promise<string | null> {
  try {
    if (hasElectronAPI()) {
      return await window.electronAPI!.loadData(key);
    }
    return localStorage.getItem(key);
  } catch (err) {
    console.error(`storage.loadData failed for "${key}"`, err);
    return null;
  }
}

/** Save a raw string value under `key`. Returns true on success. */
export async function saveData(key: string, data: string): Promise<boolean> {
  try {
    if (hasElectronAPI()) {
      return await window.electronAPI!.saveData(key, data);
    }
    localStorage.setItem(key, data);
    return true;
  } catch (err) {
    console.error(`storage.saveData failed for "${key}"`, err);
    return false;
  }
}
