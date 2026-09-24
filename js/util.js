'use strict';
/* 梦潮：回声航线 — shared helpers, save data (v2) and local telemetry */

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
  shake: true, particles: 'full', colorblind: false, bigButtons: false, reduceFlash: false, showHitbox: true,
  dragSens: 1, music: 0.7, sfx: 0.8, muted: false, binds: null,
});

/* 每架飞机解锁时随机生成自己的星盘：四条路线各 5 个节点 */
function genStarMap(planeId, seed) {
  const rnd = mulberry32(seed || Math.floor(Math.random() * 1e9));
  const map = {};
  for (const r of ROUTE_ORDER) {
    const pool = ROUTES[r].pool.slice(0, 5);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    map[r] = pool.map((type) => { const T = NODE_TYPES[type]; return { type, v: T.min + Math.round(rnd() * (T.max - T.min)) }; });
  }
  return map;
}
function addStarNode(rec) {
  // 4★：随机一条路线多一个节点
  const r = pick(ROUTE_ORDER), pool = ROUTES[r].pool, type = pool[5 % pool.length], T = NODE_TYPES[type];
  rec.map[r].push({ type, v: T.min + Math.round(Math.random() * (T.max - T.min)) });
  return r;
}
function newPlaneRecord(id) {
  return { owned: true, stars: 1, frags: 0, map: genStarMap(id), lit: { blast: 0, fire: 0, collect: 0, burst: 0 } };
}

function freshMeta() {
  return {
    v: 2,
    stardust: 0, tickets: 0, talent: 0, cosTickets: 0,
    planes: { moon: newPlaneRecord('moon') },
    frags: {},
    current: 'moon',
    gacha: { pulls: 0, sinceHigh: 0, newbieDone: false },
    lockRoute: null,
    cosmetics: { owned: ['exp:default', 'trail:default'], exp: 'default', trail: 'default' },
    tasks: { active: ['kills', 'bursts', 'runs'], progress: {}, claimed: 0 },
    stats: { kills: 0, bursts: 0, runs: 0, syns: 0, streak100: 0, crystals: 0, bossKills: 0, lv5: 0, chests: 0 },
    codex: { planes: { moon: 1 }, skills: {}, syns: {}, enemies: {}, portals: {} },
    records: { runs: 0, clears: 0, bestStreak: 0, bestTime: 0, bestCrystals: 0 },
    bossFirstClear: false,
    firstRunDone: false, seenTitle: false,
    nextHint: null,
    settings: DEFAULT_SETTINGS(),
    telemetry: { counts: {}, firsts: {}, runs: [] },
  };
}

const Store = {
  key: 'dreamtide.echo-route.v2',
  ok: true,
  load() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(this.key) || 'null'); } catch (e) { this.ok = false; }
    const base = freshMeta();
    if (!data || data.v !== 2) return base;
    const m = Object.assign(base, data);
    const f = freshMeta();
    m.settings = Object.assign(DEFAULT_SETTINGS(), data.settings || {});
    for (const k of ['gacha', 'cosmetics', 'tasks', 'stats', 'codex', 'records', 'telemetry']) m[k] = Object.assign(f[k], data[k] || {});
    if (!m.planes || !m.planes[m.current]) { m.planes = Object.assign({ moon: newPlaneRecord('moon') }, m.planes || {}); m.current = 'moon'; }
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
  add(name, n) { if (!this.meta || !n) return; const c = this.meta.telemetry.counts; c[name] = (c[name] || 0) + n; },
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
