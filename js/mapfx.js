'use strict';
/* 梦潮：回声航线 v0.8 — 飞机与地图的关系。相邻两次互动的操作和结局都不一样，完成后都会留下看得见的痕迹：
   信标亭：碰一下门前的铃铛 → 屋顶折起、烟囱变摇柄、整间屋子变成转盘（完整升级仪式）→ 变成亮着的补给点，下一批敌人经过时帮你打一发。
   风车塔：从宽风环穿过去 → 云层被吹开、露出藏着的入口，一排敌人被推到炮口前 → 二选一。
   星砂矿：碰一下矿核，它会跟着你飞 → 拖到标记的岩壁上炸开 → 新航道 + 动力装置（二选一），之后敌人从裂口钻出来。
   救援吊舱：碰一下吊舱挂上拖绳 → 沿安全光带护送到修理点（吊舱有三格耐久，挨一发不会坏）→ 伙伴加入、修好炮台、支援二选一。
   全部只靠移动；第一次出现时按固定顺序教学。 */

const MAP_DRIFT = 95;
const COMP_SLOTS = [[-62, -48], [-62, 48], [-104, 0], [-110, -70], [-110, 70]];
function mapShuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(srnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

Object.assign(World.prototype, {
  initMap(o) {
    this.mapObjs = []; this.orbs = []; this.companions = []; this.journey = []; this.lurks = [];
    this.mapCalm = false; this.mapDwell = false; this.cam = { z: 1, x: this.W / 2, y: LH / 2 };
    this.seenMap = new Set(o.seenMap || []); this.mapHintKind = null;
    this.nextRare = false; this.rareNext = false; this.laneT = 0; this.minerKills = 0; this.grandpaT = 0; this.sky = null;
    Object.assign(this.m, { interacts: 0, interactFails: 0, interactMax: 0, firstInteract: null, rescues: 0, giants: 0 });
  },
  spawnMapObject(kind, f = {}) {
    const W = this.W, top = this.arena.top, bot = this.arena.bottom, mid = (top + bot) / 2, p = this.player;
    const o = { kind, id: this.eid++, t: 0, state: 'idle', phase: 'in', x: W + 220, y: mid, near: 0, alpha: 0, engageT: null, station: W * 0.64, seed: srand(10), optional: !!f.optional, reward: !!f.reward, wait: f.reward ? 1e9 : 20 };
    switch (kind) {
      case 'house': o.y = clamp(srand(mid - 40, mid + 80), top + 150, bot - 60); o.sensor = { dx: -122, dy: 36, r: 58 }; o.first = this.offerN === 0; if (o.first) o.wait = 1e9; break;
      case 'wind':
        o.y = srand(mid - 40, mid + 90); o.station = W * 0.7; o.ringDx = -150; o.ringR = 92; o.spin = 0.6;
        if (this.wf.upper) { o.upper = { dx: -150, y: top + 64, r: 62 }; o.y = Math.max(o.y, top + 64 + 200); } // 家园修好了风道：塔顶多一个上层风圈（和下面的风圈分开）
        break;
      case 'mine': {
        o.y = srand(mid - 100, mid + 100); o.station = W * 0.6; o.core = { x: o.x - 34, y: o.y - 12, towed: false };
        const side = o.y < mid ? 1 : -1; o.wall = { x: W * 0.82, y: side < 0 ? top + 20 : bot - 20, side, shown: 0 };
        break;
      }
      case 'bridge': { // 断桥：三个灯环排成一条之字形航线，依次穿过去，尾流把它们连成桥
        o.station = W * 0.6; const s = srnd() < 0.5 ? 1 : -1;
        o.rings = [[-300, 95 * s], [-120, -70 * s], [60, 45 * s]].map(([dx, dy]) => ({ dx, dy: clamp(dy, top - mid + 90, bot - mid - 70) }));
        o.lit = [false, false, false]; o.build = 0; o.ringR = 66;
        break;
      }
      case 'giant': { // 沉睡巨鲸：浮在海面上，眼睛半睁；飞到眼睛旁边停一下就醒
        o.sub = 'whale'; o.station = W * 0.66; o.y = bot - 70; o.s = 0.85; o.eye = 0.1; o.act = 0; o.mouth = 0; o.wakeT = 0;
        break;
      }
      case 'npc': {
        o.sub = f.sub || this.pickNpc(); o.y = f.y !== undefined ? f.y : srand(mid - 80, mid + 80); o.station = W * 0.42; o.wait = f.reward || f.sub ? 1e9 : 26;
        o.story = this.wf.targets.includes(o.sub); // 家园追踪的伙伴：一路有箭头
        const hp = this.wf.beacon ? 5 : 3; o.pod = { x: o.x, y: o.y, hp, max: hp, inv: 0, towed: false }; o.dockR = this.wf.beacon ? 125 : 95; // 小梦兔的救援信标：吊舱更耐打、修理点更大
        const ry = clamp(p.y < mid ? srand(mid + 20, bot - 110) : srand(top + 110, mid - 20), top + 110, bot - 110);
        o.dock = { x: W + 170, y: ry, w: 160 }; o.lane = { y: ry, h: 150 }; // 修理点等挂上拖绳后才从右边慢慢漂过来：护送要走一段
        break;
      }
    }
    this.mapObjs.push(o);
    return o;
  },
  pickNpc() {
    const have = new Set(this.companions.map((c) => c.id)), p = this.player, wf = this.wf;
    const t = this.nextTarget(); if (t) return t; // 家园追踪的伙伴（联机时每个人的都算）：首次救援一定能遇到
    let pool = NPC_ORDER.filter((id) => !have.has(id));
    const fresh = pool.filter((id) => !wf.rescued.includes(id) && id !== 'merchant'); // 糖果商人只在上层云桥出现
    if (fresh.length) pool = fresh;
    const pref = [];
    if (p.hp <= p.maxHp / 2) pref.push('grandpa');
    if (this.lvOf('wing')) pref.push('clockling');
    if (this.lvOf('magnet')) pref.push('miner');
    if (this.picks.length >= 3) pref.push('merchant');
    pref.push('miner', 'bunny');
    for (const id of pref) if (pool.includes(id)) return id;
    return pool.length ? spick(pool) : spick(NPC_ORDER);
  },
  /* 这一局还没救、也还没出现过的追踪目标（糖果商人只在上层云桥） */
  nextTarget() { const done = new Set([...this.companions.map((c) => c.id), ...this.m.rescuedNow, ...this.mapObjs.filter((o) => o.kind === 'npc').map((o) => o.sub)]); return this.wf.targets.find((t) => t !== 'merchant' && !done.has(t)) || null; },
  wantsMerchant() { return this.wf.targets.includes('merchant') && !this.m.rescuedNow.includes('merchant'); },
  /* 联机时房间里的人各有要救的伙伴：救完一位（或错过）后，下一位的吊舱跟着来 */
  queueNextRescue() { if (this.mode !== 'run' || this.phase !== 'fight') return; const t = this.nextTarget(); if (t) this.later(6, () => { if (this.phase === 'fight' && this.state === 'play' && this.nextTarget() === t) this.spawnMapObject('npc', { sub: t }); }); },
  /* 多人：拖着矿核 / 吊舱的那位优先；否则离装置最近的那架飞机来判定碰触 */
  mapActor(o) {
    const by = o.by !== undefined ? this.players[o.by] : null;
    if (by && by.alive && !by.gone) return by;
    const t = this.mapGoalPos(o) || { x: o.x, y: o.y };
    return this.nearestPlayer(t.x, t.y);
  },
  /* 这个装置下一步该去哪里（指引箭头 / 自动测试的飞行员都用它） */
  mapGoalPos(o) {
    if (o.state === 'idle') {
      if (o.kind === 'house') return { x: o.x + o.sensor.dx, y: o.y + o.sensor.dy };
      if (o.kind === 'wind') return o.upper && this.wantsMerchant() ? { x: o.x + o.upper.dx, y: o.upper.y } : { x: o.x + o.ringDx, y: o.y }; // 要去救商人：箭头指上层风圈
      if (o.kind === 'mine') return { x: o.core.x, y: o.core.y };
      if (o.kind === 'npc') return { x: o.pod.x, y: o.pod.y };
      if (o.kind === 'bridge') { const i = o.lit.indexOf(false); const R = o.rings[i < 0 ? 2 : i]; return { x: o.x + R.dx, y: o.y + R.dy }; }
      if (o.kind === 'giant') return this.giantEye(o);
    }
    if (o.state === 'tow') return o.kind === 'mine' ? { x: o.wall.x, y: o.wall.y + o.wall.side * -40 } : { x: o.dock.x, y: o.dock.y };
    return null;
  },
  /* 地图交互第一次出现时教一次（lessons UT15），一次只教一步：去哪 = 那个点上一圈呼吸的光 + 从飞机指过去的箭头；
     碰到会怎样 = 底部提示的那句话（ui.js showHint）。要护送的（吊舱、矿核）碰到以后，光圈换到终点上写“送到这里”。只画，不影响玩法 */
  drawMapHint(g) {
    const o = this.mapObjs.find((q) => q.kind === this.mapHintKind && (q.state === 'idle' || q.state === 'tow') && q.x < this.W + 20); if (!o) return;
    const towing = o.state === 'tow', word = towing ? '送到这里' : '碰这里';
    const g0 = this.mapGoalPos(o) || o, at = { x: clamp(g0.x, 60, this.W - 60), y: clamp(g0.y, TOP + 60, BOTTOM - 80) }; // 终点在屏幕外时贴在边上
    const p = this.me, t = this.t, k = 0.5 + 0.5 * Math.sin(t * 6), col = (MAP_OBJECTS[o.kind] && MAP_OBJECTS[o.kind].color) || '#ffe38a';
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 2; i++) { const r = 34 + ((t * 40 + i * 22) % 44); g.strokeStyle = hexA(col, 0.75 * (1 - (r - 34) / 44)); g.lineWidth = 4; g.beginPath(); g.arc(at.x, at.y, r, 0, TAU); g.stroke(); }
    g.globalCompositeOperation = 'source-over';
    g.font = '700 16px "Noto Sans SC", sans-serif'; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = 'rgba(20,14,50,.9)'; g.fillStyle = '#fff6c8';
    // 字放在光圈下面：装置上方常有它自己的标签（吊舱的“救小梦兔”），别叠在一起
    g.strokeText(word, at.x, at.y + 66 + k * 4); g.fillText(word, at.x, at.y + 66 + k * 4);
    // 要护送的：还没碰之前就把终点淡淡圈出来（修理点 / 岩壁），一开始就知道要送去哪
    const dest = !towing && (o.kind === 'npc' ? o.dock : o.kind === 'mine' ? { x: o.wall.x, y: o.wall.y + o.wall.side * -40 } : null);
    if (dest) {
      const dx2 = clamp(dest.x, 60, this.W - 60), dy2 = clamp(dest.y, TOP + 60, BOTTOM - 80);
      g.globalAlpha = 0.55; g.setLineDash([8, 8]); g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.arc(dx2, dy2, 40, 0, TAU); g.stroke(); g.setLineDash([]);
      g.strokeStyle = 'rgba(20,14,50,.9)'; g.lineWidth = 4; const lab = o.kind === 'npc' ? '修理点' : '岩壁'; g.strokeText(lab, dx2, dy2 + 62); g.fillText(lab, dx2, dy2 + 62); g.globalAlpha = 1;
    }
    const dx = at.x - p.x, dy = at.y - p.y, d = Math.hypot(dx, dy);
    if (p.alive && d > 140) {
      const a = Math.atan2(dy, dx), r0 = 54 + k * 8;
      g.translate(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0); g.rotate(a);
      g.fillStyle = col; g.strokeStyle = 'rgba(20,14,50,.9)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(16, 0); g.lineTo(-8, -12); g.lineTo(-3, 0); g.lineTo(-8, 12); g.closePath(); g.stroke(); g.fill();
    }
    g.restore();
  },
  guideTarget() {
    const P = this.props && this.props.find((q) => q.kind === 'core'); if (P) return { x: P.x, y: P.y };
    if (this.surprise && this.surprise.guide) return this.surprise.guide;
    const o = this.mapObjs.find((q) => (q.state === 'idle' || q.state === 'tow') && q.x < this.W - 20);
    return o ? this.mapGoalPos(o) : null;
  },

  /* ---------- 每帧 ---------- */
  updateMap(dt) {
    if (this.mode !== 'run') return;
    if (this.timeStop <= 0) this.updateLurks(dt);
    this.mapCalm = false; this.mapDwell = false;
    for (const o of this.mapObjs) { if (o.by !== undefined) { const b = this.players[o.by]; if (!b || b.gone || b.away) o.by = undefined; } } // 拖着矿核 / 吊舱的人断线或离开：转成大家都能接手（v0.11 §8）
    for (const o of this.mapObjs) if (this.state === 'play') this.withPlayer(this.mapActor(o), () => this.updateMapObj(o, dt)); // 谁在操作这个装置，“当前飞机”就是谁
    this.mapObjs = this.mapObjs.filter((o) => !o.gone);
    this.updateOrbs(dt);
    this.updateCompanions(dt);
    if (this.sky) { // 上层云桥：商人救下来（或一阵子后）天色回落
      const S = this.sky; S.t += dt;
      if (S.on && S.t > 14 && !this.mapObjs.some((o) => o.kind === 'npc' && o.sub === 'merchant' && o.state !== 'done')) S.on = false;
      S.a = approach(S.a || 0, S.on ? 1 : 0, dt * 0.8); if (!S.on && S.a <= 0) this.sky = null;
    }
    const p = this.player;
    const lane = this.laneT > 0 ? 125 : 0;
    if (this.laneT > 0) this.laneT -= dt;
    if (lane && p.alive) this.bullets.each((b) => { if (dist2(b.x, b.y, p.x, p.y) < lane * lane) { b.on = false; this.part('puff', b.x, b.y, rand(-40, 40), rand(-40, 40), 0.5, 7, 'rgba(255,255,255,0.8)'); } });
  },
  updateMapObj(o, dt) {
    const p = this.player, M = MAP_OBJECTS[o.kind];
    o.t += dt; o.alpha = Math.min(1, o.alpha + dt * 2);
    const holding = o.state === 'idle' || o.state === 'tow' || o.state === 'ritual' || o.state === 'blow' || o.state === 'boom' || o.state === 'build' || o.state === 'wake' || o.state === 'gulp';
    if (o.phase === 'in') { o.x -= MAP_DRIFT * dt; if (o.x <= o.station) o.phase = 'wait'; }
    else if (o.phase === 'wait') { o.x -= (holding ? 6 : 20) * dt; if (o.state === 'idle') { o.wait -= dt; if (o.wait <= 0) o.phase = 'out'; } else if (!holding) o.phase = 'out'; }
    else { o.x -= MAP_DRIFT * 1.5 * dt; if (o.x < -320) { o.gone = true; if (o.state === 'idle') this.mapMissed(o); } }
    if (o.kind === 'mine' && o.core && !o.core.towed && o.state === 'idle') { o.core.x = o.x - 34; o.core.y = o.y - 12 + Math.sin(o.t * 2) * 4; }
    if (o.kind === 'npc' && o.state === 'idle') { o.pod.x = o.x; o.pod.y = o.y + Math.sin(o.t * 1.4) * 8; }
    if (o.x < this.W - 60 && !this.seenMap.has(o.kind) && o.state === 'idle') { this.seenMap.add(o.kind); this.mapHintKind = o.kind; this.emit('maphint', { kind: o.kind }); }
    const tgt = this.mapGoalPos(o);
    if (tgt) { const d = Math.sqrt(dist2(p.x, p.y, tgt.x, tgt.y)), was = o.near > 0.5; o.near = approach(o.near, d < 240 ? 1 : 0, dt * 3); if (!was && o.near > 0.5) Sound.sfx('mapNear', { pan: this.pan(tgt.x) }); }
    const paper = this.planeId === 'paper', moon = this.planeId === 'moon', reach = (paper ? 16 : 0) + (moon ? 10 : 0);
    switch (o.kind) {
      case 'house':
        if (o.state === 'idle') {
          const sx = o.x + o.sensor.dx, sy = o.y + o.sensor.dy;
          // 第一间信标亭保证能拿到：等久了会慢慢飘到飞机的高度
          if (o.first && o.phase === 'wait' && o.t > 9) { o.y = smooth(o.y, clamp(p.y - o.sensor.dy, this.arena.top + 150, this.arena.bottom - 60), 0.8, dt); o.seek = true; }
          if (p.alive && dist2(p.x, p.y, sx, sy) < (o.sensor.r + reach) ** 2) this.houseTrigger(o);
        } else if (o.state === 'supply') this.houseSupply(o, dt);
        break;
      case 'wind':
        o.spin = smooth(o.spin, o.state === 'blow' || o.state === 'ritual' ? 14 : 0.6, 3, dt); o.rot = (o.rot || 0) + o.spin * dt;
        if (o.state === 'idle') {
          const rx = o.x + o.ringDx, ry = o.y, U = o.upper;
          if (U && p.alive && Math.abs(p.x - (o.x + U.dx)) < U.r * 0.6 + 14 + reach && Math.abs(p.y - U.y) < U.r + reach) this.windUpper(o);
          else if (p.alive && Math.abs(p.x - rx) < o.ringR * 0.55 + 14 + reach && Math.abs(p.y - ry) < o.ringR + reach) this.windBlow(o);
        } else if (o.state === 'blow') {
          o.blowT += dt;
          for (const e of o.pushed) if (e.alive) { e.x = smooth(e.x, e.rowX, 7, dt); e.y = smooth(e.y, e.rowY, 7, dt); e.y0 = e.y; e.stun = Math.max(e.stun, 0.1); }
          if (Math.random() < 0.5) this.part('puff', rand(this.W * 0.5, this.W), rand(TOP, TOP + 140), rand(400, 800), rand(-40, 40), 0.6, rand(10, 18), 'rgba(235,240,255,0.45)');
          if (o.blowT > 1.6) { o.state = 'ritual'; this.queueRitual('wind', { x: o.x, y: o.y, device: 'machine', obj: o }); }
        }
        break;
      case 'mine':
        if (o.state === 'idle' && p.alive && dist2(p.x, p.y, o.core.x, o.core.y) < (62 + reach) ** 2) {
          o.state = 'tow'; o.core.towed = true; o.engageT = this.runT; o.by = p.idx; Sound.sfx('hook', { pan: this.pan(o.core.x) });
          this.text('矿核跟上来了 · 拖到发光的岩壁', o.core.x, o.core.y - 60, '#c9a8ff', 18, 4);
        }
        if (o.state === 'tow') {
          o.wall.shown = Math.min(1, o.wall.shown + dt * 2);
          o.core.x = smooth(o.core.x, p.x - 74, 5, dt); o.core.y = smooth(o.core.y, p.y + 14, 5, dt);
          if (Math.random() < 0.5) this.part('mote', o.core.x, o.core.y, rand(-60, -10), rand(-20, 20), 0.4, 3, '#c9a8ff');
          if (dist2(o.core.x, o.core.y, o.wall.x, o.wall.y) < 150 * 150 || dist2(p.x, p.y, o.wall.x, o.wall.y) < 130 * 130) { o.state = 'boom'; o.boomT = 0; o.from = { x: o.core.x, y: o.core.y }; Sound.sfx('coreFly', { pan: this.pan(o.wall.x) }); }
        } else if (o.state === 'boom') {
          o.boomT += dt; const u = clamp(o.boomT / 0.35, 0, 1);
          o.core.x = lerp(o.from.x, o.wall.x, u); o.core.y = lerp(o.from.y, o.wall.y, u);
          if (u >= 1 && !o.blown) this.mineBlow(o);
        }
        break;
      case 'bridge':
        if (o.state === 'idle') {
          // 灯环按顺序点亮（队友谁穿过都算）；穿错顺序不罚，只是下一个还没亮
          const i = o.lit.indexOf(false), R = o.rings[i], rx = o.x + R.dx, ry = o.y + R.dy;
          for (const q of this.players) {
            if (!q.alive || q.gone || q.away) continue;
            if (dist2(q.x, q.y, rx, ry) < (o.ringR * 0.8 + reach) ** 2) {
              o.lit[i] = true; if (o.engageT === null) o.engageT = this.runT;
              Sound.sfx('ringPass', { k: i }); this.part('ring', rx, ry, 0, 0, 0.35, o.ringR * 1.6, 'rgba(255,215,106,0.9)');
              for (let k = 0; k < 10; k++) this.part('spark', rx, ry, rand(-220, 220), rand(-220, 220), 0.5, rand(3, 6), pick(['#ffe38a', '#9fe3f0', '#fff6c8']));
              if (i === 2) this.bridgeBuilt(o);
              break;
            }
          }
        } else if (o.state === 'build') {
          o.build = Math.min(1, o.build + dt / 0.9);
          if (o.build >= 1) { o.state = 'ritual'; this.queueRitual('bridge', { full: true, q: 1, x: o.x - 60, y: clamp(o.y - 170, this.arena.top + 120, this.arena.bottom - 120), device: 'machine', obj: o }); }
        }
        break;
      case 'giant': {
        const E = this.giantEye(o);
        if (o.state === 'idle') {
          // 有人停在眼睛旁边：眼睛慢慢睁开，0.6 秒后醒来；飞开了又慢慢闭上
          const near = this.players.some((q) => q.alive && !q.gone && !q.away && dist2(q.x, q.y, E.x, E.y) < (78 + reach) ** 2);
          o.wakeT = near ? o.wakeT + dt : Math.max(0, o.wakeT - dt * 0.5); o.eye = 0.1 + Math.min(1, o.wakeT / 0.6) * 0.9;
          if (near && o.engageT === null) o.engageT = this.runT;
          if (o.wakeT >= 0.6) this.giantWake(o);
        } else if (o.state === 'wake') {
          o.stT += dt; o.act = Math.min(1, o.stT / 0.9); o.y = smooth(o.y, this.arena.bottom - 150, 2.5, dt);
          if (o.stT > 0.9) { o.state = 'gulp'; o.stT = 0; this.giantGulp(o); }
        } else if (o.state === 'gulp') {
          o.stT += dt; o.mouth = Math.min(1, o.stT / 0.3);
          const M = this.giantMouth(o);
          for (const e of this.enemies) if (e.alive && e.pull && e.pull.giant === o.id && dist2(e.x, e.y, M.x, M.y) < 60 * 60) { this.killEnemy(e, { x: M.x, y: M.y }); this.part('puff', M.x, M.y, rand(-60, 60), rand(-60, 60), 0.4, 10, 'rgba(200,230,255,0.8)'); }
          if (o.stT > 1.3) {
            for (const e of this.enemies) if (e.alive && e.pull && e.pull.giant === o.id) e.pull = null;
            o.mouth = 0; o.state = 'ritual'; this.shake(0.4); Sound.sfx('boomNote');
            this.queueRitual('giant', { full: true, q: 2, rare: true, x: o.x - 140, y: clamp(o.y - 260, this.arena.top + 120, this.arena.bottom - 120), device: 'machine', obj: o });
          }
        }
        break;
      }
      case 'npc': {
        const pod = o.pod; pod.inv = Math.max(0, pod.inv - dt);
        if (o.state === 'idle' && p.alive && dist2(p.x, p.y, pod.x, pod.y) < (60 + reach) ** 2) {
          o.state = 'tow'; pod.towed = true; o.engageT = this.runT; o.by = p.idx; Sound.sfx('hook', { pan: this.pan(pod.x) });
          this.text(`${NPCS[o.sub].name}挂上拖绳了 · 沿光带送到修理点`, pod.x, pod.y - 64, '#ff9fcf', 17, 4);
        }
        if (o.state === 'tow') {
          o.dock.x = Math.max(this.W * 0.6, o.dock.x - 95 * dt); // 修理点停在屏幕中部，不和右侧的厚甲怪 / 精英站位挤在一起
          pod.x = smooth(pod.x, p.x - 64, 4.5, dt); pod.y = smooth(pod.y, p.y + 26, 4.5, dt);
          const L = o.lane, inLane = (b) => b.x > this.W * 0.1 && b.x < o.dock.x + 60 && Math.abs(b.y - L.y) < L.h / 2;
          this.bullets.each((b) => {
            if (inLane(b)) { b.on = false; if (Math.random() < 0.3) this.part('mote', b.x, b.y, 0, -30, 0.4, 2.5, 'rgba(255,200,230,0.9)'); return; }
            if (pod.inv <= 0 && dist2(b.x, b.y, pod.x, pod.y) < 24 * 24) { b.on = false; this.podHit(o); }
          });
          if (o.dock.x < this.W * 0.64 && (dist2(pod.x, pod.y, o.dock.x, o.dock.y) < o.dockR * o.dockR || dist2(p.x, p.y, o.dock.x, o.dock.y) < (o.dockR - 15) ** 2)) this.npcDock(o);
        }
        if (o.state === 'bail') { o.dock.x = Math.max(this.W * 0.6, o.dock.x - 95 * dt); pod.x = smooth(pod.x, o.dock.x, 1.2, dt); pod.y = smooth(pod.y, o.dock.y, 1.2, dt); if (dist2(pod.x, pod.y, o.dock.x, o.dock.y) < 40 * 40) this.npcDock(o, true); }
        break;
      }
    }
  },

  /* ---------- 信标亭 ---------- */
  houseTrigger(o) {
    o.state = 'ritual'; o.engageT = this.runT;
    Sound.sfx('bell', { pan: this.pan(o.x) });
    this.queueRitual('house', { full: true, q: o.first ? 0 : 1, x: o.x, y: o.y - 60, device: 'wheel', obj: o, promise: '主炮改造' });
    o.onRitual = () => { o.state = 'supply'; o.shots = 4; o.shotT = 1; o.supplyT = 0; };
    this.mapDone(o, '点亮', MAP_OBJECTS.house.name, '主炮二选一', '屋子变成转盘，转出两个主炮改造；之后变成补给点帮你打一发');
  },
  houseSupply(o, dt) {
    o.supplyT += dt; o.shotT -= dt;
    if (o.shotT <= 0 && o.shots > 0) {
      const e = this.enemies.find((q) => q.alive && !q.isBoss && q.x > o.x - 60 && q.x < o.x + 460 && q.x < this.W - 20 && Math.abs(q.y - o.y) < 300);
      if (e) { o.shotT = 1.4; o.shots--; this.addShot('starbolt', o.x, o.y - 110, angTo(o.x, o.y - 110, e.x, e.y), 760, { dmg: 40 * this.stats.dmgK, r: 10, homing: 8, life: 1.6, from: 'house' }); Sound.sfx('houseShot', { pan: this.pan(o.x) }); this.part('flash', o.x, o.y - 110, 0, 0, 0.2, 40, '#ffe38a'); }
    }
    if (o.shots <= 0 || o.supplyT > 24) o.phase = 'out';
  },
  /* ---------- 风车塔 ---------- */
  windBlow(o) {
    const p = this.player, top = this.arena.top + 40, bot = this.arena.bottom - 40;
    o.state = 'blow'; o.blowT = 0; o.engageT = this.runT;
    Sound.sfx('wind', { pan: this.pan(o.x) }); this.rumble(0.3, 0.5, 120);
    // 吹开云层：露出藏着的入口（之后杂兵也会从这里出来）
    this.traces.door = { x: this.W * 0.88, y: this.arena.top + 110, side: -1, born: this.t };
    // 一排敌人被推到炮口前
    const y = clamp(p.y, top + 20, bot - 20);
    let list = this.enemies.filter((e) => e.alive && !e.isBoss && !e.elite && !e.goal && !e.lurk && e.type !== 'armor' && e.type !== 'wreck' && e.x < this.W + 40).slice(0, 8);
    for (let i = list.length; i < 6; i++) list.push(this.addEnemy('jelly', { x: this.W + 30 + i * 30, y: srand(top, bot), path: 'line', vx: -120 }));
    list.forEach((e, i) => { e.rowX = Math.min(this.W - 40, p.x + 250 + i * 50); e.rowY = y; e.path = 'line'; e.vx = -40; });
    o.pushed = list;
    this.text('风！一排敌人被推到炮口前', clamp(p.x + 300, 200, this.W - 200), y - 70, '#9fe3f0', 20, 5);
    o.onRitual = () => { o.state = 'done'; o.phase = 'out'; };
    this.mapDone(o, '吹开', MAP_OBJECTS.wind.name, '推一排 + 二选一', '云层吹开露出入口，一排敌人被推到炮口前');
  },
  /* ---------- 星砂矿：拖核撞墙 ---------- */
  mineBlow(o) {
    const W = o.wall; o.blown = true; o.state = 'done'; o.phase = 'out';
    this.explode(W.x, W.y, 260 * this.stats.blastK, 90 * this.stats.dmgK, { level: 3, fireworks: true });
    this.fx(W.x, W.y, 4, 320, ['#c9a8ff', '#6ff0ff', '#ffe38a']); this.clearBullets(true);
    for (let i = 0; i < 18; i++) this.part('shard', W.x, W.y, rand(-420, 420), -W.side * rand(80, 420), 1, rand(8, 14), pick(['#3b3170', '#5b4fa0', '#8f82d6']));
    this.hitStop(0.05); this.shake(0.5); this.rumble(0.9, 0.6, 180);
    Sound.sfx('wallBreak');
    this.traces.crack = { x: W.x, y: W.y, side: W.side, born: this.t };
    for (let i = 0; i < 24; i++) this.dropPickup('dust', W.x + srand(-40, 40), W.y - W.side * 30, { value: 1, vx: srand(-300, 100), vy: -W.side * srand(60, 300) });
    this.later(0.35, () => { for (const k of this.pickups) if (k.kind === 'dust') k.attract = true; });
    this.addCharge(0.5, true); this.text('大招充能 ▲▲', this.player.x, this.player.y - 56, '#ffd76a', 18, 5); // 纯资源直接吸收
    this.queueRitual('mine', { x: W.x - 40, y: W.y - W.side * 150, device: 'machine', obj: o });
    this.remember('炸开了星砂岩壁', 1);
    this.mapDone(o, '炸开', MAP_OBJECTS.mine.name, '强化二选一', '岩壁炸出新航道和动力装置；之后敌人会从裂口钻出来');
  },
  /* ---------- 断桥：三个灯环都亮了 → 桥一块块接上，桥上一段时间敌弹化掉（安全航道）→ 二选一 ---------- */
  bridgeBuilt(o) {
    o.state = 'build'; o.build = 0;
    Sound.sfx('bridge'); this.clearBullets(true); this.laneT = Math.max(this.laneT, 7);
    this.text('断桥接上了！桥上一段时间敌弹会化掉', clamp(o.x, 220, this.W - 220), o.y - 140, '#9fe3f0', 20, 5);
    o.onRitual = () => { o.state = 'done'; o.phase = 'out'; };
    this.remember('接上了断桥', 1);
    this.mapDone(o, '修复', MAP_OBJECTS.bridge.name, '安全航道 + 二选一', '三个灯环连成桥，一段安全航道');
  },
  /* ---------- 沉睡巨鲸：叫醒 → 浮起来 → 一大口吞掉前面的普通敌人（Boss、精英、主目标不吞）→ 稀有二选一 ---------- */
  giantEye(o) { const e = GIANT_EYE.whale; return { x: o.x + e[0] * o.s, y: o.y + e[1] * o.s }; },
  giantMouth(o) { return { x: o.x - 200 * o.s, y: o.y + 20 * o.s }; },
  giantWake(o) {
    o.state = 'wake'; o.stT = 0; o.eye = 1;
    Sound.sfx('giantWake'); this.rumble(0.6, 0.8, 300); this.shake(0.3);
    this.text('巨鲸醒了！', o.x - 120, o.y - 200, '#6ff0ff', 24, 5);
    o.onRitual = () => { o.state = 'done'; o.phase = 'out'; };
    this.traces.door = { x: this.W * 0.86, y: this.arena.bottom - 120, side: 1, born: this.t }; // 巨鲸游开后，海面下的通道成了新的来敌口
    this.m.giants++;
    this.remember('叫醒了沉睡巨鲸', 1);
    this.mapDone(o, '唤醒', MAP_OBJECTS.giant.name, '吞掉一片 + 稀有二选一', '巨鲸浮上来，把附近的敌人一口吞掉');
  },
  giantGulp(o) {
    const M = this.giantMouth(o);
    this.clearBullets(true); this.hitStop(0.06); this.flash = Math.max(this.flash, 0.25 * this.flashK()); this.flashColor = '200,235,255';
    for (const e of this.enemies) if (e.alive && !e.isBoss && !e.elite && !e.goal && !e.lurk && e.type !== 'cmdr' && e.type !== 'wreck' && e.x < this.W + 40) e.pull = { x: M.x, y: M.y, v: 620, giant: o.id };
    for (let i = 0; i < 16; i++) this.part('puff', M.x + rand(0, 400), M.y + rand(-200, 200), -rand(300, 600), rand(-60, 60), 0.6, rand(10, 18), 'rgba(200,230,255,0.5)');
  },

  /* ---------- 救援吊舱：护送 ---------- */
  podHit(o) {
    const pod = o.pod; pod.hp--; pod.inv = 1.1; Sound.sfx('podHit', { pan: this.pan(pod.x) });
    this.text(pod.hp > 0 ? `吊舱被打中 · 还剩 ${pod.hp} 格` : '救生舱坏了！幸存者自己跳伞', pod.x, pod.y - 44, '#ffb2a8', 16, 4);
    if (pod.hp <= 0) { o.state = 'bail'; pod.towed = false; }
  },
  npcDock(o, bailed) {
    const d = o.dock, id = o.sub; o.state = 'done'; o.phase = 'out';
    if (this.cb.onRescue) this.cb.onRescue(id); // 到达修理点 = 救出：当场存档，之后被击落也不会丢（跳伞到达也算）
    if (bailed && !this.m.rescuedNow.includes(id)) this.m.rescuedNow.push(id);
    this.later(0.1, () => this.queueNextRescue());
    Sound.sfx('rescue'); this.fx(d.x, d.y, 3, 140, ['#ff9fcf', '#ffffff', '#ffe38a']);
    if (!bailed) {
      this.companions.push({ id, x: o.pod.x, y: o.pod.y, t: 0, fireT: 0.6, mood: 'happy', moodT: 2, idx: this.companions.length, owner: this.player.idx });
      if (!this.m.rescuedNow.includes(id)) this.m.rescuedNow.push(id);
      this.m.rescues++; this.emit('companion', { id });
      if (id === 'grandpa') this.player.cloudShield = true;
      if (id === 'clockling') this.addCharge(0.3, true);
      if (id === 'miner') for (let i = 0; i < 12; i++) this.dropPickup('dust', d.x, d.y, { value: 1, attract: true });
      this.remember(`救出了${NPCS[id].name}`, 3);
    }
    this.turret = { x: d.x, y: d.y, t: 0, shots: 6, fireT: 0.8 }; // 修好的炮台：帮你打几发
    this.queueRitual('npc', { x: d.x - 40, y: d.y, device: 'machine', obj: o });
    this.mapDone(o, '救出', NPCS[id].name, '支援二选一', bailed ? `${NPCS[id].name}自己跳伞到了修理点，修好了炮台` : `${NPCS[id].name}加入队伍，修好了炮台`);
  },
  updateTurret(dt) {
    const T = this.turret; if (!T) return;
    T.t += dt; T.x -= 20 * dt; T.fireT -= dt;
    if (T.fireT <= 0 && T.shots > 0 && this.state === 'play' && !this.ritualFocus()) {
      const e = this.nearestEnemy(T.x, T.y, 700);
      if (e) { T.fireT = 1.1; T.shots--; this.addShot('starbolt', T.x, T.y - 20, angTo(T.x, T.y - 20, e.x, e.y), 740, { dmg: 26 * this.stats.dmgK, r: 8, homing: 7, life: 1.5, from: 'npc' }); Sound.sfx('houseShot', { pan: this.pan(T.x), gap: 200 }); }
    }
    if (T.x < -80 || (T.shots <= 0 && T.t > 12)) this.turret = null;
  },

  /* ---------- 完成 / 错过 ---------- */
  mapDone(o, verb, name, reward, desc) {
    const dur = o.engageT !== null ? this.runT - o.engageT : 0;
    this.m.interacts++; this.m.interactMax = Math.max(this.m.interactMax, dur);
    if (this.m.firstInteract === null) this.m.firstInteract = this.runT;
    this.highlight();
    Sound.sfx('mapDone');
    // 飞机专属地图反应
    const p = this.player;
    if (this.planeId === 'candy') { for (let i = 0; i < 8; i++) this.addShot('candyBomb', o.x + srand(-260, 260), TOP - 10 - i * 20, Math.PI / 2, srand(420, 560), { dmg: 40 * this.stats.dmgK, r: 10, life: 3, ty: srand(this.arena.top + 60, this.arena.bottom - 60) }); p.candy = Math.max(p.candy, 5); }
    if (this.planeId === 'clock' && !this.bursting) this.timeStop = Math.max(this.timeStop, 1.2);
    if (WOOD_DROP[o.kind]) this.dropWood(o.kind === 'npc' ? o.dock.x : o.x, o.kind === 'npc' ? o.dock.y : o.y, WOOD_DROP[o.kind]);
    const entry = { kind: o.kind, sub: o.sub || null, verb, name, reward, desc };
    this.journey.push(entry);
    this.emit('mapDone', entry);
    if (this.mapHintKind === o.kind) { this.mapHintKind = null; this.emit('maphint', { kind: null }); }
    if (this.cb.onMap) this.cb.onMap(o.kind, o.sub);
  },
  /* 残骸零件：一小把从装置里蹦出来，自动飞向飞机（多人时每人一份）；回家两个折一份废料 */
  dropWood(x, y, n) { for (let i = 0; i < n; i++) this.dropPickup('wood', x + srand(-30, 30), y + srand(-30, 30), { value: 1, vx: srand(-160, 160), vy: srand(-220, -40) }); this.later(0.5, () => { for (const k of this.pickups) if (k.kind === 'wood') k.attract = true; }); },
  /* ---------- 上层云桥：风道修好后才有的高空航路（v0.10 §10） ---------- */
  windUpper(o) {
    const p = this.player, top = this.arena.top;
    o.state = 'blow'; o.blowT = 0; o.engageT = this.runT; o.pushed = []; o.wentUp = true;
    Sound.sfx('wind', { pan: this.pan(o.x) }); this.rumble(0.4, 0.5, 140);
    this.sky = { t: 0, on: true }; this.m.upperRoute++;
    if (this.wantsMerchant()) { // 高空护送：糖果商人困在云桥上
      this.later(0.8, () => this.spawnMapObject('npc', { sub: 'merchant', y: top + 150, reward: true }));
      this.text('上层云桥 · 糖果商人困在这里！', clamp(p.x + 260, 220, this.W - 220), top + 120, '#ffd76a', 22, 5);
    } else { // 密集清怪：一大串碎屑虫从云桥扑下来，掉更多星砂和零件
      for (let i = 0; i < 14; i++) this.later(i * 0.12, () => this.addEnemy('moth', { x: this.W + 30 + (i % 3) * 30, y: top + 60 + (i % 5) * 50, path: 'line', vx: -170 }));
      this.dropWood(this.W * 0.75, top + 120, 3);
      this.text('上层云桥 · 一大串碎屑虫扑下来', clamp(p.x + 260, 220, this.W - 220), top + 120, '#9fe3f0', 20, 5);
    }
    this.remember('飞上了上层云桥', 3);
    o.onRitual = () => { o.state = 'done'; o.phase = 'out'; };
    this.mapDone(o, '飞上', '上层云桥', '高空航路 + 二选一', '风道修好了：风车塔上方的风圈通往高空云桥');
  },
  mapMissed(o) { if (o.kind === 'npc') this.queueNextRescue(); this.m.interactFails++; if (this.mapHintKind === o.kind) { this.mapHintKind = null; this.emit('maphint', { kind: null }); } },

  /* ---------- 奖励：从物件飞回飞机（纯资源直接吸收） ---------- */
  launchOrb(x, y, icon, color, label, apply) { this.orbs.push({ sx: x, sy: y, x, y, t: 0, dur: 0.7, icon, color, label, apply }); },
  updateOrbs(dt) {
    const p = this.player;
    for (const b of this.orbs) {
      b.t += dt; const u = Math.min(1, b.t / b.dur), k = u * u * (3 - 2 * u);
      const cx = (b.sx + p.x) / 2, cy = Math.min(b.sy, p.y) - 150;
      b.x = (1 - k) * (1 - k) * b.sx + 2 * (1 - k) * k * cx + k * k * p.x; b.y = (1 - k) * (1 - k) * b.sy + 2 * (1 - k) * k * cy + k * k * p.y;
      if (u >= 1 && !b.done) { b.done = true; b.apply(); Sound.sfx('crystal'); this.text(b.label, p.x, p.y - 52, b.color, 20, 5); }
    }
    this.orbs = this.orbs.filter((b) => !b.done);
  },

  /* ---------- 伙伴 ---------- */
  updateCompanions(dt) {
    this.updateTurret(dt);
    if (!this.companions.length) return;
    const ownerOf = (c) => { const q = this.players[c.owner]; return q && q.alive && !q.gone ? q : this.anchor(); }, p = this.anchor();
    const bossIntro = this.phase === 'boss' && this.bossIntroT > 0;
    this.companions.forEach((c, i) => {
      c.t += dt; c.moodT -= dt;
      const slot = COMP_SLOTS[i % COMP_SLOTS.length];
      const o = ownerOf(c); // 伙伴跟着救它的那架飞机
      let tx = o.x + slot[0], ty = o.y + slot[1];
      if (bossIntro) { tx = o.x - 30 - i * 10; ty = o.y + (i % 2 ? 16 : -16); c.mood = 'scared'; c.moodT = 0.3; }
      if (c.id === 'bunny' && !bossIntro) { const k = this.pickups.find((q) => (q.kind === 'chest' || q.kind === 'heart' || q.kind === 'candy' || q.kind === 'gold') && q.x < this.W - 30); if (k) { tx = lerp(tx, k.x, 0.6); ty = lerp(ty, k.y, 0.6); } }
      c.x = smooth(c.x, clamp(tx, 20, this.W - 20), 5, dt); c.y = smooth(c.y, clamp(ty, TOP, BOTTOM), 5, dt);
      if (c.moodT <= 0) { const r = srnd(); c.mood = r < 0.25 ? 'wave' : r < 0.4 && this.phase !== 'boss' ? 'sleep' : 'idle'; c.moodT = c.mood === 'sleep' ? 2.2 : c.mood === 'wave' ? 1.2 : srand(3, 6); }
      if (this.state === 'play' && p.alive && !this.ritualFocus()) {
        c.fireT -= dt;
        if (c.fireT <= 0) { c.fireT = 0.75; const e = this.nearestEnemy(c.x, c.y, 760); if (e && e.x > c.x - 40) { this.addShot('starbolt', c.x + 10, c.y, angTo(c.x, c.y, e.x, e.y), 720, { dmg: 7 * this.stats.dmgK * (1 + this.stats.npcBoost), r: 6, homing: 5, life: 1.3, from: 'npc' }); if (c.mood === 'sleep') c.moodT = 0; } }
      }
    });
    const has = (id) => this.companions.some((c) => c.id === id);
    if (has('grandpa') && !p.cloudShield && p.alive) { this.grandpaT -= dt; if (this.grandpaT <= 0) { p.cloudShield = true; this.grandpaT = 15 / (1 + this.stats.npcBoost); this.text('云朵爷爷铺了一层云', p.x, p.y - 50, '#dff2ff', 15, 3); } }
    if (has('bunny')) for (const k of this.pickups) { if (k.x > this.W - 30 || k.fade !== undefined) continue; if (k.kind === 'chest' || k.kind === 'heart' || k.kind === 'candy' || k.kind === 'gold') k.attract = true; }
  },
  onCompanionKill(e) {
    if (!this.companions.length || e.fodder) return;
    if (this.companions.some((c) => c.id === 'miner')) {
      this.minerKills++;
      if (this.minerKills % 8 === 0) { for (let i = 0; i < 4; i++) this.dropPickup('dust', e.x, e.y, { value: 1, big: i === 0, attract: true }); this.addCharge(0.03); }
    }
  },
  onCompanionSkill() {
    if (!this.companions.some((c) => c.id === 'merchant')) return;
    const p = this.player;
    this.later(0.15, () => { this.explode(p.x + 110, p.y, 120 * this.stats.blastK, 36 * this.stats.dmgK, { level: 2, fireworks: true }); this.dropPickup('candy', p.x + 160, p.y, { owner: this.np > 1 ? p.idx : undefined }); this.text('糖果爆炸', p.x + 110, p.y - 60, '#ff9fcf', 16, 3); });
  },
  /* Boss 入口：库存为 0 时补到 1；伙伴 / 修好的炮台各帮一次忙 */
  onMapBoss() {
    const p = this.player;
    for (const o of this.mapObjs) if (o.state === 'idle') { o.state = 'failed'; o.phase = 'out'; }
    if (this.mapHintKind) { this.mapHintKind = null; this.emit('maphint', { kind: null }); }
    for (const b of this.orbs) if (!b.done) { b.done = true; b.apply(); }
    this.orbs = [];
    this.text('Boss 来了 · 没有大招的补上一次', p.x, p.y - 60, '#ffd76a', 20, 5); // 补库存在 startBoss 里按每架飞机做
    if (this.companions.length) this.later(1.2, () => { for (const c of this.companions) this.fx(c.x, c.y, 2, 50, [NPCS[c.id].color, '#ffffff']); this.text('幸存者助力！', p.x, p.y + 60, '#ff9fcf', 18, 4); for (const q of this.players) q.res.dust += 10 * this.companions.length; });
  },
  onCompanionBossPhase() {
    if (!this.companions.some((c) => c.id === 'clockling')) return;
    const p = this.player; this.addStock(1);
    this.text('小闹钟：准点补一次大招', p.x, p.y - 64, '#ffd76a', 16, 4);
  },

  /* ---------- 画 ---------- */
  applyCam(g) { if (this.cam && this.cam.z > 1.001) { g.translate(this.cam.x, this.cam.y); g.scale(this.cam.z, this.cam.z); g.translate(-this.cam.x, -this.cam.y); } },
  drawMap(g) {
    const t = this.t, p = this.me;
    for (const o of this.mapObjs) {
      const M = MAP_OBJECTS[o.kind], idle = o.state === 'idle';
      const inRitual = this.ritual && this.ritual.q.obj === o && this.ritual.st !== 'resume' && this.ritual.st !== 'fly';
      g.save(); g.globalAlpha = o.alpha * (o.state === 'failed' ? 0.6 : 1);
      switch (o.kind) {
        case 'house':
          if (!(inRitual && o.kind === 'house')) drawLampHouse(g, o.x, o.y, { lit: o.state === 'supply' ? 1 : o.near * 0.4, done: o.state === 'supply', open: o.state === 'supply' ? 1 : 0, turn: 0, look: clamp((p.x - o.x) / 200, -1, 1), bulb: this.trailId && this.trailId !== 'default' ? this.trailColors[0] : null }, t);
          if (idle) drawBell(g, o.x + o.sensor.dx, o.y + o.sensor.dy + Math.sin(t * 1.3) * 5, o.sensor.r, o.near, t);
          if (o.state === 'supply' && o.shots > 0) drawStepPill(g, o.x, o.y - 170, `补给点 · 还能帮你打 ${o.shots} 发`, '#ffd76a', 0.9);
          break;
        case 'wind':
          drawWindTower(g, o.x, o.y, o.rot || 0, t, idle ? o.ringR : 0, o.ringDx, o.near);
          if (o.upper && idle) { // 上层风圈：金色虚线圈 + 一截云桥；爷爷做风向观察时两个风圈都写明通向哪里
            const ux = o.x + o.upper.dx, uy = o.upper.y, merchant = this.wantsMerchant();
            g.strokeStyle = 'rgba(255,215,106,0.85)'; g.lineWidth = 4; g.setLineDash([10, 8]); g.lineDashOffset = -t * 40; g.beginPath(); g.ellipse(ux, uy, o.upper.r * 0.6, o.upper.r, 0, 0, TAU); g.stroke(); g.setLineDash([]);
            glowAt(g, ux, uy, o.upper.r * 1.3, 'rgba(255,230,160,0.6)', 0.35 + Math.sin(t * 3) * 0.1);
            g.fillStyle = 'rgba(255,250,235,0.55)'; for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(ux + 60 + i * 46, uy + 12 + Math.sin(t + i) * 3, 30, 11, 0, 0, TAU); g.fill(); }
            if (this.wf.scout || merchant) drawStepPill(g, ux, uy - o.upper.r - 18, merchant ? '上层云桥 · 糖果商人在上面' : '上层云桥 · 密集清怪', '#ffd76a', 0.95);
            if (this.wf.scout) drawStepPill(g, o.x + o.ringDx, o.y + o.ringR + 22, '下层风圈 · 推一排 + 二选一', '#9fe3f0', 0.9);
          }
          break;
        case 'mine':
          if (!o.blown) drawMine(g, o.x, o.y, { r: 60, charge: o.state === 'idle' ? 0.2 : 0, crackA: Math.PI, seed: o.seed, shake: false }, t);
          if (o.state === 'tow' || o.state === 'boom') drawWallMark(g, o.wall, t);
          const ow = this.players[o.by] || p;
          if (!o.blown) { if (o.state === 'tow') { const p = ow; g.strokeStyle = 'rgba(201,168,255,0.7)'; g.lineWidth = 2; g.setLineDash([4, 6]); g.beginPath(); g.moveTo(p.x - 20, p.y); g.lineTo(o.core.x, o.core.y); g.stroke(); g.setLineDash([]); } drawMineCore(g, o.core.x, o.core.y, t, o.state !== 'idle'); }
          break;
        case 'bridge': {
          const pts = [{ x: o.x + o.rings[0].dx - 130, y: o.y + o.rings[0].dy + 40 }, ...o.rings.map((R) => ({ x: o.x + R.dx, y: o.y + R.dy })), { x: o.x + o.rings[2].dx + 140, y: o.y + o.rings[2].dy - 30 }];
          const lit = o.lit.filter(Boolean).length;
          drawBridgeDeck(g, pts, o.state === 'idle' ? lit * 0.22 : 0.66 + o.build * 0.34, t); // 亮一个灯环接上一截，全亮后整座桥接完
          if (o.state === 'idle') o.rings.forEach((R, i) => drawLampRing(g, o.x + R.dx, o.y + R.dy, o.ringR, t, o.lit[i], i === lit ? o.near : 0));
          break;
        }
        case 'giant':
          drawGiant(g, o.x, o.y, o.s, { kind: 'whale', eye: o.eye, act: o.act, mouth: o.mouth }, t);
          if (o.state === 'idle') { const E = this.giantEye(o); g.strokeStyle = `rgba(111,240,255,${0.4 + o.near * 0.5})`; g.lineWidth = 3; g.setLineDash([8, 8]); g.lineDashOffset = -t * 30; g.beginPath(); g.arc(E.x, E.y, 78, 0, TAU); g.stroke(); g.setLineDash([]); if (o.wakeT > 0) drawChargeRing(g, E.x, E.y, 50, Math.min(1, o.wakeT / 0.6), '#6ff0ff', t); }
          break;
        case 'npc':
          if (o.state === 'tow' || o.state === 'bail') drawSafeLane(g, this.W * 0.1, o.dock.x + 40, o.lane.y, o.lane.h, t);
          if (o.state !== 'idle' && (o.state !== 'done' || o.phase !== 'out')) drawDock(g, o.dock.x, o.dock.y, t, o.state === 'done');
          if (o.state !== 'done') {
            if (o.state === 'tow') { const p = this.players[o.by] || this.me; g.strokeStyle = 'rgba(255,200,230,0.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(p.x - 20, p.y + 6); g.quadraticCurveTo((p.x + o.pod.x) / 2, Math.max(p.y, o.pod.y) + 30, o.pod.x, o.pod.y - 20); g.stroke(); }
            drawPod(g, o.pod.x, o.pod.y, o.sub, o.pod.hp, o.pod.inv, t, o.state === 'bail');
          }
          break;
      }
      // 标签 + 一步一步的操作说明 + 指引箭头
      const tgt = this.mapGoalPos(o);
      if (tgt && (idle || o.state === 'tow')) {
        const step = o.kind === 'house' ? (o.seek ? '铃铛飘过来了 · 碰一下就好' : '碰一下门前的铃铛')
          : o.kind === 'wind' ? (o.upper && this.wantsMerchant() ? '飞进上层风圈 · 去救糖果商人' : '从风环里穿过去')
          : o.kind === 'mine' ? (o.state === 'tow' ? '把矿核拖到发光的岩壁' : '碰一下发光的矿核')
          : o.kind === 'bridge' ? `穿过第 ${o.lit.filter(Boolean).length + 1} 个灯环`
          : o.kind === 'giant' ? '飞到眼睛旁边停一下'
          : o.state === 'tow' ? `沿光带送到修理点 · 耐久 ${o.pod.hp}/${o.pod.max}` : o.story ? `救${NPCS[o.sub].name} · 碰一下吊舱` : '碰一下吊舱';
        const lx = clamp(tgt.x, 150, this.W - 170), ly = clamp(tgt.y, this.arena.top + 110, this.arena.bottom); // 目标在屏幕外时，标签贴在屏幕边上
        drawMapTag(g, lx, ly - 92, M.icon, M.tag, M.color, o.alpha * (0.7 + 0.3 * Math.sin(t * 4)));
        drawStepPill(g, lx, ly - 62, step, M.color, o.alpha);
        if (p.alive && (o.near > 0.2 || o.state === 'tow' || o.seek || o.reward || (o.story && this.wf.clue) || (o.upper && this.wantsMerchant()))) drawPointer(g, p.x, p.y, tgt.x, tgt.y, M.color, t);
      }
      g.restore();
    }
  },
  drawMapFront(g) {
    const t = this.t, p = this.player;
    if (this.laneT > 0 && p.alive) {
      const a = Math.min(1, this.laneT) * 0.8;
      glowAt(g, p.x, p.y, 150, 'rgba(220,240,255,0.6)', a * 0.5);
    }
    if (this.turret) drawTurret(g, this.turret.x, this.turret.y, t, this.turret.shots);
    for (const c of this.companions) drawNPC(g, c.id, c.x, c.y, 0.95, t + c.idx, c.mood);
    for (const b of this.orbs) drawRewardOrb(g, b.x, b.y, b.icon, b.color, t, 1 + Math.sin(b.t * 20) * 0.08);
  },
});

/* ---------- 新装置的画法 ---------- */
function drawBell(g, x, y, r, near, t) {
  glowAt(g, x, y, r * 1.6, 'rgba(255,215,106,0.8)', 0.35 + near * 0.4);
  g.save(); g.translate(x, y); g.rotate(Math.sin(t * (3 + near * 6)) * (0.12 + near * 0.2));
  g.strokeStyle = PAL.ink; g.lineWidth = 2.4; g.beginPath(); g.moveTo(0, -30); g.lineTo(0, -18); g.stroke();
  g.fillStyle = '#ffd76a'; g.beginPath(); g.moveTo(-16, 10); g.quadraticCurveTo(-16, -18, 0, -18); g.quadraticCurveTo(16, -18, 16, 10); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#fff6c8'; g.beginPath(); g.arc(0, 14, 5, 0, TAU); g.fill(); g.stroke();
  g.restore();
  g.strokeStyle = `rgba(255,227,138,${0.4 + near * 0.5})`; g.lineWidth = 3; g.setLineDash([6, 8]); g.lineDashOffset = -t * 30; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); g.setLineDash([]);
}
function drawWindTower(g, x, y, rot, t, ringR, ringDx, near) {
  g.save(); g.translate(x, y + Math.sin(t) * 4);
  floatRock(g, 150, 60, t);
  g.fillStyle = '#c8cedf'; // 太阳风车：金属塔，叶片是太阳能板 g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(-18, 0); g.lineTo(-10, -120); g.lineTo(10, -120); g.lineTo(18, 0); g.closePath(); g.fill(); g.stroke();
  g.save(); g.translate(0, -124); g.rotate(rot);
  for (let i = 0; i < 4; i++) { g.rotate(TAU / 4); g.fillStyle = '#2f5fbf'; g.beginPath(); g.moveTo(6, -8); g.lineTo(60, -12); g.lineTo(60, 12); g.lineTo(6, 8); g.closePath(); g.fill(); g.stroke(); g.strokeStyle = 'rgba(160,210,255,0.6)'; g.lineWidth = 1; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(6 + k * 13.5, -9 - k * 0.8); g.lineTo(6 + k * 13.5, 9 + k * 0.8); g.stroke(); } g.strokeStyle = PAL.ink; g.lineWidth = 2.4; }
  g.fillStyle = '#ffd76a'; g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fill(); g.stroke();
  g.restore(); g.restore();
  if (ringR) {
    const rx = x + ringDx;
    glowAt(g, rx, y, ringR * 1.6, 'rgba(159,227,240,0.8)', 0.3 + near * 0.4);
    g.strokeStyle = PAL.ink; g.lineWidth = 12; g.beginPath(); g.ellipse(rx, y, ringR * 0.55, ringR, 0, 0, TAU); g.stroke();
    g.strokeStyle = '#9fe3f0'; g.lineWidth = 6; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2; g.setLineDash([10, 10]); g.lineDashOffset = -t * 80; g.beginPath(); g.ellipse(rx, y, ringR * 0.38, ringR * 0.8, 0, 0, TAU); g.stroke(); g.setLineDash([]);
  }
}
function drawMineCore(g, x, y, t, towed) {
  glowAt(g, x, y, 56, GLOW.purple, 0.7 + Math.sin(t * 7) * 0.2);
  g.save(); g.translate(x, y); g.rotate(t * (towed ? 3 : 1));
  g.fillStyle = '#e9dcff'; g.strokeStyle = PAL.ink; g.lineWidth = 2.2;
  g.beginPath(); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU, r = i % 2 ? 12 : 20; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#6ff0ff'; g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill();
  g.restore();
}
function drawWallMark(g, w, t) {
  g.save(); g.translate(w.x, w.y); g.globalAlpha = w.shown;
  const s = w.side;
  g.fillStyle = '#2e2466'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(-110, s * 30); g.lineTo(-80, -s * 20); g.lineTo(-30, -s * 8); g.lineTo(0, -s * 40); g.lineTo(40, -s * 12); g.lineTo(110, -s * 24); g.lineTo(110, s * 30); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = '#c9a8ff'; g.lineWidth = 3; g.beginPath(); g.moveTo(-30, -s * 8); g.lineTo(-6, -s * 26); g.lineTo(12, -s * 10); g.stroke();
  const pulse = 1 + Math.sin(t * 6) * 0.1;
  g.strokeStyle = `rgba(201,168,255,${0.7 + Math.sin(t * 6) * 0.3})`; g.lineWidth = 3; g.beginPath(); g.arc(0, -s * 40, 34 * pulse, 0, TAU); g.stroke();
  g.beginPath(); g.moveTo(-14, -s * 40 - 14); g.lineTo(14, -s * 40 + 14); g.moveTo(14, -s * 40 - 14); g.lineTo(-14, -s * 40 + 14); g.stroke();
  g.restore();
}
function drawSafeLane(g, x0, x1, y, h, t) {
  g.save();
  const gr = g.createLinearGradient(0, y - h / 2, 0, y + h / 2); gr.addColorStop(0, 'rgba(255,159,207,0)'); gr.addColorStop(0.5, 'rgba(255,159,207,0.16)'); gr.addColorStop(1, 'rgba(255,159,207,0)');
  g.fillStyle = gr; g.fillRect(x0, y - h / 2, x1 - x0, h);
  g.strokeStyle = 'rgba(255,200,230,0.55)'; g.lineWidth = 2; g.setLineDash([12, 10]); g.lineDashOffset = -t * 60;
  g.beginPath(); g.moveTo(x0, y - h / 2); g.lineTo(x1, y - h / 2); g.moveTo(x0, y + h / 2); g.lineTo(x1, y + h / 2); g.stroke(); g.setLineDash([]);
  g.fillStyle = 'rgba(255,220,240,0.5)';
  for (let x = x0 + ((t * 80) % 60); x < x1; x += 60) { g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 12, y); g.lineTo(x, y + 8); g.closePath(); g.fill(); }
  g.restore();
}
function drawPod(g, x, y, sub, hp, inv, t, bail) {
  g.save(); g.translate(x, y + Math.sin(t * 2) * 3);
  if (inv > 0 && Math.sin(t * 40) > 0) g.globalAlpha = 0.5;
  g.strokeStyle = PAL.ink; g.lineWidth = 2;
  if (bail) { g.fillStyle = '#fff6ee'; g.beginPath(); g.arc(0, -40, 26, Math.PI, 0); g.closePath(); g.fill(); g.stroke(); g.beginPath(); g.moveTo(-24, -40); g.lineTo(0, -6); g.lineTo(24, -40); g.stroke(); }
  else { g.fillStyle = 'rgba(255,200,230,0.9)'; g.beginPath(); g.ellipse(0, -30, 22, 26, 0, 0, TAU); g.fill(); g.stroke(); g.beginPath(); g.moveTo(-8, -6); g.lineTo(-10, 4); g.moveTo(8, -6); g.lineTo(10, 4); g.stroke(); }
  g.fillStyle = 'rgba(40,30,100,0.9)'; g.beginPath(); g.roundRect ? g.roundRect(-18, 2, 36, 24, 8) : g.rect(-18, 2, 36, 24); g.fill(); g.stroke();
  drawNPC(g, sub, 0, 12, 0.7, t, hp >= 2 ? 'idle' : 'scared');
  const n = Math.max(3, hp); for (let i = 0; i < n; i++) { g.fillStyle = i < hp ? '#ff9fcf' : 'rgba(255,255,255,0.2)'; g.fillRect(-(n * 11 - 3) / 2 + i * 11, 32, 8, 5); }
  g.restore();
}
function drawDock(g, x, y, t, done) {
  g.save(); g.translate(x, y);
  glowAt(g, 0, 0, 90, done ? GLOW.gold : GLOW.pink, 0.4 + Math.sin(t * 3) * 0.1);
  g.fillStyle = '#3b3170'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
  g.beginPath(); g.roundRect ? g.roundRect(-40, -12, 80, 40, 10) : g.rect(-40, -12, 80, 40); g.fill(); g.stroke();
  g.fillStyle = done ? '#ffd76a' : '#ff9fcf'; g.beginPath(); g.arc(0, -22, 12, 0, TAU); g.fill(); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.setLineDash([6, 6]); g.lineDashOffset = -t * 30; g.beginPath(); g.arc(0, 0, 70, 0, TAU); g.stroke(); g.setLineDash([]);
  g.restore();
  if (!done) drawStepPill(g, x, y + 60, '修理点', '#ff9fcf', 1);
}
function drawTurret(g, x, y, t, shots) {
  g.save(); g.translate(x, y);
  g.fillStyle = '#3b3170'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
  g.beginPath(); g.roundRect ? g.roundRect(-30, -6, 60, 30, 8) : g.rect(-30, -6, 60, 30); g.fill(); g.stroke();
  g.fillStyle = '#ffd76a'; g.fillRect(-6, -30, 12, 26); g.strokeRect(-6, -30, 12, 26);
  glowAt(g, 0, -30, 26, GLOW.gold, 0.6);
  g.restore();
  if (shots > 0) drawStepPill(g, x, y + 46, `修好的炮台 · ${shots}`, '#ffd76a', 0.85);
}

/* ================================================== 会出手的地图（v0.12，用户 2026-10-06：横版通关没有特色就太传统） ==================================================
   地图的一部分会转过来对付你：边缘伸出一只手来抓、装饰突然醒来扑咬、上下的地形往里合拢。
   每一种都先给固定的先兆（约 1 秒：冒泡 / 抽动 / 睁眼 / 折痕 + 声音），每次都一样，玩家学得会；先兆期间碰不到人。
   每一种都能躲开或打碎：打碎有额外奖励。第一次出现在平静段当教学（带一句提示），之后加入推压段。
   出怪方向跟着压力曲线（director.js tension）：平静只从前方，蓄压加一侧，高潮多方向 + 地图出手，喘息回到前方。 */
const LURK_THEMES = {
  bay: { order: ['bottom', 'scene', 'top', 'rear'], kinds: [{ kind: 'hand', side: 'bottom', look: 'tide' }, { kind: 'wake', side: 'scene', look: 'lantern' }] },
  river: { order: ['scene', 'top', 'bottom', 'rear'], kinds: [{ kind: 'wake', side: 'scene', look: 'boat' }, { kind: 'close', side: 'scene', look: 'paper' }, { kind: 'hand', side: 'top', look: 'paper' }] },
  tower: { order: ['top', 'scene', 'rear', 'bottom'], kinds: [{ kind: 'hand', side: 'top', look: 'clock' }, { kind: 'wake', side: 'scene', look: 'clock' }, { kind: 'close', side: 'scene', look: 'gear' }] },
};
const LURK_INFO = {
  'hand:tide': { name: '机械爪', hint: '下方冒火花的那一列会伸出一只机械爪：离开那一列，或打碎它', color: '#7fd8ff', tell: 'tide' },
  'hand:paper': { name: '吊臂', hint: '上方震动的那一列会伸下一只吊臂：离开那一列，或打碎它', color: '#fff1d6', tell: 'peel' },
  'hand:clock': { name: '发条手', hint: '上方齿轮转起来的那一列会伸下一只发条手：离开那一列，或打碎它', color: '#ffd76a', tell: 'rewind' },
  'wake:lantern': { name: '伪装信标灯', hint: '顶上抖动、睁眼的信标灯会沿白线扑过来：躲开白线，或打掉它', color: '#ffcf6a', tell: 'houseWake' },
  'wake:boat': { name: '货柜怪', hint: '抖动、睁眼的货柜会沿白线扑过来：躲开白线，或打掉它', color: '#fff1d6', tell: 'houseWake' },
  'wake:clock': { name: '钟面怪', hint: '背景里睁眼的小钟会沿白线扑过来：躲开白线，或打掉它', color: '#ffb3e6', tell: 'moonBlink' },
  'close:paper': { name: '货柜门合拢', hint: '上下货柜门起折痕就会往里合：打碎两边发光的锁，马上打开', color: '#fff1d6', tell: 'riftOpen' },
  'close:gear': { name: '齿轮墙', hint: '上下边缘裂开，齿轮墙会往里压：打碎两边发光的齿轮心，马上退回', color: '#ffcf7a', tell: 'riftOpen' },
};
const HAZ = '#ff5f87'; // 地图出手的统一危险色：和自己的子弹（青 / 白 / 金）分得开
const LURK = { handOmen: 1.1, wakeOmen: 1.0, closeOmen: 1.3, handHp: 70, wakeHp: 40, sealHp: 60, closeDepth: 92, closeHold: 6, reward: 6 };

Object.assign(World.prototype, {
  lurkTheme() { return LURK_THEMES[(this.stage && this.stage.theme) || 'bay'] || LURK_THEMES.bay; },
  lurkInfo(L) { return LURK_INFO[`${L.kind}:${L.look}`] || LURK_INFO['hand:tide']; },
  /* 出一只（teach = 第一次，带教学提示）；同一时间最多一只 */
  spawnLurk(def, teach) {
    if (!this.lurks) this.lurks = [];
    const W = this.W, top = this.arena.top, bot = this.arena.bottom, q = this.pickTarget(), hpK = this.foeHpK();
    const L = { id: this.eid++, kind: def.kind, look: def.look, side: def.side, t: 0, st: 'omen', teach: !!teach, hpK };
    if (def.kind === 'hand') {
      L.omen = LURK.handOmen; L.x = clamp(q.x + srand(140, 200), W * 0.3, W * 0.85); L.from = def.side === 'bottom' ? 1 : -1; // 在飞机前方升起：打得到，也看得清
      L.edgeY = L.from > 0 ? LH + 30 : TOP - 30; L.reachY = clamp(q.y, top + 50, bot - 50); L.grabX = L.x - 120; // 升到飞机的高度，再往飞机这边抓一把
    } else if (def.kind === 'wake') {
      L.omen = LURK.wakeOmen; L.x = clamp(q.x + srand(320, 460), W * 0.45, W * 0.9);
      L.y = def.look === 'lantern' ? top + 26 : def.look === 'boat' ? bot - 34 : clamp(srand(top + 80, bot - 80), top + 60, bot - 60);
      L.tx = q.x; L.ty = q.y;
      const a = angTo(L.x, L.y, L.tx, L.ty), d = Math.hypot(L.tx - L.x, L.ty - L.y) + 160;
      L.warn = this.addWarn({ kind: 'line', x: L.x, y: L.y, a, len: d, w: 34, tWarn: L.omen, beam: 0, silent: true, hidden: true }); // 扑咬路线：危险色的箭头线（drawLurks 画）
    } else {
      L.omen = LURK.closeOmen; L.depth = LURK.closeDepth;
    }
    this.lurks.push(L);
    Sound.sfx(this.lurkInfo(L).tell, { pan: this.pan(L.x || W / 2) });
    if (teach) { const I = this.lurkInfo(L); this.emit('lurkTeach', { name: I.name, hint: I.hint, color: I.color }); }
    return L;
  },
  updateLurks(dt) {
    if (!this.lurks || !this.lurks.length) return;
    const top = this.arena.top, bot = this.arena.bottom;
    for (const L of this.lurks) {
      L.t += dt;
      const e = L.e;
      if (L.st === 'omen') {
        if (L.t < L.omen) continue;
        L.t = 0; this.noteSide(L.side);
        if (L.kind === 'hand') { L.st = 'reach'; L.e = this.addEnemy('lurk', { x: L.x, y: L.edgeY, path: 'fixed', fodder: true, lurk: L.id, look: L.look, part: 'hand', from: L.from, r: 32, hp: LURK.handHp * L.hpK, shownT: this.t - L.omen }); Sound.sfx('bite', { pan: this.pan(L.x) }); }
        else if (L.kind === 'wake') { L.st = 'lunge'; const a = angTo(L.x, L.y, L.tx, L.ty); L.vx = Math.cos(a) * 560; L.vy = Math.sin(a) * 560; L.e = this.addEnemy('lurk', { x: L.x, y: L.y, path: 'fixed', fodder: true, lurk: L.id, look: L.look, part: 'wake', r: 26, hp: LURK.wakeHp * L.hpK, shownT: this.t - L.omen }); Sound.sfx('bite', { pan: this.pan(L.x) }); }
        else {
          L.st = 'hold'; this.arenaTarget = { top: TOP + L.depth, bottom: BOTTOM - L.depth };
          L.seals = [-1, 1].map((s) => this.addEnemy('lurk', { x: this.W * 0.62, y: s < 0 ? TOP + L.depth - 6 : BOTTOM - L.depth + 6, path: 'fixed', fodder: true, lurk: L.id, look: L.look, part: 'seal', nocontact: true, r: 30, hp: LURK.sealHp * L.hpK, shownT: this.t - L.omen }));
          Sound.sfx('riftOpen'); this.shake(0.25);
        }
        continue;
      }
      if (L.kind === 'hand') {
        if (!e || !e.alive) { if (L.st !== 'done') L.st = 'done'; continue; }
        if (L.st === 'reach') { const u = Math.min(1, L.t / 0.35); e.y = lerp(L.edgeY, L.reachY, Ease.outBack(u)); e.grip = 0; if (u >= 1) { L.st = 'grab'; L.t = 0; } }
        else if (L.st === 'grab') { const k = Math.min(1, L.t / 0.45); e.grip = k; e.x = lerp(L.x, L.grabX, Ease.inOutCubic ? Ease.inOutCubic(k) : k); e.y = L.reachY + Math.sin(L.t * 9) * 4; if (L.t > 1.2) { L.st = 'retract'; L.t = 0; } }
        else if (L.st === 'retract') { const k = Math.min(1, L.t / 0.5); e.x = lerp(L.grabX, L.x, k); e.y = lerp(L.reachY, L.edgeY, k); if (L.t >= 0.5) { e.alive = false; L.st = 'done'; this.lurkDodged(L); } }
      } else if (L.kind === 'wake') {
        if (!e || !e.alive) { L.st = 'done'; continue; }
        if (L.st === 'lunge') { e.x += L.vx * dt; e.y = clamp(e.y + L.vy * dt, top + 20, bot - 20); if (L.t > 0.75) { L.st = 'hover'; L.t = 0; } }
        else if (L.st === 'hover') { e.x -= 40 * dt; e.y += Math.sin(this.t * 3 + L.id) * 30 * dt; if (L.t > 2.6) { L.st = 'flee'; L.t = 0; } }
        else if (L.st === 'flee') { e.x -= 340 * dt; if (e.x < -60) { e.alive = false; L.st = 'done'; this.lurkDodged(L); } }
      } else if (L.kind === 'close') {
        const alive = L.seals.filter((s) => s.alive).length;
        if (alive === 0 && L.st === 'hold') { L.st = 'open'; L.t = 0; this.lurkBonus(this.W * 0.62, (TOP + BOTTOM) / 2, 1.5); for (const sy of [TOP + L.depth, BOTTOM - L.depth]) for (let i = 0; i < 18; i++) this.part(L.look === 'paper' ? 'plate' : 'shard', rand(0, this.W), sy, rand(-160, 160), (sy < LH / 2 ? -1 : 1) * rand(120, 360), 0.9, rand(10, 22), L.look === 'paper' ? '#fff1d6' : '#ffcf7a'); this.text(`${this.lurkInfo(L).name}被撑开了！`, this.W * 0.5, (TOP + BOTTOM) / 2 - 60, this.lurkInfo(L).color, 20, 5); }
        if (L.st === 'hold' && L.t > LURK.closeHold) { L.st = 'open'; L.t = 0; for (const s of L.seals) s.alive = false; }
        if (L.st === 'open') { this.arenaTarget = { top: TOP, bottom: BOTTOM }; if (L.t > 1.6) L.st = 'done'; }
      }
    }
    this.lurks = this.lurks.filter((L) => L.st !== 'done');
  },
  /* 躲开了（这一下没伤到任何人）：飞机旁一点闪光和一句字 */
  lurkDodged(L) {
    if (L.hit) return;
    this.m.lurkDodges = (this.m.lurkDodges || 0) + 1;
    const p = this.me; if (!p || !p.alive) return;
    this.text('躲开了！', p.x, p.y - 44, '#9ff2c8', 18, 3);
    for (let i = 0; i < 8; i++) this.part('spark', p.x, p.y, rand(-160, 160), rand(-160, 60), 0.4, 3, '#9ff2c8');
  },
  /* 打碎地图伸出来的东西：一把大星砂 + 一截大招（多人时每人一份） */
  onLurkKilled(e) {
    this.m.lurkKills = (this.m.lurkKills || 0) + 1;
    if (e.part === 'seal') { this.fx(e.x, e.y, 2, 70, ['#fff6c8', '#ffcf7a', '#ffffff']); return; } // 封印：两个都碎了才算撑开，奖励在 updateLurks 里给
    this.lurkBonus(e.x, e.y, 1);
    const L = this.lurks && this.lurks.find((q) => q.id === e.lurk);
    if (L) this.text(e.part === 'hand' ? `打碎了${this.lurkInfo(L).name}！` : `打掉了${this.lurkInfo(L).name}！`, e.x, e.y - 50, this.lurkInfo(L).color, 19, 5);
  },
  lurkBonus(x, y, k) {
    for (let i = 0; i < Math.round(LURK.reward * k); i++) this.dropPickup('dust', x + srand(-20, 20), y + srand(-20, 20), { value: 3, big: true, vx: srand(-220, 160), vy: srand(-380, -140) });
    for (const q of this.players) if (!q.gone && q.alive) this.withPlayer(q, () => this.addCharge(0.12 * k));
    this.text(`+${Math.round(LURK.reward * k) * 3} 星砂`, x, y - 18, '#ffe38a', 22, 4); // 奖励当场弹出来：打碎它值多少一眼看见
    this.fx(x, y, 2, 90, ['#ffe38a', '#fff6c8', HAZ]);
    this.hitStop(0.04); Sound.sfx('eliteKill', { pan: this.pan(x), gap: 0 });
  },
  /* 先兆和手臂 / 墙（画在敌人下面；手掌、扑咬的装饰、封印是真敌人，由 EnemyArt.lurk 画）。
     统一的危险语言：危险色 HAZ 的虚线框 / 箭头线，来源那一侧的屏幕边缘闪“！” */
  drawLurks(g) {
    if (!this.lurks || !this.lurks.length) return;
    const t = this.t, pulse = 0.55 + 0.45 * Math.sin(t * 14);
    const alert = (x, y) => { g.save(); g.translate(x, y); g.globalAlpha = pulse; g.fillStyle = HAZ; g.strokeStyle = PAL.ink; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, -18); g.lineTo(17, 13); g.lineTo(-17, 13); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#ffffff'; g.font = '900 18px "Noto Sans SC", sans-serif'; g.textAlign = 'center'; g.fillText('!', 0, 9); g.restore(); };
    for (const L of this.lurks) {
      const I = this.lurkInfo(L), u = L.st === 'omen' ? clamp(L.t / L.omen, 0, 1) : 1;
      if (L.kind === 'hand') {
        const edge = L.from > 0 ? BOTTOM : TOP;
        if (L.st === 'omen') { // 先兆：危险色的柱子标出会伸到哪里、横向箭头标出会往哪边抓；边缘闪“！”；根部冒泡 / 起皱 / 齿轮转；指尖探出来抽动
          const yA = Math.min(edge, L.reachY), yB = Math.max(edge, L.reachY);
          g.save(); g.globalAlpha = 0.2 + 0.25 * u; g.fillStyle = HAZ; g.fillRect(L.x - 40, yA, 80, yB - yA); g.restore();
          g.save(); g.strokeStyle = HAZ; g.lineWidth = 3; g.setLineDash([10, 8]); g.lineDashOffset = -t * 50; g.strokeRect(L.x - 40, yA, 80, yB - yA);
          g.beginPath(); g.moveTo(L.x - 40, L.reachY); g.lineTo(L.grabX - 30, L.reachY); g.stroke(); g.setLineDash([]);
          g.fillStyle = HAZ; g.beginPath(); g.moveTo(L.grabX - 44, L.reachY); g.lineTo(L.grabX - 26, L.reachY - 11); g.lineTo(L.grabX - 26, L.reachY + 11); g.closePath(); g.fill(); g.restore();
          alert(L.x, L.from > 0 ? BOTTOM - 30 : TOP + 30);
          if (L.look === 'tide') { for (let i = 0; i < 5; i++) { const k = (t * 1.6 + i / 5) % 1; g.strokeStyle = `rgba(190,235,255,${(1 - k) * 0.8})`; g.lineWidth = 2; g.beginPath(); g.ellipse(L.x, edge - 6, 20 + k * 50, 6 + k * 10, 0, Math.PI, TAU); g.stroke(); } for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(200,240,255,0.8)'; g.beginPath(); g.arc(L.x + Math.sin(t * 7 + i * 2) * 26, edge - 10 - ((t * 60 + i * 23) % 50), 4, 0, TAU); g.fill(); } }
          else if (L.look === 'paper') { g.strokeStyle = 'rgba(255,241,214,0.85)'; g.lineWidth = 2; g.beginPath(); for (let i = -3; i <= 3; i++) { g.moveTo(L.x + i * 12, edge); g.lineTo(L.x + i * 12 + Math.sin(t * 20 + i) * 4, edge + 18 + u * 14); } g.stroke(); }
          else { g.save(); g.translate(L.x, edge + 16); g.rotate(t * (4 + u * 10)); g.strokeStyle = 'rgba(255,215,106,0.9)'; g.lineWidth = 3; g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; g.moveTo(Math.cos(a) * 14, Math.sin(a) * 14); g.lineTo(Math.cos(a) * 24, Math.sin(a) * 24); } g.stroke(); g.restore(); }
          const peek = 10 + u * 16 + Math.sin(t * 30) * 3 * u;
          g.fillStyle = I.color; g.strokeStyle = PAL.ink; g.lineWidth = 2;
          for (let i = -1; i <= 1; i++) { g.beginPath(); g.ellipse(L.x + i * 13, edge - L.from * peek * 0.5, 6, peek * 0.6, 0, 0, TAU); g.fill(); g.stroke(); }
        } else if (L.e && L.e.alive) { // 手臂：从屏幕边缘连到手掌，危险色的描边光
          const y0 = L.from > 0 ? LH + 40 : -40, ey = L.e.y + L.from * 30, wob = Math.sin(t * 6) * 6, ex = L.e.x;
          const arm = () => { g.beginPath(); g.moveTo(L.x - 34, y0); g.quadraticCurveTo(L.x - 30 + wob, (y0 + ey) / 2, ex - 20, ey); g.lineTo(ex + 20, ey); g.quadraticCurveTo(L.x + 30 + wob, (y0 + ey) / 2, L.x + 34, y0); g.closePath(); };
          g.save(); g.strokeStyle = hexA(HAZ, 0.75); g.lineWidth = 10; arm(); g.stroke(); g.restore();
          g.fillStyle = I.color; g.strokeStyle = PAL.ink; g.lineWidth = 3; arm(); g.fill(); g.stroke();
          g.strokeStyle = hexA('#ffffff', 0.4); g.lineWidth = 5; g.beginPath(); g.moveTo(L.x - 16, y0); g.quadraticCurveTo(L.x - 14 + wob, (y0 + ey) / 2, ex - 8, ey); g.stroke();
          const edgeY = L.from > 0 ? BOTTOM : TOP;
          g.fillStyle = L.look === 'tide' ? 'rgba(210,245,255,0.9)' : L.look === 'paper' ? 'rgba(255,248,232,0.95)' : 'rgba(255,215,106,0.9)';
          for (let i = 0; i < 7; i++) { const a = Math.PI + (i / 6) * Math.PI, r = 44 + Math.sin(t * 8 + i) * 5; g.beginPath(); g.arc(L.x + Math.cos(a) * r, edgeY - L.from * Math.abs(Math.sin(a)) * 14, 7, 0, TAU); g.fill(); }
          glowAt(g, L.e.x, L.e.y, 60, hexA(HAZ, 0.8), 0.45);
        }
      } else if (L.kind === 'wake' && L.st === 'omen') { // 先兆：装饰放大、抖动、发危险色的光、慢慢睁眼；危险色的箭头线标出扑咬路线
        const ex = L.tx + (L.tx - L.x) * 0.15, ey = L.ty + (L.ty - L.y) * 0.15;
        g.save(); g.strokeStyle = HAZ; g.globalAlpha = 0.5 + 0.5 * u; g.lineWidth = 6; g.setLineDash([16, 10]); g.lineDashOffset = -t * 70; g.beginPath(); g.moveTo(L.x, L.y); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
        const a = Math.atan2(ey - L.y, ex - L.x); g.fillStyle = HAZ; g.beginPath(); g.moveTo(ex + Math.cos(a) * 18, ey + Math.sin(a) * 18); g.lineTo(ex + Math.cos(a + 2.5) * 18, ey + Math.sin(a + 2.5) * 18); g.lineTo(ex + Math.cos(a - 2.5) * 18, ey + Math.sin(a - 2.5) * 18); g.closePath(); g.fill(); g.restore();
        g.save(); g.translate(L.x + Math.sin(t * 40) * 3 * u, L.y); g.scale(1.6, 1.6);
        glowAt(g, 0, 0, 44, hexA(HAZ, 0.85), 0.35 + 0.5 * u);
        EnemyArt.lurk(g, { part: 'wake', look: L.look, eye: u, r: 26 }, t);
        g.restore();
        alert(clamp(L.x, 30, this.W - 30), L.y - TOP < 110 ? L.y + 72 : L.y - 72); // “！”挂在装饰头上，不压住它的脸
      } else if (L.kind === 'close') { // 先兆：上下边缘起危险色折痕 + 闪“！”；合拢期间画两面墙（边缘危险色）
        const d = L.st === 'omen' ? 0 : L.st === 'hold' ? Math.min(1, L.t / 0.6) * L.depth : Math.max(0, 1 - L.t / 0.8) * L.depth;
        for (const s of [-1, 1]) {
          const y0 = s < 0 ? TOP : BOTTOM, yw = s < 0 ? TOP + d : BOTTOM - d;
          if (L.st === 'omen') { g.strokeStyle = hexA(HAZ, 0.5 + 0.5 * u); g.lineWidth = 4; g.beginPath(); for (let x = 0; x <= this.W; x += 40) { const yy = y0 - s * (10 + ((x / 40) % 2) * 14 * u); if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy); } g.stroke(); alert(this.W * 0.5, y0 - s * 34); continue; }
          g.fillStyle = L.look === 'paper' ? 'rgba(250,236,210,0.92)' : 'rgba(120,70,40,0.92)'; g.fillRect(0, Math.min(y0, yw), this.W, Math.abs(yw - y0));
          if (L.look === 'paper') { g.strokeStyle = 'rgba(180,150,120,0.6)'; g.lineWidth = 2; for (let x = 20; x < this.W; x += 60) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x + 30, yw); g.stroke(); } }
          else { g.fillStyle = '#ffcf7a'; for (let x = ((t * 60) % 40) - 40; x < this.W; x += 40) { g.beginPath(); g.moveTo(x, yw); g.lineTo(x + 12, yw + s * 14); g.lineTo(x + 24, yw); g.closePath(); g.fill(); } }
          g.strokeStyle = HAZ; g.lineWidth = 4; g.beginPath(); g.moveTo(0, yw); g.lineTo(this.W, yw); g.stroke();
        }
      }
    }
  },
});
/* 受伤越重裂纹越多：看得出它打得碎、快碎了 */
function lurkCracks(g, e, r) {
  if (!e.maxHp || e.hp >= e.maxHp) return;
  const n = Math.ceil((1 - Math.max(0, e.hp) / e.maxHp) * 4);
  g.save(); g.strokeStyle = PAL.ink; g.lineWidth = 2.2; g.lineCap = 'round';
  for (let i = 0; i < n; i++) { const a = i * 1.9 + 0.4; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.15, Math.sin(a) * r * 0.15); g.lineTo(Math.cos(a + 0.35) * r * 0.5, Math.sin(a + 0.35) * r * 0.5); g.lineTo(Math.cos(a - 0.1) * r * 0.85, Math.sin(a - 0.1) * r * 0.85); g.stroke(); }
  g.restore();
}
/* 手掌 / 扑咬的装饰 / 封印 */
EnemyArt.lurk = (g, e, t) => {
  const I = LURK_INFO[`${e.part === 'seal' ? 'close' : e.part === 'hand' ? 'hand' : 'wake'}:${e.look}`] || LURK_INFO['hand:tide'];
  g.strokeStyle = PAL.ink; g.lineWidth = 2.4; g.lineJoin = 'round';
  if (e.part === 'hand') { // 手掌：五指张开，抓住时收拢
    const k = e.grip || 0, s = e.from > 0 ? 1 : -1; g.scale(1, s); // 从下面伸上来：手指朝上
    g.save(); g.strokeStyle = hexA(HAZ, 0.85); g.lineWidth = 9; g.beginPath(); g.ellipse(0, 0, 31, 29, 0, 0, TAU); g.stroke(); g.restore(); // 手掌一圈危险色的光：一眼看出是敌人
    g.fillStyle = I.color; g.lineWidth = 2.6;
    for (let i = 0; i < 4; i++) { const a = (-0.62 + (i / 3) * 1.24) * (1 - k * 0.55), tip = -62 + k * 19; g.save(); g.rotate(a); g.beginPath(); g.ellipse(0, -40 + k * 12, 9, 22 - k * 7, 0, 0, TAU); g.fill(); g.stroke(); g.fillStyle = HAZ; g.beginPath(); g.moveTo(-6, tip + 3); g.lineTo(6, tip + 3); g.lineTo(0, tip - 10); g.closePath(); g.fill(); g.stroke(); g.fillStyle = I.color; g.restore(); } // 四根手指张开（指尖是危险色的爪），抓住时收拢
    g.save(); g.rotate(-1.25 + k * 0.6); g.beginPath(); g.ellipse(0, -30, 8, 17, 0, 0, TAU); g.fill(); g.stroke(); g.restore(); // 拇指
    g.beginPath(); g.ellipse(0, 0, 30, 28, 0, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(0, 2 * s, 11, 9 * (1 - k * 0.5), 0, 0, TAU); g.fill(); g.stroke(); // 手心里一只眼睛
    g.fillStyle = '#d23a52'; g.beginPath(); g.arc(0, 2 * s, 5 * (1 - k * 0.5), 0, TAU); g.fill(); // 红色的瞳孔
    g.lineWidth = 3; g.beginPath(); g.moveTo(-13, -9 * s); g.lineTo(-2, -5 * s); g.moveTo(13, -9 * s); g.lineTo(2, -5 * s); g.stroke(); // 皱眉
    lurkCracks(g, e, 30);
    return;
  }
  if (e.part === 'seal') { // 封印 / 齿轮心：发光的结
    glowAt(g, 0, 0, 54, hexA(HAZ, 0.9), 0.6 + Math.sin(t * 8) * 0.25); // 打得掉的点：发危险色的光
    g.save(); g.strokeStyle = HAZ; g.lineWidth = 3.5; g.globalAlpha = 0.55 + 0.45 * Math.sin(t * 8); g.beginPath(); g.arc(0, 0, 31 + Math.sin(t * 8) * 4, 0, TAU); g.stroke(); g.restore(); // 一圈跳动的危险色：在米色纸页上也看得见
    g.fillStyle = HAZ; g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + t * 1.5, r = i % 2 ? 12 : 23; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill();
    lurkCracks(g, e, 22);
    return;
  }
  // 醒来的装饰：灯笼 / 纸船 / 小钟，睁眼、长牙
  const eye = e.eye === undefined ? 1 : e.eye;
  if (e.look === 'lantern') { g.fillStyle = '#ffb35c'; g.beginPath(); g.ellipse(0, 0, 20, 24, 0, 0, TAU); g.fill(); g.stroke(); g.fillStyle = '#7a3b1d'; g.fillRect(-10, -28, 20, 6); g.fillRect(-10, 22, 20, 6); }
  else if (e.look === 'boat') { g.fillStyle = '#fff1d6'; g.beginPath(); g.moveTo(-30, -2); g.lineTo(30, -2); g.lineTo(20, 18); g.lineTo(-20, 18); g.closePath(); g.fill(); g.stroke(); g.beginPath(); g.moveTo(0, -2); g.lineTo(0, -28); g.lineTo(-18, -2); g.closePath(); g.fill(); g.stroke(); }
  else { g.fillStyle = '#ffd9f2'; g.beginPath(); g.arc(0, 0, 24, 0, TAU); g.fill(); g.stroke(); g.strokeStyle = 'rgba(90,30,100,0.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(t * 6) * 16, Math.sin(t * 6) * 16); g.stroke(); g.strokeStyle = PAL.ink; }
  if (eye > 0.1) { g.fillStyle = '#ffffff'; for (const x of [-8, 8]) { g.beginPath(); g.ellipse(x, -4, 5, 5 * eye, 0, 0, TAU); g.fill(); g.stroke(); } g.fillStyle = '#d23a52'; for (const x of [-8, 8]) { g.beginPath(); g.arc(x - 1, -4, 2.2 * eye, 0, TAU); g.fill(); } }
  if (eye > 0.6) { g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(-12, 8); for (let i = 0; i < 6; i++) g.lineTo(-12 + i * 4.8 + 2.4, i % 2 ? 8 : 15); g.lineTo(12, 8); g.closePath(); g.fill(); g.stroke(); }
  lurkCracks(g, e, 24);
};
