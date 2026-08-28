/**
 * Computes a human-readable changelog between two sets of RosterEvents.
 * Operator Request, Surveillance, and Other Duties events are tracked.
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
  /** Immutable month state at this committed version, when available. */
  snapshot?: RosterEvent[];
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

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function displayValue(value: unknown): string {
  return safeString(value) || '\u2014';
}

/**
 * Other Duties used to store one operator in `operator`; current records use
 * `operators`. Read both shapes so old committed snapshots compare cleanly
 * with current events.
 */
function otherDutiesOperators(e: RosterEvent): string[] {
  const record = e as Record<string, unknown>;
  if (Array.isArray(record.operators)) {
    return record.operators.filter((operator): operator is string =>
      typeof operator === 'string',
    );
  }
  return typeof record.operator === 'string' ? [record.operator] : [];
}

function otherDutiesSubType(e: RosterEvent): string {
  return safeString((e as Record<string, unknown>).subType);
}

function otherDutiesRemarks(e: RosterEvent): string {
  return safeString((e as Record<string, unknown>).remarks);
}

/** Bold event identifier line — date first, no inspectors. */
function eventLabel(e: RosterEvent): string {
  const d = formatDate(e.date);
  if (e.eventType === 'Operator Request') {
    return `${d} \u2014 ${e.operator} ${e.simulatorCodes?.join(', ') ?? e.simulatorCode}`;
  }
  if (e.eventType === 'Surveillance') {
    const types = e.surveillanceTypes.join('/');
    return `${d} \u2014 ${e.operator} ${types}${e.details ? ' ' + e.details : ''}`;
  }
  if (e.eventType === 'Other Duties') {
    const operators = otherDutiesOperators(e).join(', ');
    const subType = otherDutiesSubType(e);
    const identifier = [operators, subType].filter(Boolean).join(' ');
    return `${d} \u2014 ${identifier || 'Other Duties'}`;
  }
  return d;
}

/** Stable fingerprint for detecting changes in key fields. */
function fingerprint(e: RosterEvent): string {
  const base = `${e.date}|${e.startTime}|${e.endTime}|${[...e.inspectors].sort().join(',')}`;
  if (e.eventType === 'Operator Request')
    return `${base}|${e.operator}|${e.simulatorCodes?.join(',') ?? e.simulatorCode}|${e.activity}|${e.candidateName ?? ''}`;
  if (e.eventType === 'Surveillance')
    return `${base}|${e.operator}|${[...e.surveillanceTypes].sort().join(',')}|${e.details ?? ''}`;
  if (e.eventType === 'Other Duties') {
    const operators = otherDutiesOperators(e).slice().sort().join(',');
    return `${base}|${operators}|${otherDutiesSubType(e)}|${otherDutiesRemarks(e)}`;
  }
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
  if (curr.eventType === 'Operator Request' && base.eventType === 'Operator Request') {
    if (base.operator      !== curr.operator)
      out.push(`Operator: ${base.operator} \u2192 ${curr.operator}`);
    const baseCodes = base.simulatorCodes?.join(', ') ?? base.simulatorCode;
    const currCodes = curr.simulatorCodes?.join(', ') ?? curr.simulatorCode;
    if (baseCodes !== currCodes)
      out.push(`Sim code: ${baseCodes || '\u2014'} \u2192 ${currCodes || '\u2014'}`);
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
  } else if (curr.eventType === 'Other Duties' && base.eventType === 'Other Duties') {
    const baseOperators = otherDutiesOperators(base);
    const currOperators = otherDutiesOperators(curr);
    if (baseOperators.slice().sort().join(',') !== currOperators.slice().sort().join(',')) {
      out.push(
        `Operator${baseOperators.length === 1 && currOperators.length === 1 ? '' : 's'}: ${displayValue(baseOperators.join(', '))} \u2192 ${displayValue(currOperators.join(', '))}`,
      );
    }
    const baseSubType = otherDutiesSubType(base);
    const currSubType = otherDutiesSubType(curr);
    if (baseSubType !== currSubType)
      out.push(`Sub-type: ${displayValue(baseSubType)} \u2192 ${displayValue(currSubType)}`);
    const baseRemarks = otherDutiesRemarks(base);
    const currRemarks = otherDutiesRemarks(curr);
    if (baseRemarks !== currRemarks)
      out.push(`Remarks: ${displayValue(baseRemarks)} \u2192 ${displayValue(currRemarks)}`);
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
 * Returns true when tracked (Operator Request / Surveillance / Other Duties) events differ between
 * baseline and current — used to detect uncommitted changes before export.
 */
export function hasTrackedChanges(baseline: RosterEvent[], current: RosterEvent[]): boolean {
  const isTracked = (e: RosterEvent) =>
    e.eventType === 'Operator Request' ||
    e.eventType === 'Surveillance' ||
    e.eventType === 'Other Duties';
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
 * snapshot and the current event state. Operator Request, Surveillance, and
 * Other Duties events are included; Leave events are silently ignored.
 */
export function computeChangelog(
  baseline: RosterEvent[],
  current:  RosterEvent[],
): ChangelogEntry[] {
  const isTracked = (e: RosterEvent) =>
    e.eventType === 'Operator Request' ||
    e.eventType === 'Surveillance' ||
    e.eventType === 'Other Duties';

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
