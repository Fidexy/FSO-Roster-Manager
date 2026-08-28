// Pure validation — no React imports, safe to call from anywhere.

import {
  RosterEvent,
  OperatorRequestEvent,
  SurveillanceEvent,
  LeaveEvent,
  OtherDutiesEvent,
  Inspector,
  Qualifications,
  firstNameOf,
} from './rosterStore';

export type ValidationResult =
  | { isValid: true }
  | { isValid: false; error: string };

/**
 * An event that may or may not have an id yet (staging vs. calendar).
 * Typed as a discriminated union so TypeScript can narrow on `eventType`.
 */
export type EventInput =
  | (Omit<OperatorRequestEvent, 'id'> & { id?: string })
  | (Omit<SurveillanceEvent, 'id'> & { id?: string })
  | (Omit<LeaveEvent,        'id'> & { id?: string })
  | (Omit<OtherDutiesEvent,  'id'> & { id?: string });

/**
 * Runs three ordered checks against an event:
 *  1. Start time must be before end time.
 *  2. No assigned inspector may already appear on a calendar event on the same date.
   *  3. (Operator Request only) At least one assigned inspector must hold a qualified
 *     position for configured activities. Custom activities intentionally
 *     bypass that mapping requirement.
 *
 * @param event           The event to validate.
 * @param calendarEvents  Current committed calendar events.
 * @param inspectors      Inspector roster (for position look-ups).
 * @param qualifications  Operator Request activity → allowed positions map.
 * @param excludeId       When editing an existing event, pass its id to exclude it
 *                        from the double-booking check.
 * @param excludeSourceIds Set of calendar event ids that are the source of any
 *                        staged edit currently in the queue. All are excluded
 *                        from conflict checking so swapped events don't
 *                        falsely conflict with each other's originals.
 * @param surveillanceQualifications Surveillance type → allowed positions map.
 */
export function validateEvent(
  event: EventInput,
  calendarEvents: RosterEvent[],
  inspectors: Inspector[],
  qualifications: Qualifications,
  excludeId?: string,
  excludeSourceIds?: Set<string>,
  surveillanceQualifications?: Qualifications,
): ValidationResult {

  // ── Check 0: Required fields ─────────────────────────────────────────────
  const missing: string[] = [];
  if (!event.date)      missing.push('date');
  if (event.eventType === 'Operator Request') {
    const e = event as OperatorRequestEvent;
    if (!e.operator)      missing.push('operator');
    if (!e.activity)      missing.push('activity');
  } else if (event.eventType === 'Surveillance') {
    const e = event as SurveillanceEvent;
    if (!e.operator) missing.push('operator');
    if (!e.surveillanceTypes || e.surveillanceTypes.length === 0)
      missing.push('surveillance type');
  } else if (event.eventType === 'Leave') {
    if (!(event as LeaveEvent).leaveType) missing.push('leave type');
  }
  if (missing.length > 0) {
    return {
      isValid: false,
      error: `Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
    };
  }

  // ── Check 1: Time range ──────────────────────────────────────────────────
  if (event.startTime && event.endTime && event.startTime >= event.endTime) {
    return { isValid: false, error: 'Invalid time range: start time must be before end time.' };
  }

  // ── Check 2: Double-booking ──────────────────────────────────────────────
  // Exclude the event being edited (excludeId) and ALL calendar events that
  // are the source of any staged edit (excludeSourceIds). This covers swap
  // scenarios: when A and B are both staged as edits, each must see the
  // other's original as already-removed, not as a conflicting booking.
  const sameDayEvents = calendarEvents.filter(
    ce => ce.date === event.date && ce.id !== excludeId && !excludeSourceIds?.has(ce.id),
  );

  for (const inspectorName of event.inspectors) {
    for (const ce of sameDayEvents) {
      const timesOverlap = event.startTime < ce.endTime && ce.startTime < event.endTime;
      if (ce.inspectors.includes(inspectorName) && timesOverlap) {
        return {
          isValid: false,
          error: `Conflict: ${firstNameOf(inspectorName)} is already booked on this date.`,
        };
      }
    }
  }

  // ── Check 3: Qualifications (Operator Request only) ──────────────────────
  if (event.eventType === 'Operator Request') {
    if (event.inspectors.length === 0) {
      return { isValid: false, error: 'No inspectors listed.' };
    }

    // A simulator activity absent from the configured map is a custom activity.
    // It still needs an assigned inspector, but is not constrained by a
    // qualification list that cannot exist for a free-text activity.
    if (!Object.prototype.hasOwnProperty.call(qualifications, event.activity)) {
      return { isValid: true };
    }

    const allowedPositions: string[] = qualifications[event.activity] ?? [];

    const atLeastOneQualified = event.inspectors.some(name => {
      const inspector = inspectors.find(i => i.name === name);
      return inspector ? allowedPositions.includes(inspector.position) : false;
    });

    if (!atLeastOneQualified) {
      // Report the first inspector who is not qualified.
      const firstUnqualifiedName = event.inspectors.find(name => {
        const inspector = inspectors.find(i => i.name === name);
        return inspector ? !allowedPositions.includes(inspector.position) : true;
      });
      const inspector = inspectors.find(i => i.name === firstUnqualifiedName);
      const position = inspector?.position ?? '?';
      return {
        isValid: false,
        error: `Qualification error: ${firstNameOf(firstUnqualifiedName ?? '')} (${position}) is not qualified for ${event.activity}.`,
      };
    }
  }

  // ── Check 4: Qualifications (Surveillance) ───────────────────────────────
  // For each selected surveillance type, at least one assigned inspector must
  // hold a qualified position. Unqualified inspectors may still be assigned —
  // they are treated as OJT trainees paired with the qualified supervisors.
  if (event.eventType === 'Surveillance' && surveillanceQualifications) {
    if (event.inspectors.length === 0) {
      return { isValid: false, error: 'No inspectors listed.' };
    }
    for (const type of (event as SurveillanceEvent).surveillanceTypes) {
      const allowedPositions: string[] = surveillanceQualifications[type] ?? [];
      const atLeastOneQualified = event.inspectors.some(name => {
        const inspector = inspectors.find(i => i.name === name);
        return inspector ? allowedPositions.includes(inspector.position) : false;
      });
      if (!atLeastOneQualified) {
        return {
          isValid: false,
          error: `Qualification error: no assigned inspector is qualified for ${type}.`,
        };
      }
    }
  }

  return { isValid: true };
}
