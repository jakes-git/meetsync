// Searchable time zone picker (type a city, region, abbreviation, zone name or UTC offset).
import { allTimeZones, browserTz, isValidTz, offsetLabel, shortTz } from './tz.js';

const ALIASES = {
  'America/New_York': 'eastern us usa east coast boston miami washington dc',
  'America/Chicago': 'central us usa texas dallas houston',
  'America/Denver': 'mountain us usa colorado',
  'America/Phoenix': 'arizona',
  'America/Los_Angeles': 'pacific us usa west coast california san francisco seattle',
  'America/Toronto': 'canada ontario',
  'America/Vancouver': 'canada british columbia',
  'America/Mexico_City': 'mexico',
  'America/Sao_Paulo': 'brazil',
  'America/Argentina/Buenos_Aires': 'argentina',
  'Europe/London': 'uk united kingdom england britain',
  'Europe/Dublin': 'ireland',
  'Europe/Paris': 'france',
  'Europe/Berlin': 'germany',
  'Europe/Madrid': 'spain',
  'Europe/Rome': 'italy',
  'Europe/Amsterdam': 'netherlands holland',
  'Europe/Zurich': 'switzerland',
  'Europe/Stockholm': 'sweden',
  'Europe/Warsaw': 'poland',
  'Europe/Kyiv': 'ukraine kiev',
  'Europe/Istanbul': 'turkey',
  'Europe/Moscow': 'russia',
  'Asia/Dubai': 'uae emirates',
  'Asia/Kolkata': 'india ist calcutta mumbai delhi bangalore',
  'Asia/Karachi': 'pakistan',
  'Asia/Dhaka': 'bangladesh',
  'Asia/Bangkok': 'thailand',
  'Asia/Jakarta': 'indonesia',
  'Asia/Singapore': 'singapore',
  'Asia/Manila': 'philippines',
  'Asia/Shanghai': 'china beijing',
  'Asia/Hong_Kong': 'hong kong',
  'Asia/Taipei': 'taiwan',
  'Asia/Seoul': 'korea',
  'Asia/Tokyo': 'japan',
  'Asia/Jerusalem': 'israel tel aviv',
  'Africa/Lagos': 'nigeria',
  'Africa/Cairo': 'egypt',
  'Africa/Nairobi': 'kenya',
  'Africa/Johannesburg': 'south africa',
  'Australia/Sydney': 'australia nsw melbourne',
  'Australia/Perth': 'western australia',
  'Pacific/Auckland': 'new zealand nz',
  UTC: 'gmt utc universal coordinated zulu',
};
// Browsers differ on old vs new zone names.
Object.assign(ALIASES, { 'Asia/Calcutta': ALIASES['Asia/Kolkata'], 'Europe/Kiev': ALIASES['Europe/Kyiv'], 'America/Buenos_Aires': ALIASES['America/Argentina/Buenos_Aires'] });

let index;
function buildIndex() {
  if (index) return index;
  const now = Date.now();
  index = allTimeZones().map((z) => {
    let long = '';
    try {
      long = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'long' }).formatToParts(now)
        .find((p) => p.type === 'timeZoneName')?.value || '';
    } catch { /* ignore */ }
    const off = offsetLabel(z, now);
    // Abbreviations in winter and summer, so both "PST" and "PDT" find Los Angeles.
    const y = new Date(now).getUTCFullYear();
    const abbr = [Date.UTC(y, 0, 15), Date.UTC(y, 6, 15)].map((t) => shortTz(z, t)).join(' ');
    const hay = [z.replace(/[_/]/g, ' '), off, off.replace('UTC', 'GMT'), abbr, long, ALIASES[z] || ''].join(' ').toLowerCase();
    return { z, name: z.replace(/_/g, ' '), off, long, hay, offMin: parseOffset(off) };
  });
  return index;
}

function parseOffset(off) {
  const m = off.match(/UTC([+-])(\d+)(?::(\d+))?/);
  return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0)) : 0;
}

const display = (z) => `${z.replace(/_/g, ' ')} (${offsetLabel(z)})`;

export function tzPicker(value, { compact = false, label = 'Time zone' } = {}) {
  let cur = isValidTz(value) ? value : browserTz();
  const detected = browserTz();
  const wrap = document.createElement('div');
  wrap.className = 'tzp' + (compact ? ' compact' : '');
  const input = document.createElement('input');
  Object.assign(input, { type: 'text', autocomplete: 'off', spellcheck: false, value: display(cur) });
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', label);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.placeholder = 'Search city, country, abbreviation or UTC+2';
  const list = document.createElement('ul');
  list.className = 'tzp-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.append(input, list);

  let items = [];
  let active = 0;

  const render = (q) => {
    const tokens = q.toLowerCase().replace(/\bgmt/g, 'utc').split(/\s+/).filter(Boolean);
    const all = buildIndex();
    // Whole-word matches (e.g. "india" as a country) rank above partial ones ("Indian/...").
    const score = (e) => tokens.reduce((sum, t) => {
      const words = e.hay.split(/[\s,()·]+/);
      return sum + (words.includes(t) ? 3 : words.some((w) => w.startsWith(t)) ? 2 : 1);
    }, 0) + (ALIASES[e.z] ? 1 : 0);
    items = tokens.length
      ? all.filter((e) => tokens.every((t) => e.hay.includes(t) || e.hay.replace(/gmt/g, 'utc').includes(t)))
        .map((e) => [score(e), e]).sort((a, b) => b[0] - a[0] || a[1].offMin - b[1].offMin || a[1].name.localeCompare(b[1].name)).map((x) => x[1])
      : [...all].sort((a, b) => a.offMin - b.offMin || a.name.localeCompare(b.name));
    if (!tokens.length) {
      const top = all.filter((e) => e.z === detected || e.z === cur);
      items = [...top, ...items.filter((e) => !top.includes(e))];
    }
    active = Math.max(0, items.findIndex((e) => e.z === cur && !tokens.length));
    list.replaceChildren(...(items.length ? items.map((e, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.i = i;
      li.className = (i === active ? 'active' : '') + (e.z === cur ? ' sel' : '');
      const a = document.createElement('span');
      a.textContent = e.name + (e.z === detected ? ' · detected' : '');
      const b = document.createElement('small');
      b.textContent = `${e.off}${e.long ? ' · ' + e.long : ''}`;
      li.append(a, b);
      li.addEventListener('mousedown', (ev) => { ev.preventDefault(); choose(e.z); });
      return li;
    }) : [Object.assign(document.createElement('li'), { className: 'empty', textContent: 'No matching time zone' })]));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    scrollActive();
  };

  const scrollActive = () => {
    const el = list.children[active];
    if (el) el.scrollIntoView({ block: 'nearest' });
  };
  const setActive = (i) => {
    if (!items.length) return;
    list.children[active]?.classList.remove('active');
    active = (i + items.length) % items.length;
    list.children[active]?.classList.add('active');
    scrollActive();
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.value = display(cur);
  };
  const choose = (z) => {
    const changed = z !== cur;
    cur = z;
    close();
    input.blur();
    if (changed) wrap.dispatchEvent(new Event('change'));
  };

  input.addEventListener('focus', () => { input.select(); render(''); });
  input.addEventListener('click', () => { if (list.hidden) render(''); });
  input.addEventListener('input', () => render(input.value));
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) render(''); else setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { if (!list.hidden) { e.preventDefault(); if (items[active]) choose(items[active].z); } }
    else if (e.key === 'Escape') { if (!list.hidden) { e.preventDefault(); e.stopPropagation(); close(); } }
  });

  Object.defineProperty(wrap, 'value', {
    get: () => cur,
    set: (v) => { if (isValidTz(v)) { cur = v; input.value = display(v); } },
  });
  return wrap;
}
