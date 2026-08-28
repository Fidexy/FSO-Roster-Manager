import React, {
  useState,
  useEffect,
  useCallback,
  FormEvent,
  useRef,
} from "react";
import {
  useRosterStore,
  EventType,
  SIMULATOR_ACTIVITIES,
  sanitizeImportedState,
  sanitizeSettingsState,
  DEFAULT_INSPECTORS,
  DEFAULT_QUALIFICATIONS,
  DEFAULT_OPERATORS,
  DEFAULT_OPERATOR_COLORS,
  DEFAULT_OTHER_DUTIES_COLORS,
  DEFAULT_SIMULATOR_ACTIVITIES,
  DEFAULT_SIMULATOR_MAP,
  DEFAULT_SURVEILLANCE_ACTIVITIES,
  DEFAULT_SURVEILLANCE_QUALIFICATIONS,
  makeShortName,
  sortInspectorsByName,
} from "@/store/rosterStore";
import { validateEvent, EventInput } from "@/store/validateEvent";
import { motion, AnimatePresence } from "framer-motion";
import StagingQueue from "@/components/StagingQueue";
import CalendarGrid from "@/components/CalendarGrid";
import Settings from "@/components/Settings";
import ManagementSummary from "@/components/ManagementSummary";
import TimeInput from "@/components/TimeInput";
import {
  AlertTriangle,
  Calendar,
  Settings as SettingsIcon,
  Pencil,
  Download,
  Upload,
  Trash2,
  FileSpreadsheet,
  FileText,
  Save,
  Check,
  Loader2,
  Moon,
  Sun,
  ChevronDown,
  BarChart2,
  HelpCircle,
  X,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import * as XLSX from "xlsx";
import { exportWordCalendar, exportWordOperatorPlan } from "@/utils/wordExport";
import { saveFileWithPicker } from "@/utils/fileSave";
import { generateHtmlCalendar } from "@/utils/htmlExport";
import { expandDailyEventRange } from "@/utils/eventRange";
import { getHKHolidayMap } from "@/utils/holidays";
import {
  readExportVersion,
  incrementExportVersion,
  resetExportVersion,
  resetAllExportVersions,
  readVersionSnapshot,
  readVersionBaseline,
  writeVersionSnapshot,
  writeVersionBaseline,
  readVersionChangelog,
  writeVersionChangelog,
  appendVersionChangelogHistory,
  readVersionChangelogHistory,
} from "@/utils/exportVersion";
import { computeChangelog, hasTrackedChanges } from "@/utils/exportDiff";

type ActiveView = "calendar" | "settings" | "summary";

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDateKey(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

function getInitialSelectedDate(): string {
  const saved = localStorage.getItem("roster-last-date");
  return isValidDateKey(saved) ? saved : localDateKey();
}


const FieldInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={`w-full h-8 rounded border border-border bg-card px-2.5 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors disabled:opacity-50${className ? ` ${className}` : ""}`}
    {...props}
  />
));
FieldInput.displayName = "FieldInput";

const FieldSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>((props, ref) => (
  <select
    ref={ref}
    className="w-full h-8 rounded border border-border bg-card px-2.5 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors appearance-none cursor-pointer"
    style={{
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "right 10px center",
    }}
    {...props}
  />
));
FieldSelect.displayName = "FieldSelect";

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <label className="block text-xs font-medium text-muted-foreground mb-1">
    {children}
  </label>
);

export default function Home() {
  const { isDark, toggle: toggleTheme } = useTheme();
  const [showHelp, setHelp] = useState(false);
  const {
    state,
    addEventToQueue,
    setEditingEventId,
    removeCalendarEvent,
    setEditingStagingId,
    updateStagingEvent,
    removeEvent,
    importState,
    resetAll,
    manualSave,
    saveStatus,
  } = useRosterStore();
  const {
    stagingQueue,
    inspectors,
    qualifications,
    operators,
    simulatorActivities,
    surveillanceActivities,
    calendarEvents,
    editingEventId,
    editingStagingId,
    simulatorMap,
    leaveTypes,
    dutySubTypes,
    operatorColors,
    otherDutiesColors,
  } = state;

  const simCodes = Object.keys(simulatorMap).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  const [activeView, setActiveView] = useState<ActiveView>("calendar");

  // ── Form state ────────────────────────────────────────────────────────────
  const [eventType, setEventType] = useState<EventType>("Operator Request");
  const [date, setDate] = useState(getInitialSelectedDate);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [selectedInspectors, setSelectedInspectors] = useState<string[]>([]);

  // Simulator fields
  const [operator, setOperator] = useState("");
  const [simulatorCodes, setSimulatorCodes] = useState<string[]>([]);
  const [aircraftType, setAircraftType] = useState("");
  const [aircraftTypeManuallyEdited, setAircraftTypeManuallyEdited] =
    useState(false);
  const [activity, setActivity] = useState<string>("");
  const [useCustomActivity, setUseCustomActivity] = useState(false);
  const [candidateName, setCandidateName] = useState("");

  // Surveillance fields
  const [surveillanceTypes, setSurveillanceTypes] = useState<string[]>([]);
  const [surveillanceDetails, setSurveillanceDetails] = useState("");

  // Leave fields
  const [leaveType, setLeaveType] = useState("");
  const [customLeaveType, setCustomLeaveType] = useState("");
  const [leaveShift, setLeaveShift] = useState<"AM" | "PM" | null>(null);
  const [oooEndDate, setOooEndDate] = useState("");

  // Other Duties fields
  const [aexmorSubType, setAexmorSubType] = useState("");
  const [customSubType, setCustomSubType] = useState("");
  const [otherDutiesOperators, setOtherDutiesOperators] = useState<string[]>(
    [],
  );
  const [otherDutiesIncludeCustom, setOtherDutiesIncludeCustom] =
    useState(false);
  const [otherDutiesCustomOp, setOtherDutiesCustomOp] = useState("");
  const [otherDutiesCustomColor, setOtherDutiesCustomColor] = useState("#9ca3af");
  const [otherDutiesColorManuallySet, setOtherDutiesColorManuallySet] =
    useState(false);
  const [otherDutiesRemarks, setOtherDutiesRemarks] = useState("");
  const [otherDutiesAppendRemark, setOtherDutiesAppendRemark] = useState(false);

  const startTimeRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const settingsImportRef = useRef<HTMLInputElement>(null);

  // ── Data management: export / import / reset ──────────────────────────────
  const [dataNotice, setDataNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending notice timer on unmount
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const showNotice = (kind: "success" | "error", text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setDataNotice({ kind, text });
    noticeTimer.current = setTimeout(() => setDataNotice(null), 4000);
  };

  /** Build a JSON Blob from any payload. */
  const jsonBlob = (payload: unknown) =>
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });

  /** Apply the active calendar filters to an event list (mirrors CalendarGrid logic). */
  const applyCalendarFilters = (events: typeof calendarEvents) =>
    events.filter((e) => {
      if (filterOperators.size > 0) {
        if (e.eventType === "Leave") return false;
        if (e.eventType === "Other Duties") {
          if (!e.operators.some((op) => filterOperators.has(op))) return false;
        } else {
          if (!filterOperators.has(e.operator)) return false;
        }
      }
      if (filterInspectors.size > 0) {
        if (!e.inspectors.some((i) => filterInspectors.has(i))) return false;
      }
      return true;
    });

  /** Export settings only (everything except events). */
  const handleSettingsExport = async () => {
    const { operatorColors, otherDutiesColors } = state;
    const suggestedName = `settings-${new Date().toISOString().split("T")[0]}.json`;
    const blob = jsonBlob({
      exportDate: new Date().toISOString(),
      version: 1,
      operators,
      operatorColors,
      otherDutiesColors,
      simulatorActivities,
      simulatorMap,
      inspectors,
      qualifications,
      surveillanceActivities: state.surveillanceActivities,
      surveillanceQualifications: state.surveillanceQualifications,
      leaveTypes,
      dutySubTypes,
    });
    const result = await saveFileWithPicker(blob, suggestedName, [
      { description: "JSON file", accept: { "application/json": [".json"] } },
    ]);
    if (!result) return; // user cancelled
    const loc = result.usedPicker ? "" : " to Downloads";
    showNotice("success", `"${result.filename}" exported${loc}.`);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const sanitized = sanitizeImportedState(parsed);
        if (!sanitized) {
          throw new Error(
            'Not a valid roster backup. Use "Import Settings" for a settings file.',
          );
        }
        if (importMode === "add-to-queue") {
          // Merge all imported events into the staging queue for review
          const incoming = [
            ...(sanitized.calendarEvents ?? []),
            ...(sanitized.stagingQueue ?? []),
          ];
          importState({ stagingQueue: [...stagingQueue, ...incoming] });
          showNotice(
            "success",
            `${incoming.length} event(s) added to queue for review.`,
          );
        } else {
          importState(sanitized);
          resetAllExportVersions();
          const importedByMonth = new Map<
            string,
            NonNullable<typeof sanitized.calendarEvents>
          >();
          for (const event of sanitized.calendarEvents ?? []) {
            const monthStr = event.date.slice(0, 7);
            const monthEvents: NonNullable<typeof sanitized.calendarEvents> =
              importedByMonth.get(monthStr) ?? [];
            monthEvents.push(event);
            importedByMonth.set(monthStr, monthEvents);
          }
          for (const [monthStr, monthEvents] of importedByMonth) {
            writeVersionBaseline(monthStr, monthEvents);
          }
          setExportVersion(0);
          showNotice(
            "success",
            "Roster events restored from backup (overwrote existing).",
          );
        }
      } catch (err) {
        showNotice(
          "error",
          `Import failed: ${err instanceof Error ? err.message : "invalid JSON file."}`,
        );
      }
    };
    reader.onerror = () =>
      showNotice("error", "Import failed: could not read file.");
    reader.readAsText(file);
  };

  const handleSettingsImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const sanitized = sanitizeSettingsState(parsed);
        if (!sanitized) {
          throw new Error(
            'Not a valid settings file. Use "Import Roster" for a roster backup.',
          );
        }
        importState(sanitized);
        showNotice("success", "Settings restored from file.");
      } catch (err) {
        showNotice(
          "error",
          `Import failed: ${err instanceof Error ? err.message : "invalid JSON file."}`,
        );
      }
    };
    reader.onerror = () =>
      showNotice("error", "Import failed: could not read file.");
    reader.readAsText(file);
  };

  // ── Calendar filter state (lifted so handleExport can use them) ───────────
  const [filterOperators, setFilterOperators] = useState<Set<string>>(
    new Set(),
  );
  const [filterInspectors, setFilterInspectors] = useState<Set<string>>(
    new Set(),
  );

  // Currently viewed calendar month (lifted from CalendarGrid so exports can use it)
  const [calYear, setCalYear] = useState(() => {
    return Number(getInitialSelectedDate().split("-")[0]);
  });
  const [calMonth, setCalMonth] = useState(() => {
    return Number(getInitialSelectedDate().split("-")[1]); // 1-based
  });

  // ── Export dropdowns ──────────────────────────────────────────────────────
  type ExportPeriod = "current" | "all" | "alltime";
  type ExportFormat =
    | "excel"
    | "docx"
    | "json"
    | "html"
    | "docx-operator"
    | "docx-batch";
  const [exportPeriod, setExportPeriod] = useState<ExportPeriod>("current");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("excel");
  // Selected operator for the single-operator sim plan export
  const [exportOperator, setExportOperator] = useState<string>("");
  // Keep exportOperator in sync with the operator list
  useEffect(() => {
    if (operators.length === 0) {
      setExportOperator("");
      return;
    }
    if (!operators.includes(exportOperator)) setExportOperator(operators[0]);
  }, [operators]);

  // ── Import mode ───────────────────────────────────────────────────────────
  type ImportMode = "add-to-queue" | "overwrite";
  const [importMode, setImportMode] = useState<ImportMode>("add-to-queue");

  // ── Toolbar popover open state ────────────────────────────────────────────
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  useEffect(() => {
    const close = () => {
      setExportOpen(false);
      setImportOpen(false);
      setClearOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // ── Persist last selected date ────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem("roster-last-date", date);
  }, [date]);

  // ── Export version counter (per-month, localStorage-backed) ──────────────
  const [exportVersion, setExportVersion] = useState<number>(0);
  const [pendingNewVersion, setPendingNewVersion] = useState(false);
  useEffect(() => {
    const ms = `${calYear}-${String(calMonth).padStart(2, "0")}`;
    setExportVersion(readExportVersion(ms));
    setPendingNewVersion(false); // reset confirmation when navigating months
  }, [calYear, calMonth]);

  const handleResetVersion = () => {
    const ms = `${calYear}-${String(calMonth).padStart(2, "0")}`;
    resetExportVersion(ms);
    setExportVersion(0);
  };

  const handlePeriodChange = (period: ExportPeriod) => {
    setExportPeriod(period);
    // these formats are only valid for current month; auto-fallback when switching to all
    if (
      (period === "all" || period === "alltime") &&
      ["docx", "html", "docx-operator", "docx-batch"].includes(exportFormat)
    ) {
      setExportFormat("excel");
    }
  };

  // ── Commit a new version explicitly ──────────────────────────────────────
  const handleCommitVersion = () => {
    const ms = `${calYear}-${String(calMonth).padStart(2, "0")}`;
    // Always use unfiltered events — active calendar filters must not affect versioning
    const monthEvents = calendarEvents.filter((e) =>
      e.date.startsWith(ms + "-"),
    );
    // 1. Compute changelog against the PREVIOUS snapshot or imported baseline
    // BEFORE overwriting the committed snapshot.
    const previousSnapshot = readVersionSnapshot(ms) ?? readVersionBaseline(ms);
    // A brand-new roster has no baseline, so its first commit compares against
    // an empty roster. An imported roster compares against its imported state.
    const changelog = computeChangelog(previousSnapshot ?? [], monthEvents);
    writeVersionChangelog(ms, changelog);
    // 2. Now overwrite the snapshot with the current state
    writeVersionSnapshot(ms, monthEvents);
    // 3. Finally bump the version counter
    const newVersion = incrementExportVersion(ms);
    appendVersionChangelogHistory(ms, newVersion, changelog, monthEvents);
    setExportVersion(newVersion);
    setPendingNewVersion(false);
  };

  const handleExportAction = async () => {
    const anyFilterActive =
      filterOperators.size > 0 || filterInspectors.size > 0;
    const monthStr = `${calYear}-${String(calMonth).padStart(2, "0")}`;
    const periodPrefix =
      exportPeriod === "current"
        ? monthStr
        : exportPeriod === "all"
          ? String(calYear)
          : "all-time";

    // Today's full date for filenames
    const today = new Date().toISOString().split("T")[0];

    // Use the current committed version — never auto-increment on export
    const version =
      exportPeriod === "current" ? readExportVersion(monthStr) : 0;

    // Detect uncommitted changes: compare unfiltered month events to snapshot.
    // If dirty, treat as an unversioned draft — no version suffix, no changelog popup.
    const unfilteredMonthEvents = calendarEvents.filter((e) =>
      e.date.startsWith(monthStr + "-"),
    );
    const snapshot = version > 0 ? readVersionSnapshot(monthStr) : null;
    const isDraft =
      version > 0 &&
      snapshot !== null &&
      hasTrackedChanges(snapshot, unfilteredMonthEvents);
    const effectiveVersion = isDraft ? 0 : version;
    const vSuffix = effectiveVersion > 0 ? `-v${effectiveVersion}` : "";

    // Base event list, with optional calendar-filter applied
    let events = anyFilterActive
      ? applyCalendarFilters(calendarEvents)
      : calendarEvents;
    // Narrow to the selected period ("alltime" → no filter)
    if (exportPeriod !== "alltime") {
      events = events.filter((e) => e.date.startsWith(periodPrefix));
    }

    /** Helper: build the notice text from a SaveResult. */
    const notice = (filename: string, usedPicker: boolean, detail: string) => {
      const loc = usedPicker ? "" : " to Downloads";
      showNotice(
        "success",
        `"${filename}" exported${loc}${detail ? ` (${detail})` : ""}.`,
      );
    };

    if (exportFormat === "docx-operator") {
      const op = exportOperator;
      const simEvents = events.filter(
        (e) => e.eventType === "Operator Request" && e.operator === op,
      );
      const blob = await exportWordOperatorPlan(
        calYear,
        calMonth,
        simEvents,
        state.operatorColors,
        op,
        state.inspectors,
      );
      const suggestedName = `Monthly_Plan_FSO_Inspecting_Staff_${op}_${monthStr}_${today}.docx`;
      const result = await saveFileWithPicker(blob, suggestedName, [
        {
          description: "Word document",
          accept: {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
              [".docx"],
          },
        },
      ]);
      if (!result) return;
      notice(result.filename, result.usedPicker, op);
      return;
    }

    if (exportFormat === "docx-batch") {
      const activeOps = [
        ...new Set(
          events
            .filter((e) => e.eventType === "Operator Request")
            .map((e) => e.operator)
            .filter(Boolean),
        ),
      ].sort() as string[];
      if (activeOps.length === 0) {
        showNotice("error", "No Operator Request events found for this month.");
        return;
      }
      const { zipSync } = await import("fflate");
      const files: Record<string, Uint8Array> = {};
      for (const op of activeOps) {
        const simEvents = events.filter(
          (e) => e.eventType === "Operator Request" && e.operator === op,
        );
        const blob = await exportWordOperatorPlan(
          calYear,
          calMonth,
          simEvents,
          state.operatorColors,
          op,
          state.inspectors,
        );
        const buf = await blob.arrayBuffer();
        files[`Monthly_Plan_FSO_Inspecting_Staff_${op}_${monthStr}.docx`] = new Uint8Array(buf);
      }
      const zipped = zipSync(files);
      const zipBlob = new Blob([zipped], { type: "application/zip" });
      const suggestedName = `Monthly_Plan_FSO_Inspecting_Staff_${monthStr}_${today}.zip`;
      const result = await saveFileWithPicker(zipBlob, suggestedName, [
        { description: "ZIP archive", accept: { "application/zip": [".zip"] } },
      ]);
      if (!result) return;
      notice(
        result.filename,
        result.usedPicker,
        `${activeOps.length} operator${activeOps.length === 1 ? "" : "s"}`,
      );
      return;
    }

    if (exportFormat === "docx") {
      const allEvents = anyFilterActive
        ? applyCalendarFilters(calendarEvents)
        : calendarEvents;
      const suggestedName = `Monthly_Plan_${monthStr}_${today}${vSuffix}.docx`;
      const blob = await exportWordCalendar(
        calYear,
        calMonth,
        allEvents,
        state.operatorColors,
        effectiveVersion,
        state.otherDutiesColors,
      );
      const result = await saveFileWithPicker(blob, suggestedName, [
        {
          description: "Word document",
          accept: {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
              [".docx"],
          },
        },
      ]);
      if (!result) return;
      const draftNote = isDraft ? "; uncommitted changes present" : "";
      notice(
        result.filename,
        result.usedPicker,
        monthStr + vSuffix + draftNote,
      );
      return;
    }

    if (exportFormat === "html") {
      const allEvents = anyFilterActive
        ? applyCalendarFilters(calendarEvents)
        : calendarEvents;
      // Changelog is only meaningful when the export matches the committed state.
      // If there are uncommitted changes, suppress the popup (isDraft → effectiveVersion = 0 → no popup).
      const changelog = !isDraft ? readVersionChangelog(monthStr) : [];
      const exportId = `${monthStr}-v${effectiveVersion}-${Date.now()}`;
      const htmlStr = generateHtmlCalendar(
        calYear,
        calMonth,
        allEvents,
        state.operatorColors,
        state.otherDutiesColors,
        state.operators,
        state.inspectors.map((i) => i.name),
        getHKHolidayMap(calYear),
        effectiveVersion,
        changelog,
        exportId,
        !isDraft ? readVersionChangelogHistory(monthStr) : [],
        !isDraft ? unfilteredMonthEvents : undefined,
        !isDraft && readVersionBaseline(monthStr) !== null,
      );
      const suggestedName = `roster-${monthStr}_${today}${vSuffix}.html`;
      const blob = new Blob([htmlStr], { type: "text/html;charset=utf-8" });
      const result = await saveFileWithPicker(blob, suggestedName, [
        { description: "HTML file", accept: { "text/html": [".html"] } },
      ]);
      if (!result) return;
      const draftNote = isDraft ? "; uncommitted changes present" : "";
      notice(result.filename, result.usedPicker, draftNote.slice(2)); // trim leading '; '
      return;
    }

    if (exportFormat === "json") {
      const suggestedName = `roster-backup-${periodPrefix}_${today}${vSuffix}.json`;
      const blob = jsonBlob({
        exportDate: new Date().toISOString(),
        version: 2,
        stagingQueue,
        calendarEvents: events,
      });
      const result = await saveFileWithPicker(blob, suggestedName, [
        { description: "JSON file", accept: { "application/json": [".json"] } },
      ]);
      if (!result) return;
      notice(result.filename, result.usedPicker, `${events.length} event(s)`);
      return;
    }

    // Excel — use XLSX.write to get a buffer, then route through the picker
    const rows = events.map((e) => {
      const base = {
        Date: e.date,
        "Start Time": e.startTime,
        "End Time": e.endTime,
        "Event Type": e.eventType,
        Inspectors: e.inspectors.join(", "),
      };
      if (e.eventType === "Operator Request") {
        return {
          ...base,
          Operator: e.operator,
          "Sim Code": e.simulatorCodes?.join(", ") ?? e.simulatorCode,
          Aircraft: e.aircraftType,
          Activity: e.activity,
          Candidate: e.candidateName,
          "Surveillance Type(s)": "",
          Details: "",
          "Leave Type": "",
          "Sub-type": "",
        };
      }
      if (e.eventType === "Surveillance") {
        return {
          ...base,
          Operator: e.operator,
          "Sim Code": "",
          Aircraft: "",
          Activity: "",
          Candidate: "",
          "Surveillance Type(s)": e.surveillanceTypes.join(", "),
          Details: e.details,
          "Leave Type": "",
          "Sub-type": "",
        };
      }
      if (e.eventType === "Other Duties") {
        return {
          ...base,
          Operator: e.operators?.join(", ") ?? "",
          "Sim Code": "",
          Aircraft: "",
          Activity: "",
          Candidate: "",
          "Surveillance Type(s)": "",
          Details: "",
          "Leave Type": "",
          "Sub-type": e.subType,
          Remarks: e.remarks ?? "",
        };
      }
      return {
        ...base,
        Operator: "",
        "Sim Code": "",
        Aircraft: "",
        Activity: "",
        Candidate: "",
        "Surveillance Type(s)": "",
        Details: "",
        "Leave Type": e.leaveType,
        "Sub-type": "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Roster Data");
    const buf = XLSX.write(wb, {
      bookType: "xlsx",
      type: "array",
    }) as ArrayBuffer;
    const suggestedName = `roster-data-${periodPrefix}_${today}${vSuffix}.xlsx`;
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const result = await saveFileWithPicker(blob, suggestedName, [
      {
        description: "Excel spreadsheet",
        accept: {
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
            ".xlsx",
          ],
        },
      },
    ]);
    if (!result) return;
    notice(result.filename, result.usedPicker, `${events.length} event(s)`);
  };

  const handleResetSettings = () => {
    if (
      window.confirm(
        "Reset all settings to defaults? This will clear inspectors, operators, qualifications, simulator codes, and colours. Roster events are not affected. This cannot be undone.",
      )
    ) {
      importState({
        inspectors: DEFAULT_INSPECTORS,
        qualifications: DEFAULT_QUALIFICATIONS,
        operators: [...DEFAULT_OPERATORS],
        operatorColors: { ...DEFAULT_OPERATOR_COLORS },
        otherDutiesColors: { ...DEFAULT_OTHER_DUTIES_COLORS },
        simulatorActivities: [...DEFAULT_SIMULATOR_ACTIVITIES],
        surveillanceActivities: [...DEFAULT_SURVEILLANCE_ACTIVITIES],
        surveillanceQualifications: { ...DEFAULT_SURVEILLANCE_QUALIFICATIONS },
        simulatorMap: { ...DEFAULT_SIMULATOR_MAP },
      });
      showNotice("success", "Settings reset to defaults.");
    }
  };

  const handleClearMonth = () => {
    const monthStr = `${calYear}-${String(calMonth).padStart(2, "0")}`;
    const monthLabel = new Date(calYear, calMonth - 1).toLocaleString(
      "default",
      { month: "long" },
    );
    const eventsInMonth = calendarEvents.filter((e) =>
      e.date.startsWith(monthStr),
    ).length;
    const queueInMonth = stagingQueue.filter((e) =>
      e.date.startsWith(monthStr),
    ).length;
    const total = eventsInMonth + queueInMonth;
    if (total === 0) {
      showNotice("error", `No events in ${monthLabel} ${calYear} to clear.`);
      return;
    }
    if (
      window.confirm(
        `Clear all ${total} event(s) in ${monthLabel} ${calYear}? This cannot be undone.`,
      )
    ) {
      importState({
        calendarEvents: calendarEvents.filter(
          (e) => !e.date.startsWith(monthStr),
        ),
        stagingQueue: stagingQueue.filter((e) => !e.date.startsWith(monthStr)),
      });
      resetExportVersion(monthStr);
      setExportVersion(0);
      showNotice(
        "success",
        `${monthLabel} ${calYear} cleared (${total} event(s) removed).`,
      );
    }
  };

  const handleClearAll = () => {
    const total = calendarEvents.length + stagingQueue.length;
    if (total === 0) {
      showNotice("error", "Roster is already empty.");
      return;
    }
    if (
      window.confirm(
        `Clear the entire roster? This removes all ${total} event(s) across all months and the staging queue. Settings are not affected. This cannot be undone.`,
      )
    ) {
      importState({ stagingQueue: [], calendarEvents: [] });
      resetAllExportVersions();
      setExportVersion(0);
      showNotice("success", `Roster cleared (${total} event(s) removed).`);
    }
  };

  // ── Edit overlay (shown when a calendar event is clicked, dismissed by "Edit" button) ──
  const [showEditOverlay, setShowEditOverlay] = useState(false);

  useEffect(() => {
    setShowEditOverlay(Boolean(editingEventId));
  }, [editingEventId]);

  // ── Validation error for edit mode ────────────────────────────────────────
  const [validationError, setValidationError] = useState<string | null>(null);

  // ── Snap form selects when their option lists change in Settings ───────────
  // Only snap if the user already had a value selected that no longer exists —
  // never auto-fill a blank field.
  useEffect(() => {
    if (
      operator &&
      operator !== "N/A" &&
      operators.length > 0 &&
      !operators.includes(operator)
    )
      setOperator("");
  }, [operators]);

  useEffect(() => {
    if (
      !useCustomActivity &&
      activity &&
      simulatorActivities.length > 0 &&
      !simulatorActivities.includes(activity)
    ) {
      setActivity("");
      setSelectedInspectors([]);
    }
  }, [simulatorActivities, useCustomActivity]);

  // Remove simulator codes that were deleted from Settings (but leave blank alone).
  useEffect(() => {
    setSimulatorCodes((current) =>
      current.filter((code) => code in simulatorMap),
    );
  }, [simulatorMap]);

  // Use the first simulator code as the initial suggestion, but preserve a
  // manually entered aircraft type when the selected codes change.
  useEffect(() => {
    if (aircraftTypeManuallyEdited) return;
    setAircraftType(simulatorMap[simulatorCodes[0]] ?? "");
  }, [aircraftTypeManuallyEdited, simulatorCodes, simulatorMap]);

  const defaultOtherDutiesColor =
    operatorColors[
      otherDutiesOperators.find((op) => op.toLowerCase() !== "n/a") ?? ""
    ] ?? "#9ca3af";

  useEffect(() => {
    if (aexmorSubType === "Custom" && !otherDutiesColorManuallySet) {
      setOtherDutiesCustomColor(defaultOtherDutiesColor);
    }
  }, [
    aexmorSubType,
    defaultOtherDutiesColor,
    otherDutiesColorManuallySet,
  ]);

  // ── Reset form to blank defaults ──────────────────────────────────────────
  const resetForm = useCallback(() => {
    setValidationError(null);
    setEditingEventId(null);
    setEditingStagingId(null);
    setShowEditOverlay(false);
    setEventType("Operator Request");
    setStartTime("");
    setEndTime("");
    setSelectedInspectors([]);
    setOperator("");
    setSimulatorCodes([]);
    setAircraftType("");
    setAircraftTypeManuallyEdited(false);
    setActivity("");
    setUseCustomActivity(false);
    setCandidateName("");
    setSurveillanceTypes([]);
    setSurveillanceDetails("");
    setLeaveType("");
    setCustomLeaveType("");
    setLeaveShift(null);
    setOooEndDate("");
    setAexmorSubType("");
    setCustomSubType("");
    setOtherDutiesOperators([]);
    setOtherDutiesIncludeCustom(false);
    setOtherDutiesCustomOp("");
    setOtherDutiesCustomColor("#9ca3af");
    setOtherDutiesColorManuallySet(false);
    setOtherDutiesRemarks("");
    setOtherDutiesAppendRemark(false);
  }, [operators, simulatorActivities]);

  // ── Populate form when entering edit mode ─────────────────────────────────
  useEffect(() => {
    if (!editingEventId) return;
    const event = calendarEvents.find((e) => e.id === editingEventId);
    if (!event) return;

    setEventType(event.eventType);
    setDate(event.date);
    setStartTime(event.startTime);
    setEndTime(event.endTime);
    setSelectedInspectors([...event.inspectors]);
    setLeaveShift(
      event.eventType === "Leave"
        ? event.leaveShift ?? null
        : event.eventType === "Other Duties"
          ? event.otherDutiesShift ?? null
          : null,
    );

    if (event.eventType === "Operator Request") {
      setOperator(event.operator);
      setSimulatorCodes(
        event.simulatorCodes?.length
          ? [...event.simulatorCodes]
          : event.simulatorCode
            ? [event.simulatorCode]
            : [],
      );
      setAircraftType(event.aircraftType ?? "");
      setAircraftTypeManuallyEdited(true);
      setActivity(event.activity);
      setCandidateName(event.candidateName);
      setUseCustomActivity(
        !!event.activity && !simulatorActivities.includes(event.activity),
      );
    } else if (event.eventType === "Surveillance") {
      setOperator(event.operator);
      setSurveillanceTypes([...event.surveillanceTypes]);
      setSurveillanceDetails(event.details ?? "");
    } else if (event.eventType === "Other Duties") {
      const storedOps = event.operators ?? [];
      const knownSet = new Set(operators);
      setOtherDutiesOperators(
        storedOps.filter((op) => knownSet.has(op) || op === "N/A"),
      );
      const customOp = storedOps.find(
        (op) => !knownSet.has(op) && op !== "N/A",
      );
      setOtherDutiesIncludeCustom(!!customOp);
      setOtherDutiesCustomOp(customOp ?? "");
      setOtherDutiesRemarks(event.remarks ?? "");
      setOtherDutiesAppendRemark(event.appendRemarkToCalendarPill === true);
      const isPresetSub = dutySubTypes.includes(event.subType);
      setAexmorSubType(isPresetSub ? event.subType : "Custom");
      setCustomSubType(isPresetSub ? "" : event.subType);
      const savedColor =
        typeof event.customColor === "string" &&
        /^#[0-9a-f]{6}$/i.test(event.customColor)
          ? event.customColor
          : null;
      setOtherDutiesCustomColor(savedColor ?? "#9ca3af");
      setOtherDutiesColorManuallySet(!!savedColor);
    } else {
      const isPreset = leaveTypes.includes(event.leaveType);
      setLeaveType(isPreset ? event.leaveType : "Custom");
      setCustomLeaveType(isPreset ? "" : event.leaveType);
      setOooEndDate("");
    }
  }, [editingEventId, leaveTypes, dutySubTypes]);

  // ── Populate form when entering staging-edit mode ─────────────────────────
  useEffect(() => {
    if (!editingStagingId) return;
    const event = stagingQueue.find((e) => e.id === editingStagingId);
    if (!event) return;

    setEventType(event.eventType);
    setDate(event.date);
    setStartTime(event.startTime);
    setEndTime(event.endTime);
    setSelectedInspectors([...event.inspectors]);
    setLeaveShift(
      event.eventType === "Leave"
        ? event.leaveShift ?? null
        : event.eventType === "Other Duties"
          ? event.otherDutiesShift ?? null
          : null,
    );

    if (event.eventType === "Operator Request") {
      setOperator(event.operator);
      setSimulatorCodes(
        event.simulatorCodes?.length
          ? [...event.simulatorCodes]
          : event.simulatorCode
            ? [event.simulatorCode]
            : [],
      );
      setAircraftType(event.aircraftType ?? "");
      setAircraftTypeManuallyEdited(true);
      setActivity(event.activity);
      setCandidateName(event.candidateName);
      setUseCustomActivity(
        !!event.activity && !simulatorActivities.includes(event.activity),
      );
    } else if (event.eventType === "Surveillance") {
      setOperator(event.operator);
      setSurveillanceTypes([...event.surveillanceTypes]);
      setSurveillanceDetails(event.details ?? "");
    } else if (event.eventType === "Other Duties") {
      const storedOps = event.operators ?? [];
      const knownSet = new Set(operators);
      setOtherDutiesOperators(
        storedOps.filter((op) => knownSet.has(op) || op === "N/A"),
      );
      const customOp = storedOps.find(
        (op) => !knownSet.has(op) && op !== "N/A",
      );
      setOtherDutiesIncludeCustom(!!customOp);
      setOtherDutiesCustomOp(customOp ?? "");
      setOtherDutiesRemarks(event.remarks ?? "");
      setOtherDutiesAppendRemark(event.appendRemarkToCalendarPill === true);
      const isPresetSub = dutySubTypes.includes(event.subType);
      setAexmorSubType(isPresetSub ? event.subType : "Custom");
      setCustomSubType(isPresetSub ? "" : event.subType);
      const savedColor =
        typeof event.customColor === "string" &&
        /^#[0-9a-f]{6}$/i.test(event.customColor)
          ? event.customColor
          : null;
      setOtherDutiesCustomColor(savedColor ?? "#9ca3af");
      setOtherDutiesColorManuallySet(!!savedColor);
    } else {
      const isPreset = leaveTypes.includes(event.leaveType);
      setLeaveType(isPreset ? event.leaveType : "Custom");
      setCustomLeaveType(isPreset ? "" : event.leaveType);
      setOooEndDate("");
    }
  }, [editingStagingId, leaveTypes, dutySubTypes]);

  const handleCancelEdit = () => {
    setValidationError(null);
    setEditingEventId(null);
    setEditingStagingId(null);
    setShowEditOverlay(false);
    resetForm();
  };

  // ── Derived: split inspectors into qualified / others for the activity ────
  // Custom activities bypass qualification checks — all inspectors are selectable.
  const orderedInspectors = sortInspectorsByName(inspectors);
  const qualifiedPositions = useCustomActivity ? [] : (qualifications[activity] ?? []);
  const qualifiedInspectors =
    eventType === "Operator Request" && !useCustomActivity
      ? orderedInspectors.filter((i) => qualifiedPositions.includes(i.position))
      : orderedInspectors;
  const otherInspectors =
    eventType === "Operator Request" && !useCustomActivity
      ? orderedInspectors.filter((i) => !qualifiedPositions.includes(i.position))
      : [];
  const shortName = makeShortName(inspectors);

  // Operator Request events need at least one *qualified* inspector selected.
  // Custom activities skip this requirement.
  const hasQualifiedSelected =
    eventType !== "Operator Request" ||
    useCustomActivity ||
    selectedInspectors.some((name) => {
      const inspector = inspectors.find((i) => i.name === name);
      return inspector
        ? qualifiedPositions.includes(inspector.position)
        : false;
    });

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const timeOptional =
      eventType === "Leave" ||
      eventType === "Surveillance" ||
      eventType === "Other Duties";
    const inspectorsRequired = eventType !== "Other Duties";
    if (
      (!timeOptional && (!startTime || !endTime)) ||
      (inspectorsRequired && selectedInspectors.length === 0) ||
      !hasQualifiedSelected
    )
      return;

    const resolvedStart = startTime || "00:00";
    const resolvedEnd = endTime || "23:59";
    const base = {
      eventType,
      date,
      startTime: resolvedStart,
      endTime: resolvedEnd,
      inspectors: selectedInspectors,
    };

    // ── Calendar edit mode ───────────────────────────────────────────────────
    if (editingEventId) {
      let updatedData: EventInput | null = null;

      if (eventType === "Operator Request") {
        updatedData = {
          ...base,
          eventType: "Operator Request",
          operator,
           simulatorCodes,
           simulatorCode: simulatorCodes[0] ?? "",
          aircraftType,
          activity,
          candidateName,
        };
      } else if (eventType === "Surveillance") {
        if (surveillanceTypes.length === 0) return;
        updatedData = {
          ...base,
          eventType: "Surveillance",
          operator,
          surveillanceTypes,
          details: surveillanceDetails.trim(),
        };
      } else if (eventType === "Other Duties") {
        const resolvedSubType =
          aexmorSubType === "Custom" ? customSubType.trim() : aexmorSubType;
        const resolvedOps = [
          ...otherDutiesOperators,
          ...(otherDutiesIncludeCustom && otherDutiesCustomOp.trim()
            ? [otherDutiesCustomOp.trim()]
            : []),
        ];
        const remarksVal = otherDutiesRemarks.trim();
        updatedData = {
          ...base,
          eventType: "Other Duties",
          operators: resolvedOps,
          subType: resolvedSubType,
          ...(leaveShift ? { otherDutiesShift: leaveShift } : {}),
          ...(aexmorSubType === "Custom"
            ? { customColor: otherDutiesCustomColor }
            : {}),
          ...(remarksVal ? { remarks: remarksVal } : {}),
          ...(otherDutiesAppendRemark
            ? { appendRemarkToCalendarPill: true }
            : {}),
        };
      } else {
        const resolvedLeaveType =
          leaveType === "Custom" ? customLeaveType.trim() : leaveType;
        if (!resolvedLeaveType) return;
        updatedData = {
          ...base,
          eventType: "Leave",
          leaveType: resolvedLeaveType,
          ...(leaveShift ? { leaveShift } : {}),
        };
      }

      if (!updatedData) return;

      // Keep the original on the calendar while the edit is staged.
      // The staged item carries sourceEventId so conflict validation skips
      // its own original, and the commit reducer atomically swaps them.
      // Discarding the staged item (REMOVE_EVENT) leaves the original untouched.
      // For swap scenarios: staging edit of A skips calendar-A but still sees
      // calendar-B, so the conflict is correctly flagged until B is also staged.
      const capturedEditingEventId = editingEventId;
      setEditingEventId(null);
      setValidationError(null);
      addEventToQueue({
        ...(updatedData as Omit<
          import("@/store/rosterStore").RosterEvent,
          "id"
        >),
        sourceEventId: capturedEditingEventId,
      });
      resetForm();
      return;
    }

    // ── Staging edit mode ────────────────────────────────────────────────────
    if (editingStagingId) {
      let updatedData: EventInput | null = null;

      if (eventType === "Operator Request") {
        updatedData = {
          ...base,
          eventType: "Operator Request",
          operator,
           simulatorCodes,
           simulatorCode: simulatorCodes[0] ?? "",
          aircraftType,
          activity,
          candidateName,
        };
      } else if (eventType === "Surveillance") {
        if (surveillanceTypes.length === 0) return;
        updatedData = {
          ...base,
          eventType: "Surveillance",
          operator,
          surveillanceTypes,
          details: surveillanceDetails.trim(),
        };
      } else if (eventType === "Other Duties") {
        const resolvedSubType =
          aexmorSubType === "Custom" ? customSubType.trim() : aexmorSubType;
        const resolvedOps = [
          ...otherDutiesOperators,
          ...(otherDutiesIncludeCustom && otherDutiesCustomOp.trim()
            ? [otherDutiesCustomOp.trim()]
            : []),
        ];
        const remarksVal = otherDutiesRemarks.trim();
        updatedData = {
          ...base,
          eventType: "Other Duties",
          operators: resolvedOps,
          subType: resolvedSubType,
          ...(leaveShift ? { otherDutiesShift: leaveShift } : {}),
          ...(aexmorSubType === "Custom"
            ? { customColor: otherDutiesCustomColor }
            : {}),
          ...(remarksVal ? { remarks: remarksVal } : {}),
          ...(otherDutiesAppendRemark
            ? { appendRemarkToCalendarPill: true }
            : {}),
        };
      } else {
        const resolvedLeaveType =
          leaveType === "Custom" ? customLeaveType.trim() : leaveType;
        if (!resolvedLeaveType) return;
        updatedData = {
          ...base,
          eventType: "Leave",
          leaveType: resolvedLeaveType,
          ...(leaveShift ? { leaveShift } : {}),
        };
      }

      if (!updatedData) return;

      setValidationError(null);
      updateStagingEvent(editingStagingId, updatedData);
      setEditingStagingId(null);
      resetForm();
      return;
    }

    // ── Create mode ──────────────────────────────────────────────────────────
    if (eventType === "Operator Request") {
      addEventToQueue({
        ...base,
        eventType: "Operator Request",
        operator,
         simulatorCodes,
         simulatorCode: simulatorCodes[0] ?? "",
        aircraftType,
        activity,
        candidateName,
      } as import("@/store/rosterStore").OperatorRequestEvent);
    } else if (eventType === "Surveillance") {
      if (surveillanceTypes.length === 0) return;
      const range = expandDailyEventRange({
        startDate: date,
        endDate: oooEndDate,
        startTime,
        endTime,
      });
      if (!range.ok) {
        setValidationError(range.error);
        return;
      }
      range.slices.forEach((slice) => {
        addEventToQueue({
          ...base,
          ...slice,
          eventType: "Surveillance",
          operator,
          surveillanceTypes,
          details: surveillanceDetails.trim(),
        } as import("@/store/rosterStore").SurveillanceEvent);
      });
    } else if (eventType === "Other Duties") {
      const resolvedSubType =
        aexmorSubType === "Custom" ? customSubType.trim() : aexmorSubType;
      const resolvedOps = [
        ...otherDutiesOperators,
        ...(otherDutiesIncludeCustom && otherDutiesCustomOp.trim()
          ? [otherDutiesCustomOp.trim()]
          : []),
      ];
      const remarksVal = otherDutiesRemarks.trim();
      const range = expandDailyEventRange({
        startDate: date,
        endDate: oooEndDate,
        startTime,
        endTime,
      });
      if (!range.ok) {
        setValidationError(range.error);
        return;
      }
      range.slices.forEach((slice) => {
        addEventToQueue({
          ...base,
          ...slice,
          eventType: "Other Duties",
          operators: resolvedOps,
          subType: resolvedSubType,
          ...(leaveShift ? { otherDutiesShift: leaveShift } : {}),
          ...(aexmorSubType === "Custom"
            ? { customColor: otherDutiesCustomColor }
            : {}),
          ...(remarksVal ? { remarks: remarksVal } : {}),
          ...(otherDutiesAppendRemark
            ? { appendRemarkToCalendarPill: true }
            : {}),
        } as import("@/store/rosterStore").OtherDutiesEvent);
      });
    } else {
      const resolvedLeaveType =
        leaveType === "Custom" ? customLeaveType.trim() : leaveType;
      if (!resolvedLeaveType) return;
      const range = expandDailyEventRange({
        startDate: date,
        endDate: oooEndDate,
        startTime,
        endTime,
      });
      if (!range.ok) {
        setValidationError(range.error);
        return;
      }
      range.slices.forEach((slice) => {
        addEventToQueue({
          ...base,
          ...slice,
          eventType: "Leave",
          leaveType: resolvedLeaveType,
          ...(leaveShift ? { leaveShift } : {}),
        } as import("@/store/rosterStore").LeaveEvent);
      });
      resetForm();
      startTimeRef.current?.focus();
      return;
    }

    resetForm();
    startTimeRef.current?.focus();
  };

  const toggleInspector = (name: string) => {
    setSelectedInspectors((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  const handleEventTypeChange = (type: EventType) => {
    if (editingEventId || editingStagingId) {
      window.alert(
        "Cannot change event type while editing.\nCancel the edit first, then create a new event.",
      );
      return;
    }
    setEventType(type);
    setSelectedInspectors([]);
    setOooEndDate("");
    setValidationError(null);
    setLeaveShift(null);
    if (type === "Operator Request") {
      setActivity("");
      setUseCustomActivity(false);
      setAircraftTypeManuallyEdited(false);
      setAircraftType(simulatorMap[simulatorCodes[0]] ?? "");
    } else {
      setAircraftType("");
      setAircraftTypeManuallyEdited(false);
    }
    setLeaveShift(null);
  };

  const handleActivityChange = (val: string) => {
    if (val === "__custom__") {
      setUseCustomActivity(true);
      setActivity("");
      setSelectedInspectors([]);
    } else {
      setUseCustomActivity(false);
      setActivity(val);
      setSelectedInspectors([]);
    }
  };

  return (
    <div className="flex h-[100dvh] w-full bg-background overflow-hidden">
      {/* ── Header / Nav ────────────────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 h-12 bg-card border-b border-border flex items-center px-6 z-10">
        <h1 className="text-sm font-semibold text-foreground">
          Roster Manager
        </h1>

        <div className="flex items-center gap-1 ml-8">
          <button
            onClick={() => setActiveView("calendar")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeView === "calendar"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <Calendar className="w-3.5 h-3.5" /> Calendar View
          </button>
          <button
            onClick={() => setActiveView("settings")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeView === "settings"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <SettingsIcon className="w-3.5 h-3.5" /> Settings
          </button>
          <button
            onClick={() => setActiveView("summary")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeView === "summary"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" /> Management Summary
          </button>
          <div className="w-px h-4 bg-border mx-1" />
          <button
            onClick={() => setHelp(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary"
            title="Open User Manual"
          >
            <HelpCircle className="w-3.5 h-3.5" /> Help
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <AnimatePresence>
            {dataNotice && (
              <motion.span
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className={`text-xs mr-2 ${dataNotice.kind === "success" ? "text-emerald-600" : "text-red-600"}`}
              >
                {dataNotice.text}
              </motion.span>
            )}
          </AnimatePresence>

          {activeView === "calendar" && (
            <>
              {/* ── Export popover ───────────────────────────────────────── */}
              <div
                className="relative border-l border-border pl-3"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    setExportOpen((o) => !o);
                    setImportOpen(false);
                    setClearOpen(false);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${exportOpen ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
                >
                  <Upload className="w-3.5 h-3.5" /> Export{" "}
                  <ChevronDown className="w-3 h-3 ml-0.5 opacity-60" />
                </button>
                {exportOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-52 bg-card border border-border rounded-lg shadow-lg p-3 z-20 flex flex-col gap-2.5">
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                        Period
                      </span>
                      <select
                        value={exportPeriod}
                        onChange={(e) =>
                          handlePeriodChange(e.target.value as ExportPeriod)
                        }
                        className="h-7 w-full rounded border border-border bg-background px-2 pr-6 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer"
                        style={{
                          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                          backgroundRepeat: "no-repeat",
                          backgroundPosition: "right 6px center",
                          appearance: "none",
                        }}
                      >
                        <option value="current">
                          {new Date(calYear, calMonth - 1).toLocaleString(
                            "default",
                            { month: "long" },
                          )}{" "}
                          {calYear}
                        </option>
                        <option value="all">All {calYear}</option>
                        <option value="alltime">All records</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                        Format
                      </span>
                      <select
                        value={exportFormat}
                        onChange={(e) =>
                          setExportFormat(e.target.value as ExportFormat)
                        }
                        className="h-7 w-full rounded border border-border bg-background px-2 pr-6 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer"
                        style={{
                          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                          backgroundRepeat: "no-repeat",
                          backgroundPosition: "right 6px center",
                          appearance: "none",
                        }}
                      >
                        <option value="excel">Excel (.xlsx)</option>
                        {exportPeriod === "current" && (
                          <option value="docx">Word (.docx)</option>
                        )}
                        {exportPeriod === "current" && (
                          <option value="docx-operator">
                            Operator Request (.docx)
                          </option>
                        )}
                        {exportPeriod === "current" && (
                          <option value="docx-batch">
                            All Operator Requests (.zip)
                          </option>
                        )}
                        {exportPeriod === "current" && (
                          <option value="html">Interactive HTML</option>
                        )}
                        <option value="json">JSON</option>
                      </select>
                    </label>
                    {exportFormat === "docx-operator" && (
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                          Operator
                        </span>
                        <select
                          value={exportOperator}
                          onChange={(e) => setExportOperator(e.target.value)}
                          className="h-7 w-full rounded border border-border bg-background px-2 pr-6 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer"
                          style={{
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                            backgroundRepeat: "no-repeat",
                            backgroundPosition: "right 6px center",
                            appearance: "none",
                          }}
                        >
                          {operators.map((op) => (
                            <option key={op} value={op}>
                              {op}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {exportPeriod === "current" && (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                            Version
                          </span>
                          <div className="flex items-center gap-1.5">
                            {exportVersion > 0 && (
                              <span className="text-xs tabular-nums text-muted-foreground font-medium">
                                v{exportVersion}
                              </span>
                            )}
                            {exportVersion > 0 && !pendingNewVersion && (
                              <button
                                onClick={handleResetVersion}
                                title="Reset version to 0"
                                className="text-sm text-muted-foreground hover:text-foreground transition-colors leading-none"
                              >
                                ↺
                              </button>
                            )}
                          </div>
                        </div>
                        {!pendingNewVersion ? (
                          <button
                            onClick={() => setPendingNewVersion(true)}
                            className="text-[10px] text-primary hover:underline text-left"
                          >
                            {exportVersion === 0
                              ? "+ Start versioning"
                              : "+ New version"}
                          </button>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground">
                              Commit v{exportVersion + 1}?
                            </span>
                            <button
                              onClick={handleCommitVersion}
                              className="text-[10px] font-medium text-primary hover:underline"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setPendingNewVersion(false)}
                              className="text-[10px] text-muted-foreground hover:underline"
                            >
                              No
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="border-t border-border pt-2">
                      <button
                        onClick={() => {
                          handleExportAction();
                          setExportOpen(false);
                        }}
                        className="w-full inline-flex items-center justify-center gap-1.5 h-8 rounded text-xs font-medium bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
                      >
                        <Upload className="w-3.5 h-3.5" /> Export
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Import popover ───────────────────────────────────────── */}
              <div
                className="relative"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    setImportOpen((o) => !o);
                    setExportOpen(false);
                    setClearOpen(false);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${importOpen ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
                >
                  <Download className="w-3.5 h-3.5" /> Import{" "}
                  <ChevronDown className="w-3 h-3 ml-0.5 opacity-60" />
                </button>
                {importOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-44 bg-card border border-border rounded-lg shadow-lg p-3 z-20 flex flex-col gap-2.5">
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                        Mode
                      </span>
                      <select
                        value={importMode}
                        onChange={(e) =>
                          setImportMode(e.target.value as ImportMode)
                        }
                        className="h-7 w-full rounded border border-border bg-background px-2 pr-6 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer"
                        style={{
                          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                          backgroundRepeat: "no-repeat",
                          backgroundPosition: "right 6px center",
                          appearance: "none",
                        }}
                        title={
                          importMode === "add-to-queue"
                            ? "Imported events go into the staging queue for review"
                            : "Imported events replace the current roster"
                        }
                      >
                        <option value="add-to-queue">Add to Queue</option>
                        <option value="overwrite">Overwrite</option>
                      </select>
                    </label>
                    <div className="border-t border-border pt-2">
                      <button
                        onClick={() => {
                          importInputRef.current?.click();
                          setImportOpen(false);
                        }}
                        className="w-full inline-flex items-center justify-center gap-1.5 h-8 rounded text-xs font-medium bg-secondary text-foreground hover:bg-secondary/80 transition-colors"
                        title={
                          importMode === "add-to-queue"
                            ? "Import JSON — events added to staging queue"
                            : "Import JSON — overwrites existing roster events"
                        }
                      >
                        <Download className="w-3.5 h-3.5" /> Choose file…
                      </button>
                    </div>
                  </div>
                )}
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleImportFile}
                />
              </div>

              {/* ── Clear dropdown ───────────────────────────────────────── */}
              <div
                className="relative border-r border-border pr-3"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    setClearOpen((o) => !o);
                    setExportOpen(false);
                    setImportOpen(false);
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${clearOpen ? "bg-red-50 text-red-600 dark:bg-red-950/30" : "text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"}`}
                  title="Clear roster data"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear{" "}
                  <ChevronDown className="w-3 h-3 ml-0.5 opacity-60" />
                </button>
                {clearOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-48 bg-card border border-border rounded-lg shadow-lg py-1 z-20">
                    <button
                      onClick={() => {
                        handleClearMonth();
                        setClearOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    >
                      Clear{" "}
                      {new Date(calYear, calMonth - 1).toLocaleString(
                        "default",
                        { month: "long" },
                      )}{" "}
                      {calYear}…
                    </button>
                    <button
                      onClick={() => {
                        handleClearAll();
                        setClearOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    >
                      Clear All…
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {activeView === "settings" && (
            <>
              <div className="flex items-center gap-1 border-l border-border pl-3">
                <button
                  onClick={handleSettingsExport}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  title="Download a JSON backup of settings (operators, inspectors, sim map, etc.)"
                >
                  <Upload className="w-3.5 h-3.5" /> Export Settings
                </button>

                <button
                  onClick={() => settingsImportRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  title="Restore settings from a settings JSON file"
                >
                  <Download className="w-3.5 h-3.5" /> Import Settings
                </button>
                <input
                  ref={settingsImportRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleSettingsImportFile}
                />
              </div>

              <div className="flex items-center gap-1 border-l border-border pl-3">
                <button
                  onClick={handleResetSettings}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  title="Reset all settings to defaults"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Reset Settings
                </button>
              </div>
            </>
          )}

          <button
            onClick={toggleTheme}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            {isDark ? (
              <Sun className="w-3.5 h-3.5" />
            ) : (
              <Moon className="w-3.5 h-3.5" />
            )}
          </button>

          <div className="ml-2 border-l border-border pl-3 flex items-center">
            <button
              onClick={() => void manualSave()}
              title="Save now (Ctrl+S)"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                saveStatus === "saving"
                  ? "text-amber-500 cursor-default"
                  : saveStatus === "saved"
                    ? "text-emerald-600 cursor-default"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {saveStatus === "saving" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : saveStatus === "saved" ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {saveStatus === "saving"
                ? "Saving…"
                : saveStatus === "saved"
                  ? "Saved"
                  : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex w-full pt-12 h-full">
        {/* Intake form — always visible */}
        <aside className="relative w-1/4 min-w-72 shrink-0 h-full bg-card border-r border-border flex flex-col overflow-hidden">
          {/* Edit-guard overlay — appears when a calendar event is clicked; user must press Edit to unlock */}
          {editingEventId && showEditOverlay && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-20 bg-background/60 backdrop-blur-[1px] flex items-center justify-center"
            >
              <button
                type="button"
                onClick={() => setShowEditOverlay(false)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-card border border-border shadow-lg text-sm font-medium text-foreground hover:bg-secondary transition-colors"
              >
                <Pencil className="w-4 h-4" /> Edit
              </button>
            </motion.div>
          )}

          {/* Form header — switches between New Entry, Calendar Edit, and Staging Edit mode */}
          <div
            className={`p-5 border-b border-border shrink-0 transition-colors ${
              editingEventId
                ? "bg-primary/5"
                : editingStagingId
                  ? "bg-amber-50"
                  : ""
            }`}
          >
            {editingEventId ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Pencil className="w-3.5 h-3.5 text-primary" />
                  <p className="text-xs font-semibold text-primary uppercase tracking-wide">
                    Edit → Staging
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : editingStagingId ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Pencil className="w-3.5 h-3.5 text-amber-600" />
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                    Editing Staged Item
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                New Entry
              </p>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            <div className="flex min-h-full flex-col gap-5 p-5">
            {/* Event Type */}
            <div className="shrink-0">
              <FieldLabel>Event Type</FieldLabel>
              <div className="flex rounded border border-border overflow-hidden">
                {(
                  [
                    "Operator Request",
                    "Surveillance",
                    "Other Duties",
                    "Leave",
                  ] as EventType[]
                ).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleEventTypeChange(type)}
                    className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                      eventType === type
                        ? "bg-primary text-white"
                        : "bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Date & Times */}
            <div className="grid grid-cols-2 gap-3 shrink-0">
              <div className="col-span-2">
                <FieldLabel>Date</FieldLabel>
                <FieldInput
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
                {date && (
                  <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                    {date.split("-").reverse().join("-")}
                  </p>
                )}
                {eventType !== "Operator Request" &&
                  !editingEventId &&
                  !editingStagingId && (
                  <div className="mt-3">
                    <FieldLabel>
                      End Date{" "}
                      <span className="font-normal text-muted-foreground">
                        (leave blank for single day)
                      </span>
                    </FieldLabel>
                    <FieldInput
                      type="date"
                      value={oooEndDate}
                      min={date}
                      onChange={(e) => setOooEndDate(e.target.value)}
                    />
                    {oooEndDate && (
                      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                        {oooEndDate.split("-").reverse().join("-")}
                      </p>
                    )}
                    {oooEndDate && oooEndDate > date && (
                      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                        Timed ranges split into daily entries: start time to
                        23:59 on the first day, 00:00–23:59 on middle days,
                        and 00:00 to the end time on the final day. Blank times
                        create all-day entries.
                      </p>
                    )}
                    {oooEndDate && oooEndDate >= date && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {Math.round(
                          (new Date(oooEndDate + "T00:00:00").getTime() -
                            new Date(date + "T00:00:00").getTime()) /
                            86400000,
                        ) + 1}{" "}
                        {Math.round(
                          (new Date(oooEndDate + "T00:00:00").getTime() -
                            new Date(date + "T00:00:00").getTime()) /
                            86400000,
                        ) + 1 === 1
                          ? "entry"
                          : "entries"}{" "}
                        will be created, one per day.
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div>
                <FieldLabel>
                  Start Time
                  {(eventType === "Leave" ||
                    eventType === "Surveillance" ||
                    eventType === "Other Duties") && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      (optional)
                    </span>
                  )}
                </FieldLabel>
                <TimeInput
                  ref={startTimeRef}
                  value={startTime}
                  onChange={(v) => {
                    setStartTime(v);
                    if (eventType === "Leave" || eventType === "Other Duties") setLeaveShift(null);
                  }}
                />
              </div>
              <div>
                <FieldLabel>
                  End Time
                  {(eventType === "Leave" ||
                    eventType === "Surveillance" ||
                    eventType === "Other Duties") && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      (optional)
                    </span>
                  )}
                </FieldLabel>
                <TimeInput
                  value={endTime}
                  onChange={(v) => {
                    setEndTime(v);
                    if (eventType === "Leave" || eventType === "Other Duties") setLeaveShift(null);
                  }}
                />
              </div>
              {(eventType === "Leave" || eventType === "Other Duties") && (
                <div className="col-span-2 flex gap-2">
                  {(["AM", "PM"] as const).map((shift) => (
                    <button
                      key={shift}
                      type="button"
                      onClick={() => {
                        if (leaveShift === shift) {
                          setLeaveShift(null);
                          setStartTime("");
                          setEndTime("");
                        } else {
                          setLeaveShift(shift);
                          setStartTime(shift === "AM" ? "09:00" : "12:00");
                          setEndTime(shift === "AM" ? "12:00" : "18:00");
                        }
                      }}
                      className={`h-7 px-4 rounded border text-xs font-medium transition-colors ${leaveShift === shift ? "bg-primary text-white border-primary" : "bg-card text-muted-foreground border-border hover:bg-muted hover:text-foreground"}`}
                    >
                      {shift}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="h-px shrink-0 bg-border" />

            {/* Conditional Fields */}
            <div className="min-h-[140px] shrink-0">
              <AnimatePresence mode="wait">
                {eventType === "Operator Request" && (
                  <motion.div
                    key="sim"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="grid grid-cols-2 gap-3"
                  >
                    <div>
                      <FieldLabel>Operator</FieldLabel>
                      <FieldSelect
                        value={operator}
                        onChange={(e) => setOperator(e.target.value)}
                      >
                        <option value="">— select —</option>
                        {operators.map((op) => (
                          <option key={op}>{op}</option>
                        ))}
                      </FieldSelect>
                    </div>
                    <div>
                      <FieldLabel>
                        Simulator Code{" "}
                        <span className="font-normal text-muted-foreground">
                           (optional; pick one or more)
                        </span>
                      </FieldLabel>
                       <div className="rounded border border-border bg-card overflow-hidden">
                         <div className="max-h-40 overflow-y-auto">
                           {simCodes.map((code) => (
                             <label
                               key={code}
                               className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/50 cursor-pointer text-xs"
                             >
                               <input
                                 type="checkbox"
                                 checked={simulatorCodes.includes(code)}
                                 onChange={() =>
                                   setSimulatorCodes((prev) =>
                                     prev.includes(code)
                                       ? prev.filter((selected) => selected !== code)
                                       : [...prev, code],
                                   )
                                 }
                                 className="w-3.5 h-3.5 accent-primary shrink-0"
                               />
                               <span className="text-foreground">{code}</span>
                             </label>
                           ))}
                         </div>
                       </div>
                    </div>
                    <div>
                      <FieldLabel>Aircraft Type</FieldLabel>
                      <FieldInput
                        value={aircraftType}
                        onChange={(e) => {
                          setAircraftType(e.target.value);
                          setAircraftTypeManuallyEdited(true);
                        }}
                        placeholder="Aircraft type"
                      />
                    </div>
                    <div>
                      <FieldLabel>Activity</FieldLabel>
                      <FieldSelect
                        value={useCustomActivity ? "__custom__" : activity}
                        onChange={(e) => handleActivityChange(e.target.value)}
                      >
                        <option value="">— select —</option>
                        {simulatorActivities.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                        <option value="__custom__">Custom…</option>
                      </FieldSelect>
                      {useCustomActivity && (
                        <FieldInput
                          className="mt-1.5"
                          value={activity}
                          onChange={(e) => setActivity(e.target.value)}
                          placeholder="Activity name"
                          autoFocus
                        />
                      )}
                    </div>
                    <div className="col-span-2">
                      <FieldLabel>Candidate Name</FieldLabel>
                      <FieldInput
                        value={candidateName}
                        onChange={(e) => setCandidateName(e.target.value)}
                      />
                    </div>
                  </motion.div>
                )}
                {eventType === "Surveillance" && (
                  <motion.div
                    key="surv"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="grid grid-cols-2 gap-3"
                  >
                    <div className="col-span-2">
                      <FieldLabel>Operator</FieldLabel>
                      <FieldSelect
                        value={operator}
                        onChange={(e) => setOperator(e.target.value)}
                      >
                        <option value="">— select —</option>
                        <option value="N/A">N/A</option>
                        {operators.map((op) => (
                          <option key={op}>{op}</option>
                        ))}
                      </FieldSelect>
                    </div>
                    <div className="col-span-2">
                      <FieldLabel>
                        Surveillance Type(s){" "}
                        <span className="font-normal text-muted-foreground">
                          (pick one or more)
                        </span>
                      </FieldLabel>
                      <div className="rounded border border-border bg-card overflow-hidden">
                        <div className="max-h-40 overflow-y-auto">
                          {surveillanceActivities.map((type) => (
                            <label
                              key={type}
                              className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/50 cursor-pointer text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={surveillanceTypes.includes(type)}
                                onChange={() =>
                                  setSurveillanceTypes((prev) =>
                                    prev.includes(type)
                                      ? prev.filter((t) => t !== type)
                                      : [...prev, type],
                                  )
                                }
                                className="w-3.5 h-3.5 accent-primary shrink-0"
                              />
                              <span className="text-foreground">{type}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <FieldLabel>
                        Surveillance Details{" "}
                        <span className="font-normal text-muted-foreground">
                          (optional)
                        </span>
                      </FieldLabel>
                      <FieldInput
                        value={surveillanceDetails}
                        onChange={(e) => setSurveillanceDetails(e.target.value)}
                      />
                    </div>
                  </motion.div>
                )}
                {eventType === "Other Duties" && (
                  <motion.div
                    key="aexmor"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="flex flex-col gap-3"
                  >
                    {/* Operator multi-select */}
                    <div>
                      <FieldLabel>
                        Operator(s) <span className="font-normal text-muted-foreground">(optional)</span>
                      </FieldLabel>
                      <div className="rounded border border-border bg-card overflow-hidden">
                        <div className="max-h-36 overflow-y-auto">
                          <label className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/50 cursor-pointer text-xs">
                            <input
                              type="checkbox"
                              checked={otherDutiesOperators.includes("N/A")}
                              onChange={() =>
                                setOtherDutiesOperators((prev) =>
                                  prev.includes("N/A")
                                    ? prev.filter((o) => o !== "N/A")
                                    : [...prev, "N/A"],
                                )
                              }
                              className="w-3.5 h-3.5 accent-primary shrink-0"
                            />
                            <span className="text-foreground font-medium">
                              N/A
                            </span>
                          </label>
                          {operators.map((op) => (
                            <label
                              key={op}
                              className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/50 cursor-pointer text-xs border-t border-border/50"
                            >
                              <input
                                type="checkbox"
                                checked={otherDutiesOperators.includes(op)}
                                onChange={() =>
                                  setOtherDutiesOperators((prev) =>
                                    prev.includes(op)
                                      ? prev.filter((o) => o !== op)
                                      : [...prev, op],
                                  )
                                }
                                className="w-3.5 h-3.5 accent-primary shrink-0"
                              />
                              <span className="text-foreground">{op}</span>
                            </label>
                          ))}
                          <label className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/50 cursor-pointer text-xs border-t border-border/50">
                            <input
                              type="checkbox"
                              checked={otherDutiesIncludeCustom}
                              onChange={(e) =>
                                setOtherDutiesIncludeCustom(e.target.checked)
                              }
                              className="w-3.5 h-3.5 accent-primary shrink-0"
                            />
                            <span className="text-muted-foreground italic">
                              Custom…
                            </span>
                          </label>
                        </div>
                      </div>
                      {otherDutiesIncludeCustom && (
                        <FieldInput
                          className="mt-1.5"
                          value={otherDutiesCustomOp}
                          onChange={(e) =>
                            setOtherDutiesCustomOp(e.target.value)
                          }
                          placeholder="Custom operator name"
                        />
                      )}
                    </div>

                    {/* Type */}
                    <div>
                      <FieldLabel>
                        Type <span className="font-normal text-muted-foreground">(optional)</span>
                      </FieldLabel>
                      <FieldSelect
                        value={aexmorSubType}
                        onChange={(e) => {
                          const nextType = e.target.value;
                          setAexmorSubType(nextType);
                          setOtherDutiesColorManuallySet(false);
                          if (nextType === "Custom") {
                            setOtherDutiesCustomColor(defaultOtherDutiesColor);
                          }
                        }}
                      >
                        <option value="">— select —</option>
                        {dutySubTypes.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                        <option value="Custom">Custom...</option>
                      </FieldSelect>
                    </div>
                    {aexmorSubType === "Custom" && (
                      <>
                        <div>
                          <FieldLabel>
                            Custom Type <span className="font-normal text-muted-foreground">(optional)</span>
                          </FieldLabel>
                          <FieldInput
                            value={customSubType}
                            onChange={(e) => setCustomSubType(e.target.value)}
                          />
                        </div>
                        <div>
                          <FieldLabel>Event Color</FieldLabel>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={otherDutiesCustomColor}
                              onChange={(e) => {
                                setOtherDutiesCustomColor(e.target.value);
                                setOtherDutiesColorManuallySet(true);
                              }}
                              aria-label="Custom Other Duties event color"
                              className="h-8 w-10 cursor-pointer rounded border border-border bg-card p-0.5"
                            />
                            <span className="text-xs font-mono text-muted-foreground">
                              {otherDutiesCustomColor.toUpperCase()}
                            </span>
                            {!otherDutiesColorManuallySet && (
                              <span className="text-[11px] text-muted-foreground">
                                Operator default
                              </span>
                            )}
                          </div>
                        </div>
                      </>
                    )}

                    {/* Remarks */}
                    <div>
                      <FieldLabel>
                        Remarks{" "}
                        <span className="font-normal text-muted-foreground">
                          (optional)
                        </span>
                      </FieldLabel>
                      <textarea
                        value={otherDutiesRemarks}
                        onChange={(e) => setOtherDutiesRemarks(e.target.value)}
                        placeholder="Additional notes…"
                        rows={2}
                        className="w-full rounded border border-border bg-card px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors resize-none"
                      />
                      <label className="mt-2 flex items-center gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={otherDutiesAppendRemark}
                          onChange={(e) =>
                            setOtherDutiesAppendRemark(e.target.checked)
                          }
                          className="h-4 w-4 rounded border-border accent-primary"
                        />
                        <span>Append remark to calendar pill</span>
                      </label>
                    </div>
                  </motion.div>
                )}
                {eventType === "Leave" && (
                  <motion.div
                    key="ooo"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="flex flex-col gap-3"
                  >
                    <div>
                      <FieldLabel>Leave Type</FieldLabel>
                      <FieldSelect
                        value={leaveType}
                        onChange={(e) => setLeaveType(e.target.value)}
                      >
                        <option value="">— select —</option>
                        {leaveTypes.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                        <option value="Custom">Custom...</option>
                      </FieldSelect>
                    </div>
                    {leaveType === "Custom" && (
                      <div>
                        <FieldLabel>Custom Leave Type</FieldLabel>
                        <FieldInput
                          value={customLeaveType}
                          onChange={(e) => setCustomLeaveType(e.target.value)}
                          required
                        />
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="h-px shrink-0 bg-border" />

            {/* Inspectors */}
            <div className="shrink-0">
              <div className="flex items-center justify-between mb-2">
                <FieldLabel>
                  Inspectors{" "}
                  {eventType === "Other Duties" && (
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  )}
                </FieldLabel>
                <span className="text-xs text-muted-foreground">
                  {selectedInspectors.length > 0
                    ? `${selectedInspectors.length} selected`
                    : eventType === "Operator Request" &&
                        qualifiedInspectors.length === 0
                      ? "None qualify"
                      : ""}
                </span>
              </div>

              {inspectors.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  No inspectors in roster. Add them in Settings.
                </p>
              ) : eventType === "Operator Request" && !useCustomActivity ? (
                <div className="flex flex-col gap-3">
                  {/* Qualified section */}
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
                      Qualified for {activity}
                    </p>
                    {qualifiedInspectors.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-1">
                        No inspectors qualify for "{activity}". Update
                        qualifications in Settings.
                      </p>
                    ) : (
                      <div className="grid grid-cols-3 gap-1.5">
                        {qualifiedInspectors.map(({ id, name }) => {
                          const selected = selectedInspectors.includes(name);
                          return (
                            <label
                              key={id}
                              className={`flex items-center justify-center py-1.5 text-xs rounded border cursor-pointer select-none transition-colors ${
                                selected
                                  ? "bg-primary/10 border-primary/40 text-primary font-medium"
                                  : "bg-card border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={selected}
                                onChange={() => toggleInspector(name)}
                              />
                              {shortName(name)}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Other inspectors section */}
                  {otherInspectors.length > 0 && (
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
                        Other Inspectors
                      </p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {otherInspectors.map(({ id, name }) => {
                          const selected = selectedInspectors.includes(name);
                          return (
                            <label
                              key={id}
                              className={`flex items-center justify-center py-1.5 text-xs rounded border cursor-pointer select-none transition-colors ${
                                selected
                                  ? "bg-primary/10 border-primary/40 text-primary font-medium"
                                  : "bg-card border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={selected}
                                onChange={() => toggleInspector(name)}
                              />
                              {shortName(name)}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Qualified-required hint */}
                  {selectedInspectors.length > 0 && !hasQualifiedSelected && (
                    <p className="text-xs text-amber-700">
                      At least one qualified inspector must be selected.
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {qualifiedInspectors.map(({ id, name }) => {
                    const selected = selectedInspectors.includes(name);
                    return (
                      <label
                        key={id}
                        className={`flex items-center justify-center py-1.5 text-xs rounded border cursor-pointer select-none transition-colors ${
                          selected
                            ? "bg-primary/10 border-primary/40 text-primary font-medium"
                            : "bg-card border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={selected}
                          onChange={() => toggleInspector(name)}
                        />
                        {shortName(name)}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Validation error (edit mode) */}
            {validationError && (
              <div className="flex shrink-0 items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-px" />
                <p className="text-xs text-amber-700 leading-snug">
                  {validationError}
                </p>
              </div>
            )}

            {/* Submit / Cancel */}
            <div className="mt-auto shrink-0 pt-2 flex flex-col gap-2">
              <button
                type="submit"
                disabled={
                  (eventType === "Operator Request" && (!startTime || !endTime)) ||
                  (eventType !== "Other Duties" && selectedInspectors.length === 0) ||
                  !hasQualifiedSelected
                }
                className={`w-full h-9 text-white text-sm font-medium rounded transition-colors focus:outline-none focus:ring-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                  editingStagingId
                    ? "bg-amber-500 hover:bg-amber-600 focus:ring-amber-400/40"
                    : "bg-primary hover:bg-primary/90 focus:ring-primary/40"
                }`}
              >
                {editingEventId
                  ? "Send to Staging"
                  : editingStagingId
                    ? "Update Staged Item"
                    : "Submit to Queue"}
              </button>

              {editingEventId && (
                <>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="w-full h-9 bg-card border border-border text-sm font-medium text-muted-foreground rounded hover:bg-secondary hover:text-foreground transition-colors"
                  >
                    Cancel Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Delete this event from the calendar? This cannot be undone.",
                        )
                      ) {
                        removeCalendarEvent(editingEventId);
                        setEditingEventId(null);
                        setShowEditOverlay(false);
                        resetForm();
                      }
                    }}
                    className="w-full h-9 bg-card border border-red-200 text-sm font-medium text-red-600 rounded hover:bg-red-50 hover:border-red-400 transition-colors"
                  >
                    Delete Event
                  </button>
                </>
              )}

              {editingStagingId && (
                <>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="w-full h-9 bg-card border border-border text-sm font-medium text-muted-foreground rounded hover:bg-secondary hover:text-foreground transition-colors"
                  >
                    Cancel Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      removeEvent(editingStagingId);
                      setEditingStagingId(null);
                      resetForm();
                    }}
                    className="w-full h-9 bg-card border border-red-200 text-sm font-medium text-red-600 rounded hover:bg-red-50 hover:border-red-400 transition-colors"
                  >
                    Remove from Queue
                  </button>
                </>
              )}
            </div>
            </div>
          </form>
        </aside>

        {/* Right area — toggled by nav */}
        <AnimatePresence mode="wait">
          {activeView === "calendar" ? (
            <motion.div
              key="calendar"
              className="flex flex-1 overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              {/* Staging Queue (middle column) */}
              <div className="w-1/3 min-w-64 shrink-0">
                <StagingQueue selectedDate={date} />
              </div>
              {/* Calendar (right column) */}
              <main className="flex-1 overflow-hidden">
                <CalendarGrid
                  year={calYear}
                  month={calMonth}
                  selectedDate={date}
                  onMonthChange={(y, m) => {
                    setCalYear(y);
                    setCalMonth(m);
                  }}
                  filterOperators={filterOperators}
                  filterInspectors={filterInspectors}
                  onFilterOperatorsChange={setFilterOperators}
                  onFilterInspectorsChange={setFilterInspectors}
                  onDateSelect={(date) => {
                    setEditingEventId(null);
                    setEditingStagingId(null);
                    setValidationError(null);
                    resetForm();
                    setDate(date);
                  }}
                />
              </main>
            </motion.div>
          ) : activeView === "settings" ? (
            <motion.div
              key="settings"
              className="flex flex-col flex-1 overflow-hidden bg-background"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              <div className="px-6 py-3 border-b border-border bg-card shrink-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Settings
                </p>
              </div>
              <Settings />
            </motion.div>
          ) : (
            <motion.div
              key="summary"
              className="flex flex-col flex-1 overflow-hidden bg-background"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              <ManagementSummary />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* ── User Manual Modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showHelp && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm p-4 md:p-8"
          >
            <motion.div
              initial={{ opacity: 0, y: 15, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 15, scale: 0.98 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="relative flex flex-col w-full max-w-3xl max-h-full bg-card border border-border shadow-2xl rounded-xl overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30 shrink-0">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-primary" />
                  Roster Manager User Manual
                </h2>
                <button
                  onClick={() => setHelp(false)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  title="Close Manual"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body (EDIT YOUR MANUAL HERE) */}
              <div className="p-6 overflow-y-auto flex-1 text-sm text-foreground space-y-6">

                <section className="space-y-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1 [&_p]:text-muted-foreground [&_ul]:list-disc [&_ul]:ml-5 [&_ul]:text-muted-foreground [&_ol]:list-decimal [&_ol]:ml-5 [&_ol]:text-muted-foreground [&_li]:mb-1 [&_table]:w-full [&_table]:text-xs [&_th]:text-left [&_th]:font-semibold [&_th]:py-1.5 [&_th]:px-2 [&_th]:bg-muted/40 [&_td]:py-1.5 [&_td]:px-2 [&_td]:border-b [&_td]:border-border [&_td]:align-top [&_table]:border [&_table]:border-border [&_table]:rounded">

                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Contents</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-primary">
                      {['The basics','Operator Request events','Surveillance events','Other Duties events','Leave events','Staging queue','Calendar','Editing & deleting','Exporting','Importing & backup','Management Summary','Settings'].map(s => (
                        <span key={s} className="text-muted-foreground">› {s}</span>
                      ))}
                    </div>
                  </div>

                  <hr className="border-border" />

                  <div>
                    <h2>🏠 The basics</h2>
                    <p>Roster Manager runs entirely in your browser — nothing is uploaded to any server. Your data is saved locally and automatically.</p>
                    <p className="mt-2 text-muted-foreground">The app has three sections, selectable from the top bar:</p>
                    <ul>
                      <li><strong>Calendar View</strong> — add events, review the staging queue, and browse the monthly calendar.</li>
                      <li><strong>Management Summary</strong> — duty statistics and OJT tracking.</li>
                      <li><strong>Settings</strong> — configure inspectors, activities, operators, and list values.</li>
                    </ul>
                    <h3>Auto-save</h3>
                    <p>Changes save automatically within one second. Press <kbd className="font-mono bg-muted px-1 rounded text-[11px]">Ctrl S</kbd> (or <kbd className="font-mono bg-muted px-1 rounded text-[11px]">⌘ S</kbd>) to save instantly.</p>
                    <h3>Light / dark mode</h3>
                    <p>Click the moon/sun icon in the top toolbar to toggle themes.</p>
                  </div>

                  <hr className="border-border" />

                  <div>
                    <h2>📋 How adding events works</h2>
                    <p>Every new event follows a two-step process:</p>
                    <ol>
                      <li><strong>Fill in the form</strong> (left panel) and click <strong>Submit</strong> → the event goes into the <strong>Staging Queue</strong> (centre panel).</li>
                      <li><strong>Review the queue</strong>, then click <strong>Add to Calendar</strong> → the event is committed to the <strong>Calendar</strong> (right panel).</li>
                    </ol>
                    <p className="mt-2 text-muted-foreground">The staging queue lets you catch mistakes before events become part of the official record.</p>
                    <div className="mt-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded p-2.5 text-xs text-blue-800 dark:text-blue-300">
                      <strong>Common fields on every event:</strong> Date (required), Start / End Time (optional except Operator Request), Inspectors (required — click name buttons to select). Blank times default to all-day (00:00–23:59).
                    </div>
                    <h3>Timed multi-day entries</h3>
                    <p>New <strong>Leave</strong>, <strong>Surveillance</strong>, and <strong>Other Duties</strong> entries can include an optional, inclusive End Date. The app creates one independent entry per day: the first day runs from the entered start time to 23:59, middle days run 00:00–23:59, and the final day runs 00:00 to the entered end time. Leave both optional times blank for all-day entries. Operator Request entries and edits of individual calendar or staged entries are always single-day.</p>
                  </div>

                  <hr className="border-border" />

                  <div>
                    <h2>✈️ Operator Request events</h2>
                    <table>
                      <thead><tr><th>Field</th><th>Notes</th></tr></thead>
                      <tbody>
                        <tr><td><strong>Operator</strong></td><td>Company organising the session.</td></tr>
                        <tr><td><strong>Simulator Code</strong></td><td>Optional device code (e.g. CPA01). Initializes Aircraft Type from the map.</td></tr>
                        <tr><td><strong>Aircraft Type</strong></td><td>Starts from the selected Simulator Code mapping, but can be edited for this event.</td></tr>
                        <tr><td><strong>Activity</strong></td><td>Choose from the list or select <em>Custom…</em> for a free-form name.</td></tr>
                        <tr><td><strong>Candidate Name</strong></td><td>Optional. The trainee's name.</td></tr>
                        <tr><td><strong>Inspectors</strong></td><td>At least one <strong>qualified</strong> inspector required for list activities.</td></tr>
                      </tbody>
                    </table>
                    <div className="mt-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-2.5 text-xs text-amber-800 dark:text-amber-300">
                      <strong>Qualifications:</strong> Inspectors split into <em>Qualified</em> and <em>Other</em> groups. Pick at least one Qualified inspector. Others may be added as OJT trainees. Using <em>Custom…</em> activity bypasses the check.
                    </div>
                  </div>

                  <hr className="border-border" />

                  <div>
                    <h2>🔍 Surveillance events</h2>
                    <table>
                      <thead><tr><th>Field</th><th>Notes</th></tr></thead>
                      <tbody>
                        <tr><td><strong>Operator</strong></td><td>The airline or organisation being surveilled.</td></tr>
                        <tr><td><strong>End Date</strong></td><td>Optional for a new entry. Use it to create an inclusive daily range; see Timed multi-day entries above.</td></tr>
                        <tr><td><strong>Surveillance Type(s)</strong></td><td>Tick one or more (Cabin, Flight, Station, ORI, and more).</td></tr>
                        <tr><td><strong>Surveillance Details</strong></td><td>Optional. Route, flight number, station, or audit scope.</td></tr>
                        <tr><td><strong>Inspectors</strong></td><td>At least one inspector qualified for <em>each</em> selected type is required.</td></tr>
                      </tbody>
                    </table>
                  </div>

                  <hr className="border-border" />

                  <div>
                    <h2>📌 Other Duties events</h2>
                    <table>
                      <thead><tr><th>Field</th><th>Notes</th></tr></thead>
                      <tbody>
                        <tr><td><strong>End Date</strong></td><td>Optional for a new entry. Use it to create an inclusive daily range; see Timed multi-day entries above.</td></tr>
                        <tr><td><strong>AM / PM</strong></td><td>AM = 09:00–12:00; PM = 12:00–18:00. Click again to clear.</td></tr>
                        <tr><td><strong>Operator(s)</strong></td><td>Tick one or more. N/A or Custom… are available.</td></tr>
                        <tr><td><strong>Type</strong></td><td>AEX Course, Flying, MOR Meeting, Overseas Duties, or Custom…</td></tr>
                        <tr><td><strong>Remarks</strong></td><td>Optional free text.</td></tr>
                      </tbody>
                    </table>
                  </div>

                  <hr className="border-border" />

                  <div>
                    <h2>🌴 Leave events</h2>
                    <table>
                      <thead><tr><th>Field</th><th>Notes</th></tr></thead>
                      <tbody>
                        <tr><td><strong>Date</strong></td><td>First (or only) day of leave.</td></tr>
                        <tr><td><strong>End Date</strong></td><td>Optional for a new entry. Set an inclusive daily range; see Timed multi-day entries above.</td></tr>
                        <tr><td><strong>AM / PM</strong></td><td>Same shortcuts as Other Duties.</td></tr>
                        <tr><td><strong>Leave Type</strong></td><td>MA, TOIL, VL, or Custom…</td></tr>
                        <tr><td><strong>Inspectors</strong></td><td>The inspector(s) on leave.</td></tr>
                      </tbody>
                    </table>
                  </div>

                  <hr className="border-border" />

                  <div>
                    <h2>📥 Staging queue</h2>
                    <p>Every submitted event appears as a card here. Click a card to edit it. Cards with errors show a warning icon — fix the issue before adding to the calendar.</p>
                    <table>
                      <thead><tr><th>Action</th><th>How</th></tr></thead>
                      <tbody>
                        <tr><td>Edit a queued event</td><td>Click the card.</td></tr>
                        <tr><td>Commit one event</td><td>Click <strong>Add to Calendar</strong> on the card.</td></tr>
                        <tr><td>Commit all valid events</td><td>Click <strong>Add all</strong> at the top of the queue.</td></tr>
                        <tr><td>Remove an event</td><td>Click the trash icon on the card.</td></tr>
                      </tbody>
                    </table>
                  </div>

                  <hr className="border-border" />

                  <div>
                    <h2>📅 Calendar</h2>
                    <p>Shows committed events for the current month. Use the ‹ › arrows to navigate months. Today has a blue circle. Weekends and HK public holidays are shaded.</p>
                    <p className="mt-1 text-muted-foreground"><strong>Hover</strong> an event pill for full details. <strong>Click</strong> a pill to edit the event.</p>
                    <h3>Filters</h3>
                    <p>Use the <strong>Operator</strong> and <strong>Inspector</strong> dropdowns to narrow the view. Click <strong>Clear filter</strong> to reset.</p>
                    <h3>Editing &amp; deleting</h3>
                    <p>Click an event pill → edit in the form → click <strong>Add to Calendar</strong> to save, or <strong>Cancel Edit</strong> to discard. To delete, open the event and click <strong>Delete Event</strong> (a confirmation prompt appears).</p>
                  </div>

                  <hr className="border-border" />

                  <div>
                    <h2>📤 Exporting</h2>
                    <p>Click <strong>Export</strong> in the toolbar. Choose period (<em>Current month</em> or <em>All</em>) and format. Active filters apply to all exports.</p>
                    <table>
                      <thead><tr><th>Format</th><th>What you get</th></tr></thead>
                      <tbody>
                        <tr><td><strong>Excel</strong></td><td>Flat table of all events.</td></tr>
                        <tr><td><strong>Word Calendar</strong></td><td>Printable monthly calendar with operator colours and HK holiday shading.</td></tr>
                        <tr><td><strong>Word Per-Operator</strong></td><td>Simulator-only plan for one operator with an inspector email appendix. Current month only.</td></tr>
                        <tr><td><strong>Word Batch (ZIP)</strong></td><td>Per-operator documents for all operators, zipped. Current month only.</td></tr>
                        <tr><td><strong>HTML</strong></td><td>Self-contained offline page with calendar, table, filters, and a <strong>📅 .ics</strong> button for Apple/Google/Outlook. Current month only.</td></tr>
                        <tr><td><strong>JSON</strong></td><td>Full roster or settings-only backup for transfer or recovery.</td></tr>
                      </tbody>
                    </table>
                  </div>

                  <hr className="border-border" />

                  <div>
                    <h2>📥 Importing &amp; backup</h2>
                    <p>Click <strong>Import</strong> in the toolbar. Only <code className="font-mono bg-muted px-1 rounded text-[11px]">.json</code> files from Roster Manager are accepted.</p>
                    <p className="mt-1 text-muted-foreground"><strong>Import Roster:</strong> <em>Add to queue</em> merges imported events for review; <em>Overwrite</em> replaces all current events. <strong>Import Settings:</strong> restores configuration without affecting event data.</p>
                    <div className="mt-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-2.5 text-xs text-amber-800 dark:text-amber-300">
                      <strong>Back up regularly.</strong> Export a JSON backup at least once a month. If browser data is cleared, your roster will be lost.
                    </div>
                    <h3>Clearing data</h3>
                    <p>The <strong>Clear</strong> menu offers: <strong>Clear Month</strong> (current month only), <strong>Clear All</strong> (all events, settings kept), and <strong>Reset Settings</strong> (factory defaults, events kept). All require confirmation.</p>
                  </div>

                  <hr className="border-border" />

                  <div>
                    <h2>📊 Management Summary</h2>
                    <p>Toggle between <em>Month</em> and <em>Last 12 months</em>. The <strong>Overview</strong> tab shows Duty vs Leave breakdown, workload per inspector, and Operator Request sessions per operator. The <strong>OJT Tracker</strong> tab lists training progress for inspectors not yet fully qualified — select an inspector to see their qualifying session history for each activity.</p>
                  </div>

                  <hr className="border-border" />

                  <div>
                    <h2>⚙️ Settings</h2>
                    <p><strong>Inspector Management</strong> — add (Full Name + Position required, Email optional) or remove inspectors. The email appears in Word per-operator exports.</p>
                    <p><strong>Activities &amp; Qualifications</strong> — add, rename (pencil icon), or delete activities. Use the tag field to assign qualified positions to each activity.</p>
                    <p><strong>Operators</strong> — add/remove operators and assign a display colour per operator (used on calendar pills and Word exports).</p>
                    <p><strong>Leave Types / Other Duties Sub-Types</strong> — manage the dropdown options for Leave and Other Duties events. At least one item must remain in each list.</p>
                    <p><strong>Simulator Map</strong> — links device codes to aircraft types. Click an Aircraft Type cell to edit inline.</p>
                  </div>

                  <p className="text-[11px] text-muted-foreground text-center pt-2">Roster Manager · All data stored locally in your browser · Export JSON backups regularly</p>

                </section>

              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
