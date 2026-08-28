import { useState, useMemo, useEffect } from 'react';
import {
  useRosterStore,
  OperatorRequestEvent,
  RosterEvent,
  SurveillanceEvent,
} from '@/store/rosterStore';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowDown, ArrowUp, BarChart2, ClipboardList } from 'lucide-react';

// ─── OJT types ───────────────────────────────────────────────────────────────

type OJTRecord = {
  id: string;
  date: string;
  task: string;
  operator: string;
  supervisors: { name: string; position: string }[];
};

type SurveillanceRecord = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  types: string[];
  details: string;
  inspectors: string[];
};

type OtherDutiesRecord = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  activity: string;
  operators: string;
  inspectors: string;
  remarks: string;
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, '0'); }

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function currentYYYYMM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** First day of the same month one year ago — e.g. if today is Aug 14 2026 → "2025-08-01". */
function twelveMonthsAgoISO(): string {
  const d = new Date();
  return `${d.getFullYear() - 1}-${pad2(d.getMonth() + 1)}-01`;
}

/** Last day of the current month — e.g. Aug 2026 → "2026-08-31". */
function endOfCurrentMonthISO(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${pad2(last.getMonth() + 1)}-${pad2(last.getDate())}`;
}

function fmtMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/** "DDMMYY" → YYYY-MM-DD. Years 00–69 are treated as 2000–2069. */
function parseDDMMYY(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 6) return null;
  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = 2000 + Number(digits.slice(4, 6));
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function toDDMMYY(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}${month}${year.slice(-2)}`;
}

function parseMins(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function eventDurationMins(ev: RosterEvent): number {
  const s = ev.startTime ?? '';
  const e = ev.endTime ?? '';
  if (!s || !e || (s === '00:00' && e === '23:59')) return 0;
  const sm = parseMins(s);
  const em = parseMins(e);
  return em > sm ? em - sm : 0;
}

function fmtHours(mins: number): string {
  if (mins === 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function fmtBarHours(mins: number): string {
  if (mins === 0) return '';
  if (mins % 60 === 0) return `${mins / 60}h`;
  return `${(mins / 60).toFixed(1)}h`;
}

// ─── Event-type colour + label maps ──────────────────────────────────────────

const DUTY_TYPES = ['Operator Request', 'Surveillance', 'Other Duties'] as const;
type DutyType = typeof DUTY_TYPES[number];

const TYPE_BG: Record<DutyType, string> = {
  'Operator Request': 'bg-blue-500',
  Surveillance: 'bg-violet-500',
  'Other Duties': 'bg-orange-400',
};
const TYPE_LABEL: Record<DutyType, string> = {
  'Operator Request':   'Operator Request',
  Surveillance: 'Surveillance',
  'Other Duties': 'Other Duties',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ManagementSummary() {
  const { state } = useRosterStore();
  const {
    calendarEvents,
    inspectors,
    qualifications,
    surveillanceActivities,
    surveillanceQualifications,
    dutySubTypes,
  } = state;

  // ─── OJT extraction ────────────────────────────────────────────────────────
  const ojtLedger = useMemo<Record<string, OJTRecord[]>>(() => {
    // Build a lookup: full name → position
    const positionOf = new Map<string, string>(
      inspectors.map(ins => [ins.name, ins.position]),
    );

    const ledger: Record<string, OJTRecord[]> = {};

    // Shared derivation for Operator Request and Surveillance events: inspectors whose
    // position is permitted for the activity act as supervisors; others are
    // trainees. Sessions with no qualified inspector are not OJT sessions.
    const addOjtRecords = (
      ev: { id: string; date: string; operator: string; inspectors: string[] },
      task: string,
      permittedPositions: string[],
    ) => {
      const qualified: string[] = [];
      const trainees: string[] = [];

      for (const name of ev.inspectors) {
        const pos = positionOf.get(name) ?? '';
        if (permittedPositions.includes(pos)) {
          qualified.push(name);
        } else {
          trainees.push(name);
        }
      }

      if (qualified.length === 0) return; // not an OJT session

      const supervisors = qualified.map(name => ({
        name,
        position: positionOf.get(name) ?? '',
      }));
      for (const trainee of trainees) {
        const record: OJTRecord = {
          id: `${ev.id}-${task}-${trainee}`,
          date: ev.date,
          task,
          operator: ev.operator,
          supervisors,
        };
        if (!ledger[trainee]) ledger[trainee] = [];
        ledger[trainee].push(record);
      }
    };

    for (const ev of calendarEvents) {
      if (ev.eventType === 'Operator Request') {
        const sim = ev as OperatorRequestEvent;
        addOjtRecords(sim, sim.activity, qualifications[sim.activity] ?? []);
      } else if (ev.eventType === 'Surveillance') {
        for (const type of ev.surveillanceTypes) {
          addOjtRecords(ev, type, surveillanceQualifications[type] ?? []);
        }
      }
    }

    // Sort each trainee's records by date descending
    for (const records of Object.values(ledger)) {
      records.sort((a, b) => b.date.localeCompare(a.date));
    }

    return ledger;
  }, [calendarEvents, inspectors, qualifications, surveillanceQualifications]);

  // Inspectors not qualified for at least one activity → eligible as trainees
  const eligibleInspectors = useMemo(() => {
    const notQualifiedSomewhere = (quals: Record<string, string[]>, pos: string) =>
      Object.keys(quals).some(act => !(quals[act] ?? []).includes(pos));
    return inspectors
      .filter(ins =>
        notQualifiedSomewhere(qualifications, ins.position) ||
        notQualifiedSomewhere(surveillanceQualifications, ins.position),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inspectors, qualifications, surveillanceQualifications]);

  const [selectedTrainee, setSelectedTrainee] = useState<string>('');

  // Reset if the selected inspector is no longer eligible (qualifications changed)
  useEffect(() => {
    if (selectedTrainee && !eligibleInspectors.find(ins => ins.name === selectedTrainee)) {
      setSelectedTrainee('');
    }
  }, [eligibleInspectors, selectedTrainee]);

  // Records for selected trainee, keyed by activity
  const recordsByActivity = useMemo<Record<string, OJTRecord[]>>(() => {
    if (!selectedTrainee) return {};
    const all = ojtLedger[selectedTrainee] ?? [];
    const map: Record<string, OJTRecord[]> = {};
    for (const rec of all) {
      if (!map[rec.task]) map[rec.task] = [];
      map[rec.task].push(rec);
    }
    return map;
  }, [ojtLedger, selectedTrainee]);

  // Available months derived from event dates, newest first
  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>();
    for (const ev of calendarEvents) monthSet.add(ev.date.slice(0, 7));
    return [...monthSet].sort().reverse();
  }, [calendarEvents]);

  const defaultMonth = availableMonths.includes(currentYYYYMM())
    ? currentYYYYMM()
    : (availableMonths[0] ?? currentYYYYMM());

  const [period, setPeriod] = useState<'month' | 'rolling12' | 'custom'>('month');
  const [selectedMonth, setSelectedMonth] = useState<string>(defaultMonth);
  const [customFrom, setCustomFrom] = useState<string>(
    () => toDDMMYY(`${defaultMonth}-01`),
  );
  const [customTo, setCustomTo] = useState<string>(
    () => toDDMMYY(endOfCurrentMonthISO()),
  );
  const [metric, setMetric] = useState<'count' | 'hours'>('count');
  const [surveillanceSort, setSurveillanceSort] = useState<'date' | 'type'>('date');
  const [selectedSurveillanceActivity, setSelectedSurveillanceActivity] = useState<string>('');
  const [selectedOtherDutiesActivity, setSelectedOtherDutiesActivity] = useState<string>('');
  const [otherDutiesSort, setOtherDutiesSort] = useState<{
    key: 'inspector' | 'operator' | 'activity' | 'date';
    direction: 'asc' | 'desc';
  }>({ key: 'date', direction: 'desc' });
  const customFromISO = parseDDMMYY(customFrom);
  const customToISO = parseDDMMYY(customTo);

  // Keep the filter valid as Settings changes the configured activity list.
  // An empty effective value means all activities, including historical event
  // types that are no longer configured.
  const effectiveSurveillanceActivity = surveillanceActivities.includes(
    selectedSurveillanceActivity,
  )
    ? selectedSurveillanceActivity
    : '';

  useEffect(() => {
    if (
      selectedSurveillanceActivity &&
      !surveillanceActivities.includes(selectedSurveillanceActivity)
    ) {
      setSelectedSurveillanceActivity('');
    }
  }, [selectedSurveillanceActivity, surveillanceActivities]);

  const effectiveOtherDutiesActivity = dutySubTypes.includes(
    selectedOtherDutiesActivity,
  )
    ? selectedOtherDutiesActivity
    : '';

  useEffect(() => {
    if (
      selectedOtherDutiesActivity &&
      !dutySubTypes.includes(selectedOtherDutiesActivity)
    ) {
      setSelectedOtherDutiesActivity('');
    }
  }, [selectedOtherDutiesActivity, dutySubTypes]);

  // Filtered events for the selected period
  const filteredEvents = useMemo(() => {
    if (period === 'month') {
      return calendarEvents.filter(ev => ev.date.startsWith(selectedMonth + '-'));
    }
    if (period === 'custom') {
      if (!customFromISO || !customToISO || customFromISO > customToISO) return [];
      return calendarEvents.filter(ev => ev.date >= customFromISO && ev.date <= customToISO);
    }
    const from = twelveMonthsAgoISO();
    const to = endOfCurrentMonthISO();
    return calendarEvents.filter(ev => ev.date >= from && ev.date <= to);
  }, [calendarEvents, period, selectedMonth, customFromISO, customToISO]);

  // Empty Other Duties operator fields are not summary events. Explicit values
  // such as "N/A" still represent a deliberate operator selection and count.
  const summaryEvents = useMemo(
    () =>
      filteredEvents.filter(
        ev =>
          ev.eventType !== 'Other Duties' ||
          ev.operators.some(operator => operator.trim().length > 0),
      ),
    [filteredEvents],
  );

  // Duty vs Leave split
  const dutyEvents = useMemo(
    () => summaryEvents.filter(ev => ev.eventType !== 'Leave'),
    [summaryEvents],
  );
  const leaveEvents = useMemo(
    () => summaryEvents.filter(ev => ev.eventType === 'Leave'),
    [summaryEvents],
  );
  const total = summaryEvents.length;
  const dutyPct  = total > 0 ? Math.round((dutyEvents.length  / total) * 100) : 0;
  const leavePct = total > 0 ? 100 - dutyPct : 0;

  // Workload: events and hours per inspector (duty only), broken down by event type
  const workloadMap = useMemo(() => {
    type Row = {
      count: number;
      mins: number;
      byType: Record<string, number>;
      byTypeMins: Record<string, number>;
    };
    const map = new Map<string, Row>();
    for (const ev of dutyEvents) {
      const dur = eventDurationMins(ev);
      const t = ev.eventType as string;
      for (const name of ev.inspectors) {
        const prev = map.get(name) ?? { count: 0, mins: 0, byType: {}, byTypeMins: {} };
        map.set(name, {
          count: prev.count + 1,
          mins: prev.mins + dur,
          byType: { ...prev.byType, [t]: (prev.byType[t] ?? 0) + 1 },
          byTypeMins: { ...prev.byTypeMins, [t]: (prev.byTypeMins[t] ?? 0) + dur },
        });
      }
    }
    return map;
  }, [dutyEvents]);

  const totalDutyMins = useMemo(
    () => dutyEvents.reduce((acc, ev) => acc + eventDurationMins(ev), 0),
    [dutyEvents],
  );

  const totalLeaveMins = useMemo(
    () => leaveEvents.reduce((acc, ev) => acc + eventDurationMins(ev), 0),
    [leaveEvents],
  );

  // Sorted by the active metric
  const workloadList = useMemo(() => {
    const entries = [...workloadMap.entries()];
    if (metric === 'hours') {
      entries.sort((a, b) => b[1].mins - a[1].mins);
    } else {
      entries.sort((a, b) => b[1].count - a[1].count);
    }
    return entries;
  }, [workloadMap, metric]);

  const maxVal = metric === 'hours'
    ? (workloadList[0]?.[1].mins ?? 1) || 1
    : (workloadList[0]?.[1].count ?? 1) || 1;

  // Operator request count: Operator Request events grouped by operator
  const operatorRequestList = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of filteredEvents) {
      if (ev.eventType !== 'Operator Request') continue;
      const op = (ev as OperatorRequestEvent).operator;
      map.set(op, (map.get(op) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filteredEvents]);

  const maxOpCount = operatorRequestList[0]?.[1] ?? 1;

  // Apply the activity filter before grouping records by operator. Events can
  // contain multiple types, so a match on any assigned type is sufficient.
  const filteredSurveillanceEvents = useMemo<SurveillanceEvent[]>(
    () =>
      filteredEvents.filter(
        (ev): ev is SurveillanceEvent =>
          ev.eventType === 'Surveillance' &&
          (effectiveSurveillanceActivity === '' ||
            ev.surveillanceTypes.includes(effectiveSurveillanceActivity)),
      ),
    [filteredEvents, effectiveSurveillanceActivity],
  );

  // Surveillance events grouped by operator for the visual activity ledger.
  const surveillanceByOperator = useMemo(() => {
    const groups = new Map<string, SurveillanceRecord[]>();
    for (const ev of filteredSurveillanceEvents) {
      const operator = ev.operator || 'N/A';
      const records = groups.get(operator) ?? [];
      records.push({
        id: ev.id,
        date: ev.date,
        startTime: ev.startTime,
        endTime: ev.endTime,
        types: ev.surveillanceTypes,
        details: ev.details,
        inspectors: ev.inspectors,
      });
      groups.set(operator, records);
    }
    return [...groups.entries()]
      .map(([operator, records]) => [
        operator,
        records.sort(
          (a, b) => {
            if (surveillanceSort === 'type') {
              const typeKey = (record: SurveillanceRecord) =>
                [...record.types]
                  .sort((left, right) =>
                    left.localeCompare(right, undefined, { sensitivity: 'base' }),
                  )
                  .join(', ');
              return (
                typeKey(a).localeCompare(
                  typeKey(b),
                  undefined,
                  { sensitivity: 'base' },
                ) ||
                a.date.localeCompare(b.date) ||
                a.startTime.localeCompare(b.startTime) ||
                a.id.localeCompare(b.id)
              );
            }
            return (
              b.date.localeCompare(a.date) ||
              b.startTime.localeCompare(a.startTime) ||
              a.id.localeCompare(b.id)
            );
          },
        ),
      ] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredSurveillanceEvents, surveillanceSort]);

  const totalSurveillanceEvents = useMemo(
    () =>
      surveillanceByOperator.reduce(
        (total, [, records]) => total + records.length,
        0,
      ),
    [surveillanceByOperator],
  );

  // Other Duties log records are derived after applying the shared period filter.
  // Joining arrays here keeps all assigned people visible while providing stable
  // values for display and sorting, without changing the roster data.
  const otherDutiesRecords = useMemo<OtherDutiesRecord[]>(() => {
    return filteredEvents
      .filter(
        ev =>
          ev.eventType === 'Other Duties' &&
          (effectiveOtherDutiesActivity === '' ||
            ev.subType === effectiveOtherDutiesActivity),
      )
      .map(ev => {
        const other = ev as RosterEvent & {
          eventType: 'Other Duties';
          operators?: string[];
          subType?: string;
          remarks?: string;
        };
        const valuesForDisplay = (values?: unknown) => {
          if (Array.isArray(values)) {
            return values
              .map(value => String(value ?? '').trim())
              .filter(Boolean)
              .join(', ') || '—';
          }
          return String(values ?? '').trim() || '—';
        };
        return {
          id: ev.id,
          date: ev.date || '',
          startTime: ev.startTime || '',
          endTime: ev.endTime || '',
          activity: other.subType?.trim() || '—',
          operators: valuesForDisplay(other.operators),
          inspectors: valuesForDisplay(ev.inspectors),
          remarks: other.remarks?.trim() || '—',
        };
      });
  }, [filteredEvents, effectiveOtherDutiesActivity]);

  const sortedOtherDutiesRecords = useMemo(() => {
    const { key, direction } = otherDutiesSort;
    const directionMultiplier = direction === 'asc' ? 1 : -1;
    const valueForSort = (record: OtherDutiesRecord) => {
      if (key === 'date') return `${record.date}\u0000${record.startTime}`;
      if (key === 'inspector') return record.inspectors;
      if (key === 'operator') return record.operators;
      return record.activity;
    };
    return [...otherDutiesRecords].sort((a, b) =>
      (valueForSort(a).localeCompare(valueForSort(b), undefined, {
        sensitivity: 'base',
        numeric: true,
      }) * directionMultiplier) ||
      a.id.localeCompare(b.id),
    );
  }, [otherDutiesRecords, otherDutiesSort]);

  const setOtherDutiesSortKey = (
    key: 'inspector' | 'operator' | 'activity' | 'date',
  ) => {
    setOtherDutiesSort(current =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'date' ? 'desc' : 'asc' },
    );
  };

  const otherDutiesSortLabel = (key: typeof otherDutiesSort.key) =>
    otherDutiesSort.key === key
      ? otherDutiesSort.direction === 'asc'
        ? ' (ascending)'
        : ' (descending)'
      : '';

  const periodLabel =
    period === 'rolling12'
      ? `${twelveMonthsAgoISO()} → ${endOfCurrentMonthISO()}`
      : period === 'custom'
        ? customFromISO && customToISO
          ? `${fmtDate(customFromISO)} → ${fmtDate(customToISO)}`
          : 'Enter a valid date range'
        : fmtMonthLabel(selectedMonth);

  const summaryCardClass = 'bg-card border border-border rounded-lg overflow-hidden';
  const summaryCardHeaderClass =
    'flex flex-col items-start justify-between gap-4 border-b border-border px-5 py-4 sm:flex-row';

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-background">
      {/* Page header */}
      <div className="px-6 py-3 border-b border-border bg-card shrink-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Management Summary
        </p>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <Tabs defaultValue="overview" className="p-6">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="overview" className="flex items-center gap-1.5">
              <BarChart2 className="w-3.5 h-3.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="ojt" className="flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5" />
              OJT Tracker
            </TabsTrigger>
            <TabsTrigger value="surveillance" className="flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5" />
              Surveillance Log
            </TabsTrigger>
            <TabsTrigger value="other-duties" className="flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5" />
              Other Duties Log
            </TabsTrigger>
          </TabsList>

          {/* Shared time-range controls — apply to every tab */}
          <div className="mt-6 flex flex-wrap items-center gap-3 justify-between">
            <div className="inline-flex items-center bg-muted p-1 rounded-lg gap-0.5">
              {(['month', 'rolling12', 'custom'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${
                    period === p
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p === 'month' ? 'Month' : p === 'rolling12' ? 'Last 12 months' : 'Custom'}
                </button>
              ))}
            </div>

            {period === 'month' ? (
              <select
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                className="h-8 rounded border border-border bg-card px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              >
                {availableMonths.length === 0
                  ? <option value={currentYYYYMM()}>{fmtMonthLabel(currentYYYYMM())}</option>
                  : availableMonths.map(ym => (
                      <option key={ym} value={ym}>{fmtMonthLabel(ym)}</option>
                    ))
                }
              </select>
            ) : period === 'custom' ? (
              <div className="flex items-center gap-2">
                <input
                  inputMode="numeric"
                  maxLength={6}
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="DDMMYY"
                  aria-label="Custom range start date in DDMMYY format"
                  className="h-8 w-24 rounded border border-border bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  inputMode="numeric"
                  maxLength={6}
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="DDMMYY"
                  aria-label="Custom range end date in DDMMYY format"
                  className="h-8 w-24 rounded border border-border bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
                {(!customFromISO || !customToISO || customFromISO > customToISO) && (
                  <span className="text-xs text-destructive">Use valid DDMMYY dates</span>
                )}
              </div>
            ) : null}

            <span className="text-xs text-muted-foreground tabular-nums ml-auto">
              {periodLabel}
            </span>
          </div>

          {/* ── Overview tab ─────────────────────────────────────────────── */}
          <TabsContent value="overview" className="mt-6 space-y-6">

            {/* Overview-only metric toggle */}
            <div className="flex justify-end">
              {/* Metric toggle — right side */}
              <div className="inline-flex items-center bg-muted p-1 rounded-lg gap-0.5 ml-auto">
                {(['count', 'hours'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMetric(m)}
                    className={`px-3 py-1 text-sm font-medium rounded-md transition-all ${
                      metric === m
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {m === 'count' ? 'Events' : 'Hours'}
                  </button>
                ))}
              </div>
            </div>

            {summaryEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground">
                <BarChart2 className="w-8 h-8 opacity-30" />
                <p className="text-sm">No events found for this period.</p>
              </div>
            ) : (
              <>
                {/* ── Duty vs Leave card ────────────────────────────────── */}
                {(() => {
                  const totalMins = totalDutyMins + totalLeaveMins;
                  const dutyBarPct  = metric === 'hours'
                    ? (totalMins > 0 ? Math.round((totalDutyMins  / totalMins) * 100) : 0)
                    : dutyPct;
                  const leaveBarPct = metric === 'hours'
                    ? (totalMins > 0 ? 100 - dutyBarPct : 0)
                    : leavePct;
                  return (
                    <div className="bg-card border border-border rounded-lg p-5">
                      <h2 className="text-sm font-semibold text-foreground mb-1">Duty vs Leave</h2>
                      <p className="text-xs text-muted-foreground mb-4">
                        {metric === 'hours'
                          ? `${fmtHours(totalMins)} total — ${periodLabel}`
                          : `${total} total events — ${periodLabel}`}
                      </p>

                      {/* Segmented bar */}
                      <div className="flex h-5 w-full rounded-md overflow-hidden mb-4 bg-muted">
                        {dutyBarPct > 0 && (
                          <div
                            className="h-full bg-primary transition-all duration-300"
                            style={{ width: `${dutyBarPct}%` }}
                          />
                        )}
                        {leaveBarPct > 0 && (
                          <div
                            className="h-full bg-amber-400 transition-all duration-300"
                            style={{ width: `${leaveBarPct}%` }}
                          />
                        )}
                      </div>

                      {/* Legend */}
                      <div className="flex flex-wrap gap-6">
                        <div className="flex items-start gap-2">
                          <div className="w-3 h-3 rounded-sm bg-primary mt-0.5 shrink-0" />
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {metric === 'hours' ? fmtHours(totalDutyMins) : dutyEvents.length}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Duty {metric === 'hours' ? 'hours' : 'events'} · {dutyBarPct}%
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <div className="w-3 h-3 rounded-sm bg-amber-400 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {metric === 'hours' ? fmtHours(totalLeaveMins) : leaveEvents.length}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Leave {metric === 'hours' ? 'hours' : 'events'} · {leaveBarPct}%
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Workload Distribution card ────────────────────────── */}
                {workloadList.length > 0 && (
                  <div className="bg-card border border-border rounded-lg p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h2 className="text-sm font-semibold text-foreground mb-1">Workload Distribution</h2>
                        <p className="text-xs text-muted-foreground">
                          {metric === 'hours' ? 'Duty hours' : 'Duty events'} per inspector — sorted highest to lowest
                        </p>
                      </div>
                      {/* Legend */}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-end">
                        {DUTY_TYPES.map(t => (
                          <div key={t} className="flex items-center gap-1">
                            <div className={`w-2.5 h-2.5 rounded-sm ${TYPE_BG[t]}`} />
                            <span className="text-[10px] text-muted-foreground">{TYPE_LABEL[t]}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      {workloadList.map(([name, row]) => {
                        const primaryVal = metric === 'hours' ? row.mins : row.count;
                        const barW = primaryVal / maxVal;
                        const segments = DUTY_TYPES.map(t => ({
                          type: t,
                          value: metric === 'hours'
                            ? (row.byTypeMins[t] ?? 0)
                            : (row.byType[t] ?? 0),
                        })).filter(segment => segment.value > 0);
                        return (
                          <div key={name} className="flex items-center gap-3">
                            <div className="w-40 shrink-0 text-xs text-foreground truncate" title={name}>
                              {name}
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                              <div className="flex min-w-0 items-center gap-2">
                                {/* Stacked segmented bar */}
                                <div
                                  className="flex h-4 min-w-0 flex-1 overflow-hidden rounded bg-muted"
                                  aria-label={`${name}: ${metric === 'hours' ? fmtHours(primaryVal) : `${primaryVal} events`}`}
                                >
                                  <div
                                    className="flex h-full transition-all duration-300"
                                    style={{ width: `${barW * 100}%` }}
                                  >
                                    {segments.map(({ type, value }) => {
                                      const segPct = primaryVal > 0 ? (value / primaryVal) * 100 : 0;
                                      const label = metric === 'hours' ? fmtBarHours(value) : value;
                                      return (
                                        <div
                                          key={type}
                                          className={`h-full ${TYPE_BG[type]} flex min-w-0 items-center justify-center overflow-hidden text-[9px] font-semibold leading-none text-white`}
                                          style={{ width: `${segPct}%` }}
                                        >
                                          {metric !== 'hours' && (
                                            <span className="inline truncate px-0.5">
                                              {label}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                                {/* Total value stays outside the proportional bar. */}
                                <span className={`${metric === 'hours' ? 'w-20' : 'w-14'} shrink-0 whitespace-nowrap text-right text-xs font-semibold tabular-nums text-foreground`}>
                                  {metric === 'hours' ? fmtHours(primaryVal) : primaryVal}
                                </span>
                              </div>
                              {metric === 'hours' && (
                                <div
                                  className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[10px] leading-tight text-muted-foreground"
                                  aria-label={`${name} duty hour breakdown`}
                                >
                                  {DUTY_TYPES.map(type => {
                                    const value = row.byTypeMins[type] ?? 0;
                                    return (
                                      <span key={type} className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap">
                                        <span className={`h-2 w-2 shrink-0 rounded-sm ${TYPE_BG[type]}`} />
                                        {TYPE_LABEL[type]}: {value === 0 ? '0h' : fmtBarHours(value)}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Operator Requests card ────────────────────────────── */}
                {operatorRequestList.length > 0 && (
                  <div className="bg-card border border-border rounded-lg p-5">
                    <h2 className="text-sm font-semibold text-foreground mb-1">Operator Requests</h2>
                    <p className="text-xs text-muted-foreground mb-4">
                      Operator Request sessions per operator — sorted highest to lowest
                    </p>

                    <div className="space-y-3">
                      {operatorRequestList.map(([op, count]) => (
                        <div key={op} className="flex items-center gap-3">
                          <div className="w-40 shrink-0 text-xs text-foreground truncate" title={op}>
                            {op}
                          </div>
                          <div className="flex flex-1 items-center gap-2">
                            <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                              <div
                                className="h-full bg-primary rounded transition-all duration-300"
                                style={{ width: `${(count / maxOpCount) * 100}%` }}
                              />
                            </div>
                            <span className="w-7 text-xs font-semibold text-foreground text-right shrink-0 tabular-nums">
                              {count}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Surveillance log tab ───────────────────────────────────────── */}
          <TabsContent value="surveillance" className="mt-6 space-y-6">
            <div className={summaryCardClass}>
              <div className={summaryCardHeaderClass}>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Surveillance Activity Log
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {totalSurveillanceEvents} event{totalSurveillanceEvents !== 1 ? 's' : ''} across {surveillanceByOperator.length} operator{surveillanceByOperator.length !== 1 ? 's' : ''} · {periodLabel}
                  </p>
                </div>
                <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                  <label className="flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground whitespace-nowrap sm:w-auto">
                    Filter activity
                    <select
                      value={effectiveSurveillanceActivity}
                      onChange={e => setSelectedSurveillanceActivity(e.target.value)}
                      aria-label="Filter surveillance events by activity"
                      className="h-8 min-w-0 flex-1 rounded border border-border bg-card px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors sm:flex-none"
                    >
                      <option value="">All activities</option>
                      {surveillanceActivities.map(activity => (
                        <option key={activity} value={activity}>{activity}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground whitespace-nowrap sm:w-auto">
                    Sort events
                    <select
                      value={surveillanceSort}
                      onChange={e => setSurveillanceSort(e.target.value as 'date' | 'type')}
                      aria-label="Sort surveillance events"
                      className="h-8 min-w-0 flex-1 rounded border border-border bg-card px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors sm:flex-none"
                    >
                      <option value="date">Date</option>
                      <option value="type">Type</option>
                    </select>
                  </label>
                </div>
              </div>

              {surveillanceByOperator.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                  <ClipboardList className="w-7 h-7 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    {effectiveSurveillanceActivity
                      ? `No surveillance events found for ${effectiveSurveillanceActivity} in this period.`
                      : 'No surveillance events found for this period.'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {surveillanceByOperator.map(([operator, records]) => (
                    <section key={operator} className="px-5 py-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full bg-violet-500 shrink-0" />
                          <h2 className="text-sm font-semibold text-foreground truncate">
                            {operator}
                          </h2>
                        </div>
                        <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300 shrink-0">
                          {records.length} event{records.length !== 1 ? 's' : ''}
                        </span>
                      </div>

                      <div className="overflow-x-auto rounded border border-border">
                        <table className="w-full min-w-[620px] table-fixed text-sm">
                          <colgroup>
                            <col className="w-[14%]" />
                            <col className="w-[14%]" />
                            <col className="w-[20%]" />
                            <col className="w-[28%]" />
                            <col className="w-[24%]" />
                          </colgroup>
                          <thead className="bg-muted/40 border-b border-border">
                            <tr>
                              <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                              <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Time</th>
                              <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Type</th>
                              <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Details</th>
                              <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Inspectors</th>
                            </tr>
                          </thead>
                          <tbody>
                            {records.map((record) => (
                              <tr key={record.id} className="border-b border-border last:border-0">
                                <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                                  {fmtDate(record.date)}
                                </td>
                                <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                                  {record.startTime && record.endTime
                                    ? `${record.startTime}–${record.endTime}`
                                    : 'All day'}
                                </td>
                                <td className="break-words px-3 py-2.5 text-xs font-medium text-foreground">
                                  {record.types.join(', ')}
                                </td>
                                <td className="break-words px-3 py-2.5 text-xs text-foreground">
                                  {record.details || '—'}
                                </td>
                                <td className="break-words px-3 py-2.5 text-xs text-foreground">
                                  {record.inspectors.length > 0
                                    ? record.inspectors.join(', ')
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Other Duties log tab ───────────────────────────────────────── */}
          <TabsContent value="other-duties" className="mt-6 space-y-6">
            <div className={summaryCardClass}>
              <div className={summaryCardHeaderClass}>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Other Duties Log
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {otherDutiesRecords.length} event{otherDutiesRecords.length !== 1 ? 's' : ''} · {periodLabel}
                  </p>
                </div>
                <label className="flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground whitespace-nowrap sm:w-auto">
                  Filter activity
                  <select
                    value={effectiveOtherDutiesActivity}
                    onChange={e => setSelectedOtherDutiesActivity(e.target.value)}
                    aria-label="Filter Other Duties events by activity"
                    className="h-8 min-w-0 flex-1 rounded border border-border bg-card px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors sm:flex-none"
                  >
                    <option value="">All Duties</option>
                    {dutySubTypes.map(activity => (
                      <option key={activity} value={activity}>{activity}</option>
                    ))}
                  </select>
                </label>
              </div>

              {otherDutiesRecords.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                  <ClipboardList className="w-7 h-7 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    {effectiveOtherDutiesActivity
                      ? `No Other Duties events found for ${effectiveOtherDutiesActivity} in this period.`
                      : 'No Other Duties events found for this period.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead className="bg-muted/40 border-b border-border">
                      <tr>
                        {([
                          ['date', 'Date'],
                          ['inspector', 'Inspectors'],
                          ['operator', 'Operators'],
                          ['activity', 'Activity'],
                        ] as const).map(([key, label]) => {
                          const active = otherDutiesSort.key === key;
                          const sortDescription = `${label}${otherDutiesSortLabel(key)}`;
                          return (
                            <th
                              key={key}
                              scope="col"
                              className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide"
                            >
                              <button
                                type="button"
                                onClick={() => setOtherDutiesSortKey(key)}
                                aria-label={`Sort by ${sortDescription}`}
                                className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                              >
                                {label}
                                {active && (
                                  otherDutiesSort.direction === 'asc'
                                    ? <ArrowUp className="w-3 h-3" aria-hidden="true" />
                                    : <ArrowDown className="w-3 h-3" aria-hidden="true" />
                                )}
                              </button>
                            </th>
                          );
                        })}
                        <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-28">Time</th>
                        <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedOtherDutiesRecords.map(record => (
                        <tr key={record.id} className="border-b border-border last:border-0">
                          <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                            {record.date ? fmtDate(record.date) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-foreground">{record.inspectors}</td>
                          <td className="px-3 py-2.5 text-xs text-foreground">{record.operators}</td>
                          <td className="px-3 py-2.5 text-xs font-medium text-foreground">{record.activity}</td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                            {record.startTime && record.endTime
                              ? `${record.startTime}–${record.endTime}`
                              : 'All day'}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-foreground">{record.remarks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── OJT Tracker tab ──────────────────────────────────────────── */}
          <TabsContent value="ojt" className="mt-6 space-y-6">
            {eligibleInspectors.length === 0 ? (
              <div className={`${summaryCardClass} flex flex-col items-center justify-center gap-3 px-5 py-24 text-center`}>
                <ClipboardList className="w-10 h-10 text-muted-foreground/30" />
                <p className="text-sm font-semibold text-foreground">No eligible trainees</p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  All inspectors are qualified for every configured activity, or no activities
                  have been set up in Settings yet.
                </p>
              </div>
            ) : (
              <div className={summaryCardClass}>
                <div className={summaryCardHeaderClass}>
                  <div>
                    <p className="text-sm font-semibold text-foreground">OJT Progress</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedTrainee
                        ? `${(ojtLedger[selectedTrainee] ?? []).length} OJT session${(ojtLedger[selectedTrainee] ?? []).length !== 1 ? 's' : ''} recorded`
                        : 'Select an inspector to view OJT progress'}
                    </p>
                  </div>
                  <label className="flex w-full min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground whitespace-nowrap sm:w-auto">
                    Inspector
                    <select
                      value={selectedTrainee}
                      onChange={e => setSelectedTrainee(e.target.value)}
                      className="h-8 min-w-0 flex-1 rounded border border-border bg-card px-2.5 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors sm:w-56 sm:flex-none"
                    >
                      <option value="">Select an inspector…</option>
                      {eligibleInspectors.map(ins => (
                        <option key={ins.id} value={ins.name}>{ins.name}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* Activity table */}
                {!selectedTrainee ? (
                  <div className="flex flex-col items-center justify-center gap-2 px-5 py-16 text-center">
                    <ClipboardList className="w-7 h-7 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">Select an inspector to view OJT progress</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-card border-b border-border z-10">
                        <tr>
                          <th className="text-left px-5 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Activity</th>
                          <th className="text-left px-5 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-28">Date</th>
                          <th className="text-left px-5 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Supervisor</th>
                          <th className="text-left px-5 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Position</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...new Set([...Object.keys(qualifications), ...Object.keys(surveillanceQualifications)])].sort().map(activity => {
                          const recs = recordsByActivity[activity] ?? [];
                          if (recs.length === 0) {
                            return (
                              <tr key={activity} className="border-b border-border last:border-0">
                                <td className="px-5 py-3 text-xs text-foreground font-medium">{activity}</td>
                                <td className="px-5 py-3 text-xs text-muted-foreground">—</td>
                                <td className="px-5 py-3 text-xs text-muted-foreground">—</td>
                                <td className="px-5 py-3 text-xs text-muted-foreground">—</td>
                              </tr>
                            );
                          }
                          return recs.map((rec, i) => (
                            <tr key={rec.id} className="border-b border-border last:border-0">
                              <td className="px-5 py-3 text-xs text-foreground font-medium">
                                {i === 0 ? activity : ''}
                              </td>
                              <td className="px-5 py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                                {fmtDate(rec.date)}
                              </td>
                              <td className="px-5 py-3 text-xs text-foreground">
                                {rec.supervisors.map(s => s.name).join(', ')}
                              </td>
                              <td className="px-5 py-3 text-xs text-foreground">
                                {rec.supervisors.map(s => s.position).join(', ')}
                              </td>
                            </tr>
                          ));
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
