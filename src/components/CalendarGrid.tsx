import { useState, useRef, useCallback, useEffect } from "react";
import {
  useRosterStore,
  RosterEvent,
  EventType,
  Inspector,
  Qualifications,
  EventHistoryField,
  EventHistoryValue,
  EVENT_HISTORY_FIELDS,
  EVENT_HISTORY_LABELS,
  getEventFieldValue,
  getEventPreviousValue,
  hasEventFieldHistory,
  makeShortName,
  sortInspectorsByName,
} from "@/store/rosterStore";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Pencil,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getHKHolidayMap } from "@/utils/holidays";

// ─── Multi-select filter dropdown ────────────────────────────────────────────

function FilterDropdown({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const active = selected.size > 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded border text-xs font-medium transition-colors
          ${
            active
              ? "bg-primary/10 border-primary/30 text-primary"
              : "bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
          }`}
      >
        {label}
        {active && (
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-white text-[10px] font-bold leading-none">
            {selected.size}
          </span>
        )}
        <ChevronDown
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className="absolute left-0 top-8 z-50 min-w-max bg-card border border-border rounded-lg shadow-lg overflow-hidden"
          >
            {active && (
              <button
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-destructive hover:bg-red-50 border-b border-border transition-colors"
              >
                <X className="w-3 h-3" /> Clear filter
              </button>
            )}
            <div className="max-h-56 overflow-y-auto py-1">
              {options.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-foreground hover:bg-muted/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(opt.value)}
                    onChange={() => onToggle(opt.value)}
                    className="w-3.5 h-3.5 accent-primary"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

/** Parse a #rrggbb hex string into {r,g,b}. Returns null for invalid input. */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

/** Build inline pill styles from an operator's hex colour. */
function operatorPillStyle(hex: string): React.CSSProperties {
  const rgb = hexToRgb(hex);
  if (!rgb) return {};
  const { r, g, b } = rgb;
  return {
    backgroundColor: `rgba(${r},${g},${b},0.13)`,
    borderColor: `rgba(${r},${g},${b},0.45)`,
    color: hex,
  };
}

function shiftLabel(event: RosterEvent): string {
  if (event.eventType !== "Other Duties") return "";
  const s = event.startTime ?? "";
  const e = event.endTime ?? "";
  if (!s && !e) return "";
  if (s === "00:00" && e === "23:59") return "";
  if (event.otherDutiesShift) return ` (${event.otherDutiesShift})`;
  return s && e ? ` ${s} – ${e}` : ` ${s || e}`;
}

function leavePillTimeLabel(event: RosterEvent): string {
  if (event.eventType !== "Leave") return "";
  const s = event.startTime ?? "";
  const e = event.endTime ?? "";
  if (!s && !e) return "";
  if (s === "00:00" && e === "23:59") return "";
  if (event.leaveShift) return ` (${event.leaveShift})`;

  return s && e ? ` ${s} – ${e}` : ` ${s || e}`;
}

function eventLabel(
  event: RosterEvent,
  shortName: (fullName: string) => string,
): string {
  if (event.eventType === "Operator Request")
    return `${event.operator} ${event.simulatorCodes?.join(", ") ?? event.simulatorCode}`;
  if (event.eventType === "Surveillance")
    return `${event.operator} ${event.surveillanceTypes.join("/")}${event.details ? " " + event.details : ""}`;
  if (event.eventType === "Other Duties") {
    const ops = (event.operators ?? []).filter(o => o.toLowerCase() !== "n/a");
    const remark =
      event.appendRemarkToCalendarPill === true && typeof event.remarks === "string"
        ? event.remarks.trim()
        : "";
    return (
      `${ops.join(", ")} ${event.subType}${remark ? ` ${remark}` : ""}${shiftLabel(event)}`
    ).trim();
  }
  // Leave: first names only + leave type
  const shortInspectors = event.inspectors.map(shortName).join(", ");
  return `${shortInspectors} ${event.leaveType}${leavePillTimeLabel(event)}`.trim();
}

/**
 * Sort an event's inspector names so qualified inspectors appear first.
   * For Operator Request events, "qualified" means the inspector's position is listed
 * in qualifications[activity]. Order within each group is preserved.
 */
function sortedInspectors(
  names: string[],
  event: RosterEvent,
  inspectors: Inspector[],
  qualifications: Qualifications,
): string[] {
  if (event.eventType !== "Operator Request") return names;
  const qualifiedPositions = new Set(qualifications[event.activity] ?? []);
  const positionOf = new Map(inspectors.map((i) => [i.name, i.position]));
  const isQualified = (name: string) =>
    qualifiedPositions.has(positionOf.get(name) ?? "");
  return [...names].sort((a, b) => {
    const qa = isQualified(a) ? 0 : 1;
    const qb = isQualified(b) ? 0 : 1;
    return qa - qb;
  });
}

function tooltipValue(
  field: EventHistoryField,
  value: EventHistoryValue,
  shortName?: (name: string) => string,
): string {
  if (value === null) return "Not set";
  if (Array.isArray(value)) {
    const names = field === "inspectors" && shortName
      ? value.map(shortName)
      : value;
    return names.join(", ") || "None";
  }
  if (field === "date") {
    const [year, month, day] = value.split("-");
    return year && month && day ? `${day}-${month}-${year}` : value;
  }
  return value;
}

function HistoryFieldRow({
  event,
  field,
  shortName,
  onClearHistory,
  formatValue,
}: {
  event: RosterEvent;
  field: EventHistoryField;
  shortName?: (name: string) => string;
  onClearHistory: (id: string, field: EventHistoryField) => void;
  formatValue?: (value: EventHistoryValue) => string;
}) {
  const current = getEventFieldValue(event, field);
  const previous = getEventPreviousValue(event, field);
  const changed = hasEventFieldHistory(event, field);
  if (current === null && !changed) return null;
  const format = (value: EventHistoryValue) =>
    formatValue ? formatValue(value) : tooltipValue(field, value, shortName);

  return (
    <div
      className={`${
        changed
          ? "-mx-1 rounded bg-amber-50 px-1 dark:bg-amber-950/30"
          : ""
      }`}
    >
      <div>
        <span className="text-muted-foreground">
          {EVENT_HISTORY_LABELS[field]}:{" "}
        </span>
        {format(current)}
      </div>
      {changed && (
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/50">
          <span className="line-through">{format(previous.value)}</span>
          <button
            type="button"
            className="pointer-events-auto rounded p-0.5 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Clear ${EVENT_HISTORY_LABELS[field].toLowerCase()} edit history`}
            title={`Clear ${EVENT_HISTORY_LABELS[field].toLowerCase()} edit history`}
            onClick={(e) => {
              e.stopPropagation();
              onClearHistory(event.id, field);
            }}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export function EventTooltip({
  event,
  x,
  y,
  inspectors,
  qualifications,
  onClearHistory,
  onMouseEnter,
  onMouseLeave,
}: {
  event: RosterEvent;
  x: number;
  y: number;
  inspectors: Inspector[];
  qualifications: Qualifications;
  onClearHistory: (
    id: string,
    field: EventHistoryField | "inspectors" | "time",
  ) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  // Keep card on screen: flip left if near right edge, flip up if near bottom
  const flipLeft = x > window.innerWidth - 220;
  const flipUp = y > window.innerHeight - 160;
  const shortName = makeShortName(inspectors);
  const previousStart = getEventPreviousValue(event, "startTime");
  const previousEnd = getEventPreviousValue(event, "endTime");
  const hasPreviousTime =
    hasEventFieldHistory(event, "startTime") ||
    hasEventFieldHistory(event, "endTime");
  const previousEventType = getEventPreviousValue(event, "eventType");
  const hasPreviousEventType = hasEventFieldHistory(event, "eventType");
  const previousInspectors = getEventPreviousValue(event, "inspectors");
  const hasPreviousInspectors = hasEventFieldHistory(event, "inspectors");
  const shownFields = new Set<EventHistoryField>([
    "date",
    "eventType",
    "startTime",
    "endTime",
    "inspectors",
  ]);
  if (event.eventType === "Operator Request") {
    ["operator", "simulatorCodes", "aircraftType", "activity", "candidateName"].forEach(
      (field) => shownFields.add(field as EventHistoryField),
    );
  } else if (event.eventType === "Surveillance") {
    ["operator", "surveillanceTypes", "details"].forEach((field) =>
      shownFields.add(field as EventHistoryField),
    );
  } else if (event.eventType === "Other Duties") {
    ["operators", "subType", "otherDutiesShift", "customColor", "remarks"].forEach(
      (field) => shownFields.add(field as EventHistoryField),
    );
  } else {
    ["leaveType", "leaveShift"].forEach((field) =>
      shownFields.add(field as EventHistoryField),
    );
  }

  const typeColor: Record<EventType, string> = {
    "Operator Request": "bg-blue-100 text-blue-700",
    Surveillance: "bg-amber-100 text-amber-700",
    "Other Duties": "bg-purple-100 text-purple-700",
    Leave: "bg-gray-600 text-white",
  };

  return (
    <div
      className="fixed z-50 pointer-events-auto"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        left: flipLeft ? x - 12 : x + 12,
        top: flipUp ? y - 8 : y + 8,
        transform: `translate(${flipLeft ? "-100%" : "0"}, ${flipUp ? "-100%" : "0"})`,
      }}
    >
      <div className="w-52 rounded-lg border border-border bg-card shadow-lg p-3 text-xs flex flex-col gap-1.5">
        {/* Header */}
        <div
          className={`flex items-center justify-between gap-2${
            hasPreviousTime
              ? " -mx-1 rounded bg-amber-50 px-1 py-0.5 dark:bg-amber-950/30"
              : ""
          }`}
        >
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${typeColor[event.eventType]}`}
          >
            {event.eventType}
          </span>
          <span className="flex flex-col items-end tabular-nums text-muted-foreground">
            <span>{event.startTime}–{event.endTime}</span>
            {hasPreviousTime && (
              <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/50">
                <span className="line-through">
                  {tooltipValue("startTime", previousStart.value)}–
                  {tooltipValue("endTime", previousEnd.value)}
                </span>
                <button
                  type="button"
                  className="pointer-events-auto rounded p-0.5 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Clear previous start time"
                  title="Clear previous start time"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearHistory(event.id, "startTime");
                  }}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
                <button
                  type="button"
                  className="pointer-events-auto rounded p-0.5 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Clear previous end time"
                  title="Clear previous end time"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearHistory(event.id, "endTime");
                  }}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            )}
          </span>
        </div>

        <HistoryFieldRow
          event={event}
          field="date"
          onClearHistory={onClearHistory}
        />
        {hasPreviousEventType && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
            <span>
              Previous {EVENT_HISTORY_LABELS.eventType.toLowerCase()}:{" "}
              <span className="line-through">
                {tooltipValue("eventType", previousEventType.value)}
              </span>
            </span>
            <button
              type="button"
              className="pointer-events-auto rounded p-0.5 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
              aria-label="Clear event type edit history"
              title="Clear event type edit history"
              onClick={(e) => {
                e.stopPropagation();
                onClearHistory(event.id, "eventType");
              }}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        )}

        {/* Type-specific fields */}
        {event.eventType === "Operator Request" && (
          <>
            <HistoryFieldRow
              event={event}
              field="simulatorCodes"
              onClearHistory={onClearHistory}
            />
            <HistoryFieldRow
              event={event}
              field="aircraftType"
              onClearHistory={onClearHistory}
            />
            <HistoryFieldRow
              event={event}
              field="activity"
              onClearHistory={onClearHistory}
            />
            <HistoryFieldRow
              event={event}
              field="operator"
              onClearHistory={onClearHistory}
            />
            <HistoryFieldRow
              event={event}
              field="candidateName"
              onClearHistory={onClearHistory}
            />
          </>
        )}
        {event.eventType === "Surveillance" && (
          <>
            <HistoryFieldRow
              event={event}
              field="operator"
              onClearHistory={onClearHistory}
            />
            <HistoryFieldRow
              event={event}
              field="surveillanceTypes"
              onClearHistory={onClearHistory}
            />
            <HistoryFieldRow
              event={event}
              field="details"
              onClearHistory={onClearHistory}
            />
          </>
        )}
        {event.eventType === "Other Duties" && (
          <>
            <HistoryFieldRow
              event={event}
              field="operators"
              onClearHistory={onClearHistory}
              formatValue={(value) =>
                tooltipValue(
                  "operators",
                  Array.isArray(value)
                    ? value.filter((operator) => operator.toLowerCase() !== "n/a")
                    : value,
                )
              }
            />
            <HistoryFieldRow
              event={event}
              field="subType"
              onClearHistory={onClearHistory}
            />
            <HistoryFieldRow
              event={event}
              field="otherDutiesShift"
              onClearHistory={onClearHistory}
            />
            <HistoryFieldRow
              event={event}
              field="customColor"
              onClearHistory={onClearHistory}
            />
            <HistoryFieldRow
              event={event}
              field="remarks"
              onClearHistory={onClearHistory}
            />
          </>
        )}
        {event.eventType === "Leave" && (
          <>
            <HistoryFieldRow
              event={event}
              field="leaveType"
              onClearHistory={onClearHistory}
            />
            <HistoryFieldRow
              event={event}
              field="leaveShift"
              onClearHistory={onClearHistory}
            />
          </>
        )}

        {EVENT_HISTORY_FIELDS.filter(
          (field) => !shownFields.has(field) && hasEventFieldHistory(event, field),
        ).map((field) => (
          <HistoryFieldRow
            key={field}
            event={event}
            field={field}
            onClearHistory={onClearHistory}
          />
        ))}

        {/* Inspectors — qualified first for Operator Request events */}
        <div
          className={`pt-0.5 border-t border-border${hasPreviousInspectors ? " -mx-1 px-1 rounded bg-amber-50 dark:bg-amber-950/30" : ""}`}
        >
          <div className="text-muted-foreground">
            {sortedInspectors(
              event.inspectors,
              event,
              inspectors,
              qualifications,
            )
              .map(shortName)
              .join(", ")}
          </div>
          {hasPreviousInspectors && (
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/50">
              <span className="line-through">
                {tooltipValue("inspectors", previousInspectors.value, shortName)}
              </span>
              <button
                type="button"
                className="pointer-events-auto rounded p-0.5 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                aria-label="Clear inspector edit history"
                title="Clear inspector edit history"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearHistory(event.id, "inspectors");
                }}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CalendarEvent({
  event,
  operatorColor,
  shortName,
  onEdit,
  isEditing,
  hasPendingEdit,
  onMouseEnter,
  onMouseLeave,
}: {
  event: RosterEvent;
  operatorColor?: string;
  shortName: (fullName: string) => string;
  onEdit: (id: string) => void;
  isEditing: boolean;
  hasPendingEdit: boolean;
  onMouseEnter: (e: React.MouseEvent, event: RosterEvent) => void;
  onMouseLeave: () => void;
}) {
  const isOOO = event.eventType === "Leave";
  const hasOperator = event.eventType !== "Leave";

  // Leave pills: dark gray
  const oooClass = "bg-gray-600 border-gray-700 text-white font-semibold";
  // Operator-coloured pills (Sim / Surveillance): computed inline styles
  const operatorStyle =
    hasOperator && operatorColor ? operatorPillStyle(operatorColor) : {};
  const operatorClass =
    hasOperator && !operatorColor
      ? "bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-foreground"
      : "";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.1 } }}
      onClick={(e) => {
        e.stopPropagation();
        onEdit(event.id);
      }}
      onMouseEnter={(e) => onMouseEnter(e, event)}
      onMouseLeave={onMouseLeave}
      style={operatorStyle}
      className={`min-w-0 overflow-hidden rounded border px-1.5 py-1 text-[10px] leading-tight cursor-pointer transition-shadow
        ${isOOO ? oooClass : operatorClass}
        ${isEditing ? "ring-2 ring-primary ring-offset-1" : "hover:ring-1 hover:ring-primary/50"}
        ${hasPendingEdit ? "opacity-60" : ""}`}
    >
      <div className="flex items-baseline gap-1 min-w-0">
        <span className="truncate min-w-0 flex-1">
          {eventLabel(event, shortName)}
        </span>
        {hasPendingEdit && (
          <span
            title="Edit staged — pending commit"
            className="shrink-0 leading-none"
          >
            <Pencil className="w-2.5 h-2.5 opacity-70" />
          </span>
        )}
      </div>
    </motion.div>
  );
}

export default function CalendarGrid({
  onDateSelect,
  selectedDate,
  year: controlledYear,
  month: controlledMonth,
  onMonthChange,
  filterOperators,
  filterInspectors,
  onFilterOperatorsChange,
  onFilterInspectorsChange,
}: {
  onDateSelect?: (date: string) => void;
  /** Date currently used by the entry form and staging queue. */
  selectedDate?: string;
  /** Optional controlled month view (1-based month). */
  year?: number;
  month?: number;
  onMonthChange?: (year: number, month: number) => void;
  filterOperators: Set<string>;
  filterInspectors: Set<string>;
  onFilterOperatorsChange: (next: Set<string>) => void;
  onFilterInspectorsChange: (next: Set<string>) => void;
}) {
  const { state, setEditingEventId, clearEventHistory } = useRosterStore();
  const {
    editingEventId,
    calendarEvents,
    stagingQueue,
    operatorColors,
    otherDutiesColors,
    operators,
    inspectors,
    qualifications,
  } = state;

  // Build a set of calendar event IDs that have a pending staged edit
  const pendingEditIds = new Set(
    stagingQueue.map((e) => e.sourceEventId).filter(Boolean) as string[],
  );

  const toggleOperator = (v: string) => {
    const n = new Set(filterOperators);
    n.has(v) ? n.delete(v) : n.add(v);
    onFilterOperatorsChange(n);
  };
  const toggleInspector = (v: string) => {
    const n = new Set(filterInspectors);
    n.has(v) ? n.delete(v) : n.add(v);
    onFilterInspectorsChange(n);
  };

  // Apply filters: operator filter hides OOO (no operator field); inspector filter checks the inspectors list
  const filteredEvents = calendarEvents.filter((e) => {
    if (filterOperators.size > 0) {
      if (e.eventType === "Leave") return false;
      if (e.eventType === "Other Duties") {
        if (!e.operators.some((op) => filterOperators.has(op))) return false;
      } else {
        if (!filterOperators.has(e.operator)) return false;
      }
    }
    if (filterInspectors.size > 0) {
      if (!e.inspectors.some((i) => filterInspectors.has(i)))
        return false;
    }
    return true;
  });

  const [tooltip, setTooltip] = useState<{
    event: RosterEvent;
    x: number;
    y: number;
  } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, event: RosterEvent) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setTooltip({ event, x: e.clientX, y: e.clientY });
    },
    [],
  );

  const handleMouseLeave = useCallback(() => {
    hideTimer.current = setTimeout(() => setTooltip(null), 80);
  }, []);
  const handleTooltipMouseEnter = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);
  const handleClearHistory = useCallback(
    (
      id: string,
      kind: EventHistoryField | "inspectors" | "time",
    ) => {
      clearEventHistory(id, kind);
      setTooltip(null);
    },
    [clearEventHistory],
  );

  const now = new Date();
  const [internalYear, setYear] = useState(now.getFullYear());
  const [internalMonth, setMonth] = useState(now.getMonth() + 1); // 1-based

  // Controlled mode: parent supplies year/month and receives navigation changes
  const year = controlledYear ?? internalYear;
  const month = controlledMonth ?? internalMonth;

  function changeMonth(nextYear: number, nextMonth: number) {
    setYear(nextYear);
    setMonth(nextMonth);
    onMonthChange?.(nextYear, nextMonth);
  }

  function goToPrev() {
    if (month === 1) changeMonth(year - 1, 12);
    else changeMonth(year, month - 1);
  }

  function goToNext() {
    if (month === 12) changeMonth(year + 1, 1);
    else changeMonth(year, month + 1);
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOffset = new Date(year, month - 1, 1).getDay(); // 0=Sun…6=Sat

  const eventsByDate = new Map<string, RosterEvent[]>();
  for (const event of filteredEvents) {
    const list = eventsByDate.get(event.date) ?? [];
    list.push(event);
    eventsByDate.set(event.date, list);
  }
  for (const list of eventsByDate.values()) {
    // Simulator first, then Surveillance, then Other Duties. Flying remains
    // directly above Leave to preserve the existing Flying > Leave priority.
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
    list.sort(
      (a, b) =>
        sortTier(a) - sortTier(b) ||
        (a.startTime ?? "").localeCompare(b.startTime ?? ""),
    );
  }

  // Count events visible in this month (after filtering)
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;
  const visibleCount = filteredEvents.filter((e) =>
    e.date.startsWith(monthPrefix),
  ).length;
  const anyFilterActive = filterOperators.size > 0 || filterInspectors.size > 0;

  const shortName = makeShortName(inspectors);
  const inspectorOptions = sortInspectorsByName(inspectors).map((i) => ({
    value: i.name,
    label: shortName(i.name),
  }));

  const cells: Array<number | null> = [
    ...Array.from({ length: firstDayOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <section className="h-full flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrev}
            className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            title="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <p className="text-sm font-semibold text-foreground w-36 text-center">
            {MONTH_NAMES[month - 1]} {year}
          </p>
          <button
            onClick={goToNext}
            className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            title="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <FilterDropdown
            label="Operator"
            options={operators.map((o) => ({ value: o, label: o }))}
            selected={filterOperators}
            onToggle={toggleOperator}
            onClear={() => onFilterOperatorsChange(new Set())}
          />
          <FilterDropdown
            label="Inspector"
            options={inspectorOptions}
            selected={filterInspectors}
            onToggle={toggleInspector}
            onClear={() => onFilterInspectorsChange(new Set())}
          />
          {anyFilterActive && (
            <button
              onClick={() => {
                onFilterOperatorsChange(new Set());
                onFilterInspectorsChange(new Set());
              }}
              className="inline-flex items-center gap-1 h-7 px-2 rounded text-xs text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors"
              title="Clear all filters"
            >
              <X className="w-3 h-3" /> All
            </button>
          )}
          <span className="text-xs text-muted-foreground pl-1 border-l border-border">
            {visibleCount} {visibleCount === 1 ? "event" : "events"}
            {anyFilterActive && " (filtered)"}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide text-right"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-px bg-border border border-border rounded overflow-hidden">
          {(() => {
            const holidays = getHKHolidayMap(year);
            return cells.map((day, i) => {
              const col = i % 7;
              const isWeekend = col === 0 || col === 6;
              if (day === null) {
                // For blank cells we don't have a dateKey, but we can still shade weekends
                return (
                  <div
                    key={`blank-${i}`}
                    className={`min-h-32 ${isWeekend ? "bg-muted" : "bg-card"} opacity-60`}
                  />
                );
              }
              const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const holidayName = holidays.get(dateKey);
              const isHoliday = !!holidayName;
              const isShaded = isWeekend || isHoliday;
              const isToday = dateKey === todayKey;
              const isSelected = dateKey === selectedDate;
              const dayEvents = eventsByDate.get(dateKey) ?? [];
              return (
                <div
                  key={day}
                  onClick={() => onDateSelect?.(dateKey)}
                  aria-label={`${dateKey}${isToday ? " (today)" : ""}${isSelected ? " (selected)" : ""}`}
                  aria-current={isToday ? "date" : undefined}
                  aria-selected={isSelected}
                  className={`min-h-32 p-1.5 flex flex-col cursor-pointer hover:bg-primary/5 transition-colors group ${
                    isShaded ? "bg-muted" : "bg-card"
                  } ${
                    isSelected ? "ring-2 ring-primary ring-inset" : ""
                  }`}
                >
                  <span
                    className={`self-end mb-1 tabular-nums text-xs ${
                      isToday
                        ? "rounded-full min-w-6 h-6 px-1 flex items-center justify-center font-bold bg-primary text-primary-foreground"
                        : dayEvents.length > 0
                          ? "font-semibold text-foreground"
                          : "text-muted-foreground"
                    }`}
                  >
                    {day}
                  </span>
                  <div className="flex flex-col gap-1">
                    <AnimatePresence>
                      {dayEvents.map((event) => {
                        const eventColor =
                          event.eventType === "Operator Request" ||
                          event.eventType === "Surveillance"
                            ? operatorColors[event.operator]
                            : event.eventType === "Other Duties"
                              ? (() => {
                                  const operatorColor = (event.operators ?? [])
                                    .map((operator) => operatorColors[operator])
                                    .find(Boolean);
                                  if (operatorColor) return operatorColor;
                                  if (/^#[0-9a-f]{6}$/i.test(event.customColor ?? "")) {
                                    return event.customColor;
                                  }
                                  return otherDutiesColors[event.subType];
                                })()
                              : undefined;
                        return (
                          <CalendarEvent
                            key={event.id}
                            event={event}
                            operatorColor={eventColor}
                            shortName={shortName}
                            onEdit={setEditingEventId}
                            isEditing={editingEventId === event.id}
                            hasPendingEdit={pendingEditIds.has(event.id)}
                            onMouseEnter={handleMouseEnter}
                            onMouseLeave={handleMouseLeave}
                          />
                        );
                      })}
                    </AnimatePresence>
                  </div>
                  {isHoliday && !isWeekend && holidayName && (
                    <span className="mt-auto pt-1 text-[9px] leading-tight text-slate-500 truncate opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      {holidayName}
                    </span>
                  )}
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* Hover tooltip */}
      <AnimatePresence>
        {tooltip && (
          <motion.div
            key={tooltip.event.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
          >
            <EventTooltip
              event={tooltip.event}
              x={tooltip.x}
              y={tooltip.y}
              inspectors={inspectors}
              qualifications={qualifications}
              onClearHistory={handleClearHistory}
              onMouseEnter={handleTooltipMouseEnter}
              onMouseLeave={handleMouseLeave}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
