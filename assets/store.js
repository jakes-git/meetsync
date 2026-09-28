// Shared project storage with no server of our own and no accounts.
//
// Each project is stored on several free public Nostr relays. The project key is the only secret:
// it deterministically derives (1) a signing key, so anyone who knows the project key can write,
// and (2) an AES-GCM key, so relays only ever see encrypted blobs. Every record (project info,
// one per person, one per meeting) is a separate "replaceable" event, so concurrent edits to
// different people/meetings never clobber each other. Every browser that opens a project keeps
// a local copy and re-publishes anything a relay is missing, so data heals itself over time.

import { finalizeEvent, getPublicKey, verifyEvent, bytesToHex } from './vendor/nostr.js';

const KIND = 30078; // NIP-78: arbitrary app data, addressable/replaceable by "d" tag
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.nostr.net',
  'wss://offchain.pub',
  'wss://nostr.oxtr.dev',
];

export function relayList() {
  const q = new URLSearchParams(location.search).get('relays');
  if (q) return q.split(',').map((s) => s.trim()).filter(Boolean);
  return DEFAULT_RELAYS;
}

// ---- project keys ----------------------------------------------------------------------------

const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i

export function newProjectKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = [...bytes].map((b) => ALPHA[b % ALPHA.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export function normalizeKey(input) {
  const s = String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s.length !== 12 || [...s].some((c) => !ALPHA.includes(c))) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export function newId() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
}

const enc = new TextEncoder();
const dec = new TextDecoder();
async function sha256(str) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(str)));
}
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function deriveKeys(key) {
  const sk = await sha256(`meetsync/v1/sign/${key}`);
  const aesRaw = await sha256(`meetsync/v1/encrypt/${key}`);
  const aes = await crypto.subtle.importKey('raw', aesRaw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { sk, pk: getPublicKey(sk), aes };
}

// ---- local cache -----------------------------------------------------------------------------

function lsGet(k, fallback) {
  try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ }
}
export const local = { get: lsGet, set: lsSet, del: (k) => { try { localStorage.removeItem(k); } catch {} } };

// ---- relay connection ------------------------------------------------------------------------

class RelayConn {
  constructor(url, owner) {
    this.url = url;
    this.owner = owner;
    this.ws = null;
    this.open = false;
    this.closed = false;
    this.backoff = 2000;
    this.seen = new Set(); // event ids this relay has sent us
    this.eose = false;
    this.connect();
  }

  connect() {
    if (this.closed) return;
    let ws;
    try { ws = new WebSocket(this.url); } catch { return this.retry(); }
    this.ws = ws;
    ws.onopen = () => {
      this.open = true;
      this.backoff = 2000;
      this.eose = false;
      this.seen.clear();
      this.send(['REQ', 'p', { kinds: [KIND], authors: [this.owner.pk] }]);
      this.owner.onRelayStatus();
    };
    ws.onmessage = (msg) => {
      let data;
      try { data = JSON.parse(msg.data); } catch { return; }
      const [type] = data;
      if (type === 'EVENT' && data[2]) {
        this.seen.add(data[2].id);
        this.owner.receive(data[2]);
      } else if (type === 'EOSE') {
        this.eose = true;
        this.owner.onEose(this);
      } else if (type === 'OK') {
        this.owner.onOk(data[1], data[2], this);
        if (data[2]) this.seen.add(data[1]);
      }
    };
    ws.onclose = () => {
      const was = this.open;
      this.open = false;
      if (was) this.owner.onRelayStatus();
      this.retry();
    };
    ws.onerror = () => {};
  }

  retry() {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 60000);
  }

  send(arr) {
    if (this.open && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(arr)); return true; } catch { return false; }
    }
    return false;
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    try { this.ws && this.ws.close(); } catch {}
  }
}

// ---- project ---------------------------------------------------------------------------------

export class ProjectStore {
  constructor(key) {
    this.key = key;
    this.cacheKey = `ms:cache:${key}`;
    this.records = new Map(); // d -> { event, data }
    this.listeners = new Set();
    this.pending = new Map(); // event id -> resolve()
    this.relays = [];
    this.anyEose = false;
  }

  async open() {
    const { sk, pk, aes } = await deriveKeys(this.key);
    this.sk = sk; this.pk = pk; this.aes = aes;
    for (const ev of lsGet(this.cacheKey, [])) await this.ingest(ev, false);
    this.relays = relayList().map((u) => new RelayConn(u, this));
    this.emit();
    return this;
  }

  close() {
    this.relays.forEach((r) => r.close());
    this.listeners.clear();
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit() {
    clearTimeout(this.emitTimer);
    this.emitTimer = setTimeout(() => this.listeners.forEach((fn) => fn(this.state())), 30);
  }

  status() {
    return { connected: this.relays.filter((r) => r.open).length, total: this.relays.length, loaded: this.anyEose };
  }

  onRelayStatus() { this.emit(); }

  onEose(relay) {
    this.anyEose = true;
    // Self-healing: give this relay any record it didn't have.
    for (const { event } of this.records.values()) {
      if (!relay.seen.has(event.id)) relay.send(['EVENT', event]);
    }
    this.emit();
  }

  onOk(id, ok) {
    if (ok && this.pending.has(id)) { this.pending.get(id)(true); this.pending.delete(id); }
  }

  receive(ev) { this.ingest(ev, true); }

  async ingest(ev, fromNetwork) {
    try {
      if (!ev || ev.kind !== KIND || ev.pubkey !== this.pk) return;
      const d = (ev.tags.find((t) => t[0] === 'd') || [])[1];
      if (!d) return;
      const cur = this.records.get(d);
      if (cur && (cur.event.created_at > ev.created_at || (cur.event.created_at === ev.created_at && cur.event.id <= ev.id))) return;
      if (fromNetwork && !verifyEvent(ev)) return;
      const data = await this.decrypt(ev.content);
      const now = this.records.get(d); // re-check after await
      if (now && (now.event.created_at > ev.created_at || (now.event.created_at === ev.created_at && now.event.id <= ev.id))) return;
      this.records.set(d, { event: ev, data });
      if (fromNetwork) { this.saveCache(); this.emit(); }
    } catch { /* ignore malformed or undecryptable events */ }
  }

  saveCache() {
    clearTimeout(this.cacheTimer);
    this.cacheTimer = setTimeout(() => lsSet(this.cacheKey, [...this.records.values()].map((r) => r.event)), 200);
  }

  async encrypt(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.aes, enc.encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv); out.set(ct, 12);
    return b64(out);
  }

  async decrypt(str) {
    const raw = unb64(str);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, this.aes, raw.subarray(12));
    return JSON.parse(dec.decode(pt));
  }

  // Write a record. Resolves true once any relay confirms, false on timeout (the record is still
  // kept locally and will be re-sent whenever a relay reconnects).
  async put(d, data) {
    const cur = this.records.get(d);
    const created_at = Math.max(Math.floor(Date.now() / 1000), cur ? cur.event.created_at + 1 : 0);
    const event = finalizeEvent({ kind: KIND, created_at, tags: [['d', d]], content: await this.encrypt(data) }, this.sk);
    this.records.set(d, { event, data });
    this.saveCache();
    this.emit();
    const confirmed = new Promise((resolve) => {
      this.pending.set(event.id, resolve);
      setTimeout(() => { if (this.pending.delete(event.id)) resolve(false); }, 8000);
    });
    this.relays.forEach((r) => r.send(['EVENT', event]));
    return confirmed;
  }

  remove(d) { return this.put(d, { deleted: true }); }

  state() {
    const s = { name: null, created: null, members: {}, meetings: {} };
    for (const [d, { data }] of this.records) {
      if (!data || data.deleted) continue;
      if (d === 'meta') { s.name = data.name; s.created = data.created; }
      else if (d.startsWith('member:')) s.members[d.slice(7)] = { ...data, id: d.slice(7) };
      else if (d.startsWith('meeting:')) s.meetings[d.slice(8)] = { ...data, id: d.slice(8) };
    }
    s.exists = s.name != null;
    return s;
  }
}
