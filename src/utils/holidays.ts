import Holidays from 'date-holidays';

const cache = new Map<number, Map<string, string>>();

/**
 * Returns a Map of YYYY-MM-DD → holiday name for HK public holidays in the given year.
 */
export function getHKHolidayMap(year: number): Map<string, string> {
  if (cache.has(year)) return cache.get(year)!;

  const hd = new Holidays('HK');
  const holidays = hd.getHolidays(year);

  const dateMap = new Map<string, string>(
    holidays
      .filter(h => h.type === 'public')
      .map(h => [h.date.slice(0, 10), h.name] as [string, string])
  );

  cache.set(year, dateMap);
  return dateMap;
}

/** Returns a Set of YYYY-MM-DD strings for HK public holidays in the given year. */
export function getHKHolidays(year: number): Set<string> {
  return new Set(getHKHolidayMap(year).keys());
}
