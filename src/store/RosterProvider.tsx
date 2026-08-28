// Component-only file — safe for Vite Fast Refresh.
// All non-component exports (types, context, hook) live in ./rosterStore.ts

import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  DEFAULT_INSPECTORS,
  DEFAULT_OPERATORS,
  DEFAULT_OPERATOR_COLORS,
  DEFAULT_OTHER_DUTIES_COLORS,
  DEFAULT_QUALIFICATIONS,
  DEFAULT_SIMULATOR_ACTIVITIES,
  DEFAULT_SIMULATOR_MAP,
  DEFAULT_SURVEILLANCE_ACTIVITIES,
  DEFAULT_SURVEILLANCE_QUALIFICATIONS,
  DEFAULT_LEAVE_TYPES,
  DEFAULT_DUTY_SUBTYPES,
  Inspector,
  ROSTER_VERSION,
  RosterContext,
  RosterEvent,
  firstNameOf,
  generateId,
  initialRosterState,
  parseEvents,
  parseJson,
  rosterReducer,
  sortInspectorsByName,
} from './rosterStore';
import { loadData, saveData } from '../utils/storage';
import { toast } from 'sonner';

const AUTO_SAVE_DELAY_MS = 1000;

// ── Inspector name migration helpers ─────────────────────────────────────────
// Builds a first-name → full-name map from a list of inspectors.
// Entries with colliding first names are marked ambiguous (empty string)
// so they are never substituted.
function buildFirstToFullMap(inspectors: Inspector[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const insp of inspectors) {
    const fn = firstNameOf(insp.name);
    if (m.has(fn)) {
      m.set(fn, ''); // ambiguous — two inspectors share the same first name
    } else {
      m.set(fn, insp.name);
    }
  }
  return m;
}

// Upgrades legacy first-name-only inspector strings inside events to full names.
// Names that already contain a space are assumed to be full names and left as-is.
// Names with no unique match are also left unchanged.
function migrateEvents(
  events: RosterEvent[],
  firstToFull: Map<string, string>,
): RosterEvent[] {
  const upgrade = (name: string): string => {
    if (name.includes(' ')) return name; // already a full name
    const full = firstToFull.get(name);
    return full ? full : name; // skip ambiguous (full === '') or unknown
  };
  return events.map(ev => {
    const inspectors = ev.inspectors.map(upgrade);
    const previousInspectors = ev.previousInspectors?.map(upgrade);
    const previousValues = ev.previousValues
      ? {
          ...ev.previousValues,
          ...(Array.isArray(ev.previousValues.inspectors)
            ? { inspectors: ev.previousValues.inspectors.map(upgrade) }
            : {}),
        }
      : undefined;
    return {
      ...ev,
      inspectors,
      ...(previousInspectors ? { previousInspectors } : {}),
      ...(previousValues ? { previousValues } : {}),
    };
  });
}

export function RosterProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(rosterReducer, initialRosterState);
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  // ── Auto-load on start (environment-aware: Electron file storage or localStorage).
  // If the stored version doesn't match ROSTER_VERSION, reset inspectors and
  // qualifications to defaults so stale position names don't persist.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [
        storedVersion,
        stagingRaw, calendarRaw, inspectorsRaw, qualsRaw,
         operatorsRaw, colorsRaw, otherDutiesColorsRaw, simActsRaw, simMapRaw,
        survActsRaw, survQualsRaw, leaveTypesRaw, dutySubTypesRaw,
      ] = await Promise.all([
        loadData('roster_version'),
        loadData('roster_stagingQueue'),
        loadData('roster_calendarEvents'),
        loadData('roster_inspectors'),
        loadData('roster_qualifications'),
        loadData('roster_operators'),
        loadData('roster_operatorColors'),
         loadData('roster_otherDutiesColors'),
        loadData('roster_simulatorActivities'),
        loadData('roster_simulatorMap'),
        loadData('roster_surveillanceActivities'),
        loadData('roster_surveillanceQualifications'),
        loadData('roster_leaveTypes'),
        loadData('roster_dutySubTypes'),
      ]);
      if (cancelled) return;

      const versionMatch = storedVersion === ROSTER_VERSION;
      if (!versionMatch) {
        void saveData('roster_version', ROSTER_VERSION);
      }

      // Collect which keys were corrupted so we can show a single grouped toast.
      const corruptedKeys: string[] = [];
      const onCorrupt = (label: string) => () => corruptedKeys.push(label);

      // Load inspectors first so the migration pass can use them.
      const loadedInspectors: Inspector[] = versionMatch
        ? sortInspectorsByName(parseJson(inspectorsRaw, DEFAULT_INSPECTORS, onCorrupt('inspectors')))
        : sortInspectorsByName(DEFAULT_INSPECTORS);

      // Upgrade any legacy first-name-only inspector strings to full names.
      const firstToFull = buildFirstToFullMap(loadedInspectors);
      const rawStaging  = parseEvents(stagingRaw,  onCorrupt('staging queue'));
      const rawCalendar = parseEvents(calendarRaw, onCorrupt('calendar events'));

      dispatch({
        type: 'INIT',
        payload: {
          stagingQueue:        migrateEvents(rawStaging,  firstToFull),
          calendarEvents:      migrateEvents(rawCalendar, firstToFull),
          inspectors:          loadedInspectors,
          qualifications:      versionMatch ? parseJson(qualsRaw,      DEFAULT_QUALIFICATIONS,      onCorrupt('qualifications')) : DEFAULT_QUALIFICATIONS,
          operators:           parseJson(operatorsRaw, DEFAULT_OPERATORS,           onCorrupt('operators')).slice().sort((a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
          operatorColors:      parseJson(colorsRaw,    DEFAULT_OPERATOR_COLORS,    onCorrupt('operator colours')),
           otherDutiesColors:   parseJson(otherDutiesColorsRaw, DEFAULT_OTHER_DUTIES_COLORS, onCorrupt('other duties colours')),
          simulatorActivities: parseJson(simActsRaw,   DEFAULT_SIMULATOR_ACTIVITIES, onCorrupt('simulator activities')).slice().sort((a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
          surveillanceActivities: parseJson(survActsRaw, DEFAULT_SURVEILLANCE_ACTIVITIES, onCorrupt('surveillance activities')).slice().sort((a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
          surveillanceQualifications: versionMatch ? parseJson(survQualsRaw, DEFAULT_SURVEILLANCE_QUALIFICATIONS, onCorrupt('surveillance qualifications')) : DEFAULT_SURVEILLANCE_QUALIFICATIONS,
          simulatorMap:        parseJson(simMapRaw,    DEFAULT_SIMULATOR_MAP,      onCorrupt('simulator map')),
          leaveTypes:          parseJson(leaveTypesRaw,   DEFAULT_LEAVE_TYPES,   onCorrupt('leave types')).slice().sort((a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
          dutySubTypes:        parseJson(dutySubTypesRaw, DEFAULT_DUTY_SUBTYPES, onCorrupt('duty sub-types')).slice().sort((a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
          editingEventId:      null,
          editingStagingId:    null,
        },
      });

      if (corruptedKeys.length > 0) {
        toast.error('Save data corrupted — defaults loaded', {
          description: `Could not read: ${corruptedKeys.join(', ')}. Your other data is unaffected.`,
          duration: 8000,
        });
      }
      hydrated.current = true;
      setIsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Persistence: debounced auto-save + immediate manual save ───────────────
  // stateRef always holds the latest state so manualSave/flush never save stale data.
  const stateRef = useRef(state);
  stateRef.current = state;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistNow = useCallback(async () => {
    setSaveStatus('saving');
    const s = stateRef.current;
    await Promise.all([
      saveData('roster_version',             ROSTER_VERSION),
      saveData('roster_stagingQueue',        JSON.stringify(s.stagingQueue)),
      saveData('roster_calendarEvents',      JSON.stringify(s.calendarEvents)),
      saveData('roster_inspectors',          JSON.stringify(s.inspectors)),
      saveData('roster_qualifications',      JSON.stringify(s.qualifications)),
      saveData('roster_operators',           JSON.stringify(s.operators)),
      saveData('roster_operatorColors',      JSON.stringify(s.operatorColors)),
      saveData('roster_otherDutiesColors',   JSON.stringify(s.otherDutiesColors)),
      saveData('roster_simulatorActivities', JSON.stringify(s.simulatorActivities)),
      saveData('roster_simulatorMap',        JSON.stringify(s.simulatorMap)),
      saveData('roster_surveillanceActivities',     JSON.stringify(s.surveillanceActivities)),
      saveData('roster_surveillanceQualifications', JSON.stringify(s.surveillanceQualifications)),
      saveData('roster_leaveTypes',   JSON.stringify(s.leaveTypes)),
      saveData('roster_dutySubTypes', JSON.stringify(s.dutySubTypes)),
    ]);
    setSaveStatus('saved');
    if (savedTimer.current !== null) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => {
      setSaveStatus('idle');
      savedTimer.current = null;
    }, 2000);
  }, []);

  /** Save immediately, bypassing (and clearing) any pending debounced save. */
  const manualSave = useCallback(async () => {
    if (!hydrated.current) return; // never persist pre-hydration initial state
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await persistNow();
  }, [persistNow]);

  // Debounced auto-save on every data change (skip the pre-hydration initial state)
  useEffect(() => {
    if (!hydrated.current) return;
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void persistNow();
    }, AUTO_SAVE_DELAY_MS);
    return () => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [state.stagingQueue, state.calendarEvents, state.inspectors, state.qualifications, state.operators, state.operatorColors, state.otherDutiesColors, state.simulatorActivities, state.simulatorMap, state.surveillanceActivities, state.surveillanceQualifications, state.leaveTypes, state.dutySubTypes, persistNow]);

  // Flush any pending save when the window is closed/hidden so data isn't lost
  // inside the debounce window.
  useEffect(() => {
    const flush = () => {
      if (!hydrated.current) return;
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void persistNow();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [persistNow]);

  // Electron: main process asks us to flush before the window closes and waits
  // for the acknowledgement (storage:flush-complete) before actually closing,
  // so async IPC writes aren't abandoned mid-teardown.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onFlushRequest) return;
    const dispose = api.onFlushRequest(async () => {
      if (hydrated.current) {
        if (saveTimer.current !== null) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        await persistNow();
      }
      api.flushComplete?.();
    });
    return dispose;
  }, [persistNow]);

  // Ctrl+S / Cmd+S → manual save
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void manualSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [manualSave]);

  // ── Event actions ──────────────────────────────────────────────────────────
  const addEventToQueue = (eventData: Omit<RosterEvent, 'id'>) => {
    dispatch({ type: 'ADD_EVENT', payload: { ...eventData, id: generateId() } as RosterEvent });
  };
  const removeEvent         = (id: string) => dispatch({ type: 'REMOVE_EVENT',          payload: id });
  const commitEvent         = (id: string) => dispatch({ type: 'COMMIT_EVENT',           payload: id });
  const commitAll           = ()           => dispatch({ type: 'COMMIT_ALL' });
  const removeCalendarEvent = (id: string) => dispatch({ type: 'REMOVE_CALENDAR_EVENT',  payload: id });
  const clearEventHistory = (
    id: string,
    kind: import('./rosterStore').EventHistoryField | 'inspectors' | 'time',
  ) =>
    dispatch({ type: 'CLEAR_EVENT_HISTORY', payload: { id, kind } });

  // ── Inspector actions ──────────────────────────────────────────────────────
  const addInspector = (data: Omit<Inspector, 'id'>) => {
    dispatch({ type: 'ADD_INSPECTOR', payload: { ...data, id: generateId() } });
  };
  const removeInspector = (id: string) => dispatch({ type: 'REMOVE_INSPECTOR', payload: id });

  // ── Qualification actions ──────────────────────────────────────────────────
  const toggleQualification = (activity: string, position: string) => {
    dispatch({ type: 'TOGGLE_QUALIFICATION', payload: { activity, position } });
  };
  const setActivityQualifications = (activity: string, positions: string[]) => {
    dispatch({ type: 'SET_ACTIVITY_QUALIFICATIONS', payload: { activity, positions } });
  };
  const setSurveillanceQualifications = (activity: string, positions: string[]) => {
    dispatch({ type: 'SET_SURVEILLANCE_QUALIFICATIONS', payload: { activity, positions } });
  };

  // ── List actions ───────────────────────────────────────────────────────────
  const addListItem    = (list: import('./rosterStore').ListKey, value: string) =>
    dispatch({ type: 'ADD_LIST_ITEM',    payload: { list, value } });
  const removeListItem = (list: import('./rosterStore').ListKey, value: string) =>
    dispatch({ type: 'REMOVE_LIST_ITEM', payload: { list, value } });
  const renameListItem = (list: import('./rosterStore').ListKey, oldValue: string, newValue: string) =>
    dispatch({ type: 'RENAME_LIST_ITEM', payload: { list, oldValue, newValue } });

  // ── Operator color actions ─────────────────────────────────────────────────
  const setOperatorColor = (operator: string, color: string) =>
    dispatch({ type: 'SET_OPERATOR_COLOR', payload: { operator, color } });
  const setOtherDutiesColor = (subType: string, color: string) =>
    dispatch({ type: 'SET_OTHER_DUTIES_COLOR', payload: { subType, color } });

  // ── Simulator map actions ──────────────────────────────────────────────────
  const setSimMapEntry = (code: string, aircraftType: string) =>
    dispatch({ type: 'SET_SIM_MAP_ENTRY', payload: { code, aircraftType } });
  const removeSimMapEntry = (code: string) =>
    dispatch({ type: 'REMOVE_SIM_MAP_ENTRY', payload: code });

  // ── Edit mode actions ──────────────────────────────────────────────────────
  // The two edit modes are mutually exclusive: activating one always clears the other.
  const setEditingEventId = (id: string | null) => {
    if (id !== null) dispatch({ type: 'SET_EDITING_STAGING_ID', payload: null });
    dispatch({ type: 'SET_EDITING_EVENT_ID', payload: id });
  };
  const updateCalendarEvent = (id: string, data: Omit<import('./rosterStore').RosterEvent, 'id'>) =>
    dispatch({ type: 'UPDATE_CALENDAR_EVENT', payload: { id, data } });
  const setEditingStagingId = (id: string | null) => {
    if (id !== null) dispatch({ type: 'SET_EDITING_EVENT_ID', payload: null });
    dispatch({ type: 'SET_EDITING_STAGING_ID', payload: id });
  };
  const updateStagingEvent = (id: string, data: Omit<import('./rosterStore').RosterEvent, 'id'>) =>
    dispatch({ type: 'UPDATE_STAGING_EVENT', payload: { id, data } });

  // ── Import / Reset actions ─────────────────────────────────────────────────
  const importState = (data: Partial<import('./rosterStore').RosterState>) => {
    // Normalise any legacy first-name-only inspector strings in imported events.
    // Use the inspector list that will be active after the import: prefer the
    // imported inspectors (if any) so a settings+events bundle migrates itself;
    // otherwise fall back to the current live inspectors.
    const activeInspectors = data.inspectors ?? state.inspectors;
    const firstToFull = buildFirstToFullMap(activeInspectors);
    const migrated: Partial<import('./rosterStore').RosterState> = { ...data };
    if (migrated.stagingQueue)  migrated.stagingQueue  = migrateEvents(migrated.stagingQueue,  firstToFull);
    if (migrated.calendarEvents) migrated.calendarEvents = migrateEvents(migrated.calendarEvents, firstToFull);
    dispatch({ type: 'IMPORT_STATE', payload: migrated });
  };
  const resetAll = () => dispatch({ type: 'RESET_ALL' });

  return (
    <RosterContext.Provider value={{
      state,
      addEventToQueue,
      removeEvent,
      commitEvent,
      commitAll,
      removeCalendarEvent,
      clearEventHistory,
      addInspector,
      removeInspector,
      toggleQualification,
      setActivityQualifications,
      setSurveillanceQualifications,
      addListItem,
      removeListItem,
      renameListItem,
      setOperatorColor,
      setOtherDutiesColor,
      setSimMapEntry,
      removeSimMapEntry,
      setEditingEventId,
      updateCalendarEvent,
      setEditingStagingId,
      updateStagingEvent,
      importState,
      resetAll,
      manualSave,
      isLoaded,
      saveStatus,
    }}>
      {isLoaded ? children : (
        <div className="flex h-screen items-center justify-center text-muted-foreground text-sm">
          Loading roster data…
        </div>
      )}
    </RosterContext.Provider>
  );
}
