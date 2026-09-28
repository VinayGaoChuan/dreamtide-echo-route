'use strict';
/* 梦潮：回声航线 v0.8 — 场景惊喜。每个都先给看得见的线索，再变身，变身后能用直射解决，结束后场景留下痕迹。
   1-1 月亮怪：月亮眨眼、影子移动、缺口在转 → 脱离天空长出牙和手 → 先打碎嘴边四块碎片再打核心 → 天空留下裂缝，碎片变成光环航道 + 重要升级。
   1-2 贴纸拟态：HUD 旁边的装饰贴纸晃动、长眼睛、卷边 → 撕下来跳进战场 → 先预警再咬 → 可攻击。真正的血条 / 暂停 / 大招库存 / 按键提示始终可靠。
   1-3 拟态梦灯屋：窗户跟着心跳闪、烟囱像在呼吸、门缝有牙 → 醒来长腿 → 打倒后奖励照样拿（不会出现在教学用的第一间屋）。
   一局最多一个主要惊喜；和升级仪式互斥，不同时发生。 */

const MOON_TEETH = [[-92, -66], [-106, -22], [-106, 22], [-92, 66]];

Object.assign(World.prototype, {
  startSurprise(kind) {
    this.surprise = { kind, st: 'clue', t: 0, busy: false, done: false, title: null, prog: null, sub: null, guide: null, parts: [] };
    if (kind === 'moon') { this.scene.moonFx = { blink: 0, notch: 0, shade: 0, gone: false, rift: false }; this.surprise.title = '月亮不太对劲…'; this.surprise.sub = '抬头看看天上的月亮'; }
    if (kind === 'mimic') { const S = this.surprise; S.title = '角落的贴纸在动？'; S.sub = '右上角那张星星贴纸'; S.sx = this.W - 240; S.sy = TOP + 46; }
    if (kind === 'houseMimic') { const S = this.surprise; S.title = '这间梦灯屋怪怪的'; S.sub = '窗户在跟着心跳闪'; S.hx = this.W + 200; S.hy = (this.arena.top + this.arena.bottom) / 2 + 40; }
  },
  updateSurprise(dt) {
    const S = this.surprise; if (!S || S.done || this.phase !== 'fight') return;
    S.t += dt;
    if (S.kind === 'moon') this.updMoon(S, dt);
    else if (S.kind === 'mimic') this.updMimic(S, dt);
    else if (S.kind === 'houseMimic') this.updHouseMimic(S, dt);
  },
  surpriseTo(S, st) { S.st = st; S.t = 0; },

  /* ---------- 月亮怪 ---------- */
  updMoon(S, dt) {
    const F = this.scene.moonFx, mid = (this.arena.top + this.arena.bottom) / 2, p = this.player;
    if (S.st === 'clue') {
      F.blink = (S.t % 1.7) < 0.18 ? 1 : 0; F.notch += dt * 1.4; F.shade = clamp(S.t / 7, 0, 1);
      if (S.t > 3 && !S.said) { S.said = true; this.text('月亮刚刚……眨了一下眼？', this.W * 0.4, LH * 0.2 + 90, '#dcd0ff', 18, 4); Sound.sfx('moonBlink'); }
      if (S.t > 7 && !this.ritual) { this.surpriseTo(S, 'detach'); S.busy = true; this.clearBullets(true); Sound.sfx('moonDetach'); this.shake(0.3); this.rumble(0.5, 0.3, 300); S.title = '月亮掉下来了！'; S.sub = null; }
    } else if (S.st === 'detach') {
      const u = Ease.inOutCubic ? Ease.inOutCubic(clamp(S.t / 2.2, 0, 1)) : clamp(S.t / 2.2, 0, 1);
      F.gone = true;
      S.mx = lerp(this.W * 0.4, this.W * 0.74, u); S.my = lerp(LH * 0.2, mid, u); S.r = lerp(60, 105, u); S.grow = u;
      if (S.t > 2.2) {
        this.surpriseTo(S, 'fight'); S.busy = false; S.atkT = 2.2; S.atk = 0;
        S.core = this.addEnemy('mcore', { elite: true, x: S.mx, y: S.my, path: 'fixed', guarded: true, sup: true, portrait: 'moon' });
        S.parts = MOON_TEETH.map((o, i) => this.addEnemy('mtooth', { elite: true, x: S.mx + o[0], y: S.my + o[1], path: 'fixed', sup: true, k: i }));
        for (const e of [S.core, ...S.parts]) { e.goal = true; this.goal && this.goal.targets.push(e.id); }
        if (this.cb.onSeenEnemy) this.cb.onSeenEnemy('mcore');
        S.title = '打碎月亮嘴边的碎片';
      }
    } else if (S.st === 'fight') {
      S.mx = this.W * 0.74 + Math.sin(S.t * 0.5) * 30; S.my = mid + Math.sin(S.t * 0.7) * 70; S.r = 105;
      const teeth = S.parts.filter((e) => e.alive);
      S.parts.forEach((e, i) => { if (e.alive) { e.x = S.mx + MOON_TEETH[i][0]; e.y = S.my + MOON_TEETH[i][1]; } });
      if (S.core.alive) { S.core.x = S.mx - 10; S.core.y = S.my; S.core.guarded = teeth.length > 0; }
      S.prog = teeth.length ? { type: 'count', n: 4 - teeth.length, total: 4 } : { type: 'hp', u: S.core.hp / S.core.maxHp };
      S.title = teeth.length ? '打碎月亮嘴边的碎片' : '碎片没了 · 打月亮的核心';
      S.sub = teeth.length ? '碎片在不同高度，对准了打' : '核心露出来了';
      if (!teeth.length && !S.exposed) { S.exposed = true; Sound.sfx('weakOpen'); this.text('核心露出来了！', S.mx, S.my - 140, '#fff3c8', 22, 5); }
      // 攻击：咬（先画出一条航道预警）/ 手臂甩出扇形弹
      if (!this.ritual) S.atkT -= dt;
      if (S.atkT <= 0 && this.state === 'play') {
        S.atkT = teeth.length ? 3.3 : 2.8; S.atk++;
        if (S.atk % 2) {
          const y = clamp(p.y, this.arena.top + 60, this.arena.bottom - 60), h = 104;
          this.addWarn({ kind: 'zone', x: 0, y: y - h / 2, w: S.mx - 80, h, tWarn: 1.0, onFire: () => { S.bite = 0.5; for (let i = 0; i < 8; i++) this.fire('pink', S.mx - 100, y + (i - 3.5) * 12, Math.PI, 430, { silent: i > 0 }); Sound.sfx('bite'); } });
          this.text('要咬了 · 离开那条航道', S.mx - 160, y - 64, '#ffb2a8', 16, 3);
        } else for (const s of [-1, 1]) this.later(s > 0 ? 0.35 : 0, () => { if (!S.core.alive) return; const ax = S.mx - 20, ay = S.my + s * 110, a0 = this.aimAngle(ax, ay); for (let i = 0; i < 5; i++) this.fire('gold', ax, ay, a0 + (i - 2) * 0.16, 200, { silent: i > 0 }); });
      }
      S.bite = Math.max(0, (S.bite || 0) - dt);
      if (!S.core.alive) {
        this.surpriseTo(S, 'break'); S.busy = true; this.clearBullets(true); this.warns = [];
        this.fx(S.mx, S.my, 5, 420, ['#f6f0ff', '#cfc2ff', '#ffe38a']); this.hitStop(0.06); this.shake(0.8); this.rumble(1, 0.7, 260); Sound.sfx('moonBreak', { prio: true });
        this.scene.moonFx.rift = true; this.remember('打碎了会咬人的月亮', 5);
        S.title = '月亮碎了'; S.prog = null; S.sub = null;
      }
    } else if (S.st === 'break') {
      if (S.t > 1.3) {
        this.surpriseTo(S, 'rings'); S.busy = false;
        const y0 = clamp(p.y, this.arena.top + 120, this.arena.bottom - 120);
        S.rings = [[0.44, -50], [0.58, 40], [0.72, -30]].map(([k, dy]) => ({ x: this.W * k, y: clamp(y0 + dy, this.arena.top + 80, this.arena.bottom - 80), lit: false }));
        S.title = '穿过月光碎片变成的光环'; S.prog = { type: 'count', n: 0, total: 3 };
        this.text('碎片变成了光环航道', this.W * 0.56, y0 - 110, '#fff3c8', 20, 5);
      }
    } else if (S.st === 'rings') {
      let lit = 0;
      for (const r of S.rings) { r.x -= 26 * dt; if (!r.lit && p.alive && dist2(p.x, p.y, r.x, r.y) < 56 * 56) { r.lit = true; Sound.sfx('ringPass', { k: S.rings.filter((q) => q.lit).length - 1 }); this.fx(r.x, r.y, 2, 70, ['#fff3c8', '#ffd76a', '#dcd0ff']); this.addCharge(0.1, true); } if (r.lit) lit++; }
      S.prog = { type: 'count', n: lit, total: 3 };
      const next = S.rings.find((r) => !r.lit); S.guide = next ? { x: next.x, y: next.y } : null;
      if ((lit === 3 || S.t > 12) && !S.queued) {
        S.queued = true; const last = S.rings[2];
        this.queueRitual('moon', { full: true, q: 2, rare: lit === 3, x: last.x, y: last.y, device: 'crystal', obj: { onRitual: () => { S.done = true; S.guide = null; this.text('天上的裂缝里，好像就是 Boss 的入口', this.W * 0.42, LH * 0.2 + 100, '#ffd76a', 18, 5); } } });
        S.title = '月光碎片 · 重要升级'; S.prog = null;
      }
    }
  },
  /* ---------- 贴纸拟态 ---------- */
  updMimic(S, dt) {
    const p = this.player, mid = (this.arena.top + this.arena.bottom) / 2;
    if (S.st === 'clue') {
      S.wob = (S.t % 2.2) < 0.35 ? Math.sin(S.t * 40) * 0.2 : 0; S.eyes = clamp((S.t - 3) / 0.6, 0, 1); S.peel = clamp((S.t - 6) / 2, 0, 1);
      if (S.t > 3.2 && !S.said) { S.said = true; Sound.sfx('moonBlink'); S.sub = '它长出眼睛了……'; }
      if (S.t > 9 && !this.ritual) { this.surpriseTo(S, 'peel'); S.busy = true; this.clearBullets(true); Sound.sfx('peel'); S.title = '贴纸撕下来跳进战场了！'; S.sub = null; S.x0 = S.sx; S.y0 = S.sy; }
    } else if (S.st === 'peel') {
      const u = clamp(S.t / 1.2, 0, 1), k = Ease.inOutCubic ? Ease.inOutCubic(u) : u;
      S.mx = lerp(S.x0, this.W * 0.74, k); S.my = lerp(S.y0, mid, k) - Math.sin(u * Math.PI) * 80; S.r = lerp(26, 46, k);
      if (S.t > 1.2) {
        this.surpriseTo(S, 'fight'); S.busy = false; S.atkT = 1.6;
        S.e = this.addEnemy('mimic', { elite: true, x: S.mx, y: S.my, path: 'fixed', sup: true, portrait: 'mimic' });
        this.addTarget(S.e); if (this.cb.onSeenEnemy) this.cb.onSeenEnemy('mimic');
        S.title = '打倒贴纸拟态';
      }
    } else if (S.st === 'fight') {
      const e = S.e;
      if (e.alive) {
        if (S.dash) { // 咬：沿预警过的航道冲过去再回来
          S.dash.t += dt; const u = S.dash.t / 0.9, k = u < 0.5 ? Ease.outCubic(u * 2) : 1 - Ease.inOutSine((u - 0.5) * 2);
          e.x = lerp(this.W * 0.74, this.W * 0.3, k); e.y = S.dash.y; if (u >= 1) S.dash = null;
        } else { e.x = smooth(e.x, this.W * 0.74, 3, dt); e.y = smooth(e.y, mid + Math.sin(S.t * 0.8) * 110, 2, dt); }
        S.prog = { type: 'hp', u: e.hp / e.maxHp };
        if (!this.ritual) S.atkT -= dt;
        if (S.atkT <= 0 && !S.dash && this.state === 'play') {
          S.atkT = 3.4; S.n = (S.n || 0) + 1;
          if (S.n % 2) {
            const y = clamp(p.y, this.arena.top + 60, this.arena.bottom - 60), h = 110;
            this.addWarn({ kind: 'zone', x: this.W * 0.26, y: y - h / 2, w: this.W * 0.5, h, tWarn: 1.0, onFire: () => { if (e.alive) { S.dash = { t: 0, y }; Sound.sfx('bite'); } } });
            S.sub = '它要沿着这条航道咬过来'; e.y = y;
          } else { const a0 = this.aimAngle(e.x, e.y); for (let i = 0; i < 3; i++) this.fire('gold', e.x - 30, e.y, a0 + (i - 1) * 0.22, 210, { silent: i > 0 }); S.sub = '吐出了星星贴纸'; }
        }
      } else {
        S.st = 'reward'; S.t = 0; this.warns = []; S.title = '贴纸拟态被撕掉了'; S.prog = null; S.sub = null;
        this.remember('撕下了会咬人的贴纸', 5);
        this.queueRitual('mimic', { rare: true, x: e.x, y: e.y, device: 'crystal', obj: { onRitual: () => { S.done = true; } } });
      }
    }
  },
  /* ---------- 拟态梦灯屋 ---------- */
  updHouseMimic(S, dt) {
    const p = this.player, mid = (this.arena.top + this.arena.bottom) / 2;
    if (S.st === 'clue') {
      S.hx = smooth(S.hx, this.W * 0.66, 0.9, dt); S.beat = (S.t % 0.9) < 0.12 ? 1 : 0;
      const bx = S.hx - 122, by = S.hy + 36; S.guide = { x: bx, y: by };
      if (S.t > 3.5 && !S.said) { S.said = true; S.sub = '烟囱在呼吸，门缝里好像有牙'; }
      if (((p.alive && dist2(p.x, p.y, bx, by) < 60 * 60) || S.t > 12) && !this.ritual) {
        this.surpriseTo(S, 'wake'); S.busy = true; S.guide = null; this.clearBullets(true); Sound.sfx('houseWake'); this.shake(0.4); this.rumble(0.6, 0.4, 200);
        S.title = '梦灯屋站起来了！'; S.sub = null;
      }
    } else if (S.st === 'wake') {
      S.legs = clamp(S.t / 1.2, 0, 1);
      if (S.t > 1.3) {
        this.surpriseTo(S, 'fight'); S.busy = false; S.atkT = 1.5; S.ty = S.hy;
        S.e = this.addEnemy('hmimic', { elite: true, x: S.hx, y: S.hy - 30, path: 'fixed', sup: true, portrait: 'hmimic' });
        this.addTarget(S.e); if (this.cb.onSeenEnemy) this.cb.onSeenEnemy('hmimic');
        S.title = '打倒拟态梦灯屋 · 奖励照样拿';
      }
    } else if (S.st === 'fight') {
      const e = S.e;
      if (e.alive) {
        S.hy = smooth(S.hy, S.ty, 4, dt); S.hx = smooth(S.hx, this.W * 0.72, 2, dt); e.x = S.hx; e.y = S.hy - 30;
        S.prog = { type: 'hp', u: e.hp / e.maxHp };
        if (!this.ritual) S.atkT -= dt;
        if (S.atkT <= 0 && this.state === 'play') {
          S.atkT = 3.0;
          const ny = pick([this.arena.top + 150, mid + 20, this.arena.bottom - 80].filter((y) => Math.abs(y - S.ty) > 60));
          this.addWarn({ kind: 'zone', x: S.hx - 90, y: ny - 110, w: 180, h: 170, tWarn: 0.9, onFire: () => { if (!e.alive) return; S.ty = ny; this.later(0.4, () => { if (!e.alive) return; const a0 = this.aimAngle(S.hx - 40, ny - 60); for (let i = 0; i < 5; i++) this.fire('pink', S.hx - 40, ny - 60, a0 + (i - 2) * 0.18, 190, { silent: i > 0 }); Sound.sfx('bite'); }); } });
          S.sub = '跳到哪里会先画出落点';
        }
      } else {
        S.st = 'reward'; S.t = 0; this.warns = []; S.title = '拟态梦灯屋倒下了 · 奖励还在'; S.prog = null; S.sub = null;
        this.remember('拆穿了假梦灯屋', 5);
        this.queueRitual('house', { full: true, q: 1, x: S.hx, y: S.hy - 60, device: 'wheel', obj: { onRitual: () => { S.done = true; } } });
      }
    }
  },

  /* ---------- 画 ---------- */
  drawSurprise(g) {
    const S = this.surprise; if (!S) return;
    const t = this.t;
    if (S.kind === 'moon') {
      if (S.st === 'detach' || S.st === 'fight') drawMoonMonster(g, S.mx, S.my, S.r, S.st === 'detach' ? S.grow : 1, t, S.bite || 0, S.core && !S.core.guarded);
      if (S.st === 'rings' && !S.done) for (const r of S.rings) drawLampRing(g, r.x, r.y, 44, t, r.lit, 1);
    } else if (S.kind === 'mimic') {
      if (S.st === 'clue') drawSticker(g, S.sx, S.sy, 26, S.wob || 0, S.eyes || 0, S.peel || 0, t);
      else if (S.st === 'peel') drawSticker(g, S.mx, S.my, S.r, Math.sin(t * 20) * 0.2, 1, 1, t);
    } else if (S.kind === 'houseMimic') {
      if (S.st === 'clue' || S.st === 'wake' || (S.st === 'fight' && S.e && S.e.alive)) drawMimicHouse(g, S.hx, S.hy, t, S.beat || 0, S.st === 'clue' ? 0 : S.legs === undefined ? 1 : S.legs, S.st === 'fight');
      if (S.st === 'clue') { drawBell(g, S.hx - 122, S.hy + 36, 58, 0.6, t); drawStepPill(g, S.hx - 122, S.hy - 30, '碰一下门前的铃铛？', '#ffd76a', 0.9); }
    }
  },
});

/* ---------- 画法 ---------- */
EnemyArt.mtooth = (g, e, t) => {
  const u = 1 - e.hp / e.maxHp;
  g.fillStyle = '#fff8ee'; g.strokeStyle = PAL.ink; g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(14, -20); g.lineTo(-22, 0); g.lineTo(14, 20); g.quadraticCurveTo(22, 0, 14, -20); g.closePath(); g.fill(); g.stroke();
  if (u > 0.3) { g.strokeStyle = '#6b63d6'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(8, -12); g.lineTo(-2, 0); g.lineTo(6, 10); if (u > 0.65) { g.moveTo(-2, 0); g.lineTo(-14, 2); } g.stroke(); }
};
EnemyArt.mcore = (g, e, t) => {
  glowAt(g, 0, 0, 60, e.guarded ? 'rgba(200,190,255,0.5)' : GLOW.gold, 0.7);
  g.fillStyle = '#fff'; g.strokeStyle = PAL.ink; g.lineWidth = 2.6; g.beginPath(); g.ellipse(0, 0, 30, 24, 0, 0, TAU); g.fill(); g.stroke();
  g.fillStyle = e.guarded ? '#6b63d6' : '#ff7a6b'; g.beginPath(); g.arc(-6, 0, 11, 0, TAU); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(-9, -4, 3.5, 0, TAU); g.fill();
  if (e.guarded) { g.strokeStyle = 'rgba(220,210,255,0.8)'; g.lineWidth = 3; g.setLineDash([5, 5]); g.beginPath(); g.arc(0, 0, 40, 0, TAU); g.stroke(); g.setLineDash([]); }
};
EnemyArt.mimic = (g, e, t) => { drawSticker(g, 0, 0, 46, Math.sin(t * 6) * 0.08, 1, 1, t, true); };
EnemyArt.hmimic = () => {}; // 身体由 drawSurprise 画
function drawMoonMonster(g, x, y, r, grow, t, bite, open) {
  g.save(); g.translate(x, y);
  glowAt(g, 0, 0, r * 1.8, 'rgba(200,185,255,0.6)', 0.5);
  // 手臂
  if (grow > 0.5) { g.strokeStyle = PAL.ink; g.lineWidth = 3; g.fillStyle = '#d8ccff'; for (const s of [-1, 1]) { g.save(); g.translate(-10, s * r * 0.9); g.rotate(s * (0.4 + Math.sin(t * 3) * 0.2)); g.beginPath(); g.ellipse(-20, 0, 30 * grow, 12, 0, 0, TAU); g.fill(); g.stroke(); g.restore(); } }
  const mg = g.createRadialGradient(-r * 0.3, -r * 0.3, 8, 0, 0, r); mg.addColorStop(0, '#f6f0ff'); mg.addColorStop(1, '#bfb2f5');
  g.fillStyle = mg; g.strokeStyle = PAL.ink; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill(); g.stroke();
  g.fillStyle = 'rgba(150,130,225,0.5)'; for (const [cx, cy, cr] of [[30, -40, 16], [44, 30, 12], [10, 58, 8], [52, -6, 7]]) { g.beginPath(); g.arc(cx * r / 105, cy * r / 105, cr * r / 105, 0, TAU); g.fill(); }
  // 嘴：左侧一道深色月牙，咬的时候张大
  g.fillStyle = '#2a1f5a'; g.beginPath(); g.ellipse(-r * 0.78, 0, r * (0.2 + bite * 0.3) * grow, r * 0.72 * grow, 0, 0, TAU); g.fill();
  if (open) glowAt(g, -10, 0, 50, GLOW.gold, 0.4 + Math.sin(t * 8) * 0.2);
  g.restore();
}
function drawSticker(g, x, y, r, wob, eyes, peel, t, live) {
  g.save(); g.translate(x, y); g.rotate(wob);
  g.fillStyle = 'rgba(0,0,0,0.25)'; BulletArt.star(g, 3, 4, 5, r, r * 0.52, -Math.PI / 2); g.fill();
  g.fillStyle = '#ffe38a'; g.strokeStyle = '#fff6ee'; g.lineWidth = Math.max(2, r * 0.12); BulletArt.star(g, 0, 0, 5, r, r * 0.52, -Math.PI / 2); g.fill(); g.stroke();
  if (peel > 0) { g.fillStyle = '#e8d8a0'; g.beginPath(); g.moveTo(r * 0.55, r * 0.2); g.lineTo(r * 0.95 * (1 - peel * 0.3), r * 0.5 + peel * 8); g.lineTo(r * 0.35, r * 0.62); g.closePath(); g.fill(); }
  if (eyes > 0) { const blink = (t % 2.6) < 0.14 ? 0.2 : 1; for (const s of [-1, 1]) { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(s * r * 0.22, -r * 0.08, r * 0.14 * eyes, r * 0.18 * eyes * blink, 0, 0, TAU); g.fill(); g.fillStyle = PAL.ink; g.beginPath(); g.arc(s * r * 0.22 - r * 0.04, -r * 0.06, r * 0.07 * eyes, 0, TAU); g.fill(); } }
  if (live) { g.fillStyle = '#5a2330'; g.beginPath(); g.arc(0, r * 0.22, r * 0.18, 0, Math.PI); g.fill(); g.fillStyle = '#fff'; for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(i * r * 0.1 - 3, r * 0.22); g.lineTo(i * r * 0.1, r * 0.3); g.lineTo(i * r * 0.1 + 3, r * 0.22); g.fill(); } }
  g.restore();
}
function drawMimicHouse(g, x, y, t, beat, legs, awake) {
  g.save(); g.translate(x, y + (awake ? Math.abs(Math.sin(t * 3)) * -12 : 0));
  if (legs > 0) { g.strokeStyle = PAL.ink; g.lineWidth = 6; g.lineCap = 'round'; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 40, 30); g.lineTo(s * 52, 30 + 50 * legs); g.stroke(); g.strokeStyle = '#8f82d6'; g.lineWidth = 3; g.stroke(); g.strokeStyle = PAL.ink; g.lineWidth = 6; } }
  drawLampHouse(g, 0, 0, { lit: beat ? 1 : 0.2, done: false, open: 0, turn: Math.sin(t * 2) * 0.3, look: -0.4 }, t);
  // 门缝里的牙 + 屋顶上的眼睛
  g.fillStyle = '#fff'; for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * 7 - 4, 4); g.lineTo(i * 7, 12 + (awake ? 4 : 0)); g.lineTo(i * 7 + 4, 4); g.fill(); }
  if (awake || legs > 0.5) for (const s of [-1, 1]) { g.fillStyle = '#fff'; g.beginPath(); g.arc(s * 20, -96, 9, 0, TAU); g.fill(); g.strokeStyle = PAL.ink; g.lineWidth = 2; g.stroke(); g.fillStyle = '#ff6a8a'; g.beginPath(); g.arc(s * 20 - 3, -95, 4, 0, TAU); g.fill(); }
  g.restore();
}
