import { type RosterEvent, firstNameOf } from '@/store/rosterStore';

// ─── RFC 5545 text escaping ───────────────────────────────────────────────────
/** Escape a TEXT value per RFC 5545 §3.3.11. */
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')        // backslash must come first
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')       // CRLF → literal \n (before lone CR)
    .replace(/\r/g, '\\n')         // lone CR → literal \n
    .replace(/\n/g, '\\n');        // lone LF → literal \n
}

/** UTC timestamp in RFC 5545 DATE-TIME form: YYYYMMDDTHHMMSSZ */
function dtstamp(): string {
  const n = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  return (
    `${n.getUTCFullYear()}${pad(n.getUTCMonth() + 1)}${pad(n.getUTCDate())}` +
    `T${pad(n.getUTCHours())}${pad(n.getUTCMinutes())}${pad(n.getUTCSeconds())}Z`
  );
}

// ─── RFC 5545 line folding (byte-aware) ──────────────────────────────────────
/**
 * Fold a single iCalendar content line so no line exceeds 75 UTF-8 octets
 * (RFC 5545 §3.1).  Continuation lines are prefixed with a single SPACE.
 */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;

  const segments: string[] = [];
  let seg = '';
  let segBytes = 0;
  // First segment: 75 bytes; continuation: 74 bytes content + 1-byte leading space = 75 total
  let limit = 75;

  for (const char of line) {
    const cb = enc.encode(char).length;
    if (segBytes + cb > limit) {
      segments.push(seg);
      seg = char;
      segBytes = cb;
      limit = 74;
    } else {
      seg += char;
      segBytes += cb;
    }
  }
  if (seg) segments.push(seg);

  return segments[0] + segments.slice(1).map(s => '\r\n ' + s).join('');
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
/** Add one calendar day to a "YYYY-MM-DD" string using UTC arithmetic (no TZ shift). */
function nextCalendarDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Date.UTC handles month/year rollovers correctly
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function toIcsDateTime(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

// ─── VEVENT builders ─────────────────────────────────────────────────────────

function buildSummary(ev: RosterEvent): string {
  const ea = ev as Record<string, unknown>;
  switch (ev.eventType) {
    case 'Simulator':
      return `Simulator \u2013 ${ea.operator ?? ''} ${ea.activity ?? ''}`.trim();
    case 'Surveillance':
      return `Surveillance \u2013 ${ea.operator ?? ''} ${((ea.surveillanceTypes as string[]) ?? []).join(', ')}`.trim();
    case 'Other Duties':
      return `Other Duties \u2013 ${ea.subType ?? ''}`.trim();
    case 'Leave':
      return `Leave \u2013 ${ea.leaveType ?? ''}`.trim();
    default:
      return '';
  }
}

/**
 * Build the DESCRIPTION value.
 * Each field value is individually escaped; segments are joined with RFC 5545
 * literal \n (backslash + n), NOT an actual newline.
 */
function buildDescription(ev: RosterEvent): string {
  const ea = ev as Record<string, unknown>;
  const parts: string[] = [];

  const names = (ev.inspectors ?? []).map(firstNameOf).join(', ');
  if (names) parts.push(`Inspectors: ${esc(names)}`);

  if (ev.eventType === 'Simulator') {
    if (ea.simulatorCode) parts.push(`Code: ${esc(ea.simulatorCode)}`);
    if (ea.candidateName) parts.push(`Candidate: ${esc(ea.candidateName)}`);
  } else if (ev.eventType === 'Surveillance') {
    if (ev.details) parts.push(`Details: ${esc(ev.details)}`);
  } else if (ev.eventType === 'Other Duties') {
    const ops = ((ea.operators as string[]) ?? []).join(', ');
    if (ops) parts.push(`Operator: ${esc(ops)}`);
    if (ea.remarks) parts.push(`Remarks: ${esc(ea.remarks)}`);
  }

  // RFC 5545: literal \n (backslash + n) separates lines within a TEXT value
  return parts.join('\\n');
}

function makeVEvent(ev: RosterEvent): string {
  const isAllDay =
    !ev.startTime ||
    (ev.startTime === '00:00' && (!ev.endTime || ev.endTime === '23:59'));

  let dtStart: string;
  let dtEnd: string;

  if (isAllDay) {
    const dateCompact = ev.date.replace(/-/g, '');
    dtStart = `DTSTART;VALUE=DATE:${dateCompact}`;
    // DTEND is exclusive: the next calendar day, computed in UTC to avoid TZ shifts
    dtEnd = `DTEND;VALUE=DATE:${nextCalendarDate(ev.date)}`;
  } else {
    dtStart = `DTSTART:${toIcsDateTime(ev.date, ev.startTime)}`;
    dtEnd = `DTEND:${toIcsDateTime(ev.date, ev.endTime || ev.startTime)}`;
  }

  const desc = buildDescription(ev);

  return [
    'BEGIN:VEVENT',
    fold(`DTSTAMP:${dtstamp()}`),
    fold(dtStart),
    fold(dtEnd),
    fold(`SUMMARY:${esc(buildSummary(ev))}`),
    ...(desc ? [fold(`DESCRIPTION:${desc}`)] : []),
    fold(`UID:${esc(ev.id)}@roster-manager`),
    'END:VEVENT',
  ].join('\r\n');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generates a fully RFC 5545-compliant iCalendar (.ics) string from a list of
 * roster events.  Compatible with Apple Calendar, Google Calendar, and Outlook.
 *
 * @param events  Already-filtered event list; caller applies operator/inspector
 *                filters before passing events in.
 */
export function generateIcsCalendar(events: RosterEvent[]): string {
  const vevents = events.map(makeVEvent).join('\r\n');
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Roster Manager//Roster Export//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      vevents,
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n'  // RFC 5545 requires CRLF after the last line
  );
}
