import { useEffect, useRef, useState, useCallback } from 'react';
import { Plus, Trash2, UserPlus, X, ChevronDown, Copy, Check, Pencil } from 'lucide-react';
import { useRosterStore, SIMULATOR_ACTIVITIES, firstNameOf, makeShortName } from '@/store/rosterStore';

// ─── Pill tag + autocomplete input ───────────────────────────────────────────

type Suggestion = { position: string; label: string; byName: boolean };

function QualInput({
  permitted,
  allPositions,
  inspectors,
  onCommit,
}: {
  permitted: string[];
  allPositions: string[];
  inspectors: { name: string; position: string }[];
  onCommit: (positions: string[]) => void;
}) {
  const [draft, setDraft]       = useState('');
  const [open, setOpen]         = useState(false);
  const [cursor, setCursor]     = useState(-1);
  const inputRef                = useRef<HTMLInputElement>(null);
  const containerRef            = useRef<HTMLDivElement>(null);

  // Build suggestions: position matches first, then name→position matches.
  // Deduplicate by position so a name match doesn't double-up a position match.
  const suggestions: Suggestion[] = (() => {
    if (!draft) return allPositions
      .filter(p => !permitted.includes(p))
      .map(p => ({ position: p, label: p, byName: false }));

    const q = draft.toLowerCase();
    const seen = new Set<string>();
    const out: Suggestion[] = [];

    // Direct position substring matches
    allPositions.forEach(p => {
      if (!permitted.includes(p) && p.toLowerCase().includes(q)) {
        out.push({ position: p, label: p, byName: false });
        seen.add(p);
      }
    });

    // Inspector name substring matches → translate to position
    inspectors.forEach(insp => {
      if (
        (insp.name.toLowerCase().includes(q) || firstNameOf(insp.name).toLowerCase().includes(q)) &&
        !permitted.includes(insp.position) &&
        !seen.has(insp.position)
      ) {
        out.push({ position: insp.position, label: `${makeShortName(inspectors)(insp.name)} → ${insp.position}`, byName: true });
        seen.add(insp.position);
      }
    });

    return out;
  })();

  // Reset cursor when suggestions list changes
  useEffect(() => { setCursor(-1); }, [draft]);

  const addPosition = useCallback((pos: string) => {
    const normalised = pos.trim();
    if (!normalised) return;

    if (normalised.toLowerCase() === 'all') {
      onCommit([...allPositions]);
    } else if (allPositions.includes(normalised) && !permitted.includes(normalised)) {
      onCommit([...permitted, normalised]);
    }
    setDraft('');
    setCursor(-1);
    inputRef.current?.focus();
  }, [allPositions, onCommit, permitted]);

  const removePosition = (pos: string) => {
    onCommit(permitted.filter(p => p !== pos));
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setCursor(c => Math.min(c + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && cursor >= 0 && suggestions[cursor]) {
        addPosition(suggestions[cursor].position);
      } else if (suggestions.length === 1 && draft.trim()) {
        // Exactly one suggestion — commit it without requiring arrow-key selection
        addPosition(suggestions[0].position);
      } else if (draft.trim()) {
        // Try resolving a typed name to a position before falling back
        const q = draft.trim().toLowerCase();
        const nameMatch = inspectors.find(
          i =>
            !permitted.includes(i.position) &&
            (i.name.toLowerCase() === q || firstNameOf(i.name).toLowerCase() === q)
        );
        addPosition(nameMatch ? nameMatch.position : draft.trim());
      }
      setOpen(false);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setCursor(-1);
    } else if (e.key === 'Backspace' && draft === '' && permitted.length > 0) {
      removePosition(permitted[permitted.length - 1]);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const showAll = permitted.length > 0 &&
    allPositions.length > 0 &&
    allPositions.every(p => permitted.includes(p));

  return (
    <div ref={containerRef} className="relative flex-1">
      {/* Tag container */}
      <div
        className="flex flex-wrap gap-1 items-center min-h-8 border border-border rounded px-2 py-1 bg-card cursor-text transition-colors focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary"
        onClick={() => inputRef.current?.focus()}
      >
        {/* "All" shorthand pill */}
        {showAll ? (
          <span className="inline-flex items-center gap-1 h-5 pl-2 pr-1 rounded-full bg-primary/10 text-primary text-[11px] font-medium">
            All
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); onCommit([]); }}
              className="rounded-full p-0.5 hover:bg-primary/20 transition-colors"
              tabIndex={-1}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ) : (
          permitted.map(pos => (
            <span
              key={pos}
              className="inline-flex items-center gap-1 h-5 pl-2 pr-1 rounded-full bg-secondary text-foreground text-[11px] font-medium"
            >
              {pos}
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); removePosition(pos); }}
                className="rounded-full p-0.5 hover:bg-border transition-colors"
                tabIndex={-1}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))
        )}

        {/* Text input */}
        {!showAll && (
          <input
            ref={inputRef}
            value={draft}
            onChange={e => { setDraft(e.target.value); setOpen(true); }}
            onFocus={() => { setOpen(true); }}
            onKeyDown={handleKeyDown}
            placeholder={permitted.length === 0 ? 'Type a position, name, or All…' : ''}
            className="flex-1 min-w-[80px] h-5 text-sm text-foreground placeholder:text-muted-foreground bg-transparent outline-none"
          />
        )}
      </div>

      {/* Autocomplete dropdown */}
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-card border border-border rounded shadow-md overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={s.position}
              type="button"
              onMouseDown={e => { e.preventDefault(); addPosition(s.position); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                i === cursor
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-secondary'
              }`}
            >
              {s.byName ? (
                <span>
                  <span className="text-muted-foreground">{s.label.split(' → ')[0]}</span>
                  <span className="mx-1 text-muted-foreground">→</span>
                  <span className="font-medium">{s.label.split(' → ')[1]}</span>
                </span>
              ) : s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Operator editor with per-operator color pickers ─────────────────────────

function OperatorEditor({
  operators,
  operatorColors,
  onAdd,
  onRemove,
  onColorChange,
}: {
  operators: string[];
  operatorColors: Record<string, string>;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  onColorChange: (operator: string, color: string) => void;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const v = draft.trim();
    if (!v || operators.includes(v)) return;
    onAdd(v);
    setDraft('');
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mb-4">Operators</h2>
      <div className="bg-card border border-border rounded overflow-hidden">
        {operators.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center text-muted-foreground">No operators yet.</p>
        ) : (
          <ul>
            {operators.map((op, i) => (
              <li
                key={op}
                className={`group flex items-center gap-3 px-3 py-2 ${i < operators.length - 1 ? 'border-b border-border' : ''}`}
              >
                {/* Color swatch / picker */}
                <label
                  className="relative w-6 h-6 rounded cursor-pointer shrink-0 border border-black/10 shadow-sm overflow-hidden"
                  title={`Pick colour for ${op}`}
                  style={{ backgroundColor: operatorColors[op] ?? '#6b7280' }}
                >
                  <input
                    type="color"
                    value={operatorColors[op] ?? '#6b7280'}
                    onChange={e => onColorChange(op, e.target.value)}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                  />
                </label>

                <span className="text-sm text-foreground flex-1">{op}</span>

                <button
                  onClick={() => { if (operators.length > 1) onRemove(op); }}
                  disabled={operators.length <= 1}
                  title={operators.length <= 1 ? 'At least one operator required' : `Remove ${op}`}
                  className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-0 disabled:pointer-events-none"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          className="flex-1 h-8 rounded border border-border bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        />
        <button
          onClick={commit}
          disabled={!draft.trim() || operators.includes(draft.trim())}
          className="inline-flex items-center gap-1 h-8 px-3 bg-primary text-white text-xs font-medium rounded hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
    </section>
  );
}

// ─── Reusable simple list editor (Operators / Activities) ────────────────────

function ListEditor({
  title,
  items,
  onAdd,
  onRemove,
  placeholder,
}: {
  title: string;
  items: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const v = draft.trim();
    if (!v || items.includes(v)) return;
    onAdd(v);
    setDraft('');
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mb-4">{title}</h2>
      <div className="bg-card border border-border rounded overflow-hidden">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center text-muted-foreground">No items yet.</p>
        ) : (
          <ul>
            {items.map((item, i) => (
              <li
                key={item}
                className={`group flex items-center justify-between px-4 py-2.5 ${i < items.length - 1 ? 'border-b border-border' : ''}`}
              >
                <span className="text-sm text-foreground">{item}</span>
                <button
                  onClick={() => { if (items.length > 1) onRemove(item); }}
                  disabled={items.length <= 1}
                  title={items.length <= 1 ? 'At least one item required' : `Remove ${item}`}
                  className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-0 disabled:pointer-events-none"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add row */}
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          placeholder={placeholder ?? 'Add item…'}
          className="flex-1 h-8 rounded border border-border bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        />
        <button
          onClick={commit}
          disabled={!draft.trim() || items.includes(draft.trim())}
          className="inline-flex items-center gap-1 h-8 px-3 bg-primary text-white text-xs font-medium rounded hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
    </section>
  );
}

// ─── List editor with inline rename support ───────────────────────────────────

function RenameListEditor({
  title,
  description,
  items,
  onAdd,
  onRemove,
  onRename,
  placeholder,
}: {
  title: string;
  description?: string;
  items: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  onRename: (oldValue: string, newValue: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const [renamingItem, setRenamingItem] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const v = draft.trim();
    if (!v || items.includes(v)) return;
    onAdd(v);
    setDraft('');
  };

  const startRename = (item: string) => {
    setRenamingItem(item);
    setRenameDraft(item);
    setTimeout(() => renameRef.current?.select(), 0);
  };

  const commitRename = () => {
    const v = renameDraft.trim();
    if (v && v !== renamingItem && !items.includes(v)) {
      onRename(renamingItem!, v);
    }
    setRenamingItem(null);
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mb-1">{title}</h2>
      {description && <p className="text-xs text-muted-foreground mb-4">{description}</p>}
      {!description && <div className="mb-4" />}
      <div className="bg-card border border-border rounded overflow-hidden">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center text-muted-foreground">No items yet.</p>
        ) : (
          <ul>
            {items.map((item, i) => (
              <li
                key={item}
                className={`group flex items-center gap-2 px-3 py-2 ${i < items.length - 1 ? 'border-b border-border' : ''}`}
              >
                {renamingItem === item ? (
                  <input
                    ref={renameRef}
                    value={renameDraft}
                    onChange={e => setRenameDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                      if (e.key === 'Escape') { setRenamingItem(null); }
                    }}
                    onBlur={commitRename}
                    className="flex-1 h-7 rounded border border-primary bg-card px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    autoFocus
                  />
                ) : (
                  <span className="flex-1 text-sm text-foreground">{item}</span>
                )}
                {renamingItem !== item && (
                  <button
                    onClick={() => startRename(item)}
                    title={`Rename ${item}`}
                    className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={() => { if (items.length > 1) onRemove(item); }}
                  disabled={items.length <= 1}
                  title={items.length <= 1 ? 'At least one item required' : `Remove ${item}`}
                  className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-0 disabled:pointer-events-none"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add row */}
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          placeholder={placeholder ?? 'Add item…'}
          className="flex-1 h-8 rounded border border-border bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        />
        <button
          onClick={commit}
          disabled={!draft.trim() || items.includes(draft.trim())}
          className="inline-flex items-center gap-1 h-8 px-3 bg-primary text-white text-xs font-medium rounded hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
    </section>
  );
}

// ─── Merged activity list + qualification mapping editor ──────────────────────

function ActivityQualEditor({
  title,
  activities,
  qualifications,
  uniquePositions,
  inspectors,
  onAdd,
  onRemove,
  onRename,
  onQualCommit,
  placeholder,
}: {
  title: string;
  activities: string[];
  qualifications: Record<string, string[]>;
  uniquePositions: string[];
  inspectors: { name: string; position: string }[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  onRename: (oldValue: string, newValue: string) => void;
  onQualCommit: (activity: string, positions: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const [renamingItem, setRenamingItem] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const v = draft.trim();
    if (!v || activities.includes(v)) return;
    onAdd(v);
    setDraft('');
  };

  const startRename = (item: string) => {
    setRenamingItem(item);
    setRenameDraft(item);
    setTimeout(() => renameRef.current?.select(), 0);
  };

  const commitRename = () => {
    const v = renameDraft.trim();
    if (v && v !== renamingItem && !activities.includes(v)) {
      onRename(renamingItem!, v);
    }
    setRenamingItem(null);
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mb-1">{title}</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Click <Pencil className="w-2.5 h-2.5 inline" /> to rename an activity. Type a position or name in the tag field, or <span className="font-medium text-foreground">All</span> to permit everyone.
      </p>

      {uniquePositions.length === 0 ? (
        <div className="bg-card border border-border rounded p-6 text-center text-sm text-muted-foreground">
          Add inspectors first to configure qualifications.
        </div>
      ) : activities.length === 0 ? (
        <div className="bg-card border border-border rounded p-6 text-center text-sm text-muted-foreground">
          No activities yet.
        </div>
      ) : (
        <div className="bg-card border border-border rounded overflow-hidden">
          {activities.map((activity, i) => {
            const permitted = qualifications[activity] ?? [];
            return (
              <div
                key={activity}
                className={`group flex items-start gap-2 px-3 py-2.5 ${i < activities.length - 1 ? 'border-b border-border' : ''}`}
              >
                {/* Activity name / rename input */}
                <div className="w-36 shrink-0 flex items-center gap-1 pt-1.5">
                  {renamingItem === activity ? (
                    <input
                      ref={renameRef}
                      value={renameDraft}
                      onChange={e => setRenameDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                        if (e.key === 'Escape') { setRenamingItem(null); }
                      }}
                      onBlur={commitRename}
                      className="w-full h-6 rounded border border-primary bg-card px-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      autoFocus
                    />
                  ) : (
                    <>
                      <span className="text-xs font-medium text-foreground truncate flex-1">{activity}</span>
                      <button
                        onClick={() => startRename(activity)}
                        title={`Rename ${activity}`}
                        className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0"
                      >
                        <Pencil className="w-2.5 h-2.5" />
                      </button>
                    </>
                  )}
                </div>

                {/* Qualification input */}
                <div className="flex-1">
                  <QualInput
                    permitted={permitted}
                    allPositions={uniquePositions}
                    inspectors={inspectors}
                    onCommit={positions => onQualCommit(activity, positions)}
                  />
                </div>

                {/* Delete button */}
                <button
                  onClick={() => { if (activities.length > 1) onRemove(activity); }}
                  disabled={activities.length <= 1}
                  title={activities.length <= 1 ? 'At least one activity required' : `Remove ${activity}`}
                  className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-0 disabled:pointer-events-none mt-0.5 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add row */}
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          placeholder={placeholder ?? 'Add activity…'}
          className="flex-1 h-8 rounded border border-border bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        />
        <button
          onClick={commit}
          disabled={!draft.trim() || activities.includes(draft.trim())}
          className="inline-flex items-center gap-1 h-8 px-3 bg-primary text-white text-xs font-medium rounded hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
    </section>
  );
}

// ─── Simulator map editor (code → aircraft type) ─────────────────────────────

function SimMapEditor({
  simulatorMap,
  onSet,
  onRemove,
}: {
  simulatorMap: Record<string, string>;
  onSet: (code: string, aircraftType: string) => void;
  onRemove: (code: string) => void;
}) {
  const [newCode, setNewCode] = useState('');
  const [newType, setNewType] = useState('');

  const codes = Object.keys(simulatorMap).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  const commit = () => {
    const code = newCode.trim();
    const type = newType.trim();
    if (!code || !type || code in simulatorMap) return;
    onSet(code, type);
    setNewCode('');
    setNewType('');
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mb-1">Simulator Map</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Each simulator code maps to an aircraft type. Edit a type inline, or add new codes below.
      </p>

      <div className="bg-card border border-border rounded overflow-hidden">
        {codes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center text-muted-foreground">No simulator codes yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Simulator Code</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Aircraft Type</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {codes.map((code, i) => (
                <tr key={code} className={`group ${i < codes.length - 1 ? 'border-b border-border' : ''}`}>
                  <td className="px-4 py-1.5 text-foreground font-medium">{code}</td>
                  <td className="px-4 py-1.5">
                    <input
                      type="text"
                      value={simulatorMap[code]}
                      onChange={e => onSet(code, e.target.value)}
                      className="w-full h-7 rounded border border-transparent hover:border-border focus:border-primary bg-transparent focus:bg-card px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      onClick={() => { if (codes.length > 1) onRemove(code); }}
                      disabled={codes.length <= 1}
                      title={codes.length <= 1 ? 'At least one entry required' : `Remove ${code}`}
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-0 disabled:pointer-events-none"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add row */}
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={newCode}
          onChange={e => setNewCode(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          className="flex-1 h-8 rounded border border-border bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        />
        <input
          type="text"
          value={newType}
          onChange={e => setNewType(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          placeholder="Aircraft type"
          className="flex-1 h-8 rounded border border-border bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        />
        <button
          onClick={commit}
          disabled={!newCode.trim() || !newType.trim() || newCode.trim() in simulatorMap}
          className="inline-flex items-center gap-1 h-8 px-3 bg-primary text-white text-xs font-medium rounded hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
    </section>
  );
}

// ─── JSON reference collapsible ──────────────────────────────────────────────

type RefTab = 'Roster Backup' | 'Settings Backup' | 'Simulator' | 'Surveillance' | 'Other Duties' | 'Leave';

const REF_FILENAMES: Record<RefTab, string> = {
  'Roster Backup':   'roster-backup.json',
  'Settings Backup': 'settings-backup.json',
  'Simulator':       'simulator-event.json',
  'Surveillance':    'surveillance-event.json',
  'Other Duties':    'other-duties-event.json',
  'Leave':           'leave-event.json',
};

const REF_EXAMPLES: Record<RefTab, object> = {
  'Roster Backup': {
    exportDate: '2026-08-11T09:00:00.000Z',
    version: 2,
    stagingQueue: [
      {
        id: 'evt_staged01',
        eventType: 'Surveillance',
        date: '2026-08-15',
        startTime: '10:30',
        endTime: '12:00',
        operator: 'CPA',
        surveillanceTypes: ['Cabin', 'Flight'],
        details: 'HKG-NRT CX100',
        inspectors: ['ASI(1)'],
      },
    ],
    calendarEvents: [
      {
        id: 'evt_abc123',
        eventType: 'Simulator',
        date: '2026-08-11',
        startTime: '09:00',
        endTime: '13:00',
        operator: 'CPA',
        simulatorCode: 'CPA01',
        aircraftType: 'B777-300ER',
        activity: 'AE Initial',
        candidateName: 'Chan, Peter',
        inspectors: ['ASI(1)', 'ASI(2)'],
      },
      {
        id: 'evt_jkl012',
        eventType: 'Leave',
        date: '2026-08-14',
        startTime: '',
        endTime: '',
        leaveType: 'VL',
        inspectors: ['ASI(2)'],
      },
    ],
  },
  'Settings Backup': {
    exportDate: '2026-08-11T09:00:00.000Z',
    version: 1,
    operators: ['AHK', 'CPA', 'HKA'],
    operatorColors: {
      AHK: '#dc2626',
      CPA: '#006b3c',
      HKA: '#dc2626',
    },
    simulatorActivities: ['AE Initial', 'AE Renewal', 'AP Initial', 'AP Renewal'],
    simulatorMap: {
      CPA01: 'A320-200',
      CPA02: 'A330 (RR)',
      CPA14: 'B777',
    },
    inspectors: [
      { id: 'insp_abc123', name: 'Chan, Peter', position: 'ASI(1)' },
      { id: 'insp_def456', name: 'Smith, James', position: 'ASI(2)' },
    ],
    qualifications: {
      'AE Initial': ['ASI(1)', 'ASI(2)'],
      'AP Initial': ['ASI(1)'],
    },
    surveillanceActivities: ['Cabin', 'Flight', 'Station', 'QMS Audit'],
    surveillanceQualifications: {
      Cabin: ['ASI(1)', 'ASI(2)'],
      'QMS Audit': ['ASI(1)'],
    },
  },
  Simulator: {
    id: 'evt_abc123',
    eventType: 'Simulator',
    date: '2026-08-11',
    startTime: '09:00',
    endTime: '13:00',
    operator: 'CPA',
    simulatorCode: 'CPA01',
    aircraftType: 'B777-300ER',
    activity: 'AE Initial',
    candidateName: 'Chan, Peter',
    inspectors: ['ASI(1)', 'ASI(2)'],
  },
  Surveillance: {
    id: 'evt_def456',
    eventType: 'Surveillance',
    date: '2026-08-12',
    startTime: '10:30',
    endTime: '12:00',
    operator: 'CPA',
    surveillanceTypes: ['Cabin'],
    details: 'HKG-NRT CX100',
    inspectors: ['ASI(1)'],
  },
  'Other Duties': {
    id: 'evt_ghi789',
    eventType: 'Other Duties',
    date: '2026-08-13',
    startTime: '08:00',
    endTime: '17:00',
    operators: ['CPA', 'HKX'],
    subType: 'Meeting',
    remarks: 'Annual safety review',
    inspectors: ['ASI(1)', 'ASI(3)'],
  },
  Leave: {
    id: 'evt_jkl012',
    eventType: 'Leave',
    date: '2026-08-14',
    startTime: '',
    endTime: '',
    leaveType: 'VL',
    inspectors: ['ASI(2)'],
  },
};

const TABS: RefTab[] = ['Roster Backup', 'Settings Backup', 'Simulator', 'Surveillance', 'Other Duties', 'Leave'];

function EventJsonReferenceCollapsible() {
  const [open,   setOpen]   = useState(false);
  const [tab,    setTab]    = useState<RefTab>('Roster Backup');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(REF_EXAMPLES[tab], null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleTab = (t: RefTab) => { setTab(t); setCopied(false); };

  return (
    <div className="rounded border border-border bg-card">
      {/* Header / toggle */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="group flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-secondary rounded"
      >
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            JSON Reference
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Complete example payloads — file formats and individual event types
          </p>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-border">
          {/* Tab bar — scrollable on narrow viewports */}
          <div className="flex overflow-x-auto border-b border-border">
            {TABS.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => handleTab(t)}
                className={`shrink-0 px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
                  tab === t
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* JSON body + copy toolbar */}
          <div>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/40">
              <span className="text-[11px] text-muted-foreground font-mono">
                {REF_FILENAMES[tab]}
              </span>
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                {copied
                  ? <><Check className="w-3 h-3 text-green-600" /> Copied!</>
                  : <><Copy className="w-3 h-3" /> Copy</>}
              </button>
            </div>
            <pre className="overflow-auto max-h-72 p-4 text-[11px] leading-relaxed font-mono text-foreground whitespace-pre">
              {JSON.stringify(REF_EXAMPLES[tab], null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main settings page ───────────────────────────────────────────────────────

export default function Settings() {
  const { state, addInspector, removeInspector, setActivityQualifications, setSurveillanceQualifications, addListItem, removeListItem, renameListItem, setSimMapEntry, removeSimMapEntry, setOperatorColor } = useRosterStore();
  const { inspectors, qualifications, operators, operatorColors, simulatorActivities, surveillanceActivities, surveillanceQualifications, simulatorMap, leaveTypes, dutySubTypes } = state;

  const [newName,     setNewName]     = useState('');
  const [newPosition, setNewPosition] = useState('');
  const [newEmail,    setNewEmail]    = useState('');

  const uniquePositions = [...new Set(inspectors.map(i => i.position))].sort();

  const handleAddInspector = (e: React.FormEvent) => {
    e.preventDefault();
    const name     = newName.trim();
    const position = newPosition.trim();
    const email    = newEmail.trim();
    if (!name || !position) return;
    addInspector({ name, position, ...(email ? { email } : {}) });
    setNewName('');
    setNewPosition('');
    setNewEmail('');
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto flex flex-col gap-10">

        {/* ── Row 1: Inspector Management | Simulator Activities & Qualifications ── */}
        <div className="grid grid-cols-2 gap-8 items-start">

          {/* Inspector Management */}
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-4">Inspector Management</h2>

            <div className="bg-card border border-border rounded overflow-hidden">
              {inspectors.length === 0 ? (
                <p className="px-4 py-6 text-sm text-center text-muted-foreground">No inspectors yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Full Name</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Position</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {inspectors.map((inspector, i) => (
                      <tr key={inspector.id} className={`group ${i < inspectors.length - 1 ? 'border-b border-border' : ''}`}>
                        <td className="px-4 py-2.5 text-foreground font-medium">
                          {inspector.name}
                          <span className="ml-1.5 text-muted-foreground font-normal text-[11px]">({makeShortName(inspectors)(inspector.name)})</span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{inspector.position}</td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">{inspector.email ?? '—'}</td>
                        <td className="px-2 py-2.5">
                          <button
                            onClick={() => removeInspector(inspector.id)}
                            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                            title={`Remove ${inspector.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <form onSubmit={handleAddInspector} className="mt-3 bg-card border border-border rounded p-3">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Add Inspector</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Full Name</label>
                  <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                    className="w-full h-8 rounded border border-border bg-card px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Position</label>
                  <input type="text" value={newPosition} onChange={e => setNewPosition(e.target.value)} 
                    className="w-full h-8 rounded border border-border bg-card px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Contact Email <span className="font-normal">(optional)</span></label>
                  <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                    className="w-full h-8 rounded border border-border bg-card px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors" />
                </div>
                <button type="submit" disabled={!newName.trim() || !newPosition.trim()}
                  className="col-span-2 inline-flex items-center justify-center gap-1.5 h-8 px-3 bg-primary text-white text-xs font-medium rounded hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  <UserPlus className="w-3.5 h-3.5" /> Add Inspector
                </button>
              </div>
            </form>
          </section>

          <div className="flex flex-col gap-10">
            {/* Simulator Activities & Qualification Mapping (merged) */}
            <ActivityQualEditor
              title="Simulator Activities & Qualifications"
              activities={simulatorActivities}
              qualifications={qualifications}
              uniquePositions={uniquePositions}
              inspectors={inspectors}
              onAdd={v         => addListItem('simulatorActivities', v)}
              onRemove={v      => removeListItem('simulatorActivities', v)}
              onRename={(o, n) => renameListItem('simulatorActivities', o, n)}
              onQualCommit={(activity, positions) => setActivityQualifications(activity, positions)}
            />

            {/* Surveillance Activities & Qualifications */}
            <ActivityQualEditor
              title="Surveillance Activities & Qualifications"
              activities={surveillanceActivities}
              qualifications={surveillanceQualifications}
              uniquePositions={uniquePositions}
              inspectors={inspectors}
              onAdd={v         => addListItem('surveillanceActivities', v)}
              onRemove={v      => removeListItem('surveillanceActivities', v)}
              onRename={(o, n) => renameListItem('surveillanceActivities', o, n)}
              onQualCommit={(activity, positions) => setSurveillanceQualifications(activity, positions)}
            />
          </div>

        </div>

        {/* ── Row 2: Operators | Leave Types | Other Duties Sub-Types ──────── */}
        <div className="grid grid-cols-3 gap-8">
          <OperatorEditor
            operators={operators}
            operatorColors={operatorColors}
            onAdd={v       => addListItem('operators', v)}
            onRemove={v    => removeListItem('operators', v)}
            onColorChange={(op, color) => setOperatorColor(op, color)}
          />
          <RenameListEditor
            title="Leave Types"
            description="Types shown in the Leave dropdown when logging leave."
            items={leaveTypes}
            onAdd={v         => addListItem('leaveTypes', v)}
            onRemove={v      => removeListItem('leaveTypes', v)}
            onRename={(o, n) => renameListItem('leaveTypes', o, n)}

          />
          <RenameListEditor
            title="Other Duties Sub-Types"
            description="Types shown in the Other Duties type dropdown."
            items={dutySubTypes}
            onAdd={v         => addListItem('dutySubTypes', v)}
            onRemove={v      => removeListItem('dutySubTypes', v)}
            onRename={(o, n) => renameListItem('dutySubTypes', o, n)}

          />
        </div>

        {/* ── Row 4: Simulator map ─────────────────────────────────────────── */}
        <SimMapEditor
          simulatorMap={simulatorMap}
          onSet={setSimMapEntry}
          onRemove={removeSimMapEntry}
        />

        {/* ── Event JSON reference ─────────────────────────────────────────── */}
        <EventJsonReferenceCollapsible />

      </div>{/* end flex-col */}
    </div>
  );
}
