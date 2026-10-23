const timezoneSuffix = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Every instant is stored in UTC and shown in São Paulo time, whatever time zone
 * the tablet, terminal or RH desktop happens to be configured with.
 */
export const APP_TIME_ZONE = 'America/Sao_Paulo';

export function parseApiDate(value: string): Date {
  const normalized = timezoneSuffix.test(value) ? value : `${value}Z`;
  return new Date(normalized);
}

export function formatInAppTimeZone(value: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: APP_TIME_ZONE }).format(value);
}

function appWallClockParts(instant: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `yyyy-mm-dd` of the São Paulo calendar day that contains `instant`. */
export function appDateInput(instant: Date): string {
  const { year, month, day } = appWallClockParts(instant);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Calendar arithmetic on `yyyy-mm-dd` strings, independent of any time zone. */
export function shiftDateInput(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function appOffsetMs(instantMs: number): number {
  const wall = appWallClockParts(new Date(instantMs));
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return wallAsUtc - (instantMs - (((instantMs % 1000) + 1000) % 1000));
}

/**
 * UTC ISO instant of São Paulo midnight (or 23:59:59.999) on `date` (`yyyy-mm-dd`).
 * Uses the time zone database instead of a fixed -03:00, so it stays correct if
 * daylight saving time ever returns.
 */
export function appDayBoundaryIso(date: string, endOfDay = false): string {
  const [year, month, day] = date.split('-').map(Number);
  const wallMs = endOfDay
    ? Date.UTC(year, month - 1, day, 23, 59, 59, 999)
    : Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const oneDayMs = 86_400_000;
  // Offsets in force around this date; more than one only near a DST change.
  const candidates = [...new Set([wallMs - oneDayMs, wallMs, wallMs + oneDayMs].map(appOffsetMs))]
    .map((offset) => wallMs - offset);
  const valid = candidates.filter((instantMs) => wallMs - appOffsetMs(instantMs) === instantMs);
  const instantMs = valid.length
    // A repeated wall time (clocks going back) widens the day on both ends.
    ? (endOfDay ? Math.max(...valid) : Math.min(...valid))
    // A skipped wall time (clocks going forward) starts at the first instant after the gap.
    : Math.max(...candidates);
  return new Date(instantMs).toISOString();
}
