// Meeting invites are fully contained in the link (after the #), so they work for anyone,
// forever, without reading any shared data and without revealing the project key.

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64Url(str) {
  const bytes = enc.encode(str);
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64Url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return dec.decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
}

// meeting: { title, start (ms), duration (min), location, notes, attendees: [names], tz, id }
export function encodeInvite(m) {
  const o = { v: 1, t: m.title, s: Math.round(m.start / 60000), d: m.duration };
  if (m.location) o.l = m.location;
  if (m.notes) o.n = m.notes;
  if (m.attendees && m.attendees.length) o.a = m.attendees;
  if (m.tz) o.z = m.tz;
  if (m.id) o.i = m.id;
  return toB64Url(JSON.stringify(o));
}

export function decodeInvite(str) {
  const o = JSON.parse(fromB64Url(str));
  if (!o || typeof o.t !== 'string' || typeof o.s !== 'number' || typeof o.d !== 'number') throw new Error('bad invite');
  return {
    title: o.t, start: o.s * 60000, duration: o.d, location: o.l || '', notes: o.n || '',
    attendees: Array.isArray(o.a) ? o.a.map(String) : [], tz: o.z || '', id: o.i || '',
  };
}

export function siteBase() {
  return location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
}

export function inviteUrl(m) {
  return `${siteBase()}invite.html#${encodeInvite(m)}`;
}

// ---- calendar links --------------------------------------------------------------------------

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}/, '');

function details(m, url) {
  const lines = [];
  if (m.notes) lines.push(m.notes, '');
  if (m.attendees.length) lines.push(`Attendees: ${m.attendees.join(', ')}`);
  if (url) lines.push(`Invite: ${url}`);
  return lines.join('\n').trim();
}

export function calendarLinks(m, url) {
  const end = m.start + m.duration * 60000;
  const body = details(m, url);
  const q = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const outlook = (host) => `https://${host}/calendar/0/action/compose?${q({
    path: '/calendar/action/compose', rru: 'addevent', subject: m.title, startdt: iso(m.start), enddt: iso(end), body, location: m.location,
  })}`;
  return {
    google: `https://calendar.google.com/calendar/render?${q({
      action: 'TEMPLATE', text: m.title, dates: `${stamp(m.start)}/${stamp(end)}`, details: body, location: m.location,
    })}`,
    outlook: outlook('outlook.live.com'),
    office: outlook('outlook.office.com'),
    yahoo: `https://calendar.yahoo.com/?${q({ v: 60, title: m.title, st: stamp(m.start), et: stamp(end), desc: body, in_loc: m.location })}`,
  };
}

function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function fold(line) {
  // Fold at 73 UTF-8 bytes per RFC 5545 without splitting characters.
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > 73) { out.push(cur); cur = ' '; bytes = 1; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function buildIcs(m, url) {
  const end = m.start + m.duration * 60000;
  const uid = `${m.id || stamp(m.start)}-${Math.abs(hash(m.title + m.start))}@meetsync`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MeetSync//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(m.start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${icsEscape(m.title)}`,
  ];
  const body = details(m, url);
  if (body) lines.push(`DESCRIPTION:${icsEscape(body)}`);
  if (m.location) lines.push(`LOCATION:${icsEscape(m.location)}`);
  if (url) lines.push(`URL:${url}`);
  lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT15M', 'END:VALARM');
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function icsFileName(m) {
  return `${(m.title || 'meeting').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'meeting'}.ics`;
}

export function device() {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mac = !ios && /Macintosh/.test(ua);
  // Chrome, Firefox, Edge etc. on iPhone and in-app browsers (Instagram, Gmail, Slack...) can't
  // hand calendar files to Apple Calendar; only Safari can.
  const iosNotSafari = ios && (!/Safari\//.test(ua) || /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|YaBrowser|DuckDuckGo|FBAN|FBAV|Instagram/.test(ua));
  return { ios, mac, iosNotSafari };
}

let swReady = null;
export function registerCalendarWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  swReady = navigator.serviceWorker.register(`${siteBase()}sw.js`, { scope: siteBase() })
    .then(() => navigator.serviceWorker.ready).catch(() => null);
}

// Opens the event in the device's calendar app where the platform supports it (Apple devices),
// otherwise downloads a standard .ics file.
export async function openIcs(m, url) {
  const ics = buildIcs(m, url);
  const name = icsFileName(m);
  const { ios, mac } = device();
  if ((ios || mac) && swReady) {
    const reg = await Promise.race([swReady, new Promise((r) => setTimeout(() => r(null), 2500))]);
    if (reg && reg.active) {
      location.href = `${siteBase()}ics/${toB64Url(ics)}/${encodeURIComponent(name)}`;
      return;
    }
  }
  if (ios) {
    location.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
    return;
  }
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
