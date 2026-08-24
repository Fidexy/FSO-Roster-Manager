/**
 * Per-month export version counter, version snapshot, and pre-computed changelog.
 *
 * localStorage keys:
 *   exportVersion-YYYY-MM    — integer; 0 / absent = no version committed yet
 *   htmlSnapshot-YYYY-MM     — JSON array of RosterEvent; the state at the last committed version
 *   versionChangelog-YYYY-MM — JSON array of ChangelogEntry; computed at commit time (before snapshot overwrite)
 *   versionChangelogHistory-YYYY-MM — versioned changelogs used by exported HTML popups
 */

import type { RosterEvent } from '@/store/rosterStore';
import type { ChangelogEntry, ChangelogHistoryVersion } from '@/utils/exportDiff';

const vk = (m: string) => `exportVersion-${m}`;
const sk = (m: string) => `htmlSnapshot-${m}`;
const ck = (m: string) => `versionChangelog-${m}`;
const hk = (m: string) => `versionChangelogHistory-${m}`;

/** Returns the stored version number (0 if no version has been committed for this month). */
export function readExportVersion(monthStr: string): number {
  const raw = localStorage.getItem(vk(monthStr));
  const n   = raw !== null ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Increments the counter and returns the new version.
 * First call returns 1 (v1), second returns 2 (v2), etc.
 */
export function incrementExportVersion(monthStr: string): number {
  const next = readExportVersion(monthStr) + 1;
  localStorage.setItem(vk(monthStr), String(next));
  return next;
}

/** Removes the version counter, snapshot, and stored changelog for a month. */
export function resetExportVersion(monthStr: string): void {
  localStorage.removeItem(vk(monthStr));
  localStorage.removeItem(sk(monthStr));
  localStorage.removeItem(ck(monthStr));
  localStorage.removeItem(hk(monthStr));
}

/**
 * Removes all export version counters, snapshots, and changelogs across all months.
 * Call when the user does a full JSON overwrite import.
 */
export function resetAllExportVersions(): void {
  const keys = Object.keys(localStorage).filter(
    k =>
      k.startsWith('exportVersion-') ||
      k.startsWith('htmlSnapshot-') ||
      k.startsWith('versionChangelog-') ||
      k.startsWith('versionChangelogHistory-'),
  );
  keys.forEach(k => localStorage.removeItem(k));
}

/** Returns the stored version snapshot (unfiltered events at last commit), or null if none. */
export function readVersionSnapshot(monthStr: string): RosterEvent[] | null {
  const raw = localStorage.getItem(sk(monthStr));
  if (!raw) return null;
  try { return JSON.parse(raw) as RosterEvent[]; } catch { return null; }
}

/**
 * Writes the version snapshot for a month, overwriting any existing snapshot.
 * Always called AFTER writeVersionChangelog so the diff is captured first.
 */
export function writeVersionSnapshot(monthStr: string, events: RosterEvent[]): void {
  localStorage.setItem(sk(monthStr), JSON.stringify(events));
}

/**
 * Returns the pre-computed changelog stored at the last commit, or [] if none.
 * This is what the HTML export uses — computed before the snapshot was overwritten.
 */
export function readVersionChangelog(monthStr: string): ChangelogEntry[] {
  const raw = localStorage.getItem(ck(monthStr));
  if (!raw) return [];
  try { return JSON.parse(raw) as ChangelogEntry[]; } catch { return []; }
}

/** Stores the changelog computed at commit time (old snapshot → new state). */
export function writeVersionChangelog(monthStr: string, entries: ChangelogEntry[]): void {
  localStorage.setItem(ck(monthStr), JSON.stringify(entries));
}

/** Returns all committed per-version changelogs for a month, oldest first. */
export function readVersionChangelogHistory(monthStr: string): ChangelogHistoryVersion[] {
  const raw = localStorage.getItem(hk(monthStr));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Records a changelog once for its committed version, replacing an accidental duplicate. */
export function appendVersionChangelogHistory(
  monthStr: string,
  version: number,
  entries: ChangelogEntry[],
): void {
  const history = readVersionChangelogHistory(monthStr)
    .filter(item => item.version !== version);
  history.push({ version, entries });
  history.sort((a, b) => a.version - b.version);
  localStorage.setItem(hk(monthStr), JSON.stringify(history));
}
