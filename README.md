# Roster Manager — Agent Reference

A standalone desktop-ready React/Vite roster management app for aviation training and inspection scheduling. Runs in-browser during development; packages to a Windows Electron installer or portable executable via the included Electron Builder scripts.

---

## Monorepo Position

| Item | Value |
|---|---|
| Directory | `artifacts/roster-manager/` |
| Package name | `roster-manager` (**no** `@workspace/` scope) |
| pnpm filter | `pnpm --filter roster-manager <script>` |
| Workflow | `artifacts/roster-manager: web` → `pnpm --filter roster-manager run dev` |
| Preview path | `/` (port set by `PORT` env var; default 24215 in artifact.toml) |

> **Critical:** The package name is `roster-manager`, not `@workspace/roster-manager`. Any pnpm filter, artifact.toml service command, or workflow command must use the plain name.

---

## Scripts

```bash
pnpm --filter roster-manager run dev          # Vite dev server (all hosts)
pnpm --filter roster-manager run build        # Production Vite build → dist/
pnpm --filter roster-manager run typecheck    # tsc --noEmit
pnpm --filter roster-manager run dist          # Build + Electron NSIS installer (Windows)
pnpm --filter roster-manager run dist:portable # Build + Electron portable exe (Windows)
```

The Windows installer and portable executable use `assets/roster-flight-icon.ico` for
their application, shortcut, and runtime window icon. The portable build is written
to `artifacts/roster-manager/dist/` by Electron Builder.

---

## Stack

| Layer | Library |
|---|---|
| UI framework | React 19 + TypeScript |
| Build tool | Vite + @vitejs/plugin-react |
| Styling | Tailwind CSS v4 |
| UI primitives | shadcn/ui (Radix-based) — `src/components/ui/` |
| Routing | Wouter (hash-based) |
| State | `useReducer` + React Context (`RosterProvider`) |
| Forms | React Hook Form + Zod |
| Animations | Framer Motion |
| Icons | Lucide React |
| Dates | date-fns, date-holidays (HK holidays) |
| Toasts | **sonner** (directly) + shadcn Toaster (both mounted in App.tsx) |
| Word export | docx + file-saver |
| Excel export | xlsx |
| Desktop | Electron (main.cjs + preload.cjs) |

---

## Source Layout

```
src/
├── App.tsx                   # Root: RosterProvider → Router → Home/NotFound
├── main.tsx                  # Vite entry point
├── index.css                 # Tailwind base
├── pages/
│   ├── home.tsx              # Primary UI (form, calendar, staging queue, settings views)
│   └── not-found.tsx
├── components/
│   ├── CalendarGrid.tsx      # Month calendar, event pills, tooltips, edit/delete
│   ├── Settings.tsx          # Inspectors, qualifications, operators, simulator config, JSON Schema viewer
│   ├── StagingQueue.tsx      # Pending events list, commit/edit/remove, swap conflict detection
│   ├── TimeInput.tsx         # Controlled HH:MM input field
│   └── ui/                   # ~60 shadcn primitives (accordion, button, dialog, table, etc.)
├── store/
│   ├── rosterStore.ts        # State types, reducer, action creators, parse helpers
│   ├── RosterProvider.tsx    # useReducer provider, hydration, auto-save, Electron flush
│   ├── useRosterStore.tsx    # Context consumer hook
│   └── validateEvent.ts      # Pure event validator (overlap, qualifications)
├── hooks/
│   ├── use-mobile.tsx
│   └── use-toast.ts
├── lib/
│   └── utils.ts              # cn() helper
└── utils/
    ├── holidays.ts           # HK public holiday map/set generators
    ├── rosterSchema.ts       # JSON Schema Draft-07 constant (ROSTER_SCHEMA) for all event types
    ├── storage.ts            # loadData/saveData — Electron IPC or localStorage fallback
    └── wordExport.ts         # exportWordCalendar() → DOCX
```

---

## Data Model

### Event Types (union: `RosterEvent`)

| Type | Key field | Notes |
|---|---|---|
| `SimulatorEvent` | `eventType: 'Simulator'` | Has `simulatorId`, `inspectors[]`, duration, qualifications-gated |
| `SurveillanceEvent` | `eventType: 'Surveillance'` | Has `operator`, `surveillanceTypes[]` (multi-select), free-text `details` |
| `OtherDutiesEvent` | `eventType: 'OtherDuties'` | Free-form duty description |
| `LeaveEvent` | `eventType: 'Leave'` | Inspector out; renders `bg-gray-600` pills, sorted last per day |

> **Legacy note:** Old JSON exports may contain `eventType: 'OOO'` or `'AEX/MOR'`. No migration shim exists yet — they load but render incorrectly. Legacy `eventType: 'Inspection'` events (with `inspectionType` / `route` / `flightNo` / `station`) **are** migrated automatically to `Surveillance` on load and import.

### Calendar Day Sort Order

Events within a day sort by `typeOrder`: Simulator (0) → Surveillance (1) → OtherDuties (2) → Leave (3), then by start time.

### Multi-day timed events

New Leave, Surveillance, and Other Duties entries can use an inclusive end date. Each
day is stored as an independent event so conflict checks, editing, calendar display,
and exports continue to work per day. For a multi-day timed range, the first day uses
the entered start time through `23:59`, middle days use `00:00–23:59`, and the final
day uses `00:00` through the entered end time. Blank optional times create all-day
entries (`00:00–23:59`). Simulator entries remain single-day, and editing an existing
calendar or staged entry never creates a new range.

---

## State & Storage

### `rosterStore.ts`

Defines `RosterState`, all action types, and the reducer. Key sub-state:

- `events: RosterEvent[]` — committed calendar events
- `stagingQueue: StagingEvent[]` — pending events awaiting commit
- `inspectors: Inspector[]`
- `qualifications: Qualifications` — `Record<activityId, inspectorId[]>`
- `simulatorMap: SimulatorMap` — simulator ID → config
- `settings: RosterSettings` — operators, colors, display options

Parse helpers (`parseEvents`, `parseJson`) accept an optional `onCorrupt?: () => void` callback — fire it instead of silently swallowing bad data.

### `RosterProvider.tsx`

- Hydrates state from storage on mount; detects version mismatch and resets to defaults if needed.
- **Corruption handling:** each storage key gets a labelled `onCorrupt` callback; any that fire are collected into `corruptedKeys[]` and displayed as a grouped `toast.error()` via sonner after dispatch.
- Auto-saves with a 1-second debounce after every state change.
- Also saves on: `Ctrl/Cmd+S`, `visibilitychange`, `beforeunload`, and Electron `app-close` IPC event.

### `storage.ts`

```ts
loadData(key: string): string | null
saveData(key: string, value: string): void
```

Detects `window.electronAPI` at runtime; falls back to `localStorage`. Electron IPC uses `main.cjs` → synchronous file I/O for flush-on-close safety.

---

## `validateEvent.ts`

```ts
validateEvent(
  event: EventInput,
  calendarEvents: RosterEvent[],
  inspectors: Inspector[],
  qualifications: Qualifications,
  excludeId?: string,           // single event ID to exclude (edit mode)
  excludeSourceIds?: Set<string> // set of source IDs to exclude (swap staging)
): ValidationResult
```

- Checks time ordering, same-day inspector double-booking, and Simulator qualification.
- **Swap conflict fix:** When staging two swap events, pass `allSourceIds` as a `Set<string>` (built from the full staging queue) so each staged event sees the other's original as already removed.

---

## Key Behaviours to Preserve

### Qualified Inspectors First (Simulator events)
`sortedInspectors()` — a helper defined locally in both `CalendarGrid.tsx` and `StagingQueue.tsx` — reorders the inspector list so those whose ID appears in `qualifications[activity]` float to the top. Non-Simulator events are unaffected.

### Filter-Aware Exports
All three export paths (JSON, Word, Excel) call `applyCalendarFilters()` when any calendar filter is active, and display a filter-count notice in the export.

### Toast Provider
- Mount **both** toasters in `App.tsx`:
  - `<Toaster />` from `@/components/ui/toaster` (shadcn, for `useToast` hooks)
  - `<Toaster richColors position="top-right" />` from `'sonner'` (for programmatic `toast.*` calls)
- **Never** import the Toaster from `@/components/ui/sonner` — that wrapper requires `next-themes`/`useTheme` which has no `ThemeProvider` in this app and will crash.

### JSON Schema (Settings)
`ROSTER_SCHEMA` in `src/utils/rosterSchema.ts` is a JSON Schema Draft-07 constant covering all four event types with descriptions, enums, formats, and examples. `Settings.tsx` renders it in a `SchemaCollapsible` with a copy button.

---

## Electron Packaging

`main.cjs` and `preload.cjs` are at the artifact root. Electron Builder config lives in `package.json` under `"build"`. The `dist` script targets Windows NSIS; `dist:portable` targets a single-file portable exe. Storage in Electron mode uses `app.getPath('userData')` via IPC — never `localStorage`.

---

## Dark Mode

Dark mode is implemented without `next-themes`. The setup:

- **`src/hooks/use-theme.ts`** — `useTheme()` hook. Reads initial preference from `localStorage` (`roster-theme`) or falls back to `prefers-color-scheme`. Toggles `dark` class on `<html>` and persists the choice.
- **`src/index.css`** — `html.dark { ... }` block overrides all CSS custom properties (background, card, border, etc.) with dark-mode values. The Tailwind custom variant `@custom-variant dark (&:is(.dark *))` is already wired; `dark:` utilities work on any descendant of `html.dark`.
- **Toggle button** — Moon/Sun icon button lives in the header in `home.tsx`, rendered from `useTheme().isDark` / `.toggle`.
- **Structural colors** — all panels use `bg-card`, inputs use `bg-card`, dropdowns use `bg-card`, weekend/holiday calendar cells use `bg-muted`. These inherit dark values automatically via the CSS tokens.

**Do not** add `next-themes` or a `ThemeProvider` — the hook manages `<html>` directly without any React context.

---

## Things Not To Do

- Do not scope the package as `@workspace/roster-manager` — it will break pnpm filters and the workflow.
- Do not import `Toaster` from `@/components/ui/sonner` for programmatic toasts.
- Do not add a migration shim for `OOO`/`AEX/MOR` event types without also updating `parseEvents` and the JSON Schema.
- Do not hard-code `localhost` URLs in app code — the dev server is proxied through Replit's iframe.
- Do not add `next-themes` or a ThemeProvider — dark mode uses `src/hooks/use-theme.ts` which toggles `dark` on `<html>` directly.
