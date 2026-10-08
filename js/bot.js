'use strict';
/* 游戏自带的机器人（打包工具的两个客户端联机测试、测试版的联机自检用 K.test.run 让它玩）：和 tools/net-bot.js 的无头联机机器人同一套打法 */
function gameVsBot(w, i) { // 对抗：清自己航道、先打风塔守卫、洞口开了就进、侧风来了换边、冲突区里对准带子里的对手
  const p = w.players[i], V = w.vs, L = V.lanes[i], mid = (L.top + L.bot) / 2, off = w.viewOff || { x: 0, y: 0 }, px = p.x + off.x, py = p.y + off.y;
  let tx = w.W * 0.22, ty = mid, best = null, bd = 1e9;
  for (const e of w.enemies) { if (!e.alive || e.lane !== i || e.x < px + 30 || e.x > w.W) continue; const d = e.x - px + Math.abs(e.y - py) * 0.6 - (e.vsGuard || e.vsInt ? 220 : 0); if (d < bd) { bd = d; best = e; } }
  if (best) ty = best.y;
  const holes = V.holes.filter((h) => h.lane === i && h.st === 'open');
  if (holes.length) { const H = holes.find((h) => h.kind === (V.stage % 2 ? 'wind' : 'armor')) || holes[0]; tx = H.x; ty = H.y; }
  else if (V.clash) { ty = i === 0 ? L.bot + 30 : L.top - 30; const o = w.players.find((q) => q !== p && q.alive && w.vsInBand(q.y)); if (o && w.vsInBand(py)) { ty = o.y; tx = Math.max(60, o.x - 220); } }
  if (L.wind) ty = L.wind.dir > 0 ? Math.min(L.bot - 30, L.wind.bot + 40) : Math.max(L.top + 30, L.wind.top - 40);
  if (w.ritual && w.ritual.st === 'choose') { const g = w.ritual.gates[i % 2]; tx = g.x; ty = g.y; }
  const gain = w.ritual && w.ritual.st === 'choose' ? 120 : 60;
  return { mx: Math.sign(tx - px) * Math.min(1, Math.abs(tx - px) / gain), my: Math.sign(ty - py) * Math.min(1, Math.abs(ty - py) / (gain * 0.7)), burst: p.stock >= 1 && !w.ritual && !w.bursting, focus: false, dx: 0, dy: 0 };
}
function gameBot(w, i) {
  const p = w.players[i]; if (!p || !p.alive) return { mx: 0, my: 0, burst: false };
  if (w.vs) return gameVsBot(w, i);
  const off = w.viewOff || { x: 0, y: 0 }, px = p.x + off.x, py = p.y + off.y, mid = (TOP + BOTTOM) / 2;
  let tx = w.W * 0.22 + i * 30, ty = mid + (i - 0.5) * 60, best = null, bd = 1e9;
  for (const e of w.enemies) { if (!e.alive || e.x < px + 30 || e.x > w.W) continue; const d = e.x - px + Math.abs(e.y - py) * 0.6 - (e.goal ? 260 : 0); if (d < bd) { bd = d; best = e; } }
  if (best) ty = best.y + (i - 0.5) * 24;
  if (w.boss && w.boss.plates) { const pl = w.boss.plates.find((q) => q.alive); if (pl) ty = w.boss.y + pl.dy; }
  const gt = w.guideTarget(); if (gt && (i === 0 || i === w.beatIdx % w.players.length) && !(w.ritual && w.ritual.st === 'choose')) { tx = Math.min(gt.x - 6, w.W * 0.8); ty = gt.y; }
  const tow = w.mapObjs.find((o) => o.state === 'tow' && o.by === i); if (tow && !(w.ritual && w.ritual.st === 'choose')) { const g2 = w.mapGoalPos(tow); if (g2) { tx = Math.min(g2.x - 6, w.W * 0.8); ty = g2.y; } } // 自己拖着的东西自己送到
const mate = w.players.find((q) => q !== p && !q.alive && !q.gone); if (mate && !w.ritual) { tx = mate.x; ty = mate.y; } // 队友倒下：飞进救援圈
if (w.ritual && w.ritual.st === 'choose') { const g = w.ritual.gates[i % 2]; tx = g.x; ty = g.y; }
  const gain = w.ritual && w.ritual.st === 'choose' ? 120 : 60;
  return { mx: Math.sign(tx - px) * Math.min(1, Math.abs(tx - px) / gain), my: Math.sign(ty - py) * Math.min(1, Math.abs(ty - py) / (gain * 0.7)), burst: p.stock >= 1 && !w.ritual && !w.bursting, focus: false, dx: 0, dy: 0 };
}
