/** Time-zone helpers without a library: turn "2026-10-27 10:00 in America/New_York" into a UTC instant. */

function offsetMinutes(ts: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(ts);
  const g = (k: string) => Number(parts.find((p) => p.type === k)!.value);
  return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute')) - ts) / 60000);
}

export function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function zonedToUtc(day: string, time: string, timeZone: string) {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let utc = guess - offsetMinutes(guess, timeZone) * 60000;
  const again = guess - offsetMinutes(utc, timeZone) * 60000;
  if (again !== utc) utc = again; // across a clock change
  return new Date(utc);
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Every calendar day from..to (inclusive), with its weekday name. */
export function daysBetween(from: string, to: string) {
  const out: { day: string; weekday: string }[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = start; t <= end && out.length < 400; t += 864e5) {
    const d = new Date(t);
    out.push({ day: d.toISOString().slice(0, 10), weekday: DAY_NAMES[d.getUTCDay()] });
  }
  return out;
}

export function formatIn(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}
