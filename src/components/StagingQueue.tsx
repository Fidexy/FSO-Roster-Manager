import {
  useRosterStore,
  RosterEvent,
  EventType,
  firstNameOf,
} from "@/store/rosterStore";

/** Sort inspector names so qualified inspectors appear first (Operator Request events only). */
function sortedInspectors(
  names: string[],
  event: RosterEvent,
  inspectors: { name: string; position: string }[],
  qualifications: Record<string, string[]>,
): string[] {
  if (event.eventType !== "Operator Request") return names;
  const qualifiedPositions = new Set(qualifications[event.activity] ?? []);
  const positionOf = new Map(inspectors.map((i) => [i.name, i.position]));
  const isQualified = (name: string) =>
    qualifiedPositions.has(positionOf.get(name) ?? "");
  return [...names].sort(
    (a, b) => (isQualified(a) ? 0 : 1) - (isQualified(b) ? 0 : 1),
  );
}

/** Convert stored yyyy-mm-dd → dd-mm-yyyy for display */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}
import { validateEvent } from "@/store/validateEvent";
import { Trash2, CalendarPlus, ArrowRight, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

function EventBadge({ type }: { type: EventType }) {
  const styles: Record<EventType, string> = {
    "Operator Request": "bg-blue-50 text-blue-700 border-blue-200",
    Surveillance: "bg-amber-50 text-amber-700 border-amber-200",
    "Other Duties": "bg-purple-50 text-purple-700 border-purple-200",
    Leave: "bg-gray-50 text-gray-600 border-gray-200",
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border ${styles[type]}`}
    >
      {type}
    </span>
  );
}

function EventSummary({ event }: { event: RosterEvent }) {
  if (event.eventType === "Operator Request") {
    return (
      <p className="text-xs text-foreground truncate">
        <span className="font-medium">{event.candidateName}</span>
        <span className="text-muted-foreground">
          {" "}
          · {event.operator}/{event.simulatorCodes?.join(", ") ?? event.simulatorCode}/{event.aircraftType} ·{" "}
          {event.activity}
        </span>
      </p>
    );
  }
  if (event.eventType === "Surveillance") {
    return (
      <p className="text-xs text-foreground truncate">
        <span className="font-medium">
          {event.surveillanceTypes.join(", ")}
        </span>
        {event.details && (
          <span className="text-muted-foreground"> · {event.details}</span>
        )}
      </p>
    );
  }
  if (event.eventType === "Other Duties") {
    const opStr = event.operators?.join(", ") ?? "";
    return (
      <p className="text-xs text-foreground truncate">
        <span className="font-medium">{event.subType}</span>
        {opStr && <span className="text-muted-foreground"> · {opStr}</span>}
        {event.remarks && (
          <span className="text-muted-foreground"> · {event.remarks}</span>
        )}
      </p>
    );
  }
  return (
    <p className="text-xs font-medium text-foreground truncate">
      {event.leaveType}
    </p>
  );
}

export default function StagingQueue({
  selectedDate,
}: {
  selectedDate?: string;
}) {
  const {
    state,
    removeEvent,
    commitEvent,
    commitAll,
    setEditingStagingId,
    addEventToQueue,
  } = useRosterStore();
  const {
    stagingQueue,
    calendarEvents,
    inspectors,
    qualifications,
    surveillanceQualifications,
    editingStagingId,
  } = state;

  // Calendar events on the selected day that aren't already fully staged
  const dayEvents = selectedDate
    ? calendarEvents.filter((e) => e.date === selectedDate)
    : [];
  const stagedSourceIds = new Set(
    stagingQueue.map((e) => e.sourceEventId).filter(Boolean),
  );
  const unstaggedDayEvents = dayEvents.filter(
    (e) => !stagedSourceIds.has(e.id),
  );

  // All sourceEventIds in the queue — passed to validateEvent so every staged
  // edit sees all originals-being-replaced as already absent (swap support).
  const allSourceIds = new Set(
    stagingQueue.map((e) => e.sourceEventId).filter((id): id is string => !!id),
  );

  return (
    <section className="h-full flex flex-col bg-card border-r border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Staging Queue
          {stagingQueue.length > 0 && (
            <span className="ml-1.5 text-muted-foreground/70 normal-case tracking-normal">
              ({stagingQueue.length})
            </span>
          )}
        </p>
        <div className="flex items-center gap-3">
          {stagingQueue.length > 0 && (
            <button
              onClick={() => {
                const validIds = stagingQueue
                  .filter(
                    (event) =>
                      validateEvent(
                        event,
                        [
                          ...calendarEvents,
                          ...stagingQueue.filter((e) => e.id !== event.id),
                        ],
                        inspectors,
                        qualifications,
                        undefined,
                        allSourceIds,
                        surveillanceQualifications,
                      ).isValid,
                  )
                  .map((e) => e.id);
                const invalidCount = stagingQueue.length - validIds.length;

                if (invalidCount === stagingQueue.length) {
                  // Everything is flagged — nothing to push
                  alert(
                    "All items have errors. Fix or remove the flagged items before pushing to the calendar.",
                  );
                  return;
                }

                if (validIds.length === stagingQueue.length) {
                  // Nothing flagged — fast path
                  commitAll();
                } else {
                  // Some flagged — commit only the valid ones, leave flagged behind
                  validIds.forEach((id) => commitEvent(id));
                }
              }}
              className="shrink-0 inline-flex items-center gap-1.5 h-7 px-3 bg-primary text-white text-xs font-medium rounded-full hover:bg-primary/90 transition-colors"
              title="Add all valid entries to the calendar — flagged items stay in queue"
            >
              Add all <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {unstaggedDayEvents.length > 0 && (
        <div className="flex items-center justify-start gap-3 px-4 py-2.5 bg-primary/8 border-b border-primary/20 shrink-0">
          <button
            onClick={() => {
              unstaggedDayEvents.forEach((event) => {
                const { id, ...rest } = event;
                addEventToQueue({ ...rest, sourceEventId: id });
              });
            }}
            className="shrink-0 inline-flex items-center gap-1.5 h-7 px-3 bg-transparent border border-primary text-primary text-xs font-medium rounded hover:bg-primary/10 transition-colors"
          >
            Add {fmtDate(selectedDate!)} to queue —{" "}
            {unstaggedDayEvents.length}{" "}
            {unstaggedDayEvents.length === 1 ? "event" : "events"}
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3">
        {stagingQueue.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground px-4">
            <p className="text-sm">Queue is empty.</p>
            <p className="text-xs mt-1">
              Submitted entries appear here before they go on the calendar.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <AnimatePresence>
              {stagingQueue.map((event) => {
                // Derive validation fresh from current state — never stale.
                // Pass the full set of source IDs so swapped events don't
                // flag each other's originals as conflicts.
                // Check against calendar events AND other queue items — so two
                // conflicting queue items both get flagged, not just the later one.
                const siblingQueueEvents = stagingQueue.filter(
                  (e) => e.id !== event.id,
                );
                const result = validateEvent(
                  event,
                  [...calendarEvents, ...siblingQueueEvents],
                  inspectors,
                  qualifications,
                  undefined,
                  allSourceIds,
                  surveillanceQualifications,
                );
                const isInvalid = !result.isValid;

                return (
                  <motion.div
                    key={event.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    onClick={() => setEditingStagingId(event.id)}
                    className={`group border rounded p-2.5 transition-colors cursor-pointer ${
                      editingStagingId === event.id
                        ? "border-amber-400 bg-amber-50 ring-2 ring-amber-300/60"
                        : isInvalid
                          ? "border-amber-300 bg-amber-50 hover:border-amber-400"
                          : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <EventBadge type={event.eventType} />
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {fmtDate(event.date)} · {event.startTime}–
                        {event.endTime}
                      </span>
                    </div>
                    <EventSummary event={event} />
                    {event.inspectors.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1 truncate">
                        {sortedInspectors(
                          event.inspectors,
                          event,
                          inspectors,
                          qualifications,
                        )
                          .map(firstNameOf)
                          .join(", ")}
                      </p>
                    )}

                    {/* Validation warning */}
                    {isInvalid && (
                      <div className="mt-1.5 flex items-start gap-1.5">
                        <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0 mt-px" />
                        <p className="text-[11px] text-amber-700 leading-snug">
                          {result.error}
                        </p>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 mt-2">
                      <button
                        onClick={() => !isInvalid && commitEvent(event.id)}
                        disabled={isInvalid}
                        className="flex-1 inline-flex items-center justify-center gap-1 h-7 text-xs font-medium rounded border border-primary/40 text-primary hover:bg-primary hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-primary"
                        title={
                          isInvalid
                            ? "Fix the flagged error before adding to calendar"
                            : "Add to calendar"
                        }
                      >
                        <CalendarPlus className="w-3.5 h-3.5" /> Add to Calendar
                      </button>
                      <button
                        onClick={() => removeEvent(event.id)}
                        className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </section>
  );
}
