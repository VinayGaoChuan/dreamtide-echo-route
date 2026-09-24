'use strict';
/* 梦潮回声航线 — shared helpers, save data and local telemetry */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const angTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const approach = (v, target, rate) => (v < target ? Math.min(target, v + rate) : Math.max(target, v - rate));
const smooth = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));
const Ease = {
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outElastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* squared distance from point to segment */
function segDist2(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const len = vx * vx + vy * vy || 1;
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / len, 0, 1);
  return dist2(px, py, ax + vx * t, ay + vy * t);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const icon = (id, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

/* ---------- persistent save (per viewer, browser storage) ---------- */
const DEFAULT_SETTINGS = () => ({
  difficulty: 'normal',
  aimMode: 'auto',
  autoFire: true,
  bulletSlow: false,
  shake: true,
  particles: 'full',
  colorblind: false,
  bigButtons: false,
  simpleWarn: false,
  reduceFlash: false,
  showHitbox: true,
  music: 0.7,
  sfx: 0.8,
  muted: false,
  binds: null,
});

function freshMeta() {
  return {
    v: 1,
    dust: 0,
    unlocked: { weapons: ['needle', 'blade'], perfs: ['echo', 'melody'], nightmare: false },
    codex: { bullets: {}, enemies: {}, cards: {}, weapons: { needle: 1, blade: 1 } },
    memories: [],
    records: { runs: 0, clears: 0, deaths: 0, bestCombo: 0, bestBossTime: 0, challengeBest: 0, perfectParries: 0, assistedClear: false },
    settings: DEFAULT_SETTINGS(),
    loadout: { weapon: 'needle', perf: 'echo' },
    tutorialDone: false,
    seenTitle: false,
    telemetry: { counts: {}, firsts: {} },
    run: null,
  };
}

const Store = {
  key: 'dreamtide.echo-route.v1',
  ok: true,
  load() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(this.key) || 'null'); } catch (e) { this.ok = false; }
    const base = freshMeta();
    if (!data || data.v !== 1) return base;
    // shallow-merge so new fields added later still exist
    const m = Object.assign(base, data);
    m.settings = Object.assign(DEFAULT_SETTINGS(), data.settings || {});
    m.unlocked = Object.assign(freshMeta().unlocked, data.unlocked || {});
    m.codex = Object.assign(freshMeta().codex, data.codex || {});
    m.records = Object.assign(freshMeta().records, data.records || {});
    m.telemetry = Object.assign({ counts: {}, firsts: {} }, data.telemetry || {});
    return m;
  },
  save(meta) {
    try { localStorage.setItem(this.key, JSON.stringify(meta)); this.ok = true; return true; }
    catch (e) { this.ok = false; return false; }
  },
  wipe() { try { localStorage.removeItem(this.key); } catch (e) { /* storage blocked */ } },
};

/* ---------- local telemetry: the doc's 埋点 list, counted per viewer ---------- */
const Tele = {
  meta: null,
  recent: [],
  bind(meta) { this.meta = meta; },
  log(name, data) {
    if (!this.meta) return;
    const t = this.meta.telemetry;
    t.counts[name] = (t.counts[name] || 0) + 1;
    if (!t.firsts[name]) t.firsts[name] = Date.now();
    this.recent.push({ name, at: Date.now(), data: data || null });
    if (this.recent.length > 300) this.recent.shift();
  },
  flag(name, value = true) {
    if (!this.meta) return;
    const t = this.meta.telemetry;
    if (t.firsts[name] === undefined) t.firsts[name] = value;
  },
};

/* tiny object pool: reuse dead objects instead of allocating each frame */
class Pool {
  constructor(make, size) { this.items = []; this.make = make; for (let i = 0; i < size; i++) this.items.push(make()); this.cursor = 0; }
  get() {
    const n = this.items.length;
    for (let k = 0; k < n; k++) {
      const i = (this.cursor + k) % n;
      if (!this.items[i].on) { this.cursor = (i + 1) % n; return this.items[i]; }
    }
    return null; // full: caller drops the effect
  }
  each(fn) { const a = this.items; for (let i = 0; i < a.length; i++) if (a[i].on) fn(a[i]); }
  count() { let c = 0; for (const o of this.items) if (o.on) c++; return c; }
  clear() { for (const o of this.items) o.on = false; }
}
