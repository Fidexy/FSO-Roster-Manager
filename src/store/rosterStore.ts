// Non-component exports only — safe for Vite Fast Refresh.
// The RosterProvider component lives in ./RosterProvider.tsx

import { createContext, useContext } from "react";

// ─── Event Types ──────────────────────────────────────────────────────────────

export type EventType = "Operator Request" | "Surveillance" | "Other Duties" | "Leave";

/** User-editable event fields whose immediately previous values can be shown. */
export type EventHistoryField =
  | "eventType"
  | "date"
  | "startTime"
  | "endTime"
  | "inspectors"
  | "operator"
  | "simulatorCodes"
  | "aircraftType"
  | "activity"
  | "candidateName"
  | "surveillanceTypes"
  | "details"
  | "operators"
  | "subType"
  | "otherDutiesShift"
  | "customColor"
  | "remarks"
  | "leaveType"
  | "leaveShift";

export type EventHistoryValue = string | string[] | null;
export type PreviousEventValues = Partial<
  Record<EventHistoryField, EventHistoryValue>
>;

export type BaseEvent = {
  id: string;
  eventType: EventType;
  date: string;
  startTime: string;
  endTime: string;
  inspectors: string[];
  /**
   * Set only on staged edits of an existing calendar event.
   * Holds the id of the original calendar event that will be atomically
   * replaced when this staged item is committed.
   */
  sourceEventId?: string;
  /**
   * Set at commit time when the inspector list changed from the previous
   * calendar event. Used to display struck-through previous inspectors in
   * the hover card and Word export so viewers can see the update.
   */
  previousInspectors?: string[];
  /**
   * Set at commit time when the event time range changed. Holds the
   * immediately previous start and end values for change highlighting.
   */
  previousStartTime?: string;
  previousEndTime?: string;
  /**
   * Typed, serializable previous values for every editable field that changed
   * in the most recent committed edit. A null value means the field was absent
   * before the edit. Only the immediately preceding value is retained.
   */
  previousValues?: PreviousEventValues;
};

export type OperatorRequestEvent = BaseEvent & {
  eventType: "Operator Request";
  operator: string;
  /** All selected simulator device codes, in selection order. */
  simulatorCodes: string[];
  /** Legacy compatibility alias for the first selected code. */
  simulatorCode: string;
  aircraftType: string;
  activity: string;
  candidateName: string;
};
export type SurveillanceEvent = BaseEvent & {
  eventType: "Surveillance";
  operator: string;
  /** One or more surveillance activity types (multi-select). */
  surveillanceTypes: string[];
  /** Free-text details (replaces the old route / flightNo / station fields). */
  details: string;
};

export type LeaveEvent = BaseEvent & {
  eventType: "Leave";
  leaveType: string;
  /** Set only when the AM or PM shortcut button was explicitly selected. */
  leaveShift?: "AM" | "PM";
};

export type OtherDutiesEvent = BaseEvent & {
  eventType: "Other Duties";
  operators: string[]; // array of operator codes, 'N/A', or a custom string
  subType: string;
  /** Set only when the AM or PM shortcut button was explicitly selected. */
  otherDutiesShift?: "AM" | "PM";
  /** Optional color override used for Custom Other Duties entries. */
  customColor?: string;
  remarks?: string;
  /** Append non-empty remarks to this event's calendar pill label. */
  appendRemarkToCalendarPill?: boolean;
};

export type RosterEvent =
  | OperatorRequestEvent
  | SurveillanceEvent
  | OtherDutiesEvent
  | LeaveEvent;

export const EVENT_HISTORY_FIELDS: readonly EventHistoryField[] = [
  "eventType",
  "date",
  "startTime",
  "endTime",
  "inspectors",
  "operator",
  "simulatorCodes",
  "aircraftType",
  "activity",
  "candidateName",
  "surveillanceTypes",
  "details",
  "operators",
  "subType",
  "otherDutiesShift",
  "customColor",
  "remarks",
  "leaveType",
  "leaveShift",
];

export const EVENT_HISTORY_LABELS: Record<EventHistoryField, string> = {
  eventType: "Event type",
  date: "Date",
  startTime: "Start time",
  endTime: "End time",
  inspectors: "Inspectors",
  operator: "Operator",
  simulatorCodes: "Simulator codes",
  aircraftType: "Aircraft type",
  activity: "Activity",
  candidateName: "Candidate",
  surveillanceTypes: "Surveillance types",
  details: "Details",
  operators: "Operators",
  subType: "Duty type",
  otherDutiesShift: "Shift",
  customColor: "Custom colour",
  remarks: "Remarks",
  leaveType: "Leave type",
  leaveShift: "Shift",
};

function own(obj: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Read a field through compatibility aliases and normalize absent strings. */
export function getEventFieldValue(
  event: RosterEvent,
  field: EventHistoryField,
): EventHistoryValue {
  const rawEvent = event as unknown as Record<string, unknown>;
  if (field === "simulatorCodes") {
    if (Array.isArray(rawEvent.simulatorCodes))
      return [...rawEvent.simulatorCodes] as string[];
    return typeof rawEvent.simulatorCode === "string" &&
      rawEvent.simulatorCode.length > 0
      ? [rawEvent.simulatorCode]
      : null;
  }
  const value = rawEvent[field];
  if (Array.isArray(value)) return [...value] as string[];
  if (typeof value === "string") return value === "" ? null : value;
  return null;
}

/**
 * Read the new history map, falling back to the two legacy fields so imported
 * rosters continue to display their existing history.
 */
export function getEventPreviousValue(
  event: RosterEvent,
  field: EventHistoryField,
): { hasPrevious: boolean; value: EventHistoryValue } {
  if (event.previousValues && own(event.previousValues, field)) {
    return { hasPrevious: true, value: event.previousValues[field] ?? null };
  }
  if (field === "inspectors" && event.previousInspectors !== undefined)
    return { hasPrevious: true, value: [...event.previousInspectors] };
  if (field === "startTime" && event.previousStartTime !== undefined)
    return { hasPrevious: true, value: event.previousStartTime };
  if (field === "endTime" && event.previousEndTime !== undefined)
    return { hasPrevious: true, value: event.previousEndTime };
  return { hasPrevious: false, value: null };
}

export function eventHistoryValuesEqual(
  field: EventHistoryField,
  a: EventHistoryValue,
  b: EventHistoryValue,
): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    const left = field === "inspectors" ? [...a].sort() : a;
    const right = field === "inspectors" ? [...b].sort() : b;
    return left.length === right.length && left.every((v, i) => v === right[i]);
  }
  return a === b;
}

export function hasEventFieldHistory(
  event: RosterEvent,
  field: EventHistoryField,
): boolean {
  const previous = getEventPreviousValue(event, field);
  return (
    previous.hasPrevious &&
    !eventHistoryValuesEqual(field, previous.value, getEventFieldValue(event, field))
  );
}

/** Capture only fields changed by an edit, retaining the old value (or null). */
export function capturePreviousEventValues(
  original: RosterEvent,
  updated: RosterEvent,
): PreviousEventValues {
  const previous: PreviousEventValues = {};
  for (const field of EVENT_HISTORY_FIELDS) {
    const oldValue = getEventFieldValue(original, field);
    const newValue = getEventFieldValue(updated, field);
    if (!eventHistoryValuesEqual(field, oldValue, newValue))
      previous[field] = Array.isArray(oldValue) ? [...oldValue] : oldValue;
  }
  return previous;
}

function applyCommittedHistory(
  event: RosterEvent,
  original: RosterEvent | undefined,
): RosterEvent {
  if (!original) return event;
  const captured = capturePreviousEventValues(original, event);
  if (Object.keys(captured).length === 0) return event;
  if (own(captured, "startTime") || own(captured, "endTime")) {
    // The UI and legacy exports present time as a range, so retain both old
    // endpoints even when only one endpoint changed.
    captured.startTime = original.startTime;
    captured.endTime = original.endTime;
  }

  const withHistory: RosterEvent = {
    ...event,
    previousValues: captured,
  };
  if (own(captured, "inspectors"))
    withHistory.previousInspectors = captured.inspectors as string[];
  if (own(captured, "startTime") && own(captured, "endTime")) {
    withHistory.previousStartTime = captured.startTime as string;
    withHistory.previousEndTime = captured.endTime as string;
  }
  return withHistory;
}

// ─── Inspector / Qualification Types ─────────────────────────────────────────

export type Inspector = {
  id: string;
  /** Full name (e.g. "Robin Johnson"). Derive display name with firstNameOf(). */
  name: string;
  position: string;
  email?: string;
};

/** Compare inspectors by full name, case-insensitively, with id as a stable tie-breaker. */
export function compareInspectorsByName(
  a: { name: string; id?: string },
  b: { name: string; id?: string },
): number {
  return (
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
    (a.id ?? "").localeCompare(b.id ?? "", undefined, { sensitivity: "base" })
  );
}

/** Return inspectors in case-insensitive alphabetical full-name order. */
export function sortInspectorsByName<T extends { name: string; id?: string }>(
  inspectors: T[],
): T[] {
  return [...inspectors].sort(compareInspectorsByName);
}

/** Returns the first word of a full name — used for all roster/export display. */
export function firstNameOf(fullName: string): string {
  return fullName.split(" ")[0];
}

/**
 * Returns a display-name factory scoped to a specific inspector list.
 * When two inspectors share the same first name, conflicting entries render as
 * "First L." (first name + last-name initial) to disambiguate.
 * Accepts any object with a `name` string so it works with both full
 * Inspector records and the narrower { name, position } shape used in QualInput.
 *
 * Usage:
 *   const shortName = makeShortName(inspectors);
 *   shortName("Robin Macadam") // → "Robin" (unique) or "Robin M." (conflict)
 */
export function makeShortName(
  inspectors: { name: string }[],
): (fullName: string) => string {
  const firstCount = new Map<string, number>();
  for (const i of inspectors) {
    const f = firstNameOf(i.name);
    firstCount.set(f, (firstCount.get(f) ?? 0) + 1);
  }
  return (fullName: string): string => {
    const first = firstNameOf(fullName);
    if ((firstCount.get(first) ?? 0) <= 1) return first;
    const parts = fullName.trim().split(/\s+/);
    const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return lastInitial ? `${first} ${lastInitial}.` : first;
  };
}

/** Maps simulator activity name → array of permitted positions */
export type Qualifications = Record<string, string[]>;

export const SIMULATOR_ACTIVITIES = [
  "AE Initial",
  "AE Renewal",
  "AE SBT Initial",
  "AE SBT Renewal",
  "AE SBT Revalidation",
  "AP Initial",
  "AP (SEP) Initial",
  "AP (SEP) Renewal",
  "AP Renewal",
  "AP Requalification",
  "Sim Renewal",
] as const;
export type SimulatorActivity = (typeof SIMULATOR_ACTIVITIES)[number];

export const DEFAULT_OPERATORS: string[] = [
  "AHK",
  "CAE HK",
  "CPA",
  "GFS",
  "HEL",
  "HGB",
  "HKA",
  "HKC",
  "HKE",
];

export const DEFAULT_OPERATOR_COLORS: Record<string, string> = {
  AHK: "#dc2626", // Red
  "CAE HK": "#1e3a8a", // Dark blue
  CPA: "#006b3c", // Cathay green
  GFS: "#374151", // Dark gray
  HEL: "#6b7280", // Gray
  HGB: "#3b82f6", // Light blue
  HKA: "#dc2626", // Red
  HKC: "#ea580c", // Orange
  HKE: "#7c3aed", // Purple
};
export const DEFAULT_SIMULATOR_ACTIVITIES: string[] = [
  "AE Initial",
  "AE Renewal",
  "AE SBT Initial",
  "AE SBT Renewal",
  "AE SBT Revalidation",
  "AP Initial",
  "AP (SEP) Initial",
  "AP (SEP) Renewal",
  "AP Renewal",
  "AP Requalification",
  "Sim Renewal",
];

export const DEFAULT_SURVEILLANCE_ACTIVITIES: string[] = [
  "Cabin",
  "Flight",
  "Station",
  "ORI",
  "Routine Training Inspection",
  "Routine SAE/AE Monitoring",
  "Routine AP Monitoring",
  "SMS Assessment",
  "QMS Audit",
];

export const DEFAULT_LEAVE_TYPES: string[] = ["MA", "TOIL", "VL"];

export const DEFAULT_DUTY_SUBTYPES: string[] = [
  "AEX Course",
  "Flying",
  "MOR Meeting",
  "Overseas Duties",
];

export const DEFAULT_OTHER_DUTIES_COLORS: Record<string, string> =
  Object.fromEntries(
    DEFAULT_DUTY_SUBTYPES.map((subType) => [subType, "#9333ea"]),
  );

/** Maps simulator code → aircraft type */
export type SimulatorMap = Record<string, string>;

export const DEFAULT_SIMULATOR_MAP: SimulatorMap = {
  "2U79": "B777-300ER",
  "CAAC FSD-310": "B737-800",
  "CAAC FSD-436": "B737-800",
  CPA01: "A320-200",
  CPA02: "A330 (RR)",
  CPA14: "B777",
  CPA15: "B777-300",
  CPA16: "B747-8F",
  CPA17: "B777",
  CPA18: "A350-900",
  CPA19: "A330",
  CPA20: "A350",
  CPA22: "B777",
  CPA23: "A320",
  CPA25: "A350",
  CRK01: "A350-900",
  CRK02: "A330-200",
  "EU-FR9198 (S39)": "A330",
  "FAA 1252": "G550",
  FFS3: "A320-200",
  FFS4: "A330-200",
  FFS6: "A320-200",
  FFS8: "A320-200",
  GFS01: "EC175",
  HK04: "A320-200",
  HK07: "A320-200",
};

// ─── Roster version (bump to force-reset inspector/qualification defaults) ────

export const ROSTER_VERSION = "2";

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_INSPECTORS: Inspector[] = [
  {
    id: "1",
    name: "Robin Macadam",
    position: "FOI(C)1",
    email: "rlamacadam@cad.gov.hk",
  },
  {
    id: "2",
    name: "Steve Mihos",
    position: "FOI(C)2",
    email: "smihos@cad.gov.hk",
  },
  {
    id: "3",
    name: "Bradley Pieters",
    position: "FOI(C)3",
    email: "brjpieters@cad.gov.hk",
  },
  {
    id: "4",
    name: "Norman Wong",
    position: "FSI(1)",
    email: "nkhwong@cad.gov.hk",
  },
  {
    id: "5",
    name: "Webster Siu",
    position: "FSI(2)",
    email: "whsiu@cad.gov.hk",
  },
  {
    id: "6",
    name: "Herick Chui",
    position: "ASI(1)",
    email: "hkcchui@cad.gov.hk",
  },
  {
    id: "7",
    name: "Vincent Hui",
    position: "ASI(2)",
    email: "vwwhui@cad.gov.hk",
  },
  { id: "8", name: "Yinxian Li", position: "ASI(3)", email: "yxli@cad.gov.hk" },
  { id: "9", name: "Joel Lee", position: "ASI(4)", email: "jhklee@cad.gov.hk" },
  {
    id: "10",
    name: "Francis Chan",
    position: "ASI(5)",
    email: "fkychan@cad.gov.hk",
  },
  {
    id: "11",
    name: "Alex Kwok",
    position: "ASI(6)",
    email: "akwok@cad.gov.hk",
  },
  {
    id: "12",
    name: "Dennis Wong",
    position: "ASI(7)",
    email: "dpywong@cad.gov.hk",
  },
  {
    id: "13",
    name: "Alex Linhares",
    position: "ASI(8)",
    email: "alinhares@cad.gov.hk",
  },
  { id: "14", name: "Sam Tsui", position: "HOI", email: "skstsui@cad.gov.hk" },
  {
    id: "15",
    name: "Annette Luk",
    position: "SO(FS)1",
    email: "astluk@cad.gov.hk",
  },
  {
    id: "16",
    name: "Patrick Ma",
    position: "SO(FS)2",
    email: "pspma@cad.gov.hk",
  },
  {
    id: "17",
    name: "Carman Yeung",
    position: "SO(FS)3",
    email: "cnmyeung@cad.gov.hk",
  },
  {
    id: "18",
    name: "Stanley Tso",
    position: "SO(TS)2",
    email: "scttso@cad.gov.hk",
  },
  { id: "19", name: "Dominic Hui", position: "OI", email: "dtmhui@cad.gov.hk" },
].sort(compareInspectorsByName);

const ALL_POSITIONS = [
  "FOI(C)1",
  "FOI(C)2",
  "FOI(C)3",
  "FSI(1)",
  "FSI(2)",
  "ASI(1)",
  "ASI(2)",
  "ASI(3)",
  "ASI(4)",
  "ASI(5)",
  "ASI(6)",
  "ASI(7)",
  "ASI(8)",
  "HOI",
  "SO(FS)1",
  "SO(FS)2",
  "SO(FS)3",
  "SO(TS)2",
  "OI",
];

export const DEFAULT_QUALIFICATIONS: Qualifications = {
  "AE Initial": [...ALL_POSITIONS],
  "AE Renewal": [...ALL_POSITIONS],
  "AE SBT Initial": [...ALL_POSITIONS],
  "AE SBT Renewal": [...ALL_POSITIONS],
  "AE SBT Revalidation": [...ALL_POSITIONS],
  "AP Initial": [...ALL_POSITIONS],
  "AP (SEP) Initial": [...ALL_POSITIONS],
  "AP (SEP) Renewal": [...ALL_POSITIONS],
  "AP Renewal": [...ALL_POSITIONS],
  "AP Requalification": [...ALL_POSITIONS],
  "Sim Renewal": [...ALL_POSITIONS],
};

export const DEFAULT_SURVEILLANCE_QUALIFICATIONS: Qualifications =
  Object.fromEntries(
    DEFAULT_SURVEILLANCE_ACTIVITIES.map((a) => [a, [...ALL_POSITIONS]]),
  );

// ─── State & Actions ──────────────────────────────────────────────────────────

export type RosterState = {
  stagingQueue: RosterEvent[];
  calendarEvents: RosterEvent[];
  inspectors: Inspector[];
  qualifications: Qualifications;
  operators: string[];
  operatorColors: Record<string, string>;
  otherDutiesColors: Record<string, string>;
  simulatorActivities: string[];
  surveillanceActivities: string[];
  surveillanceQualifications: Qualifications;
  simulatorMap: SimulatorMap;
  leaveTypes: string[];
  dutySubTypes: string[];
  editingEventId: string | null; // ephemeral — never persisted
  editingStagingId: string | null; // ephemeral — never persisted
};

/** String-list state keys editable via ADD_LIST_ITEM / REMOVE_LIST_ITEM / RENAME_LIST_ITEM. */
export type ListKey =
  | "operators"
  | "simulatorActivities"
  | "surveillanceActivities"
  | "leaveTypes"
  | "dutySubTypes";

export type RosterAction =
  | { type: "ADD_EVENT"; payload: RosterEvent }
  | { type: "REMOVE_EVENT"; payload: string }
  | { type: "COMMIT_EVENT"; payload: string }
  | { type: "COMMIT_ALL" }
  | { type: "REMOVE_CALENDAR_EVENT"; payload: string }
  | {
      type: "CLEAR_EVENT_HISTORY";
      payload: {
        id: string;
        kind: EventHistoryField | "inspectors" | "time";
      };
    }
  | { type: "ADD_INSPECTOR"; payload: Inspector }
  | { type: "REMOVE_INSPECTOR"; payload: string }
  | {
      type: "TOGGLE_QUALIFICATION";
      payload: { activity: string; position: string };
    }
  | {
      type: "SET_ACTIVITY_QUALIFICATIONS";
      payload: { activity: string; positions: string[] };
    }
  | {
      type: "SET_SURVEILLANCE_QUALIFICATIONS";
      payload: { activity: string; positions: string[] };
    }
  | {
      type: "ADD_LIST_ITEM";
      payload: { list: ListKey; value: string };
    }
  | {
      type: "REMOVE_LIST_ITEM";
      payload: { list: ListKey; value: string };
    }
  | {
      type: "RENAME_LIST_ITEM";
      payload: { list: ListKey; oldValue: string; newValue: string };
    }
  | { type: "SET_OPERATOR_COLOR"; payload: { operator: string; color: string } }
  | {
      type: "SET_OTHER_DUTIES_COLOR";
      payload: { subType: string; color: string };
    }
  | {
      type: "SET_SIM_MAP_ENTRY";
      payload: { code: string; aircraftType: string };
    }
  | { type: "REMOVE_SIM_MAP_ENTRY"; payload: string }
  | { type: "SET_EDITING_EVENT_ID"; payload: string | null }
  | {
      type: "UPDATE_CALENDAR_EVENT";
      payload: { id: string; data: Omit<RosterEvent, "id"> };
    }
  | { type: "SET_EDITING_STAGING_ID"; payload: string | null }
  | {
      type: "UPDATE_STAGING_EVENT";
      payload: { id: string; data: Omit<RosterEvent, "id"> };
    }
  | { type: "INIT"; payload: RosterState }
  | { type: "IMPORT_STATE"; payload: Partial<RosterState> }
  | { type: "RESET_ALL" };

export type RosterContextValue = {
  state: RosterState;
  addEventToQueue: (event: Omit<RosterEvent, "id">) => void;
  removeEvent: (id: string) => void;
  commitEvent: (id: string) => void;
  commitAll: () => void;
  removeCalendarEvent: (id: string) => void;
  clearEventHistory: (
    id: string,
    kind: EventHistoryField | "inspectors" | "time",
  ) => void;
  addInspector: (inspector: Omit<Inspector, "id">) => void;
  removeInspector: (id: string) => void;
  toggleQualification: (activity: string, position: string) => void;
  setActivityQualifications: (activity: string, positions: string[]) => void;
  setSurveillanceQualifications: (
    activity: string,
    positions: string[],
  ) => void;
  addListItem: (list: ListKey, value: string) => void;
  removeListItem: (list: ListKey, value: string) => void;
  renameListItem: (list: ListKey, oldValue: string, newValue: string) => void;
  setOperatorColor: (operator: string, color: string) => void;
  setOtherDutiesColor: (subType: string, color: string) => void;
  setSimMapEntry: (code: string, aircraftType: string) => void;
  removeSimMapEntry: (code: string) => void;
  setEditingEventId: (id: string | null) => void;
  updateCalendarEvent: (id: string, data: Omit<RosterEvent, "id">) => void;
  setEditingStagingId: (id: string | null) => void;
  updateStagingEvent: (id: string, data: Omit<RosterEvent, "id">) => void;
  importState: (data: Partial<RosterState>) => void;
  resetAll: () => void;
  /** Immediately persist all data, bypassing the auto-save debounce. */
  manualSave: () => Promise<void>;
  /** True once persisted data has been loaded on startup. */
  isLoaded: boolean;
  /** Current auto-save / manual-save status. */
  saveStatus: "idle" | "saving" | "saved";
};

// ─── Initial state ────────────────────────────────────────────────────────────

export const initialRosterState: RosterState = {
  stagingQueue: [],
  calendarEvents: [],
  inspectors: DEFAULT_INSPECTORS,
  qualifications: DEFAULT_QUALIFICATIONS,
  operators: [...DEFAULT_OPERATORS],
  operatorColors: { ...DEFAULT_OPERATOR_COLORS },
  otherDutiesColors: { ...DEFAULT_OTHER_DUTIES_COLORS },
  simulatorActivities: [...DEFAULT_SIMULATOR_ACTIVITIES],
  surveillanceActivities: [...DEFAULT_SURVEILLANCE_ACTIVITIES],
  surveillanceQualifications: {
    ...DEFAULT_SURVEILLANCE_QUALIFICATIONS,
  },
  simulatorMap: { ...DEFAULT_SIMULATOR_MAP },
  leaveTypes: [...DEFAULT_LEAVE_TYPES],
  dutySubTypes: [...DEFAULT_DUTY_SUBTYPES],
  editingEventId: null,
  editingStagingId: null,
};

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function rosterReducer(
  state: RosterState,
  action: RosterAction,
): RosterState {
  switch (action.type) {
    case "ADD_EVENT": {
      const incoming = action.payload;
      // If this is a calendar edit (carries sourceEventId) and the queue already
      // holds a staged edit of the same calendar event, replace it in place rather
      // than appending. Otherwise two staged items share a sourceEventId and both
      // restore to the same calendar id on commit, duplicating the event.
      if (incoming.sourceEventId) {
        const existingIdx = state.stagingQueue.findIndex(
          (e) => e.sourceEventId === incoming.sourceEventId,
        );
        if (existingIdx !== -1) {
          const nextQueue = [...state.stagingQueue];
          nextQueue[existingIdx] = incoming;
          return { ...state, stagingQueue: nextQueue };
        }
      }
      return {
        ...state,
        stagingQueue: [...state.stagingQueue, incoming],
      };
    }

    case "REMOVE_EVENT": {
      const idx = state.stagingQueue.findIndex((e) => e.id === action.payload);
      if (idx === -1) return state;
      return {
        ...state,
        stagingQueue: state.stagingQueue.filter((_, i) => i !== idx),
      };
    }

    case "COMMIT_EVENT": {
      const idx = state.stagingQueue.findIndex((e) => e.id === action.payload);
      if (idx === -1) return state;
      const event = state.stagingQueue[idx];
      // Atomic swap: if this staged item was an edit of a calendar event,
      // remove the original in the same state update.
      const sourceId = event.sourceEventId;
      const baseCalendar = sourceId
        ? state.calendarEvents.filter((e) => e.id !== sourceId)
        : state.calendarEvents;
      // Strip the internal sourceEventId before placing on the calendar.
      // Restore the original event's ID so the HTML changelog diff can match
      // this committed edit to its snapshot entry (same ID = Changed, not Remove+Add).
      const { sourceEventId: _src, ...rest } = event as BaseEvent &
        Record<string, unknown>;
      const withOriginalId = sourceId ? { ...rest, id: sourceId } : rest;
      const original = sourceId
        ? state.calendarEvents.find((e) => e.id === sourceId)
        : undefined;
      const calendarEvent = applyCommittedHistory(
        withOriginalId as RosterEvent,
        original,
      );
      return {
        ...state,
        stagingQueue: state.stagingQueue.filter((_, i) => i !== idx),
        calendarEvents: [...baseCalendar, calendarEvent],
      };
    }

    case "COMMIT_ALL": {
      // Collect all sourceEventIds that need to be removed
      const sourceIds = new Set(
        state.stagingQueue
          .map((e) => e.sourceEventId)
          .filter(Boolean) as string[],
      );
      const baseCalendar = state.calendarEvents.filter(
        (e) => !sourceIds.has(e.id),
      );
      // Build a lookup of original calendar events for field diffing
      const originalMap = new Map(state.calendarEvents.map((e) => [e.id, e]));
      // Strip sourceEventId from every event before placing on the calendar;
      // attach previous values where the committed edit changed them.
      const stripped = state.stagingQueue.map((e) => {
        const { sourceEventId: _s, ...rest } = e as BaseEvent &
          Record<string, unknown>;
        // Restore the original ID so the HTML changelog diff sees a "Changed"
        // entry rather than a Remove+Add pair for edited events.
        const withOriginalId = e.sourceEventId
          ? { ...rest, id: e.sourceEventId }
          : rest;
        if (e.sourceEventId) {
          const original = originalMap.get(e.sourceEventId);
          return applyCommittedHistory(withOriginalId as RosterEvent, original);
        }
        return withOriginalId as RosterEvent;
      });
      return {
        ...state,
        stagingQueue: [],
        calendarEvents: [...baseCalendar, ...stripped],
      };
    }

    case "REMOVE_CALENDAR_EVENT": {
      const idx = state.calendarEvents.findIndex(
        (e) => e.id === action.payload,
      );
      if (idx === -1) return state;
      return {
        ...state,
        calendarEvents: state.calendarEvents.filter((_, i) => i !== idx),
      };
    }

    case "CLEAR_EVENT_HISTORY": {
      const { id, kind } = action.payload;
      const event = state.calendarEvents.find((e) => e.id === id);
      if (!event) return state;
      const updated = { ...event };
      const history = { ...(updated.previousValues ?? {}) };
      if (kind === "inspectors") {
        delete updated.previousInspectors;
        delete history.inspectors;
      } else if (kind === "time") {
        delete updated.previousStartTime;
        delete updated.previousEndTime;
        delete history.startTime;
        delete history.endTime;
      } else {
        delete history[kind];
        if (kind === "startTime") {
          delete updated.previousStartTime;
        } else if (kind === "endTime") {
          delete updated.previousEndTime;
        }
      }
      if (Object.keys(history).length > 0) updated.previousValues = history;
      else delete updated.previousValues;
      return {
        ...state,
        calendarEvents: state.calendarEvents.map((e) =>
          e.id === id ? updated : e,
        ),
      };
    }

    case "ADD_INSPECTOR": {
      const newInspector = action.payload;
      const newPos = newInspector.position;
      // Positions held by existing inspectors BEFORE this addition.
      const existingPositions = new Set(
        state.inspectors.map((i) => i.position),
      );
      const isNewPosition = !existingPositions.has(newPos);

      // Any qualification activity that already contained every existing position
      // was displaying "All". Expand those arrays to include the new position so
      // they continue to show "All" rather than exploding into an explicit list.
      const expandAll = (quals: Qualifications): Qualifications => {
        if (!isNewPosition || existingPositions.size === 0) return quals;
        const updated = { ...quals };
        let changed = false;
        for (const [activity, permitted] of Object.entries(updated)) {
          const permittedSet = new Set(permitted);
          const wasAll = [...existingPositions].every((p) =>
            permittedSet.has(p),
          );
          if (wasAll && !permittedSet.has(newPos)) {
            updated[activity] = [...permitted, newPos];
            changed = true;
          }
        }
        return changed ? updated : quals;
      };
      const qualifications = expandAll(state.qualifications);
      const surveillanceQualifications = expandAll(
        state.surveillanceQualifications,
      );

      const sortedInspectors = sortInspectorsByName([
        ...state.inspectors,
        newInspector,
      ]);
      return {
        ...state,
        inspectors: sortedInspectors,
        qualifications,
        surveillanceQualifications,
      };
    }

    case "REMOVE_INSPECTOR":
      return {
        ...state,
        inspectors: state.inspectors.filter((i) => i.id !== action.payload),
      };

    case "TOGGLE_QUALIFICATION": {
      const { activity, position } = action.payload;
      const current = state.qualifications[activity] ?? [];
      const next = current.includes(position)
        ? current.filter((p) => p !== position)
        : [...current, position];
      return {
        ...state,
        qualifications: { ...state.qualifications, [activity]: next },
      };
    }

    case "SET_ACTIVITY_QUALIFICATIONS": {
      const { activity, positions } = action.payload;
      return {
        ...state,
        qualifications: { ...state.qualifications, [activity]: positions },
      };
    }

    case "SET_SURVEILLANCE_QUALIFICATIONS": {
      const { activity, positions } = action.payload;
      return {
        ...state,
        surveillanceQualifications: {
          ...state.surveillanceQualifications,
          [activity]: positions,
        },
      };
    }

    case "ADD_LIST_ITEM": {
      const { list, value } = action.payload;
      if (state[list].includes(value)) return state;
      // When a new operator is added, seed it with a neutral default color
      const extra =
        list === "operators"
          ? {
              operatorColors: {
                ...state.operatorColors,
                [value]: state.operatorColors[value] ?? "#6b7280",
              },
            }
          : list === "dutySubTypes"
            ? {
                otherDutiesColors: {
                  ...state.otherDutiesColors,
                  [value]:
                    state.otherDutiesColors[value] ??
                    DEFAULT_OTHER_DUTIES_COLORS[DEFAULT_DUTY_SUBTYPES[0]],
                },
              }
          : {};
      const sorted = [...state[list], value].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
      return { ...state, [list]: sorted, ...extra };
    }

    case "REMOVE_LIST_ITEM": {
      const { list, value } = action.payload;
      if (list === "dutySubTypes") {
        const { [value]: _removed, ...otherDutiesColors } =
          state.otherDutiesColors;
        return {
          ...state,
          [list]: state[list].filter((v) => v !== value),
          otherDutiesColors,
        };
      }
      return { ...state, [list]: state[list].filter((v) => v !== value) };
    }

    case "RENAME_LIST_ITEM": {
      const { list, oldValue, newValue } = action.payload;
      const trimmed = newValue.trim();
      if (!trimmed || trimmed === oldValue || state[list].includes(trimmed)) return state;
      const renamed = state[list].map((v) => (v === oldValue ? trimmed : v))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
      // Migrate qualification maps when an activity is renamed
      if (list === "simulatorActivities" && oldValue in state.qualifications) {
        const { [oldValue]: positions, ...restQuals } = state.qualifications;
        return { ...state, [list]: renamed, qualifications: { ...restQuals, [trimmed]: positions } };
      }
      if (list === "surveillanceActivities" && oldValue in state.surveillanceQualifications) {
        const { [oldValue]: positions, ...restQuals } = state.surveillanceQualifications;
        return { ...state, [list]: renamed, surveillanceQualifications: { ...restQuals, [trimmed]: positions } };
      }
      if (list === "dutySubTypes" && oldValue in state.otherDutiesColors) {
        const { [oldValue]: color, ...restColors } = state.otherDutiesColors;
        return {
          ...state,
          [list]: renamed,
          otherDutiesColors: { ...restColors, [trimmed]: color },
        };
      }
      return { ...state, [list]: renamed };
    }

    case "SET_OPERATOR_COLOR": {
      const { operator, color } = action.payload;
      return {
        ...state,
        operatorColors: { ...state.operatorColors, [operator]: color },
      };
    }

    case "SET_OTHER_DUTIES_COLOR": {
      const { subType, color } = action.payload;
      return {
        ...state,
        otherDutiesColors: { ...state.otherDutiesColors, [subType]: color },
      };
    }

    case "SET_SIM_MAP_ENTRY": {
      const { code, aircraftType } = action.payload;
      const trimmed = code.trim();
      if (!trimmed) return state;
      return {
        ...state,
        simulatorMap: { ...state.simulatorMap, [trimmed]: aircraftType },
      };
    }

    case "REMOVE_SIM_MAP_ENTRY": {
      const { [action.payload]: _removed, ...rest } = state.simulatorMap;
      return { ...state, simulatorMap: rest };
    }

    case "SET_EDITING_EVENT_ID":
      return { ...state, editingEventId: action.payload };

    case "UPDATE_CALENDAR_EVENT": {
      const { id, data } = action.payload;
      return {
        ...state,
        calendarEvents: state.calendarEvents.map((e) =>
          e.id === id ? ({ ...data, id } as RosterEvent) : e,
        ),
      };
    }

    case "SET_EDITING_STAGING_ID":
      return { ...state, editingStagingId: action.payload };

    case "UPDATE_STAGING_EVENT": {
      const { id, data } = action.payload;
      return {
        ...state,
        stagingQueue: state.stagingQueue.map((e) => {
          if (e.id !== id) return e;
          // Preserve identity fields linking a staged edit to its original
          // calendar event. The form-built payload never includes these; if
          // they are dropped the item is treated as brand-new on commit
          // (duplicating the original) and validation stops excluding the
          // original (false self-conflicts).
          return {
            ...data,
            id,
            sourceEventId: data.sourceEventId ?? e.sourceEventId,
            previousInspectors: data.previousInspectors ?? e.previousInspectors,
            previousStartTime: data.previousStartTime ?? e.previousStartTime,
            previousEndTime: data.previousEndTime ?? e.previousEndTime,
            previousValues: data.previousValues ?? e.previousValues,
          } as RosterEvent;
        }),
      };
    }

    case "INIT":
      // ephemeral IDs — always reset on hydration
      return {
        ...action.payload,
        editingEventId: null,
        editingStagingId: null,
      };

    case "IMPORT_STATE":
      // Overwrite only the keys present in the imported payload; edit modes always reset
      return {
        ...state,
        ...action.payload,
        editingEventId: null,
        editingStagingId: null,
      };

    case "RESET_ALL":
      // Full factory reset — return initialRosterState so every field reverts
      // to its DEFAULT_* value. The persist effect will write defaults back to
      // localStorage on the next render cycle.
      return { ...initialRosterState };

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const RosterContext = createContext<RosterContextValue | null>(null);

// ─── ID generation ────────────────────────────────────────────────────────────

let _idCounter = 0;

export function generateId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${_idCounter++}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Convert the retired event discriminator at the storage/import boundary.
 * Simulator-specific fields are intentionally preserved; only eventType changes.
 */
export function normalizeLegacyEventType<T extends { eventType?: unknown }>(event: T): T {
  if (event.eventType === "Simulator") {
    return { ...event, eventType: "Operator Request" } as T;
  }
  return event;
}

/** Normalize the multi-code Operator Request shape at every storage boundary. */
function normalizeSimulatorCodes(
  normalized: Record<string, unknown>,
): Record<string, unknown> {
  if (normalized.eventType !== "Operator Request") return normalized;
  const codes = Array.isArray(normalized.simulatorCodes)
    ? normalized.simulatorCodes.filter(isStr)
    : typeof normalized.simulatorCode === "string" && normalized.simulatorCode
      ? [normalized.simulatorCode]
      : [];
  normalized.simulatorCodes = codes;
  normalized.simulatorCode = codes[0] ?? "";
  return normalized;
}
/**
 * Migrate a raw event record from legacy Inspection shapes to Surveillance:
 * - eventType "Inspection" → "Surveillance"
 * - single inspectionType string → surveillanceTypes: string[]
 * - route / flightNo / station → merged free-text details
 * Mutates and returns the given record. Safe to call on already-new events.
 */
function migrateSurveillanceRecord(
  normalized: Record<string, unknown>,
): Record<string, unknown> {
  if (normalized.eventType === "Inspection") {
    normalized.eventType = "Surveillance";
  }
  if (normalized.eventType === "Surveillance") {
    if (
      !Array.isArray(normalized.surveillanceTypes) ||
      !(normalized.surveillanceTypes as unknown[]).every(
        (t) => typeof t === "string",
      )
    ) {
      normalized.surveillanceTypes =
        typeof normalized.inspectionType === "string" &&
        normalized.inspectionType
          ? [normalized.inspectionType]
          : [];
    }
    if (typeof normalized.details !== "string") {
      normalized.details = [
        normalized.station,
        normalized.route,
        normalized.flightNo,
      ]
        .filter((v): v is string => typeof v === "string" && v.trim() !== "")
        .join(" ");
    }
    if (typeof normalized.operator !== "string") normalized.operator = "";
    delete normalized.inspectionType;
    delete normalized.route;
    delete normalized.flightNo;
    delete normalized.station;
  }
  return normalized;
}

function sanitizeOtherDutiesColor(
  normalized: Record<string, unknown>,
): Record<string, unknown> {
  if (
    normalized.eventType === "Other Duties" &&
    (typeof normalized.customColor !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(normalized.customColor))
  ) {
    delete normalized.customColor;
  }
  return normalized;
}

function sanitizeOtherDutiesPresentation(
  normalized: Record<string, unknown>,
): Record<string, unknown> {
  if (
    normalized.eventType === "Other Duties" &&
    typeof normalized.appendRemarkToCalendarPill !== "boolean"
  ) {
    // The field was added after existing rosters were created. Omission and
    // malformed imported values both mean the legacy false behavior.
    delete normalized.appendRemarkToCalendarPill;
  }
  return normalized;
}

export function parseEvents(
  raw: string | null,
  onCorrupt?: () => void,
): RosterEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is Record<string, unknown> =>
          !!e && typeof e === "object" && "eventType" in e && "date" in e,
      )
      .map((e) => {
        const normalized: Record<string, unknown> = {
          ...e,
          id: e.id != null ? String(e.id) : generateId(),
        };
        // Backward compat: Other Duties used to store operator: string; migrate to operators: string[]
        if (
          normalized.eventType === "Other Duties" &&
          !Array.isArray(normalized.operators) &&
          typeof normalized.operator === "string"
        ) {
          normalized.operators = [normalized.operator];
        }
        return sanitizeOtherDutiesPresentation(
          sanitizeOtherDutiesColor(
            normalizeSimulatorCodes(
              migrateSurveillanceRecord(normalizeLegacyEventType(normalized)),
            ),
          ),
        );
      }) as RosterEvent[];
  } catch {
    onCorrupt?.();
    return [];
  }
}

export function parseJson<T>(
  raw: string | null,
  fallback: T,
  onCorrupt?: () => void,
): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    onCorrupt?.();
    return fallback;
  }
}

// ─── Import sanitization ──────────────────────────────────────────────────────

const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(isStr);

/** Normalize an array of unknown records into valid RosterEvents; drops invalid entries. */
function sanitizeEvents(raw: unknown): RosterEvent[] | null {
  if (!Array.isArray(raw)) return null;
  const valid = raw.filter(
    (e): e is Record<string, unknown> =>
      !!e &&
      typeof e === "object" &&
      !Array.isArray(e) &&
      isStr(e.eventType) &&
      isStr(e.date) &&
      (e.startTime === undefined || isStr(e.startTime)) &&
      (e.endTime === undefined || isStr(e.endTime)) &&
      (e.inspectors === undefined || isStrArray(e.inspectors)),
  );
  return valid.map((e) => {
    const normalized: Record<string, unknown> = {
      ...e,
      id: e.id != null ? String(e.id) : generateId(),
      startTime: isStr(e.startTime) ? e.startTime : "",
      endTime: isStr(e.endTime) ? e.endTime : "",
      inspectors: isStrArray(e.inspectors) ? e.inspectors : [],
    };
    // Backward compat: Other Duties used to store operator: string; migrate to operators: string[]
    if (
      normalized.eventType === "Other Duties" &&
      !Array.isArray(normalized.operators) &&
      isStr(normalized.operator)
    ) {
      normalized.operators = [normalized.operator];
    }
    return sanitizeOtherDutiesPresentation(
      sanitizeOtherDutiesColor(
        normalizeSimulatorCodes(
          migrateSurveillanceRecord(normalizeLegacyEventType(normalized)),
        ),
      ),
    );
  }) as RosterEvent[];
}

function sanitizeInspectors(raw: unknown): Inspector[] | null {
  if (!Array.isArray(raw)) return null;
  const inspectors = raw
    .filter(
      (i): i is Record<string, unknown> =>
        !!i && typeof i === "object" && isStr(i.name) && isStr(i.position),
    )
    .map((i) => ({
      id: i.id != null ? String(i.id) : generateId(),
      name: i.name as string,
      position: i.position as string,
      ...(isStr((i as Record<string, unknown>).email)
        ? { email: (i as Record<string, unknown>).email as string }
        : {}),
    }));
  return sortInspectorsByName(inspectors);
}

function sanitizeQualifications(raw: unknown): Qualifications | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Qualifications = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isStrArray(v)) out[k] = v;
  }
  return out;
}

function sanitizeSimulatorMap(raw: unknown): SimulatorMap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: SimulatorMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isStr(v)) out[k] = v;
  }
  return out;
}

/** Validate a color map: only keeps entries with a valid #rrggbb hex value. */
function sanitizeColorMap(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isStr(v) && /^#[0-9a-fA-F]{6}$/.test(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Validate and normalize a parsed **events** backup file into a safe partial state.
 * Returns null when neither stagingQueue nor calendarEvents are present
 * (so a settings-only file is rejected).
 */
export function sanitizeImportedState(
  parsed: unknown,
): Partial<RosterState> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const p = parsed as Record<string, unknown>;

  const stagingQueue = sanitizeEvents(p.stagingQueue);
  const calendarEvents = sanitizeEvents(p.calendarEvents);

  // Require at least one event array — rejects a settings file used in the wrong importer
  if (!stagingQueue && !calendarEvents) return null;

  return {
    ...(stagingQueue ? { stagingQueue } : {}),
    ...(calendarEvents ? { calendarEvents } : {}),
  };
}

/**
 * Validate and normalize a parsed **settings** backup file into a safe partial state.
 * Returns null when none of the expected settings keys are present
 * (so an events-only file is rejected).
 */
export function sanitizeSettingsState(
  parsed: unknown,
): Partial<RosterState> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const p = parsed as Record<string, unknown>;

  const operators = isStrArray(p.operators) ? p.operators : null;
  const operatorColors = sanitizeColorMap(p.operatorColors);
  const otherDutiesColors = sanitizeColorMap(p.otherDutiesColors);
  const simulatorActivities = isStrArray(p.simulatorActivities)
    ? p.simulatorActivities
    : null;
  const simulatorMap = sanitizeSimulatorMap(p.simulatorMap);
  const inspectors = sanitizeInspectors(p.inspectors);
  const qualifications = sanitizeQualifications(p.qualifications);
  const surveillanceActivities = isStrArray(p.surveillanceActivities)
    ? p.surveillanceActivities
    : null;
  const surveillanceQualifications = sanitizeQualifications(
    p.surveillanceQualifications,
  );
  const leaveTypes = isStrArray(p.leaveTypes) && (p.leaveTypes as string[]).length > 0
    ? p.leaveTypes as string[]
    : null;
  const dutySubTypes = isStrArray(p.dutySubTypes) && (p.dutySubTypes as string[]).length > 0
    ? p.dutySubTypes as string[]
    : null;

  // Require at least one meaningful settings field — rejects an events-only file
  if (!operators && !inspectors && !qualifications) return null;

  return {
    ...(operators ? { operators } : {}),
    ...(operatorColors ? { operatorColors } : {}),
    ...(otherDutiesColors ? { otherDutiesColors } : {}),
    ...(simulatorActivities ? { simulatorActivities } : {}),
    ...(surveillanceActivities ? { surveillanceActivities } : {}),
    ...(surveillanceQualifications ? { surveillanceQualifications } : {}),
    ...(simulatorMap ? { simulatorMap } : {}),
    ...(inspectors ? { inspectors } : {}),
    ...(qualifications ? { qualifications } : {}),
    ...(leaveTypes ? { leaveTypes } : {}),
    ...(dutySubTypes ? { dutySubTypes } : {}),
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRosterStore(): RosterContextValue {
  const context = useContext(RosterContext);
  if (!context)
    throw new Error("useRosterStore must be used within RosterProvider");
  return context;
}
