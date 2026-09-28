// Time zone helpers built on Intl only (no libraries).

export const MIN = 60 * 1000;
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function browserTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function isValidTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

let tzList;
export function allTimeZones() {
  if (tzList) return tzList;
  let list = [];
  try { list = Intl.supportedValuesOf('timeZone'); } catch { /* old browser */ }
  if (!list.length) {
    list = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo',
      'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow', 'Africa/Johannesburg', 'Asia/Dubai',
      'Asia/Kolkata', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'];
  }
  const set = new Set(list);
  set.add('UTC');
  set.add(browserTz());
  tzList = [...set].sort();
  return tzList;
}

const partsFmt = new Map();
function fmtFor(tz) {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
    });
    partsFmt.set(tz, f);
  }
  return f;
}

// Wall-clock parts of instant `ts` (ms) in `tz`. m is 1-based, wd 0=Sunday.
export function zoned(ts, tz) {
  const o = {};
  for (const p of fmtFor(tz).formatToParts(new Date(ts))) o[p.type] = p.value;
  const h = +o.hour === 24 ? 0 : +o.hour;
  return { y: +o.year, m: +o.month, d: +o.day, h, mi: +o.minute, s: +o.second, wd: DAY_SHORT.indexOf(o.weekday) };
}

// Offset of tz from UTC at instant ts, in minutes (e.g. New York summer = -240).
export function offsetMin(ts, tz) {
  const z = zoned(ts, tz);
  const asUtc = Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, z.s);
  return Math.round((asUtc - Math.floor(ts / 1000) * 1000) / MIN);
}

// Instant (ms) for the wall-clock time y-m-d + minutes in tz. Day/minute overflow is allowed.
export function zonedToUtc(y, m, d, minutes, tz) {
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const o1 = offsetMin(guess, tz);
  let t = guess - o1 * MIN;
  const o2 = offsetMin(t, tz);
  if (o2 !== o1) t = guess - o2 * MIN;
  return t;
}

export function addDays(ymd, n) {
  const dt = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
}

export function ymdKey(ymd) {
  return `${ymd.y}-${String(ymd.m).padStart(2, '0')}-${String(ymd.d).padStart(2, '0')}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return addDays({ y, m, d }, 0);
}

// Monday of the week containing instant ts in tz.
export function weekStart(ts, tz) {
  const z = zoned(ts, tz);
  const back = (z.wd + 6) % 7;
  return addDays(z, -back);
}

export function fmtTime(ts, tz) {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(ts);
}

export function fmtDate(ts, tz, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }).format(ts);
}

export function fmtDateTime(ts, tz) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(ts);
}

// Label a clock time given as minutes after midnight (uses a fixed UTC date so no DST effects).
export function fmtMinutes(mins) {
  const t = Date.UTC(2024, 0, 1, 0, mins);
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(t);
}

export function offsetLabel(tz, ts = Date.now()) {
  const o = offsetMin(ts, tz);
  const sign = o < 0 ? '-' : '+';
  const a = Math.abs(o);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
}

export function tzLabel(tz, ts = Date.now()) {
  return `${tz.replace(/_/g, ' ')} (${offsetLabel(tz, ts)})`;
}

export function shortTz(tz, ts = Date.now()) {
  try {
    const p = new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'short' }).formatToParts(ts);
    return p.find((x) => x.type === 'timeZoneName')?.value || tz;
  } catch { return tz; }
}
