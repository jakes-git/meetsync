import { browserTz, isValidTz, fmtDate, fmtTime, shortTz, zoned } from './tz.js';
import { tzPicker } from './tzpicker.js';
import { decodeInvite, calendarLinks, openIcs, buildIcs, device, registerCalendarWorker, icsFileName } from './invite-data.js';

const root = document.getElementById('root');

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

function linkify(text) {
  const parts = String(text).split(/(https?:\/\/[^\s<]+)/g);
  return parts.map((p, i) => (i % 2 ? h('a', { href: p, target: '_blank', rel: 'noopener noreferrer' }, p) : p));
}

function platform() {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'apple';
  if (/Android/.test(ua)) return 'google';
  if (/Macintosh/.test(ua)) return 'apple';
  if (/Windows/.test(ua)) return 'outlook-desktop';
  return 'google';
}

function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

function render() {
  let m;
  try {
    m = decodeInvite(location.hash.slice(1));
  } catch {
    document.title = 'Invite not found · MeetSync';
    root.replaceChildren(h('div', { class: 'card stack', style: { textAlign: 'center' } },
      h('h2', {}, 'This invite link looks incomplete'),
      h('p', { class: 'muted' }, 'Ask whoever sent it to copy the whole link again.'),
      h('a', { class: 'btn primary', href: './' }, 'Go to MeetSync')));
    return;
  }
  document.title = `${m.title} · Invite`;
  const url = location.href;
  const end = m.start + m.duration * 60000;
  let tz = browserTz();
  const links = calendarLinks(m, url);
  const suggested = platform();

  const whenBox = h('div', {});
  const drawWhen = () => {
    const sameDay = zoned(m.start, tz).d === zoned(end - 1, tz).d;
    whenBox.replaceChildren(
      h('div', { class: 'when' }, fmtDate(m.start, tz, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })),
      h('div', { style: { fontSize: '18px', marginTop: '2px' } },
        `${fmtTime(m.start, tz)} – ${sameDay ? '' : fmtDate(end, tz) + ' '}${fmtTime(end, tz)} `,
        h('span', { class: 'muted' }, shortTz(tz, m.start))),
      h('div', { class: 'muted small', style: { marginTop: '4px' } }, relative(m.start, end)));
  };
  drawWhen();

  const tzSel = tzPicker(tz, { compact: true, label: 'Show in time zone' });
  tzSel.addEventListener('change', () => { if (isValidTz(tzSel.value)) { tz = tzSel.value; drawWhen(); } });

  const btn = (key, color, letter, label, sub, action) => {
    const attrs = { class: 'btn' + (key === suggested ? ' suggested' : '') };
    const inner = [h('span', { class: 'ic', style: { background: color } }, letter),
      h('span', {}, label, key === suggested ? h('span', { class: 'badge' }, 'Suggested') : null, h('small', {}, sub))];
    if (typeof action === 'string') return h('a', { ...attrs, href: action, target: '_blank', rel: 'noopener' }, inner);
    return h('button', { ...attrs, type: 'button', onclick: action }, inner);
  };
  const ics = () => openIcs(m, url);
  const apple = () => (device().iosNotSafari ? safariHelp(m, url) : openIcs(m, url));

  const buttons = [
    btn('google', '#1a73e8', 'G', 'Google Calendar', 'Android, Gmail, any browser', links.google),
    btn('apple', '#111', 'A', 'Apple Calendar', 'iPhone, iPad, Mac', apple),
    btn('outlook', '#0a64d6', 'O', 'Outlook.com', 'Hotmail, Live, personal Microsoft', links.outlook),
    btn('office', '#c43e1c', 'M', 'Microsoft 365', 'Work or school Outlook and Teams', links.office),
    btn('outlook-desktop', '#0f6cbd', 'W', 'Outlook desktop app', 'Windows or Mac (.ics file)', ics),
    btn('yahoo', '#6001d2', 'Y', 'Yahoo Calendar', 'Yahoo Mail', links.yahoo),
    btn('other', '#6b7185', '+', 'Other calendar app', 'Proton, Fastmail, Thunderbird… (.ics)', ics),
  ];
  // Put the suggested option first.
  buttons.sort((a, b) => (b.classList.contains('suggested') ? 1 : 0) - (a.classList.contains('suggested') ? 1 : 0));

  const details = [
    m.title,
    `${fmtDate(m.start, tz, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, ${fmtTime(m.start, tz)} – ${fmtTime(end, tz)} ${shortTz(tz, m.start)}`,
    m.location ? `Where: ${m.location}` : null,
    m.attendees.length ? `With: ${m.attendees.join(', ')}` : null,
    m.notes || null,
    url,
  ].filter(Boolean).join('\n');

  root.replaceChildren(
    h('div', { class: 'card' },
      h('div', { class: 'muted small', style: { fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' } }, 'You\'re invited'),
      h('h1', { style: { marginTop: '6px', wordBreak: 'break-word' } }, m.title),
      whenBox,
      h('div', { class: 'row small muted', style: { marginTop: '8px' } }, 'Showing your time zone:', tzSel),
      m.location ? h('div', { class: 'kv' }, h('span', {}, 'Where'), h('div', { style: { wordBreak: 'break-word' } }, linkify(m.location))) : null,
      m.attendees.length ? h('div', { class: 'kv' }, h('span', {}, 'Who'), m.attendees.join(', ')) : null,
      m.notes ? h('div', { class: 'kv' }, h('span', {}, 'Notes'), h('div', { class: 'notes' }, linkify(m.notes))) : null),
    h('div', { class: 'card', style: { marginTop: '16px' } },
      h('h2', {}, 'Add to your calendar'),
      h('div', { class: 'cal-buttons' }, buttons),
      h('div', { class: 'row', style: { marginTop: '14px' } },
        h('button', {
          class: 'sm', type: 'button', onclick: async () => {
            try { await navigator.clipboard.writeText(details); toast('Details copied'); } catch { prompt('Copy the details:', details); }
          },
        }, 'Copy details'),
        h('a', {
          class: 'btn sm', download: icsFileName(m),
          href: `data:text/calendar;charset=utf-8,${encodeURIComponent(buildIcs(m, url))}`,
        }, 'Download .ics'))),
    h('footer', { class: 'site' }, 'Planning with a team? ', h('a', { href: './' }, 'Make your own MeetSync project'), ', it\'s free.'));
}

// On iPhone, only Safari can pass an event to Apple Calendar. Other browsers just save a file.
function safariHelp(m, url) {
  const close = () => back.remove();
  const safariUrl = location.href.replace(/^https:\/\//, 'x-safari-https://');
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' }, h('h2', { class: 'grow' }, 'Open in Safari to add to Apple Calendar'),
      h('button', { class: 'ghost icon', 'aria-label': 'Close', onclick: close }, '✕')),
    h('p', { class: 'muted', style: { marginTop: 0 } },
      'This browser can\'t send events to Apple Calendar on iPhone and iPad. Safari can: open this page in Safari and tap Apple Calendar again.'),
    h('div', { class: 'stack' },
      h('a', { class: 'btn primary', href: safariUrl, style: { width: '100%' } }, 'Open in Safari'),
      h('button', {
        type: 'button', style: { width: '100%' }, onclick: async () => {
          try { await navigator.clipboard.writeText(location.href); toast('Link copied. Paste it into Safari.'); } catch { prompt('Copy this link and open it in Safari:', location.href); }
        },
      }, 'Copy link for Safari'),
      h('button', { type: 'button', class: 'ghost', style: { width: '100%' }, onclick: () => { close(); openIcs(m, url); } }, 'Save the .ics file instead')),
    h('p', { class: 'muted small', style: { marginBottom: 0 } }, 'If you saved the file, open it from the Files app and tap Add to Calendar.'));
  const back = h('div', { class: 'modal-back' }, box);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.body.append(back);
}

function relative(start, end) {
  const now = Date.now();
  if (now >= start && now < end) return 'Happening now';
  if (now >= end) return 'This meeting has already happened';
  const mins = Math.round((start - now) / 60000);
  if (mins < 60) return `Starts in ${mins} minute${mins === 1 ? '' : 's'}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 36) return `Starts in ${hrs} hour${hrs === 1 ? '' : 's'}`;
  const days = Math.round(hrs / 24);
  return `Starts in ${days} days`;
}

registerCalendarWorker();
window.addEventListener('hashchange', render);
render();
