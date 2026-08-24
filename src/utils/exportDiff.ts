/**
 * Computes a human-readable changelog between two sets of RosterEvents.
 * Only Simulator and Surveillance events are tracked.
 * Matching is ID-based (events keep their IDs when edited via the app).
 */

import { firstNameOf, type RosterEvent } from '@/store/rosterStore';

export interface ChangelogEntry {
  kind: 'added' | 'removed' | 'changed';
  label:  string;   // bold event identifier, e.g. "11 Aug — CPA 2U79"
  detail: string[]; // indented detail lines (inspectors first for changed entries)
  /** Safe HTML for each detail line, used only by the exported HTML changelog. */
  detailHtml?: string[];
  date:   string;   // YYYY-MM-DD, used for sorting only
}

export interface ChangelogHistoryVersion {
  version: number;
  entries: ChangelogEntry[];
}

function escHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "2026-08-11" → "11 Aug" */
function formatDate(dateStr: string): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const day = parseInt(parts[2], 10);
  const mon = parseInt(parts[1], 10) - 1;
  return `${day} ${months[mon] ?? ''}`;
}

/** Bold event identifier line — date first, no inspectors. */
function eventLabel(e: RosterEvent): string {
  const d = formatDate(e.date);
  if (e.eventType === 'Simulator') {
    return `${d} \u2014 ${e.operator} ${e.simulatorCode}`;
  }
  if (e.eventType === 'Surveillance') {
    const types = e.surveillanceTypes.join('/');
    return `${d} \u2014 ${e.operator} ${types}${e.details ? ' ' + e.details : ''}`;
  }
  return d;
}

/** Stable fingerprint for detecting changes in key fields. */
function fingerprint(e: RosterEvent): string {
  const base = `${e.date}|${e.startTime}|${e.endTime}|${[...e.inspectors].sort().join(',')}`;
  if (e.eventType === 'Simulator')
    return `${base}|${e.operator}|${e.simulatorCode}|${e.activity}|${e.candidateName ?? ''}`;
  if (e.eventType === 'Surveillance')
    return `${base}|${e.operator}|${[...e.surveillanceTypes].sort().join(',')}|${e.details ?? ''}`;
  return base;
}

/**
 * Natural-language field-level change descriptions.
 * Inspector diff always appears first; all others follow in logical order.
 */
function diffFields(base: RosterEvent, curr: RosterEvent): string[] {
  const out: string[] = [];

  // Inspectors — full before → after (sorted for comparison, original order for display)
  const baseInspSorted = [...base.inspectors].sort().join(',');
  const currInspSorted = [...curr.inspectors].sort().join(',');
  if (baseInspSorted !== currInspSorted) {
    out.push(`Inspectors: ${base.inspectors.map(firstNameOf).join(', ')} \u2192 ${curr.inspectors.map(firstNameOf).join(', ')}`);
  }

  // Date
  if (base.date !== curr.date)
    out.push(`Date: ${formatDate(base.date)} \u2192 ${formatDate(curr.date)}`);

  // Time
  if (base.startTime !== curr.startTime || base.endTime !== curr.endTime)
    out.push(`Time: ${base.startTime}\u2013${base.endTime} \u2192 ${curr.startTime}\u2013${curr.endTime}`);

  // Type-specific fields
  if (curr.eventType === 'Simulator' && base.eventType === 'Simulator') {
    if (base.operator      !== curr.operator)
      out.push(`Operator: ${base.operator} \u2192 ${curr.operator}`);
    if (base.simulatorCode !== curr.simulatorCode)
      out.push(`Sim code: ${base.simulatorCode} \u2192 ${curr.simulatorCode}`);
    if (base.activity      !== curr.activity)
      out.push(`Activity: ${base.activity} \u2192 ${curr.activity}`);
    if ((base.candidateName ?? '') !== (curr.candidateName ?? ''))
      out.push(`Candidate: ${base.candidateName || '\u2014'} \u2192 ${curr.candidateName || '\u2014'}`);
  } else if (curr.eventType === 'Surveillance' && base.eventType === 'Surveillance') {
    if (base.operator !== curr.operator)
      out.push(`Operator: ${base.operator} \u2192 ${curr.operator}`);
    const baseTypes = [...base.surveillanceTypes].sort().join(',');
    const currTypes = [...curr.surveillanceTypes].sort().join(',');
    if (baseTypes !== currTypes)
      out.push(`Type: ${base.surveillanceTypes.join(', ') || '\u2014'} \u2192 ${curr.surveillanceTypes.join(', ') || '\u2014'}`);
    if ((base.details ?? '') !== (curr.details ?? ''))
      out.push(`Details: ${base.details || '\u2014'} \u2192 ${curr.details || '\u2014'}`);
  }

  return out;
}

/** HTML counterpart to diffFields. Inspector replacements get visual emphasis. */
function diffFieldsHtml(base: RosterEvent, curr: RosterEvent, details: string[]): string[] {
  const baseNames = base.inspectors.map(firstNameOf).join(', ');
  const currNames = curr.inspectors.map(firstNameOf).join(', ');
  const inspectorsChanged =
    [...base.inspectors].sort().join(',') !== [...curr.inspectors].sort().join(',');

  return details.map((detail, index) => {
    if (inspectorsChanged && index === 0) {
      return `Inspectors: <span class="cl-insp-old">${escHtml(baseNames)}</span> <span class="cl-arrow">→</span> <span class="cl-insp-current">${escHtml(currNames)}</span>`;
    }
    return escHtml(detail);
  });
}

/**
 * Returns true when tracked (Simulator / Surveillance) events differ between
 * baseline and current — used to detect uncommitted changes before export.
 */
export function hasTrackedChanges(baseline: RosterEvent[], current: RosterEvent[]): boolean {
  const isTracked = (e: RosterEvent) => e.eventType === 'Simulator' || e.eventType === 'Surveillance';
  const baseMap = new Map(baseline.filter(isTracked).map(e => [e.id, fingerprint(e)]));
  const currMap = new Map(current.filter(isTracked).map(e =>  [e.id, fingerprint(e)]));
  if (baseMap.size !== currMap.size) return true;
  for (const [id, fp] of currMap) {
    if (baseMap.get(id) !== fp) return true;
  }
  return false;
}

/**
 * Returns a sorted list of added / removed / changed events between a version
 * snapshot and the current event state. Only Simulator and Surveillance events
 * are included; Other Duties and Leave are silently ignored.
 */
export function computeChangelog(
  baseline: RosterEvent[],
  current:  RosterEvent[],
): ChangelogEntry[] {
  const isTracked = (e: RosterEvent) =>
    e.eventType === 'Simulator' || e.eventType === 'Surveillance';

  const baseMap = new Map(baseline.filter(isTracked).map(e => [e.id, e]));
  const currMap = new Map(current.filter(isTracked).map(e =>  [e.id, e]));

  const entries: ChangelogEntry[] = [];

  for (const [id, e] of currMap) {
    if (!baseMap.has(id)) {
      entries.push({
        kind: 'added',
        label: eventLabel(e),
        detail: [e.inspectors.map(firstNameOf).join(', ')],
        date: e.date,
      });
    }
  }

  for (const [id, e] of baseMap) {
    if (!currMap.has(id)) {
      entries.push({
        kind: 'removed',
        label: eventLabel(e),
        detail: [e.inspectors.map(firstNameOf).join(', ')],
        date: e.date,
      });
    }
  }

  for (const [id, curr] of currMap) {
    const base = baseMap.get(id);
    if (base && fingerprint(base) !== fingerprint(curr)) {
      const detail = diffFields(base, curr);
      entries.push({
        kind: 'changed',
        label: eventLabel(curr),
        detail,
        detailHtml: diffFieldsHtml(base, curr, detail),
        date: curr.date,
      });
    }
  }

  const kindOrder = { added: 0, changed: 1, removed: 2 } as const;
  entries.sort((a, b) =>
    a.date.localeCompare(b.date) || kindOrder[a.kind] - kindOrder[b.kind],
  );

  return entries;
}
