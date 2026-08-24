/** Describes an accepted file type for showSaveFilePicker. */
export interface FilePickerType {
  description?: string;
  accept: Record<string, string[]>;
}

/** Returned by saveFileWithPicker on success; null means user cancelled. */
export interface SaveResult {
  /** The filename the user confirmed (may differ from suggestedName if they renamed it). */
  filename: string;
  /** true when the native picker was used; false when the <a>.click() fallback was used. */
  usedPicker: boolean;
}

/**
 * Saves a Blob to disk, preferring the native OS file-picker dialog
 * (showSaveFilePicker, available in Chromium-based browsers and Electron).
 *
 * Returns:
 *  - { filename, usedPicker: true }  — picker shown, file written
 *  - { filename, usedPicker: false } — picker not available; fell back to <a>.click()
 *  - null                            — user cancelled the picker (silent abort)
 */
export async function saveFileWithPicker(
  blob: Blob,
  suggestedName: string,
  types: FilePickerType[],
): Promise<SaveResult | null> {
  // showSaveFilePicker is available in Chromium ≥ 86 and Electron
  if ('showSaveFilePicker' in window && typeof (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker === 'function') {
    try {
      const handle: FileSystemFileHandle = await (
        window as unknown as {
          showSaveFilePicker(opts: { suggestedName: string; types: FilePickerType[] }): Promise<FileSystemFileHandle>;
        }
      ).showSaveFilePicker({ suggestedName, types });

      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { filename: handle.name, usedPicker: true };
    } catch (err) {
      // AbortError = user dismissed the dialog — silent return
      if (err instanceof Error && err.name === 'AbortError') return null;
      // SecurityError = cross-origin iframe blocks the picker (e.g. Replit preview) —
      // fall through to the <a>.click() fallback below instead of crashing
      if (err instanceof Error && err.name === 'SecurityError') { /* fall through */ }
      else throw err;
    }
  }

  // Fallback: invisible anchor download (Firefox, Safari, etc.)
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { filename: suggestedName, usedPicker: false };
}
