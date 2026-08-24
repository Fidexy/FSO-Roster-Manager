export type DailyTimeSlice = {
  date: string;
  startTime: string;
  endTime: string;
};

export type EventRangeExpansion =
  | { ok: true; slices: DailyTimeSlice[] }
  | { ok: false; error: string };

type EventRangeInput = {
  startDate: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALL_DAY_START = "00:00";
const ALL_DAY_END = "23:59";

function parseCalendarDate(value: string): Date | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ? parsed
    : null;
}

function formatCalendarDate(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Expands a new Leave, Surveillance, or Other Duties date range into
 * independent, valid daily entries.
 *
 * Blank optional times resolve to an all-day entry. A single-day range keeps
 * both resolved times. A multi-day range uses the entered start time only on
 * the first day and the entered end time only on the final day; each boundary
 * is rejected if it would produce a non-increasing range.
 */
export function expandDailyEventRange(
  input: EventRangeInput,
): EventRangeExpansion {
  const startDate = parseCalendarDate(input.startDate);
  const endDateValue = input.endDate || input.startDate;
  const endDate = parseCalendarDate(endDateValue);

  if (!startDate || !endDate) {
    return { ok: false, error: "Enter valid start and end dates." };
  }
  if (endDate.getTime() < startDate.getTime()) {
    return { ok: false, error: "End date must be on or after the start date." };
  }

  const startTime = input.startTime || ALL_DAY_START;
  const endTime = input.endTime || ALL_DAY_END;
  if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
    return { ok: false, error: "Enter valid times in HH:MM format." };
  }

  const isSingleDay = startDate.getTime() === endDate.getTime();
  if (isSingleDay && startTime >= endTime) {
    return {
      ok: false,
      error: "Invalid time range: start time must be before end time.",
    };
  }

  const slices: DailyTimeSlice[] = [];
  const current = new Date(startDate);
  while (current.getTime() <= endDate.getTime()) {
    const isFirstDay = current.getTime() === startDate.getTime();
    const isLastDay = current.getTime() === endDate.getTime();
    const sliceStart = isSingleDay || isFirstDay ? startTime : ALL_DAY_START;
    const sliceEnd = isSingleDay || isLastDay ? endTime : ALL_DAY_END;

    if (sliceStart >= sliceEnd) {
      return {
        ok: false,
        error: "Invalid time range: a daily time boundary must be increasing.",
      };
    }

    slices.push({
      date: formatCalendarDate(current),
      startTime: sliceStart,
      endTime: sliceEnd,
    });
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return { ok: true, slices };
}