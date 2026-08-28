import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
} from "docx";
import {
  RosterEvent,
  EventHistoryField,
  EventHistoryValue,
  EVENT_HISTORY_FIELDS,
  EVENT_HISTORY_LABELS,
  getEventPreviousValue,
  hasEventFieldHistory,
} from "@/store/rosterStore";
import { getHKHolidays } from "@/utils/holidays";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FONT = "Calibri";
const WEEKEND_HOLIDAY_SHADING = {
  type: ShadingType.CLEAR,
  color: "auto",
  fill: "FFD9B0", // light orange
};

/** "HH:MM" → "HHMM"; passes through values already without a colon. */
function fmtTime(t: string): string {
  return t.replace(":", "");
}

/** "(HHMM - HHMM)" suffix, or empty string if either time is missing. */
function timeSuffix(start: string, end: string): string {
  const s = fmtTime(start);
  const e = fmtTime(end);
  return s && e ? ` (${s} - ${e})` : "";
}

/** Inspector names → "ROBIN/STEVE" (first names only, uppercased) */
function fmtInspectors(names: string[]): string {
  return names.map((n) => n.split(" ")[0].toUpperCase()).join("/");
}

/** Strip leading '#' from a hex color for docx TextRun (expects hex without #). */
function docxColor(hex: string): string {
  return hex.replace(/^#/, "");
}

const FONT_SIZE = 16; // 8 pt (half-points)

/**
 * Returns a paragraph of the previous inspector names rendered with strikethrough
 * in grey, or null when the event has no inspector change recorded.
 */
function prevInspectorParagraph(event: RosterEvent): Paragraph | null {
  if (!hasEventFieldHistory(event, "inspectors")) return null;
  const previous = getEventPreviousValue(event, "inspectors").value;
  const names = Array.isArray(previous) ? fmtInspectors(previous) : "NONE";
  return new Paragraph({
    children: [
      new TextRun({
        text: names || "NONE",
        font: FONT,
        size: FONT_SIZE,
        strike: true,
        color: "888888",
      }),
    ],
  });
}

function wordHistoryValue(
  field: EventHistoryField,
  value: EventHistoryValue,
): string {
  if (value === null) return "Not set";
  if (Array.isArray(value)) return value.join(", ") || "None";
  if (field === "date") {
    const [year, month, day] = value.split("-");
    return year && month && day ? `${day}-${month}-${year}` : value;
  }
  if (field === "startTime" || field === "endTime") return fmtTime(value);
  return value;
}

/** Previous values for fields other than the dedicated time/inspector lines. */
function previousFieldParagraphs(event: RosterEvent): Paragraph[] {
  return EVENT_HISTORY_FIELDS.filter(
    (field) =>
      field !== "inspectors" && field !== "startTime" && field !== "endTime",
  )
    .filter((field) => hasEventFieldHistory(event, field))
    .map((field) => {
      const previous = getEventPreviousValue(event, field).value;
      return new Paragraph({
        children: [
          new TextRun({
            text: `${EVENT_HISTORY_LABELS[field]}: ${wordHistoryValue(field, previous)}`,
            font: FONT,
            size: FONT_SIZE,
            strike: true,
            color: "888888",
          }),
        ],
      });
    });
}

/**
 * Returns a paragraph of the immediately previous event time rendered with
 * strikethrough in grey, or null when no time change is recorded.
 */
function prevTimeParagraph(event: RosterEvent): Paragraph | null {
  const previousStart = getEventPreviousValue(event, "startTime");
  const previousEnd = getEventPreviousValue(event, "endTime");
  if (
    !previousStart.hasPrevious ||
    !previousEnd.hasPrevious ||
    !hasEventFieldHistory(event, "startTime") &&
      !hasEventFieldHistory(event, "endTime")
  ) return null;
  const currentIsAllDay =
    fmtTime(event.startTime) === "0000" &&
    fmtTime(event.endTime) === "2359";
  if (
    currentIsAllDay &&
    (event.eventType === "Other Duties" ||
      event.eventType === "Surveillance" ||
      event.eventType === "Leave")
  ) {
    return null;
  }
  return new Paragraph({
    children: [
      new TextRun({
        text: timeSuffix(
          String(previousStart.value ?? ""),
          String(previousEnd.value ?? ""),
        ).trim(),
        font: FONT,
        size: FONT_SIZE,
        strike: true,
        color: "888888",
      }),
    ],
  });
}

function previousTimeFieldParagraphs(event: RosterEvent): Paragraph[] {
  const previousStart = getEventPreviousValue(event, "startTime");
  const previousEnd = getEventPreviousValue(event, "endTime");
  if (previousStart.hasPrevious && previousEnd.hasPrevious) return [];
  return (["startTime", "endTime"] as const)
    .filter((field) => hasEventFieldHistory(event, field))
    .map((field) => {
      const previous = getEventPreviousValue(event, field).value;
      return new Paragraph({
        children: [
          new TextRun({
            text: `${EVENT_HISTORY_LABELS[field]}: ${wordHistoryValue(field, previous)}`,
            font: FONT,
            size: FONT_SIZE,
            strike: true,
            color: "888888",
          }),
        ],
      });
    });
}

/** Build the paragraphs for one event, per the corporate format. */
function eventParagraphs(
  event: RosterEvent,
  operatorColors: Record<string, string>,
  otherDutiesColors: Record<string, string>,
): Paragraph[] {
  const inspectors = fmtInspectors(event.inspectors);
  // Operator color — for Other Duties use first operator in array; others use single operator field
  const _primaryOp =
    event.eventType === "Other Duties"
      ? (event.operators ?? []).find((operator) => operatorColors[operator]) ?? ""
      : event.eventType !== "Leave"
        ? event.operator
        : "";
  const opHex =
    _primaryOp && operatorColors[_primaryOp]
      ? docxColor(operatorColors[_primaryOp])
      : event.eventType === "Other Duties" &&
          event.customColor &&
          /^#[0-9a-f]{6}$/i.test(event.customColor)
        ? docxColor(event.customColor)
        : event.eventType === "Other Duties" &&
            otherDutiesColors[event.subType]
          ? docxColor(otherDutiesColors[event.subType])
          : undefined;

  if (event.eventType === "Operator Request") {
    const codes = event.simulatorCodes?.join(", ") ?? event.simulatorCode;
    const line1 = `${event.operator} ${codes} ${event.aircraftType} ${(event.candidateName ?? "").toUpperCase()}${timeSuffix(event.startTime, event.endTime)}`;
    const paras: Paragraph[] = [
      new Paragraph({
        children: [
          new TextRun({
            text: line1,
            font: FONT,
            size: FONT_SIZE,
            color: opHex,
            underline: { type: UnderlineType.SINGLE },
          }),
        ],
      }),
      // Activity is red; inspector name stays black
      new Paragraph({
        children: [
          new TextRun({
            text: event.activity,
            font: FONT,
            size: FONT_SIZE,
            color: "FF0000",
          }),
          new TextRun({
            text: ` \u2013 ${inspectors}`,
            font: FONT,
            size: FONT_SIZE,
          }),
        ],
      }),
    ];
    const prevTime = prevTimeParagraph(event);
    if (prevTime) paras.push(prevTime);
    paras.push(...previousTimeFieldParagraphs(event));
    const prev = prevInspectorParagraph(event);
    if (prev) paras.push(prev);
    paras.push(...previousFieldParagraphs(event));
    return paras;
  }

  if (event.eventType === "Other Duties") {
    const opStr = (event.operators ?? [])
      .filter((op) => op && op.toLowerCase() !== "n/a")
      .join("/");
    const isAllDay =
      fmtTime(event.startTime) === "0000" && fmtTime(event.endTime) === "2359";
    const line1 = isAllDay
      ? `${opStr} ${event.subType}`.trim()
      : `${opStr} ${event.subType}${timeSuffix(event.startTime, event.endTime)}`.trim();
    const paras: Paragraph[] = [
      new Paragraph({
        children: [
          new TextRun({
            text: line1,
            font: FONT,
            size: FONT_SIZE,
            color: opHex,
            underline: { type: UnderlineType.SINGLE },
          }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: inspectors, font: FONT, size: FONT_SIZE }),
        ],
      }),
    ];
    if (event.remarks) {
      paras.push(
        new Paragraph({
          children: [
            new TextRun({
              text: event.remarks,
              font: FONT,
              size: FONT_SIZE,
              italics: true,
            }),
          ],
        }),
      );
    }
    const prevTime = prevTimeParagraph(event);
    if (prevTime) paras.push(prevTime);
    paras.push(...previousTimeFieldParagraphs(event));
    const prev = prevInspectorParagraph(event);
    if (prev) paras.push(prev);
    paras.push(...previousFieldParagraphs(event));
    return paras;
  }

  if (event.eventType === "Surveillance") {
    const parts = [
      "CAD",
      event.operator,
      event.surveillanceTypes.map((t) => t.toUpperCase()).join("/"),
      "SURV",
    ];
    if (event.details) parts.push(event.details);
    const isAllDay =
      fmtTime(event.startTime) === "0000" && fmtTime(event.endTime) === "2359";
    const line1 = isAllDay
      ? parts.join(" ")
      : `${parts.join(" ")}${timeSuffix(event.startTime, event.endTime)}`;
    const paras: Paragraph[] = [
      new Paragraph({
        children: [
          new TextRun({
            text: line1,
            font: FONT,
            size: FONT_SIZE,
            color: opHex,
            underline: { type: UnderlineType.SINGLE },
          }),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: inspectors, font: FONT, size: FONT_SIZE }),
        ],
      }),
    ];
    const prevTime = prevTimeParagraph(event);
    if (prevTime) paras.push(prevTime);
    paras.push(...previousTimeFieldParagraphs(event));
    const prev = prevInspectorParagraph(event);
    if (prev) paras.push(prev);
    paras.push(...previousFieldParagraphs(event));
    return paras;
  }

  // Leave — event name/time underlined; inspector line is not
  const isAllDay =
    fmtTime(event.startTime) === "0000" && fmtTime(event.endTime) === "2359";
  const suffix = isAllDay ? "" : timeSuffix(event.startTime, event.endTime);
  const paras: Paragraph[] = [
    new Paragraph({
      children: [
        new TextRun({
          text: `${event.leaveType}${suffix}`,
          font: FONT,
          size: FONT_SIZE,
          underline: { type: UnderlineType.SINGLE },
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `\u2013 ${inspectors}`,
          font: FONT,
          size: FONT_SIZE,
        }),
      ],
    }),
  ];
  const prevTime = prevTimeParagraph(event);
  if (prevTime) paras.push(prevTime);
  paras.push(...previousTimeFieldParagraphs(event));
  const prev = prevInspectorParagraph(event);
  if (prev) paras.push(prev);
  paras.push(...previousFieldParagraphs(event));
  return paras;
}

/** Build the calendar rows shared by both export functions. */
function buildCalendarRows(
  year: number,
  month: number,
  byDate: Map<string, RosterEvent[]>,
  operatorColors: Record<string, string>,
  otherDutiesColors: Record<string, string>,
  markEmptyMondays = false,
): TableRow[] {
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOffset = new Date(year, month - 1, 1).getDay();
  const publicHolidays = getHKHolidays(year);

  // 3 cm minimum row height (1 inch = 1440 twips, 1 cm ≈ 567 twips)
  const ROW_HEIGHT = { value: 1701, rule: HeightRule.ATLEAST };

  // Determine whether any Sun (colIdx 0) or Sat (colIdx 6) has events.
  // Columns with no events at all are rendered very narrow.
  const sunHasEvents = [...byDate.keys()].some(
    (dk) => new Date(dk).getDay() === 0 && (byDate.get(dk)?.length ?? 0) > 0,
  );
  const satHasEvents = [...byDate.keys()].some(
    (dk) => new Date(dk).getDay() === 6 && (byDate.get(dk)?.length ?? 0) > 0,
  );
  const NARROW = 4; // % width for an empty weekend column
  const narrowCount = (sunHasEvents ? 0 : 1) + (satHasEvents ? 0 : 1);
  const normalPct = (100 - narrowCount * NARROW) / (7 - narrowCount);
  /** Return the percentage width for a given column index (0=Sun … 6=Sat). */
  const colPct = (colIdx: number) => {
    if (colIdx === 0 && !sunHasEvents) return NARROW;
    if (colIdx === 6 && !satHasEvents) return NARROW;
    return normalPct;
  };
  const colWidth = (colIdx: number) => ({
    size: colPct(colIdx),
    type: WidthType.PERCENTAGE,
  });

  const headerRow = new TableRow({
    tableHeader: true,
    children: WEEKDAYS.map(
      (d, colIdx) =>
        new TableCell({
          width: colWidth(colIdx),
          verticalAlign: VerticalAlign.CENTER,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: d, font: FONT, bold: true, size: 18 }),
              ],
            }),
          ],
        }),
    ),
  });

  const cells: Array<number | null> = [
    ...Array.from({ length: firstDayOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: TableRow[] = [headerRow];

  for (let w = 0; w < cells.length / 7; w++) {
    const week = cells.slice(w * 7, w * 7 + 7);
    rows.push(
      new TableRow({
        height: ROW_HEIGHT,
        children: week.map((day, colIdx) => {
          const isWeekend = colIdx === 0 || colIdx === 6;
          if (day === null) {
            return new TableCell({
              width: colWidth(colIdx),
              shading: isWeekend ? WEEKEND_HOLIDAY_SHADING : undefined,
              children: [new Paragraph({})],
            });
          }
          const dateKey = `${monthStr}-${String(day).padStart(2, "0")}`;
          const dayEvents = byDate.get(dateKey) ?? [];
          const isHoliday = publicHolidays.has(dateKey);
          const shadeCell = isWeekend || isHoliday;
          const paragraphs: Paragraph[] = [
            new Paragraph({
              children: [
                new TextRun({
                  text: String(day),
                  font: FONT,
                  bold: true,
                  size: 16,
                }),
              ],
            }),
          ];
          if (dayEvents.length === 0 && markEmptyMondays && colIdx === 1) {
            paragraphs.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: "[Reserved*]",
                    font: FONT,
                    size: FONT_SIZE + 2,
                    italics: true,
                    color: "D30000",
                  }),
                ],
              }),
            );
          }
          dayEvents.forEach((e, i) => {
            if (i > 0) paragraphs.push(new Paragraph({}));
            paragraphs.push(...eventParagraphs(e, operatorColors, otherDutiesColors));
          });
          return new TableCell({
            width: colWidth(colIdx),
            shading: shadeCell ? WEEKEND_HOLIDAY_SHADING : undefined,
            children: paragraphs,
          });
        }),
      }),
    );
  }

  return rows;
}

// ─── Inspector email section ───────────────────────────────────────────────────

type InspectorInfo = { name: string; email?: string };

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

/**
 * Builds the inspector email list + Monday note to append below the calendar
 * table in every Word export. Returns an array of Paragraph / Table nodes.
 */
function buildInspectorEmailSection(inspectors: InspectorInfo[]): (Paragraph | Table)[] {
  const listed = inspectors
    .filter((i) => i.email?.trim())
    .sort((a, b) => a.name.localeCompare(b.name));
  const nodes: (Paragraph | Table)[] = [];

  // Heading
  nodes.push(
    new Paragraph({
      spacing: { before: 240, after: 100 },
      children: [
        new TextRun({
          text: "CAD Inspectors Emails",
          font: FONT,
          bold: true,
          underline: { type: UnderlineType.SINGLE },
          size: 20,
        }),
      ],
    }),
  );

  // Two-column borderless table for the inspector list
  if (listed.length > 0) {
    const half = Math.ceil(listed.length / 2);
    const left = listed.slice(0, half);
    const right = listed.slice(half);
    const tableRows: TableRow[] = [];
    for (let i = 0; i < half; i++) {
      const makeCell = (insp: InspectorInfo | undefined) =>
        new TableCell({
          borders: NO_BORDERS,
          width: { size: 50, type: WidthType.PERCENTAGE },
          children: [
            new Paragraph({
              spacing: { before: 0, after: 40 },
              children: insp
                ? [new TextRun({ text: `${insp.name} - ${insp.email}`, font: FONT, size: 18 })]
                : [],
            }),
          ],
        });
      tableRows.push(new TableRow({ children: [makeCell(left[i]), makeCell(right[i])] }));
    }
    nodes.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }));
  }

  // Monday note in red
  nodes.push(
    new Paragraph({
      spacing: { before: 120, after: 0 },
      children: [
        new TextRun({
          text: "*Please note that any request for regulatory oversight on ",
          font: FONT,
          size: 16,
          color: "FF0000",
        }),
        new TextRun({
          text: "Monday",
          font: FONT,
          size: 16,
          color: "FF0000",
          bold: true,
          underline: { type: UnderlineType.SINGLE },
        }),
        new TextRun({
          text: " would not normally be accommodated.",
          font: FONT,
          size: 16,
          color: "FF0000",
        }),
      ],
    }),
  );

  return nodes;
}

/**
 * Generate a simulator-only monthly Word calendar for a single operator
 * and return it as a Blob (caller handles saving).
 */
export async function exportWordOperatorPlan(
  year: number,
  month: number,
  events: RosterEvent[],
  operatorColors: Record<string, string>,
  operator: string,
  inspectors: InspectorInfo[] = [],
): Promise<Blob> {
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;

  // Only Operator Request events for this operator, grouped by date, sorted by start time
  const byDate = new Map<string, RosterEvent[]>();
  for (const e of events) {
    if (e.eventType !== "Operator Request" || e.operator !== operator) continue;
    if (!e.date.startsWith(`${monthStr}-`)) continue;
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  const rows = buildCalendarRows(year, month, byDate, operatorColors, {}, true);

  const MARGIN = 360;
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: MARGIN,
              bottom: MARGIN,
              left: MARGIN,
              right: MARGIN,
            },
          },
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: `Monthly Plan for FSO Inspecting Staff (${monthStr})`,
                font: FONT,
                bold: true,
                size: 22,
              }),
            ],
          }),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
          ...buildInspectorEmailSection(inspectors),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 80 },
            children: [
              new TextRun({
                text: `Exported ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
                font: FONT,
                size: 14,
                color: "9CA3AF",
              }),
            ],
          }),
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}

/** Generate the monthly Word calendar and return it as a Blob (caller handles saving). */
export async function exportWordCalendar(
  year: number,
  month: number,
  events: RosterEvent[],
  operatorColors: Record<string, string>,
  version?: number,
  otherDutiesColors: Record<string, string> = {},
) {
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const vSuffix = version && version > 0 ? `-v${version}` : "";

  // Operator Request, Surveillance, Other Duties, Flying, then Leave; start time
  // breaks ties while preserving the existing Flying > Leave priority.
  const sortTier = (e: RosterEvent) =>
    e.eventType === "Operator Request"
      ? 0
      : e.eventType === "Surveillance"
        ? 1
        : e.eventType === "Other Duties" &&
            (e as Record<string, unknown>).subType === "Flying"
          ? 3
          : e.eventType === "Other Duties"
            ? 2
            : 4;
  const byDate = new Map<string, RosterEvent[]>();
  for (const e of events) {
    if (!e.date.startsWith(`${monthStr}-`)) continue;
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  for (const list of byDate.values()) {
    list.sort(
      (a, b) =>
        sortTier(a) - sortTier(b) ||
        (a.startTime ?? "").localeCompare(b.startTime ?? ""),
    );
  }

  const rows = buildCalendarRows(year, month, byDate, operatorColors, otherDutiesColors);

  // Portrait, narrow margins (360 twips ≈ 0.25 in) to fit on one page
  const MARGIN = 360;

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: MARGIN,
              bottom: MARGIN,
              left: MARGIN,
              right: MARGIN,
            },
          },
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: `Monthly Plan for FSO Inspecting Staff (${monthStr})`,
                font: FONT,
                bold: true,
                size: 22,
              }),
            ],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows,
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 80 },
            children: [
              new TextRun({
                text: `Exported ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}${vSuffix ? ` · ${monthStr}${vSuffix}` : ` · ${monthStr}`}`,
                font: FONT,
                size: 14,
                color: "9CA3AF",
              }),
            ],
          }),
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}
