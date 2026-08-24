import { firstNameOf, type RosterEvent } from "@/store/rosterStore";
import type { ChangelogEntry, ChangelogHistoryVersion } from "@/utils/exportDiff";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Safely embed a value as a JS string literal inside a <script> block. */
function jsStr(s: string): string {
  return JSON.stringify(s); // produces a quoted, escaped string literal
}

// ─── TypeScript-side render helpers (mirror the embedded-JS builders) ─────────
// These produce fully-formed HTML at export time so the page is readable
// without JavaScript (e.g. iOS Quick Look, offline viewers).

const WDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function htmlPad(n: number): string {
  return String(n).padStart(2, "0");
}

function htmlHexToRgb(h: string): { r: number; g: number; b: number } | null {
  const m = h?.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

function htmlPillStyle(hex: string | undefined): string {
  if (!hex) return "";
  const rgb = htmlHexToRgb(hex);
  if (!rgb) return "";
  return `background:rgba(${rgb.r},${rgb.g},${rgb.b},0.13);border-color:rgba(${rgb.r},${rgb.g},${rgb.b},0.45);color:${hex};`;
}

function htmlOpColor(
  ev: RosterEvent,
  operatorColors: Record<string, string>,
): string | undefined {
  const ea = ev as Record<string, unknown>;
  if (ev.eventType === "Simulator" || ev.eventType === "Surveillance")
    return operatorColors[ea.operator as string];
  if (ev.eventType === "Other Duties")
    return (
      (typeof ea.customColor === "string" &&
      /^#[0-9a-f]{6}$/i.test(ea.customColor)
        ? ea.customColor
        : undefined) ??
      operatorColors[((ea.operators as string[]) ?? [])[0]]
    );
  return undefined;
}

/**
 * Returns "AM", "PM", or "" for a Leave or Other Duties event based on its stored times.
 * AM ends at or before 12:00; PM starts at or after 12:00.
 * All-day (00:00–23:59) returns "".
 */
function leaveShiftLabel(ev: RosterEvent): string {
  if (ev.eventType !== "Leave" && ev.eventType !== "Other Duties") return "";
  const s = ev.startTime ?? "";
  const e = ev.endTime ?? "";
  // Only trust well-formed zero-padded HH:MM values (imported data may be
  // empty or non-padded, where lexical comparison misclassifies).
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!valid.test(s) || !valid.test(e)) return "";
  if (s === "00:00" && e === "23:59") return "";
  if (e <= "12:00" && s < "12:00") return "AM";
  if (s >= "12:00") return "PM";
  return "";
}

function htmlEventLabel(ev: RosterEvent): string {
  const ea = ev as Record<string, unknown>;
  if (ev.eventType === "Simulator") return `${ea.operator} ${ea.simulatorCode}`;
  if (ev.eventType === "Surveillance") {
    const types = ((ea.surveillanceTypes as string[]) ?? []).join("/");
    const details = (ea.details as string) ?? "";
    return `${ea.operator} ${types}${details ? " " + details : ""}`;
  }
  if (ev.eventType === "Other Duties")
    return `${((ea.operators as string[]) ?? []).join(", ")} ${ea.subType}`.trim();
  const shift = leaveShiftLabel(ev);
  return `${(ev.inspectors ?? []).map(firstNameOf).join(", ")} ${ea.leaveType}${shift ? " " + shift : ""}`.trim();
}

/** Builds the inner HTML for a calendar pill — single line. */
function htmlPillContent(ev: RosterEvent): string {
  const ea = ev as Record<string, unknown>;

  if (ev.eventType === "Leave") {
    const names = (ev.inspectors ?? []).map(firstNameOf).join(", ");
    const shift = leaveShiftLabel(ev);
    const label = `${(ea.leaveType as string) ?? ""}${shift ? " " + shift : ""}`;
    return `<span class="pl">${esc(names)} ${esc(label)}</span>`;
  }

  const names = (ev.inspectors ?? []).map(firstNameOf).join(", ");

  let op = "";
  if (ev.eventType === "Other Duties") {
    op = ((ea.operators as string[]) ?? [])
      .filter((o) => o && o.toLowerCase() !== "n/a")
      .join("/");
  } else {
    op = (ea.operator as string) ?? "";
  }

  let detail = "";
  if (ev.eventType === "Simulator") {
    detail = (ea.activity as string) ?? "";
  } else if (ev.eventType === "Surveillance") {
    detail = `${((ea.surveillanceTypes as string[]) ?? []).join(", ")} surveillance`;
  } else if (ev.eventType === "Other Duties") {
    detail = (ea.subType as string) ?? "";
  }

  const s = ev.startTime ?? "";
  const e = ev.endTime ?? "";
  const shift = ev.eventType === "Other Duties" ? leaveShiftLabel(ev) : "";
  const time =
    !shift && s && !(s === "00:00" && e === "23:59") ? `${s} – ${e}` : "";

  const label = [names, op, detail, shift ? `(${shift})` : time]
    .filter(Boolean)
    .join(" ");
  return `<span class="pl">${esc(label)}</span>`;
}

/**
 * Produces the inspector cell HTML for a table row.
 * When `previousInspectors` differs from `inspectors`, removed names are
 * rendered with strikethrough and added names are coloured green.
 * Both the static (no-JS) pre-render and the live table use this function.
 */
function htmlInspDiff(ev: RosterEvent): string {
  const curr = (ev.inspectors ?? []).map(firstNameOf);
  const prev = ev.previousInspectors?.map(firstNameOf) ?? null;

  // No diff recorded — plain text
  if (!prev) return esc(curr.join(", "));

  // Diff recorded but no actual change — plain text
  const currSorted = [...curr].sort().join("\0");
  const prevSorted = [...prev].sort().join("\0");
  if (currSorted === prevSorted) return esc(curr.join(", "));

  const currSet = new Set(curr);
  const prevSet = new Set(prev);
  const removed = prev.filter((n) => !currSet.has(n));

  const parts: string[] = [];

  // Struck-through removed names (shown first so readers see what was replaced)
  if (removed.length > 0) {
    parts.push(
      removed.map((n) => `<s class="td-rem">${esc(n)}</s>`).join(", "),
    );
  }

  // Current names — newly added ones in green
  if (curr.length > 0) {
    parts.push(
      curr
        .map((n) =>
          prevSet.has(n) ? esc(n) : `<span class="td-add">${esc(n)}</span>`,
        )
        .join(", "),
    );
  }

  return parts.join(" ");
}

function htmlSortTier(ev: RosterEvent): number {
  if (ev.eventType === "Simulator") return 0;
  if (ev.eventType === "Surveillance") return 1;
  if (
    ev.eventType === "Other Duties" &&
    (ev as Record<string, unknown>).subType === "Flying"
  )
    return 3;
  if (ev.eventType === "Other Duties") return 2;
  return 4; // Leave
}

/** Pre-renders the calendar grid as a static HTML string. */
function tsRenderGrid(
  monthEvents: RosterEvent[],
  operatorColors: Record<string, string>,
  year: number,
  month: number,
  monthStr: string,
  holidayObj: Record<string, string>,
): string {
  const dim = new Date(year, month, 0).getDate();
  const fdo = new Date(year, month - 1, 1).getDay();

  const byDate: Record<string, RosterEvent[]> = {};
  for (const ev of monthEvents) {
    if (!byDate[ev.date]) byDate[ev.date] = [];
    byDate[ev.date].push(ev);
  }
  for (const dk of Object.keys(byDate)) {
    byDate[dk].sort(
      (a, b) =>
        htmlSortTier(a) - htmlSortTier(b) ||
        (a.startTime ?? "").localeCompare(b.startTime ?? ""),
    );
  }

  let h = '<div class="wd-row">';
  for (const w of WDAYS) h += `<div class="wd">${w}</div>`;
  h += '</div><div class="dg">';

  for (let i = 0; i < fdo; i++) {
    const col = i % 7;
    h += `<div class="dc${col === 0 || col === 6 ? " sh" : ""} bl"></div>`;
  }

  for (let day = 1; day <= dim; day++) {
    const dateKey = `${monthStr}-${htmlPad(day)}`;
    const col = (fdo + day - 1) % 7;
    const isSh = col === 0 || col === 6 || !!holidayObj[dateKey];
    const dayEvs = byDate[dateKey] ?? [];

    h += `<div class="dc${isSh ? " sh" : ""}">`;
    const dnClass = "dn" + (dayEvs.length > 0 ? " dn-ev" : "");
    h += `<span class="${dnClass}">${day}</span>`;
    if (holidayObj[dateKey] && !(col === 0 || col === 6)) {
      h += `<span class="hn" title="${esc(holidayObj[dateKey])}">${esc(holidayObj[dateKey])}</span>`;
    }
    h += '<div class="pills">';
    for (const ev of dayEvs) {
      const isLeave = ev.eventType === "Leave";
      const oc = htmlOpColor(ev, operatorColors);
      const st = isLeave
        ? ""
        : oc
          ? htmlPillStyle(oc)
          : "background:#e5e7eb;border-color:#d1d5db;color:#374151;";
      h +=
        `<div class="pill${isLeave ? " lp" : ""}" style="${st}" data-id="${esc(ev.id)}">` +
        htmlPillContent(ev) +
        `</div>`;
    }
    h += "</div></div>";
  }
  h += "</div>";
  return h;
}

/** Pre-renders the table view as a static HTML string. */
function tsRenderTable(
  monthEvents: RosterEvent[],
  operatorColors: Record<string, string>,
  year: number,
  month: number,
  monthStr: string,
  holidayObj: Record<string, string>,
): string {
  const dim = new Date(year, month, 0).getDate();

  const byDate: Record<string, RosterEvent[]> = {};
  for (const ev of monthEvents) {
    if (!byDate[ev.date]) byDate[ev.date] = [];
    byDate[ev.date].push(ev);
  }
  for (const dk of Object.keys(byDate)) {
    byDate[dk].sort(
      (a, b) =>
        htmlSortTier(a) - htmlSortTier(b) ||
        (a.startTime ?? "").localeCompare(b.startTime ?? ""),
    );
  }

  let h =
    '<div class="tv-wrap"><table class="tv"><thead><tr>' +
    '<th class="th-date">Date</th>' +
    '<th class="th-time">Time</th>' +
    '<th class="th-duty">Duty</th>' +
    '<th class="th-det">Details</th>' +
    '<th class="th-insp">Inspectors</th>' +
    "</tr></thead><tbody>";

  for (let day = 1; day <= dim; day++) {
    const dateKey = `${monthStr}-${htmlPad(day)}`;
    const dow = new Date(year, month - 1, day).getDay();
    const isSh = dow === 0 || dow === 6 || !!holidayObj[dateKey];
    const dayEvs = byDate[dateKey] ?? [];
    const dateLabel = `${WDAYS[dow]} ${day} ${MONTH_NAMES[month - 1].slice(0, 3)}`;
    const rowBase = isSh ? " tr-sh" : "";

    if (dayEvs.length === 0) {
      h +=
        `<tr class="tr-empty${rowBase}">` +
        `<td class="td-date">${esc(dateLabel)}</td>` +
        '<td colspan="4" class="td-nd">&mdash;</td>' +
        "</tr>";
    } else {
      h +=
        `<tr class="tr-placeholder tr-empty${rowBase} ph" data-date="${dateKey}">` +
        `<td class="td-date">${esc(dateLabel)}</td>` +
        '<td colspan="4" class="td-nd">&mdash;</td>' +
        "</tr>";

      for (const ev of dayEvs) {
        const ea = ev as Record<string, unknown>;
        const oc2 = htmlOpColor(ev, operatorColors);

        let duty = "";
        let det = "";
        if (ev.eventType === "Simulator") {
          duty = `${esc(ea.operator as string)} &middot; ${esc(ea.activity as string)}`;
          const codeType = `${esc(ea.simulatorCode as string)} / ${esc(ea.aircraftType as string)}`;
          const candidate = (ea.candidateName as string) ?? "";
          det = candidate ? `${codeType} &middot; ${esc(candidate)}` : codeType;
        } else if (ev.eventType === "Surveillance") {
          const types = ((ea.surveillanceTypes as string[]) ?? []).join(", ");
          duty = `${esc(ea.operator as string)} &middot; ${esc(types)} Surveillance`;
          det = esc((ea.details as string) ?? "");
        } else if (ev.eventType === "Other Duties") {
          const ops = ((ea.operators as string[]) ?? []).join(", ");
          const odShift = leaveShiftLabel(ev);
          const odBase = ops
            ? `${esc(ops)} &middot; ${esc(ea.subType as string)}`
            : esc(ea.subType as string);
          duty = odShift ? `${odBase} (${esc(odShift)})` : odBase;
          det = ea.remarks ? esc(ea.remarks as string) : "";
        } else {
          // Leave
          duty = "";
          det = esc(ea.leaveType as string);
        }

        const timeStr =
          ev.startTime + (ev.endTime ? ` &ndash; ${ev.endTime}` : "");
        h +=
          `<tr class="tr-ev${rowBase} td-date-first" data-id="${esc(ev.id)}" data-date="${dateKey}">` +
          `<td class="td-date">${esc(dateLabel)}</td>` +
          `<td class="td-time">${timeStr}</td>` +
          `<td class="td-duty">${duty}</td>` +
          `<td class="td-det">${det}</td>` +
          `<td class="td-insp">${htmlInspDiff(ev)}</td>` +
          "</tr>";
      }
    }
  }
  h += "</tbody></table></div>";
  return h;
}

/** Generate a fully self-contained interactive HTML calendar for one month. */
export function generateHtmlCalendar(
  year: number,
  month: number,
  events: RosterEvent[],
  operatorColors: Record<string, string>,
  operators: string[],
  inspectorNames: string[],
  holidays: Map<string, string>,
  version?: number,
  changelog?: ChangelogEntry[],
  exportId?: string,
  changelogHistory?: ChangelogHistoryVersion[],
): string {
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const monthTitle = `${MONTH_NAMES[month - 1]} ${year}`;
  const monthEvents = events.filter((e) => e.date.startsWith(monthStr + "-"));

  const holidayObj: Record<string, string> = {};
  for (const [k, v] of holidays) holidayObj[k] = v;

  const ver = version ?? 1;
  const cl = changelog ?? [];
  const eid = exportId ?? "";
  const exportDate = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // Pre-render both views at export time so the page displays without JavaScript.
  const preGrid = tsRenderGrid(
    monthEvents,
    operatorColors,
    year,
    month,
    monthStr,
    holidayObj,
  );
  const preTable = tsRenderTable(
    monthEvents,
    operatorColors,
    year,
    month,
    monthStr,
    holidayObj,
  );

  // Escape characters that could terminate or escape a <script> block.
  // \u003c / \u003e / \u0026 / \u2028 / \u2029 are valid JSON unicode escapes
  // and are parsed back correctly by JSON.parse in the browser.
  const payload = JSON.stringify({
    year,
    month,
    events: monthEvents,
    operatorColors,
    operators,
    inspectorNames,
    holidays: holidayObj,
    monthStr,
    version: ver,
    exportId: eid,
  })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  const opCheckboxes = operators
    .map(
      (op) =>
        `<label class="fi"><input type="checkbox" class="oc" value="${esc(op)}"><span>${esc(op)}</span></label>`,
    )
    .join("");

  const inspCheckboxes = inspectorNames
    .map(
      (n) =>
        `<label class="fi"><input type="checkbox" class="ic" value="${esc(n)}"><span>${esc(n)}</span></label>`,
    )
    .join("");

  const versionBadge = `<span class="vb">v${ver}</span>`;

  const popupHtml =
    ver > 0 ? buildPopupHtml(cl, ver, monthTitle, exportDate, changelogHistory ?? []) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Roster \u2014 ${esc(monthStr)} v${ver}</title>
<style>${getCss()}</style>
<script>try{var _rt=localStorage.getItem('roster-theme');if(_rt==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}</script>
</head>
<body>
<header class="hdr">
  <span class="hdr-title">${esc(monthTitle)}${versionBadge}</span>
  <div class="cal-period" id="calendar-period">
    <button class="cal-period-btn hidden" id="cal-period-prev" title="Previous">&#8249;</button>
    <span class="cal-period-label" id="cal-period-label">${esc(monthTitle)}</span>
    <button class="cal-period-btn hidden" id="cal-period-next" title="Next">&#8250;</button>
  </div>
  <div class="hdr-right">
    <div class="fw" id="fw-op">
      <button class="fb" id="op-btn">Operator &#9660;</button>
      <div class="fp hidden" id="op-panel">
        <div class="fi-list">${opCheckboxes || '<em class="fi-empty">No operators</em>'}</div>
        <div class="ff"><button class="fc" id="op-clear">Clear all</button></div>
      </div>
    </div>
    <div class="fw" id="fw-insp">
      <button class="fb" id="insp-btn">Inspector &#9660;</button>
      <div class="fp hidden" id="insp-panel">
        <div class="fi-list">${inspCheckboxes || '<em class="fi-empty">No inspectors</em>'}</div>
        <div class="ff"><button class="fc" id="insp-clear">Clear all</button></div>
      </div>
    </div>
    <div class="vt">
      <button class="vb-btn vb-active" id="cal-btn">Calendar</button>
      <button class="vb-btn" id="tbl-btn">Table</button>
    </div>
    <div class="vt hidden" id="cv-sub">
      <button class="vb-btn vb-active" id="mv-btn">Month</button>
      <button class="vb-btn" id="wv-btn">Week</button>
      <button class="vb-btn" id="dv-btn">Day</button>
    </div>
    <button class="ca hidden" id="ca">&#x2715;&nbsp;All</button>
    <span class="ec" id="ec"></span>
    <button class="pr-btn hidden" id="pr-btn" title="Print table">&#128438; Print</button>
     <button class="ics-btn" id="ics-btn" title="Download calendar file (.ics)">&#128197; .ics</button>
    <button class="dm-btn" id="dm-btn" aria-label="Toggle dark mode" title="Toggle dark mode">&#9790;</button>
  </div>
</header>
<div class="cw">
  <div id="wr">${preGrid}</div>
</div>
<footer class="ft">Exported ${esc(exportDate)} v${ver}</footer>
<div class="tt hidden" id="tt"></div>
${popupHtml}
<script>${getJs(payload, eid, preGrid, preTable)}</script>
</body>
</html>`;
}

// ─── Changelog popup ──────────────────────────────────────────────────────────

function buildPopupHtml(
  changelog: ChangelogEntry[],
  version: number,
  monthTitle: string,
  exportDate: string,
  history: ChangelogHistoryVersion[],
): string {
  const added = changelog.filter((e) => e.kind === "added");
  const changed = changelog.filter((e) => e.kind === "changed");
  const removed = changelog.filter((e) => e.kind === "removed");

  const section = (
    items: ChangelogEntry[],
    icon: string,
    label: string,
    cls: string,
  ) => {
    if (!items.length) return "";
    return `<div class="cl-sec">
      <div class="cl-sh ${cls}">${icon} ${esc(label)} (${items.length})</div>
      ${items.map((e) => {
        const details = e.detailHtml?.length === e.detail.length
          ? e.detailHtml
          : e.detail.map((d) => esc(d));
        return `<div class="cl-row"><div class="cl-lbl">${esc(e.label)}</div>${details.map((d) => `<div class="cl-detail">${d}</div>`).join("")}</div>`;
      }).join("\n      ")}
    </div>`;
  };

  const isFirstExport = version === 1 && changelog.length === 0;
  const hasChanges =
    added.length > 0 || changed.length > 0 || removed.length > 0;

  const body = isFirstExport
    ? `<div class="cl-none">Initial export &mdash; no previous version to compare.</div>`
    : !hasChanges
      ? `<div class="cl-none">No changes from the previous version.</div>`
      : `${section(added, "+", "Added", "cl-add")}
      ${section(changed, "~", "Changed", "cl-chg")}
      ${section(removed, "\u2212", "Removed", "cl-rem")}`;

  const title = isFirstExport
    ? `v${version} &mdash; Initial Export`
    : `What&#8217;s New in v${version}`;

  const previousVersions = history
    .filter((item) => item.version < version)
    .sort((a, b) => b.version - a.version);
  const historyHtml = previousVersions.length === 0
    ? ""
    : `<details class="cl-history">
        <summary>All past changes (${previousVersions.length} previous version${previousVersions.length === 1 ? "" : "s"})</summary>
        <div class="cl-history-list">
          ${previousVersions.map((item) => {
            const itemAdded = item.entries.filter((e) => e.kind === "added");
            const itemChanged = item.entries.filter((e) => e.kind === "changed");
            const itemRemoved = item.entries.filter((e) => e.kind === "removed");
            const itemBody = item.entries.length === 0
              ? '<div class="cl-none">Initial export — no previous version to compare.</div>'
              : `${section(itemAdded, "+", "Added", "cl-add")}
                 ${section(itemChanged, "~", "Changed", "cl-chg")}
                 ${section(itemRemoved, "−", "Removed", "cl-rem")}`;
            return `<div class="cl-history-version"><div class="cl-history-title">v${item.version}</div>${itemBody}</div>`;
          }).join("")}
        </div>
      </details>`;

  return `<div class="ov" id="ov">
  <div class="cl" id="cl">
    <div class="cl-hd">
      <div class="cl-ttl">${title}</div>
      <div class="cl-sub">${esc(monthTitle)} &middot; ${esc(exportDate)}</div>
    </div>
    <div class="cl-body">
      ${body}
      ${historyHtml}
    </div>
    <div class="cl-ft">
      <label class="cl-dsa"><input type="checkbox" id="dsa"><span>Don&#8217;t show again</span></label>
      <button class="cl-ok" id="cl-ok">Okay</button>
    </div>
  </div>
</div>`;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

function getCss(): string {
  return `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:hsl(0,0%,97%);--fg:hsl(220,13%,13%);
  --card:hsl(0,0%,100%);--border:hsl(220,13%,87%);
  --muted:hsl(220,13%,93%);--muted-fg:hsl(220,9%,50%);
  --primary:hsl(221,83%,53%);
  --sim-bg:hsl(214,90%,94%);--sim-fg:hsl(221,83%,38%);
  --insp-bg:hsl(43,95%,90%);--insp-fg:hsl(32,80%,33%);
  --duty-bg:hsl(270,65%,93%);--duty-fg:hsl(270,55%,38%);
  --leave-bg:#4b5563;--leave-fg:#fff;
}
[data-theme="dark"]{
  --bg:hsl(222,13%,11%);--fg:hsl(220,13%,90%);
  --card:hsl(222,13%,16%);--border:hsl(220,13%,24%);
  --muted:hsl(220,13%,21%);--muted-fg:hsl(220,9%,56%);
  --primary:hsl(221,83%,62%);
  --sim-bg:hsl(214,50%,18%);--sim-fg:hsl(221,83%,75%);
  --insp-bg:hsl(43,45%,18%);--insp-fg:hsl(43,80%,68%);
  --duty-bg:hsl(270,35%,20%);--duty-fg:hsl(270,60%,75%);
  --leave-bg:#374151;--leave-fg:#e5e7eb;
}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg);min-height:100vh;display:flex;flex-direction:column;font-size:13px}

/* ── Header ── */
.hdr{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:12px;padding:8px 14px;background:var(--card);border-bottom:1px solid var(--border);flex-shrink:0}
.hdr-title{font-size:14px;font-weight:600}
.hdr-right{display:flex;align-items:center;justify-self:end;gap:8px;flex-wrap:wrap}
.cal-period{display:flex;align-items:center;justify-content:center;gap:8px;min-width:220px}
.cal-period-label{font-size:13px;font-weight:600;text-align:center;white-space:nowrap}
.cal-period-btn{height:26px;min-width:26px;padding:0 4px;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--muted-fg);font-size:20px;font-weight:300;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:color .15s,border-color .15s;flex-shrink:0}
.cal-period-btn:hover{color:var(--fg);border-color:var(--primary)}

/* ── Version badge ── */
.vb{display:inline-block;margin-left:8px;padding:1px 6px;background:var(--muted);border-radius:9px;font-size:10px;font-weight:500;color:var(--muted-fg);vertical-align:middle}

/* ── Filter wrapper / button / panel ── */
.fw{position:relative}
.fb{height:26px;padding:0 10px;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--muted-fg);font-size:12px;cursor:pointer;white-space:nowrap;transition:color .15s,border-color .15s}
.fb:hover,.fb.active{color:var(--fg)}
.fb.active{border-color:var(--primary)}
.bc{display:inline-flex;align-items:center;justify-content:center;background:var(--primary);color:#fff;border-radius:9px;font-size:10px;min-width:15px;height:15px;padding:0 3px;margin:0 2px;vertical-align:middle}
.fp{position:absolute;top:calc(100% + 4px);right:0;background:var(--card);border:1px solid var(--border);border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.14);min-width:160px;max-width:210px;z-index:200}
.fi-list{max-height:200px;overflow-y:auto;padding:4px 0}
.fi{display:flex;align-items:center;gap:7px;padding:5px 11px;cursor:pointer;font-size:12px;user-select:none;white-space:nowrap}
.fi:hover{background:var(--muted)}
.fi input{accent-color:var(--primary);cursor:pointer}
.fi-empty{display:block;padding:6px 11px;font-size:12px;color:var(--muted-fg);font-style:normal}
.ff{border-top:1px solid var(--border);padding:5px 11px}
.fc{background:none;border:none;font-size:11px;color:var(--muted-fg);cursor:pointer;padding:0}
.fc:hover{color:var(--fg)}
.ca{display:inline-flex;align-items:center;height:26px;padding:0 8px;background:none;border:none;font-size:12px;color:var(--muted-fg);cursor:pointer;border-radius:4px}
.ca:hover{color:#dc2626;background:#fef2f2}
.ec{font-size:12px;color:var(--muted-fg);padding-left:8px;border-left:1px solid var(--border)}
.hidden{display:none!important}

/* ── Calendar ── */
.cw{flex:1;overflow-y:auto;padding:12px}
.wd-row{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:3px}
.wd{padding:3px 8px;font-size:11px;font-weight:500;color:var(--muted-fg);text-align:right;text-transform:uppercase;letter-spacing:.04em}
.dg{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:6px;overflow:hidden}
.dc{min-height:110px;padding:5px 5px 4px;display:flex;flex-direction:column;background:var(--card)}
.dc.sh{background:var(--muted)}
.dc.bl{opacity:.45}
.dn{font-size:11px;color:var(--muted-fg);text-align:right;display:flex;align-self:flex-end;margin-bottom:3px}
.dn.dn-ev{font-weight:600;color:var(--fg)}
.hn{font-size:9px;color:var(--muted-fg);line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:2px}
.pills{display:flex;flex-direction:column;gap:2px;flex:1}
.pill{overflow:hidden;border-radius:3px;border:1px solid var(--border);padding:3px 5px;font-size:10px;line-height:1.3;background:var(--card);color:var(--fg);cursor:default;transition:box-shadow .1s}
.pill:hover{box-shadow:0 0 0 1px rgba(99,102,241,.35)}
.lp{background:var(--leave-bg)!important;border-color:rgba(0,0,0,.25)!important;color:var(--leave-fg)!important;font-weight:600}
.ph{display:none}
.pl{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── Tooltip ── */
.tt{position:fixed;z-index:999;pointer-events:none;width:210px;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.15);padding:10px;font-size:12px;display:flex;flex-direction:column;gap:5px}
.th{display:flex;align-items:center;justify-content:space-between;gap:6px}
.bd{padding:2px 6px;border-radius:3px;font-size:10px;font-weight:600}
.bd-sim{background:var(--sim-bg);color:var(--sim-fg)}
.bd-insp{background:var(--insp-bg);color:var(--insp-fg)}
.bd-duty{background:var(--duty-bg);color:var(--duty-fg)}
.bd-leave{background:var(--leave-bg);color:var(--leave-fg)}
.tm{font-size:11px;color:var(--muted-fg);font-variant-numeric:tabular-nums}
.tf{display:flex;flex-direction:column;gap:3px}
.m{color:var(--muted-fg)}
.ti{padding-top:5px;border-top:1px solid var(--border)}
.tp{text-decoration:line-through;color:var(--muted-fg);opacity:.5;font-size:10px;margin-top:2px}

/* ── Changelog overlay + popup ── */
.ov{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:500;display:flex;align-items:center;justify-content:center}
.cl{background:var(--card);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.22);width:340px;max-width:calc(100vw - 32px);max-height:80vh;display:flex;flex-direction:column;overflow:hidden}
.cl-hd{padding:14px 16px 10px;border-bottom:1px solid var(--border);flex-shrink:0}
.cl-ttl{font-size:14px;font-weight:700}
.cl-sub{font-size:11px;color:var(--muted-fg);margin-top:2px}
.cl-body{overflow-y:auto;padding:10px 16px;flex:1;display:flex;flex-direction:column;gap:12px}
.cl-sec{display:flex;flex-direction:column;gap:3px}
.cl-sh{font-size:11px;font-weight:700;padding-bottom:2px}
.cl-add{color:#16a34a}
.cl-chg{color:#d97706}
.cl-rem{color:#dc2626}
.cl-row{padding:6px 0;border-bottom:1px solid var(--border)}
.cl-row:last-child{border-bottom:none}
.cl-lbl{font-size:12px;font-weight:600}
.cl-detail{font-size:11px;color:var(--muted-fg);padding:1px 0 0 8px}
.cl-insp-old{color:#b8b8b8}
.cl-arrow{color:var(--muted-fg);padding:0 2px}
.cl-insp-current{color:#d97706;font-weight:600}
[data-theme="dark"] .cl-insp-current{color:#fbbf24}
.cl-none{font-size:12px;color:var(--muted-fg);font-style:italic;padding:4px 0}
.cl-history{border-top:1px solid var(--border);padding-top:10px;margin-top:2px}
.cl-history summary{font-size:11px;font-weight:600;color:var(--muted-fg);cursor:pointer;user-select:none}
.cl-history summary:hover{color:var(--fg)}
.cl-history-list{display:flex;flex-direction:column;gap:10px;padding-top:10px}
.cl-history-version{border-left:2px solid var(--border);padding-left:9px}
.cl-history-title{font-size:11px;font-weight:700;margin-bottom:4px;color:var(--fg)}
.cl-ft{padding:10px 16px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0}
.cl-dsa{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted-fg);cursor:pointer;user-select:none}
.cl-dsa input{accent-color:var(--primary);cursor:pointer}
.cl-ok{height:28px;padding:0 18px;background:var(--primary);color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;transition:opacity .15s}
.cl-ok:hover{opacity:.85}

/* ── View toggle ── */
.vt{display:flex;align-items:center;gap:2px;background:var(--muted);padding:2px;border-radius:5px}
.vb-btn{height:22px;padding:0 10px;border:none;background:transparent;color:var(--muted-fg);font-size:12px;cursor:pointer;border-radius:3px;transition:background .15s,color .15s;white-space:nowrap}
.vb-btn:hover{color:var(--fg)}
.vb-btn.vb-active{background:var(--card);color:var(--fg);box-shadow:0 1px 2px rgba(0,0,0,.1)}

/* ── Dark mode toggle ── */
.dm-btn{height:26px;width:28px;padding:0;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--muted-fg);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:color .15s,border-color .15s;flex-shrink:0}
.dm-btn:hover{color:var(--fg);border-color:var(--primary)}

/* ── Print button ── */
.pr-btn{height:26px;padding:0 10px;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--muted-fg);font-size:12px;cursor:pointer;white-space:nowrap;transition:color .15s,border-color .15s;flex-shrink:0}
.pr-btn:hover{color:var(--fg);border-color:var(--primary)}
/* ── ICS download button ── */
.ics-btn{height:26px;padding:0 10px;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--muted-fg);font-size:12px;cursor:pointer;white-space:nowrap;transition:color .15s,border-color .15s;flex-shrink:0}
.ics-btn:hover{color:var(--fg);border-color:var(--primary)}

/* ── Week view ── */
.wv-wrap .wd-row{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:3px}
.wv-wrap .dg{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:6px;overflow:hidden}
.wv-wrap .dc{min-height:180px}

/* ── Day view ── */
.dv-wrap{border:1px solid var(--border);border-radius:6px;overflow:hidden}
.dv-hd{padding:10px 14px;background:var(--muted);font-size:14px;font-weight:600;border-bottom:1px solid var(--border)}
.dv-ev{padding:10px 14px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:flex-start}
.dv-ev:last-child{border-bottom:none}
.dv-time{font-size:11px;color:var(--muted-fg);font-variant-numeric:tabular-nums;min-width:88px;flex-shrink:0;padding-top:3px}
.dv-body{flex:1;min-width:0}
.dv-empty{padding:20px 14px;color:var(--muted-fg);font-size:12px;font-style:italic}
.dv-ev.ph{display:none!important}

/* ── Table view ── */
.tv-wrap{border:1px solid var(--border);border-radius:6px;overflow:hidden}
.tv{width:100%;border-collapse:collapse;font-size:12px}
.tv thead tr{background:var(--muted)}
.tv th{padding:6px 10px;text-align:left;font-size:11px;font-weight:600;color:var(--muted-fg);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);white-space:nowrap}
.tv td{padding:6px 10px;border-bottom:1px solid var(--border);vertical-align:middle}
.tv tbody tr:last-child td{border-bottom:none}
.tr-sh td{background:var(--muted)}
.tr-ev:hover td{background:var(--muted);cursor:default}
.tr-empty td,.td-nd{color:var(--muted-fg)}
.td-date{white-space:nowrap;font-size:11px;color:var(--muted-fg);min-width:90px}
.td-time{white-space:nowrap;font-variant-numeric:tabular-nums;font-size:11px;color:var(--muted-fg)}
.td-duty{font-size:12px;font-weight:500}
.td-det{font-size:12px;color:var(--muted-fg)}
.td-insp{color:var(--muted-fg);font-size:11px}
.td-rem{text-decoration:line-through;opacity:.6}
.td-add{color:#16a34a}
[data-theme="dark"] .td-add{color:#4ade80}
/* Date dedup: hide the date text on non-first visible rows per date group */
.tr-ev:not(.td-date-first) .td-date{visibility:hidden}

/* ── Footer ── */
.ft{padding:6px 14px 8px;font-size:11px;color:var(--muted-fg);border-top:1px solid var(--border);background:var(--card);text-align:right;flex-shrink:0}

/* ── Mobile layout ── */
@media(max-width:600px){
  .hdr{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:8px 10px}
  .hdr-right{width:100%;overflow-x:visible;flex-wrap:wrap;gap:6px}
  .cal-period{order:3;width:100%;min-width:0}
  .fp{left:0;right:auto}
  .dg{grid-template-columns:repeat(7,minmax(32px,1fr))}
  .dc{min-height:60px;padding:3px 2px}
  .dn{font-size:10px}
  .pill{font-size:9px;padding:2px 3px}
  .tv{width:auto}
  .tv th,.tv td{padding:4px 6px;font-size:11px}
  .td-duty,.td-det{white-space:normal;word-break:break-word}
}

/* ── Print ── */
@media print{
  @page{size:portrait;margin:1.2cm}
  .hdr,.tt,.ov,.dm-btn,.pr-btn{display:none!important}
  .cw{padding:0;overflow:visible}
  body{font-size:11px;background:#fff;color:#000}
  .tv-wrap{border:none;border-radius:0}
  .tv{font-size:11px}
  .tv th,.tv td{padding:4px 7px}
  .tv thead tr{background:#f3f4f6!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .tr-sh td{background:#f9fafb!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .bd{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .tr-ev:not(.td-date-first) .td-date{visibility:hidden}
  .ft{border-top:1px solid #e5e7eb;background:#fff;color:#6b7280;padding:4px 0;text-align:right}
}
`;
}

// ─── Embedded JS ─────────────────────────────────────────────────────────────

function getJs(
  payload: string,
  exportId: string,
  preGrid: string,
  preTable: string,
): string {
  // Escape HTML strings for safe embedding as JS string literals inside a <script> block.
  const ej = (s: string) =>
    JSON.stringify(s)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");

  return `
(function(){
"use strict";
// Pre-rendered HTML — page is fully readable without JS (iOS Quick Look, offline viewers).
var PRE_GRID=${ej(preGrid)};
var PRE_TABLE=${ej(preTable)};
var D=${payload};
var filterOps=new Set(), filterInsp=new Set();
var ttEl=document.getElementById('tt');
var ttVisible=false;
var currentView='calendar';
var calSubView='month';
var navDate=new Date(D.year,D.month-1,1);
try{var _sv=localStorage.getItem('roster-view');if(_sv==='week'||_sv==='day')calSubView=_sv;}catch(e){}

// Lookup maps built from data
var evMap={};
for(var i=0;i<D.events.length;i++){var e=D.events[i];evMap[e.id]=e;}

var evOps={}, evInsp={};
for(var i=0;i<D.events.length;i++){
  var e=D.events[i];
  evOps[e.id]=e.eventType==='Leave'?[]:e.eventType==='Other Duties'?(e.operators||[]):[e.operator];
  evInsp[e.id]=e.inspectors||[];
}

function eh(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function leaveShift(ev){
  var re=/^([01]\\d|2[0-3]):[0-5]\\d$/;
  var s=ev.startTime||'',e=ev.endTime||'';
  if(!re.test(s)||!re.test(e))return '';
  if(s==='00:00'&&e==='23:59')return '';
  if(e<='12:00'&&s<'12:00')return ' (AM)';
  if(s>='12:00')return ' (PM)';
  return '';
}

// ── Sub-view helpers ─────────────────────────────────────────────────────────
function pad2(n){return n<10?'0'+n:String(n);}
function dKey(d){return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());}
function addDays(d,n){var r=new Date(d.getTime());r.setDate(r.getDate()+n);return r;}
function weekStart(d){var r=new Date(d.getTime());r.setDate(r.getDate()-r.getDay());return r;}
function dateLabel(d){var WD=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],MN=['January','February','March','April','May','June','July','August','September','October','November','December'];return WD[d.getDay()]+', '+d.getDate()+' '+MN[d.getMonth()]+' '+d.getFullYear();}
function weekLabel(startD){var endD=addDays(startD,6),SM=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];if(startD.getFullYear()===endD.getFullYear()&&startD.getMonth()===endD.getMonth())return startD.getDate()+'–'+endD.getDate()+' '+SM[endD.getMonth()]+' '+endD.getFullYear();if(startD.getFullYear()===endD.getFullYear())return startD.getDate()+' '+SM[startD.getMonth()]+' – '+endD.getDate()+' '+SM[endD.getMonth()]+' '+endD.getFullYear();return startD.getDate()+' '+SM[startD.getMonth()]+' '+startD.getFullYear()+' – '+endD.getDate()+' '+SM[endD.getMonth()]+' '+endD.getFullYear();}
function updateCalendarPeriod(){
  var label=document.getElementById('cal-period-label');
  var prev=document.getElementById('cal-period-prev');
  var next=document.getElementById('cal-period-next');
  var isMonth=calSubView==='month';
  if(isMonth)label.textContent=D.monthStr;
  else if(calSubView==='week')label.textContent=weekLabel(weekStart(navDate));
  else label.textContent=dateLabel(navDate);
  prev.classList.toggle('hidden',isMonth);
  next.classList.toggle('hidden',isMonth);
}
 function evTypeOrder(ev){return ev.eventType==='Simulator'?0:ev.eventType==='Surveillance'?1:ev.eventType==='Other Duties'&&ev.subType==='Flying'?3:ev.eventType==='Other Duties'?2:4;}
function evHexToRgb(h){var m=h&&h.match(/^#?([a-f\\d]{2})([a-f\\d]{2})([a-f\\d]{2})$/i);if(!m)return null;return[parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16)];}
function evPillStyle(hex){if(!hex)return '';var rgb=evHexToRgb(hex);if(!rgb)return '';return 'background:rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0.13);border-color:rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',0.45);color:'+hex+';';}
function evOpColor(ev){if(ev.eventType==='Simulator'||ev.eventType==='Surveillance')return (D.operatorColors&&D.operatorColors[ev.operator])||'';if(ev.eventType==='Other Duties'){if(typeof ev.customColor==='string'&&/^#[0-9a-f]{6}$/i.test(ev.customColor))return ev.customColor;var ops=ev.operators||[];return (ops[0]&&D.operatorColors&&D.operatorColors[ops[0]])||'';}return '';}
function evLeaveShift(ev){var re=/^([01]\\d|2[0-3]):[0-5]\\d$/;var s=ev.startTime||'',e=ev.endTime||'';if(!re.test(s)||!re.test(e))return '';if(s==='00:00'&&e==='23:59')return '';if(e<='12:00'&&s<'12:00')return 'AM';if(s>='12:00')return 'PM';return '';}
function evPillContent(ev){
  var fn=function(n){return n.split(' ')[0];};
  if(ev.eventType==='Leave'){var names=(ev.inspectors||[]).map(fn).join(', ');var shift=evLeaveShift(ev);return '<span class="pl">'+eh(names+' '+(ev.leaveType||'')+(shift?' '+shift:''))+'</span>';}
  var names=(ev.inspectors||[]).map(fn).join(', ');
  var op=ev.eventType==='Other Duties'?(ev.operators||[]).filter(function(o){return o&&o.toLowerCase()!=='n/a';}).join('/'):(ev.operator||'');
  var detail=ev.eventType==='Simulator'?(ev.activity||''):ev.eventType==='Surveillance'?(((ev.surveillanceTypes||[]).join(', '))+' surveillance'):ev.eventType==='Other Duties'?(ev.subType||''):'';
  var shift=ev.eventType==='Other Duties'?evLeaveShift(ev):'';
  var s=ev.startTime||'',e=ev.endTime||'';
  var time=!shift&&s&&!(s==='00:00'&&e==='23:59')?(s+'\u2013'+e):'';
  var parts=[names,op,detail,shift?'('+shift+')':time].filter(Boolean);
  return '<span class="pl">'+eh(parts.join(' '))+'</span>';
}

function tooltipHtml(ev){
  var bt={Simulator:'sim',Surveillance:'insp','Other Duties':'duty',Leave:'leave'}[ev.eventType]||'leave';
  var f='';
  if(ev.eventType==='Simulator'){
    f='<div><span class="m">Code: </span>'+eh(ev.simulatorCode)+' &middot; '+eh(ev.aircraftType)+'</div>'
     +'<div><span class="m">Activity: </span>'+eh(ev.activity)+'</div>'
     +'<div><span class="m">Operator: </span>'+eh(ev.operator)+'</div>'
     +'<div><span class="m">Candidate: </span>'+eh(ev.candidateName)+'</div>';
  }else if(ev.eventType==='Surveillance'){
    var st=(ev.surveillanceTypes||[]).join(', ');
    f='<div><span class="m">Operator: </span>'+eh(ev.operator)+'</div>'
     +'<div><span class="m">Type: </span>'+eh(st)+'</div>'
     +(ev.details?'<div><span class="m">Details: </span>'+eh(ev.details)+'</div>':'');
  }else if(ev.eventType==='Other Duties'){
    var ops=(ev.operators||[]).join(', ');
    f=(ops?'<div><span class="m">Operator: </span>'+eh(ops)+'</div>':'')
     +'<div><span class="m">Type: </span>'+eh(ev.subType)+eh(leaveShift(ev))+'</div>'
     +(ev.remarks?'<div><span class="m">Remarks: </span>'+eh(ev.remarks)+'</div>':'');
  }else{
    f='<div><span class="m">Leave: </span>'+eh(ev.leaveType+leaveShift(ev))+'</div>';
  }
  var insp=(ev.inspectors||[]).map(function(n){return n.split(' ')[0];}).join(', ');
  var prev=ev.previousInspectors?'<div class="tp">'+eh(ev.previousInspectors.map(function(n){return n.split(' ')[0];}).join(', '))+'</div>':'';
  return '<div class="th"><span class="bd bd-'+bt+'">'+eh(ev.eventType)+'</span>'
    +'<span class="tm">'+eh(ev.startTime)+'&ndash;'+eh(ev.endTime)+'</span></div>'
    +'<div class="tf">'+f+'</div>'
    +'<div class="ti"><span class="m">'+eh(insp)+'</span>'+prev+'</div>';
}

function renderView(v){
  currentView=v;
  document.getElementById('cal-btn').classList.toggle('vb-active',v==='calendar');
  document.getElementById('tbl-btn').classList.toggle('vb-active',v==='table');
  document.getElementById('pr-btn').classList.toggle('hidden',v!=='table');
  document.getElementById('cv-sub').classList.toggle('hidden',v!=='calendar');
  document.getElementById('calendar-period').classList.toggle('hidden',v!=='calendar');
  if(v==='calendar'){
    renderCalSub();
  }else{
    document.getElementById('wr').innerHTML=PRE_TABLE;
    applyFilter();
  }
}

function renderCalSub(){
  var s=calSubView;
  document.getElementById('mv-btn').classList.toggle('vb-active',s==='month');
  document.getElementById('wv-btn').classList.toggle('vb-active',s==='week');
  document.getElementById('dv-btn').classList.toggle('vb-active',s==='day');
  updateCalendarPeriod();
  if(s==='month'){
    document.getElementById('wr').innerHTML=PRE_GRID;
  }else if(s==='week'){
    document.getElementById('wr').innerHTML=renderWeekView(weekStart(navDate));
  }else{
    document.getElementById('wr').innerHTML=renderDayView(navDate);
  }
  try{localStorage.setItem('roster-view',s);}catch(e){}
  applyFilter();
}

function renderWeekView(startD){
  var WD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var h='<div class="wv-wrap"><div class="wd-row">';
  for(var i=0;i<7;i++)h+='<div class="wd">'+WD[i]+'</div>';
  h+='</div><div class="dg">';
  for(var i=0;i<7;i++){
    var d=addDays(startD,i);
    var dk=dKey(d);
    var dayNum=d.getDate();
    var col=d.getDay();
    var isSh=col===0||col===6||(D.holidays&&!!D.holidays[dk]);
    var dayEvs=[];
    for(var j=0;j<D.events.length;j++){if(D.events[j].date===dk)dayEvs.push(D.events[j]);}
     dayEvs.sort(function(a,b){return evTypeOrder(a)-evTypeOrder(b)||(a.startTime<b.startTime?-1:a.startTime>b.startTime?1:0);});
    h+='<div class="dc'+(isSh?' sh':'')+'">';
    var dnClass='dn'+(dayEvs.length>0?' dn-ev':'');
    h+='<span class="'+dnClass+'">'+dayNum+'</span>';
    if(D.holidays&&D.holidays[dk]&&!(col===0||col===6))h+='<span class="hn" title="'+eh(D.holidays[dk])+'">'+eh(D.holidays[dk])+'</span>';
    h+='<div class="pills">';
    for(var j=0;j<dayEvs.length;j++){
      var ev=dayEvs[j];
      var isLeave=ev.eventType==='Leave';
      var oc=evOpColor(ev);
      var st=isLeave?'':evPillStyle(oc);
      h+='<div class="pill'+(isLeave?' lp':'')+'" style="'+eh(st)+'" data-id="'+eh(ev.id)+'">'+evPillContent(ev)+'</div>';
    }
    h+='</div></div>';
  }
  h+='</div></div>';
  return h;
}

function renderDayView(d){
  var WD_FULL=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var dk=dKey(d);
  var dayEvs=[];
  for(var j=0;j<D.events.length;j++){if(D.events[j].date===dk)dayEvs.push(D.events[j]);}
   dayEvs.sort(function(a,b){return evTypeOrder(a)-evTypeOrder(b)||(a.startTime<b.startTime?-1:a.startTime>b.startTime?1:0);});
  var label=WD_FULL[d.getDay()]+', '+d.getDate()+' '+MN[d.getMonth()]+' '+d.getFullYear();
  var h='<div class="dv-wrap"><div class="dv-hd">'+eh(label)+'</div>';
  if(dayEvs.length===0){
    h+='<div class="dv-empty">No events this day.</div>';
  }else{
    for(var j=0;j<dayEvs.length;j++){
      var ev=dayEvs[j];
      var isLeave=ev.eventType==='Leave';
      var oc=evOpColor(ev);
      var st=isLeave?'':evPillStyle(oc);
      var ts=(ev.startTime||'')+(ev.endTime?'\u2013'+ev.endTime:'');
      h+='<div class="dv-ev" data-id="'+eh(ev.id)+'">'
        +'<div class="dv-time">'+eh(ts)+'</div>'
        +'<div class="dv-body"><div class="pill'+(isLeave?' lp':'')+'" style="'+eh(st)+'" data-id="'+eh(ev.id)+'">'+evPillContent(ev)+'</div>'
        +'</div></div>';
    }
  }
  h+='</div>';
  return h;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function hideTooltip(){ttEl.classList.add('hidden');ttVisible=false;}

function hoverTarget(e){
  if(!e.target||!e.target.closest)return null;
  var p=e.target.closest('.pill[data-id]');
  if(p)return p;
  if(currentView==='table')return e.target.closest('.tr-ev[data-id]');
  return null;
}

document.addEventListener('mouseover',function(e){
  var tgt=hoverTarget(e);
  if(!tgt){
    if(!e.target.closest||!e.target.closest('#tt'))hideTooltip();
    return;
  }
  var ev=evMap[tgt.dataset.id];
  if(!ev)return;
  ttEl.innerHTML=tooltipHtml(ev);
  ttEl.classList.remove('hidden');
  ttVisible=true;
});

document.addEventListener('mouseout',function(e){
  var tgt=hoverTarget(e);
  if(tgt&&!(e.relatedTarget&&tgt.contains(e.relatedTarget)))hideTooltip();
});

document.addEventListener('mousemove',function(e){
  if(!ttVisible)return;
  var fl=e.clientX>window.innerWidth-230;
  var fu=e.clientY>window.innerHeight-200;
  ttEl.style.left=(fl?e.clientX-14:e.clientX+14)+'px';
  ttEl.style.top=(fu?e.clientY-8:e.clientY+8)+'px';
  ttEl.style.transform='translate('+(fl?'-100%':'0')+','+(fu?'-100%':'0')+')';
});

document.addEventListener('scroll',function(){hideTooltip();},{passive:true});

// Touch tooltip — tap to show, tap same again or tap outside to hide
document.addEventListener('pointerup',function(e){
  if(e.pointerType!=='touch')return;
  var tgt=hoverTarget(e);
  if(tgt){
    var ev=evMap[tgt.dataset.id];
    if(!ev)return;
    // Toggle off if already showing this event
    if(ttVisible&&ttEl.dataset.ttId===tgt.dataset.id){hideTooltip();return;}
    ttEl.innerHTML=tooltipHtml(ev);
    ttEl.dataset.ttId=tgt.dataset.id;
    // Position below the tapped element, clamped to viewport
    var r=tgt.getBoundingClientRect();
    var left=r.left;
    var top=r.bottom+6;
    if(left+220>window.innerWidth)left=window.innerWidth-224;
    if(top+210>window.innerHeight)top=r.top-216;
    ttEl.style.left=Math.max(4,left)+'px';
    ttEl.style.top=Math.max(4,top)+'px';
    ttEl.style.transform='none';
    ttEl.classList.remove('hidden');
    ttVisible=true;
  }else if(!e.target.closest||!e.target.closest('#tt')){
    hideTooltip();
  }
});

// ── Filter logic ──────────────────────────────────────────────────────────────
function matchesPill(id){
  var ops=evOps[id]||[];
  var insp=evInsp[id]||[];
  if(filterOps.size>0){
    if(ops.length===0)return false;
    var ok=false;
    for(var i=0;i<ops.length;i++){if(filterOps.has(ops[i])){ok=true;break;}}
    if(!ok)return false;
  }
  if(filterInsp.size>0){
    var ok2=false;
    for(var i=0;i<insp.length;i++){if(filterInsp.has(insp[i].split(' ')[0])){ok2=true;break;}}
    if(!ok2)return false;
  }
  return true;
}

function applyFilter(){
  if(currentView==='calendar'){
    var pills=document.querySelectorAll('.pill[data-id]');
    for(var i=0;i<pills.length;i++){pills[i].classList.toggle('ph',!matchesPill(pills[i].dataset.id));}
    // Day view: also hide the whole row when its event is filtered out
    if(calSubView==='day'){
      var dvEvs=document.querySelectorAll('.dv-ev[data-id]');
      for(var i=0;i<dvEvs.length;i++){dvEvs[i].classList.toggle('ph',!matchesPill(dvEvs[i].dataset.id));}
    }
  }else{
    var rows=document.querySelectorAll('.tr-ev[data-id]');
    for(var i=0;i<rows.length;i++){rows[i].classList.toggle('ph',!matchesPill(rows[i].dataset.id));}
    // For each day that has events: show placeholder iff all its event rows are hidden
    var placeholders=document.querySelectorAll('.tr-placeholder[data-date]');
    for(var j=0;j<placeholders.length;j++){
      var dk=placeholders[j].dataset.date;
      var evRows=document.querySelectorAll('.tr-ev[data-date="'+dk+'"]');
      var allHidden=evRows.length>0;
      for(var k=0;k<evRows.length;k++){if(!evRows[k].classList.contains('ph')){allHidden=false;break;}}
      placeholders[j].classList.toggle('ph',!allHidden);
    }
    // Recompute which event row shows the date label per date group.
    // Always show it on the first *visible* row; hide it (via CSS) on subsequent ones.
    var allEvRows=document.querySelectorAll('.tr-ev[data-date]');
    var seenDate={};
    for(var i=0;i<allEvRows.length;i++){
      var r=allEvRows[i];
      var dk2=r.dataset.date;
      var isHidden=r.classList.contains('ph');
      if(!isHidden&&!seenDate[dk2]){
        r.classList.add('td-date-first');
        seenDate[dk2]=true;
      }else{
        r.classList.remove('td-date-first');
      }
    }
  }
  updateCount();
}

function updateCount(){
  var sel=currentView==='calendar'?'.pill[data-id]':'.tr-ev[data-id]';
  var tot=document.querySelectorAll(sel).length;
  var vis=document.querySelectorAll(sel+':not(.ph)').length;
  var any=filterOps.size>0||filterInsp.size>0;
  document.getElementById('ec').textContent=vis+(vis===1?' event':' events')+(any&&vis<tot?' (filtered)':'');
  document.getElementById('ca').classList.toggle('hidden',!any);
}

function updateBtn(type){
  var cnt=type==='op'?filterOps.size:filterInsp.size;
  var btn=document.getElementById(type+'-btn');
  var lbl=type==='op'?'Operator':'Inspector';
  btn.innerHTML=cnt>0?lbl+' <span class="bc">'+cnt+'</span> &#9660;':lbl+' &#9660;';
  btn.classList.toggle('active',cnt>0);
}

// Wire checkboxes (built server-side in HTML)
var ocBoxes=document.querySelectorAll('.oc');
for(var i=0;i<ocBoxes.length;i++){
  ocBoxes[i].addEventListener('change',function(){
    if(this.checked)filterOps.add(this.value);else filterOps.delete(this.value);
    updateBtn('op');applyFilter();
  });
}
var icBoxes=document.querySelectorAll('.ic');
for(var i=0;i<icBoxes.length;i++){
  icBoxes[i].addEventListener('change',function(){
    if(this.checked)filterInsp.add(this.value);else filterInsp.delete(this.value);
    updateBtn('insp');applyFilter();
  });
}

// Panel toggle
var opPanel=document.getElementById('op-panel');
var inPanel=document.getElementById('insp-panel');
var opBtn=document.getElementById('op-btn');
var inBtn=document.getElementById('insp-btn');
// Stop pointerdown on buttons so the document dismiss handler doesn't fire first
opBtn.addEventListener('pointerdown',function(e){e.stopPropagation();});
inBtn.addEventListener('pointerdown',function(e){e.stopPropagation();});
opBtn.addEventListener('click',function(e){
  e.stopPropagation();
  opPanel.classList.toggle('hidden');
  inPanel.classList.add('hidden');
});
inBtn.addEventListener('click',function(e){
  e.stopPropagation();
  inPanel.classList.toggle('hidden');
  opPanel.classList.add('hidden');
});
// pointerdown works reliably on iOS WebKit; click does not fire on non-interactive bg elements
document.addEventListener('pointerdown',function(){
  opPanel.classList.add('hidden');
  inPanel.classList.add('hidden');
});
opPanel.addEventListener('pointerdown',function(e){e.stopPropagation();});
inPanel.addEventListener('pointerdown',function(e){e.stopPropagation();});

// Clear buttons
document.getElementById('op-clear').addEventListener('click',function(){
  filterOps.clear();
  for(var i=0;i<ocBoxes.length;i++)ocBoxes[i].checked=false;
  updateBtn('op');applyFilter();
});
document.getElementById('insp-clear').addEventListener('click',function(){
  filterInsp.clear();
  for(var i=0;i<icBoxes.length;i++)icBoxes[i].checked=false;
  updateBtn('insp');applyFilter();
});
document.getElementById('ca').addEventListener('click',function(){
  filterOps.clear();filterInsp.clear();
  for(var i=0;i<ocBoxes.length;i++)ocBoxes[i].checked=false;
  for(var i=0;i<icBoxes.length;i++)icBoxes[i].checked=false;
  updateBtn('op');updateBtn('insp');applyFilter();
});

// View toggle
document.getElementById('cal-btn').addEventListener('click',function(){renderView('calendar');});
document.getElementById('tbl-btn').addEventListener('click',function(){renderView('table');});

// Sub-view toggle (Month / Week / Day)
document.getElementById('mv-btn').addEventListener('click',function(){calSubView='month';renderCalSub();});
document.getElementById('wv-btn').addEventListener('click',function(){calSubView='week';renderCalSub();});
document.getElementById('dv-btn').addEventListener('click',function(){calSubView='day';renderCalSub();});
document.getElementById('cal-period-prev').addEventListener('click',function(){
  if(calSubView==='week')navDate=addDays(weekStart(navDate),-7);
  else if(calSubView==='day')navDate=addDays(navDate,-1);
  renderCalSub();
});
document.getElementById('cal-period-next').addEventListener('click',function(){
  if(calSubView==='week')navDate=addDays(weekStart(navDate),7);
  else if(calSubView==='day')navDate=addDays(navDate,1);
  renderCalSub();
});

// Dark mode toggle
var dmBtn=document.getElementById('dm-btn');
dmBtn.textContent=document.documentElement.getAttribute('data-theme')==='dark'?'\u2600\uFE0F':'\uD83C\uDF19';
dmBtn.addEventListener('click',function(){
  var isDark=document.documentElement.getAttribute('data-theme')==='dark';
  if(isDark){document.documentElement.removeAttribute('data-theme');dmBtn.textContent='\uD83C\uDF19';}
  else{document.documentElement.setAttribute('data-theme','dark');dmBtn.textContent='\u2600\uFE0F';}
  try{localStorage.setItem('roster-theme',isDark?'light':'dark');}catch(e){}
});

// Print button
document.getElementById('pr-btn').addEventListener('click',function(){window.print();});

// ICS download button — generates a self-contained .ics file from the embedded event data
(function(){
  function icsEsc(s){return String(s==null?'':s).replace(/\\\\/g,'\\\\\\\\').replace(/;/g,'\\\\;').replace(/,/g,'\\\\,').replace(/\\r\\n/g,'\\\\n').replace(/\\r/g,'\\\\n').replace(/\\n/g,'\\\\n');}
  function icsFold(line){var enc=new TextEncoder();if(enc.encode(line).length<=75)return line;var segs=[],seg='',sb=0,lim=75;for(var i=0;i<line.length;){var cp=line.codePointAt(i);var ch=String.fromCodePoint(cp);var cb=enc.encode(ch).length;if(sb+cb>lim){segs.push(seg);seg=ch;sb=cb;lim=74;}else{seg+=ch;sb+=cb;}i+=ch.length;}if(seg)segs.push(seg);return segs[0]+segs.slice(1).map(function(s){return '\\r\\n '+s;}).join('');}
  function icsDtStamp(){var n=new Date(),p=function(x){return String(x).padStart(2,'0');};return n.getUTCFullYear()+p(n.getUTCMonth()+1)+p(n.getUTCDate())+'T'+p(n.getUTCHours())+p(n.getUTCMinutes())+p(n.getUTCSeconds())+'Z';}
  function icsNextDate(ds){var p=ds.split('-').map(Number),nx=new Date(Date.UTC(p[0],p[1]-1,p[2]+1));return nx.getUTCFullYear()+(nx.getUTCMonth()+1<10?'0':'')+(nx.getUTCMonth()+1)+(nx.getUTCDate()<10?'0':'')+nx.getUTCDate();}
  function icsDt(date,time){return date.replace(/-/g,'')+'-T'+time.replace(':','')+'00';}
  function icsSum(ev){if(ev.eventType==='Simulator')return 'Simulator \\u2013 '+(ev.operator||'')+' '+(ev.activity||'');if(ev.eventType==='Surveillance')return 'Surveillance \\u2013 '+(ev.operator||'')+' '+((ev.surveillanceTypes||[]).join(', '));if(ev.eventType==='Other Duties')return 'Other Duties \\u2013 '+(ev.subType||'');return 'Leave \\u2013 '+(ev.leaveType||'');}
  function icsFn(n){return (n||'').split(' ')[0];}
  function icsDesc(ev){var p=[];var ns=(ev.inspectors||[]).map(icsFn).join(', ');if(ns)p.push('Inspectors: '+icsEsc(ns));if(ev.eventType==='Simulator'){if(ev.simulatorCode)p.push('Code: '+icsEsc(ev.simulatorCode));if(ev.candidateName)p.push('Candidate: '+icsEsc(ev.candidateName));}else if(ev.eventType==='Surveillance'){if(ev.details)p.push('Details: '+icsEsc(ev.details));}else if(ev.eventType==='Other Duties'){var ops=(ev.operators||[]).join(', ');if(ops)p.push('Operator: '+icsEsc(ops));if(ev.remarks)p.push('Remarks: '+icsEsc(ev.remarks));}return p.join('\\\\n');}
  function icsVEvent(ev){var allDay=!ev.startTime||(ev.startTime==='00:00'&&(!ev.endTime||ev.endTime==='23:59'));var ds,de;if(allDay){ds='DTSTART;VALUE=DATE:'+ev.date.replace(/-/g,'');de='DTEND;VALUE=DATE:'+icsNextDate(ev.date);}else{ds='DTSTART:'+ev.date.replace(/-/g,'')+'T'+ev.startTime.replace(':','')+'00';de='DTEND:'+ev.date.replace(/-/g,'')+'T'+(ev.endTime||ev.startTime).replace(':','')+'00';}var desc=icsDesc(ev);var lines=['BEGIN:VEVENT',icsFold('DTSTAMP:'+icsDtStamp()),icsFold(ds),icsFold(de),icsFold('SUMMARY:'+icsEsc(icsSum(ev).trim()))];if(desc)lines.push(icsFold('DESCRIPTION:'+desc));lines.push(icsFold('UID:'+icsEsc(ev.id)+'@roster-manager'));lines.push('END:VEVENT');return lines.join('\\r\\n');}
  document.getElementById('ics-btn').addEventListener('click',function(){
    var evs=D.events||[];
    var body=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Roster Manager//Roster Export//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'].concat(evs.map(icsVEvent)).concat(['END:VCALENDAR']).join('\\r\\n')+'\\r\\n';
    var blob=new Blob([body],{type:'text/calendar;charset=utf-8'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url;a.download='roster-'+(D.monthStr||'export')+'.ics';
    document.body.appendChild(a);a.click();
    setTimeout(function(){URL.revokeObjectURL(url);a.remove();},1000);
  });
})();

// Initial render — show sub-view toggle (default is calendar) and restore saved sub-view
document.getElementById('cv-sub').classList.remove('hidden');
renderCalSub();

// ── Changelog popup ───────────────────────────────────────────────────────────
(function(){
  var ov=document.getElementById('ov');
  if(!ov)return;
  var eid=${jsStr(exportId)};
  if(!eid){ov.style.display='none';return;}
  var seenKey='seen-'+eid;
  try{if(localStorage.getItem(seenKey)){ov.style.display='none';return;}}catch(e){}
  var dsa=document.getElementById('dsa');
  var okBtn=document.getElementById('cl-ok');
  if(okBtn){
    okBtn.addEventListener('click',function(){
      if(dsa&&dsa.checked){try{localStorage.setItem(seenKey,'1');}catch(e){}}
      ov.style.display='none';
    });
  }
})();

})();
`;
}
