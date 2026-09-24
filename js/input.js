'use strict';
/* 梦潮：回声航线 — 只有两个操作：拖动飞机 + 一个爆发键。键鼠 / 手柄 / 触屏走同一套动作。 */

const Input = (() => {
  const DEFAULT_BINDS = {
    up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    burst: ['Space', 'KeyJ'], focus: ['ShiftLeft', 'ShiftRight'], pause: ['Escape', 'KeyP'],
  };
  const ACTION_NAMES = { up: '上移', down: '下移', left: '左移', right: '右移', burst: '爆发（专属大招）', focus: '慢速精确飞行', pause: '暂停' };
  let binds = JSON.parse(JSON.stringify(DEFAULT_BINDS));
  const held = new Set(), presses = {}, nav = {};
  let device = 'kbm', onDevice = null, gameActive = false, rebind = null, keyboardNav = false;
  const drag = { id: null, lx: 0, ly: 0, dx: 0, dy: 0, lastTap: 0, tapX: 0, tapY: 0, downT: 0 };
  const pad = { prev: [], navT: 0, navDir: '', mx: 0, my: 0, focus: false };
  const out = { mx: 0, my: 0, focus: false, dragging: false };

  function setDevice(d) { if (d !== device) { device = d; if (onDevice) onDevice(d); } }
  function press(a) { presses[a] = performance.now(); }
  function consume(a, buffer = 150) { const t = presses[a]; if (t && performance.now() - t <= buffer) { presses[a] = 0; return true; } return false; }
  function clearPresses() { for (const k in presses) presses[k] = 0; for (const k in nav) nav[k] = 0; drag.dx = drag.dy = 0; }
  function navPress(d) { nav[d] = performance.now(); }
  function consumeNav(d) { const t = nav[d]; if (t && performance.now() - t < 200) { nav[d] = 0; return true; } return false; }
  function actionsFor(code) { const r = []; for (const a in binds) if (binds[a].includes(code)) r.push(a); return r; }
  function isHeld(a) { for (const c of binds[a]) if (held.has(c)) return true; return false; }

  window.addEventListener('keydown', (e) => {
    if (rebind) {
      e.preventDefault();
      if (e.code !== 'Escape') { const a = rebind.action; binds[a] = [e.code, ...binds[a].filter((c) => c !== e.code).slice(0, 1)]; }
      const cb = rebind.cb; rebind = null; if (cb) cb(binds); return;
    }
    setDevice('kbm'); keyboardNav = true;
    const acts = actionsFor(e.code);
    if (gameActive && acts.length) e.preventDefault();
    if (!e.repeat) { held.add(e.code); for (const a of acts) press(a); }
    if (!gameActive) {
      const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Escape: 'back' };
      if (map[e.code]) { navPress(map[e.code]); if (e.code !== 'Escape') e.preventDefault(); }
    }
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => { held.clear(); drag.id = null; });
  window.addEventListener('pointerdown', (e) => {
    keyboardNav = false;
    if (e.pointerType === 'touch' || e.pointerType === 'pen') setDevice('touch'); else if (e.pointerType === 'mouse') setDevice('kbm');
  }, true);

  /* 拖动飞机：在画面任意空白处按下并拖动，飞机按相同距离移动（相对拖动，手指不会挡住飞机） */
  function bindDrag(el) {
    el.addEventListener('pointerdown', (e) => {
      if (!gameActive || drag.id !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      drag.id = e.pointerId; drag.lx = e.clientX; drag.ly = e.clientY; drag.downT = performance.now();
      // 单手玩法：双击画面也能释放大招
      const now = performance.now();
      if (e.pointerType !== 'mouse' && now - drag.lastTap < 300 && Math.hypot(e.clientX - drag.tapX, e.clientY - drag.tapY) < 40) press('burst');
      drag.lastTap = now; drag.tapX = e.clientX; drag.tapY = e.clientY;
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== drag.id) return;
      drag.dx += e.clientX - drag.lx; drag.dy += e.clientY - drag.ly; drag.lx = e.clientX; drag.ly = e.clientY;
    });
    const end = (e) => { if (e.pointerId === drag.id) drag.id = null; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', (e) => { if (gameActive) e.preventDefault(); });
  }
  function consumeDrag() { const d = { dx: drag.dx, dy: drag.dy }; drag.dx = drag.dy = 0; return d; }

  function pollPad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null; for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) { pad.mx = pad.my = 0; pad.focus = false; return; }
    const b = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
    const edge = (i) => b(i) && !pad.prev[i];
    const dz = (v) => (Math.abs(v) < 0.2 ? 0 : (v - Math.sign(v) * 0.2) / 0.8);
    let mx = dz(gp.axes[0] || 0), my = dz(gp.axes[1] || 0);
    if (b(14)) mx = -1; if (b(15)) mx = 1; if (b(12)) my = -1; if (b(13)) my = 1;
    pad.mx = mx; pad.my = my; pad.focus = b(6) || b(4);
    let any = Math.abs(mx) + Math.abs(my) > 0.3; for (let i = 0; i < gp.buttons.length; i++) if (b(i)) any = true;
    if (any) { setDevice('pad'); keyboardNav = true; }
    if (edge(0) || edge(1) || edge(2) || edge(3) || edge(5) || edge(7)) press('burst');
    if (edge(0)) navPress('ok');
    if (edge(1)) navPress('back');
    if (edge(9)) { press('pause'); navPress('back'); }
    const dir = Math.abs(mx) > Math.abs(my) ? (mx > 0.5 ? 'right' : mx < -0.5 ? 'left' : '') : my > 0.5 ? 'down' : my < -0.5 ? 'up' : '';
    if (dir && dir !== pad.navDir) { navPress(dir); pad.navT = 0.38; } else if (dir) { pad.navT -= dt; if (pad.navT <= 0) { navPress(dir); pad.navT = 0.12; } }
    pad.navDir = dir;
    pad.prev = gp.buttons.map((x) => x.pressed || x.value > 0.5);
  }

  function update(dt) {
    pollPad(dt);
    let mx = (isHeld('right') ? 1 : 0) - (isHeld('left') ? 1 : 0), my = (isHeld('down') ? 1 : 0) - (isHeld('up') ? 1 : 0);
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    if (Math.abs(pad.mx) + Math.abs(pad.my) > 0.01) { mx = pad.mx; my = pad.my; const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; } }
    out.mx = mx; out.my = my; out.focus = isHeld('focus') || pad.focus; out.dragging = drag.id !== null;
  }

  function keyLabel(code) {
    if (!code) return '—';
    const m = { Space: '空格', Escape: 'Esc', ShiftLeft: 'Shift', ShiftRight: '右Shift', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter' };
    if (m[code]) return m[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
  }
  function hintFor(action) {
    if (device === 'pad') return { burst: 'A', pause: 'Start' }[action] || '';
    if (device === 'touch') return '';
    return keyLabel(binds[action][0]);
  }

  return {
    update, consume, press, clearPresses, consumeNav, bindDrag, consumeDrag, keyLabel, hintFor, out, ACTION_NAMES, DEFAULT_BINDS,
    get device() { return device; }, get keyboardNav() { return keyboardNav; },
    set onDevice(fn) { onDevice = fn; },
    set gameActive(v) { gameActive = v; if (!v) drag.id = null; }, get gameActive() { return gameActive; },
    get binds() { return binds; },
    setBinds(b) { binds = JSON.parse(JSON.stringify(b || DEFAULT_BINDS)); for (const k in DEFAULT_BINDS) if (!binds[k]) binds[k] = DEFAULT_BINDS[k].slice(); },
    startRebind(action, cb) { rebind = { action, cb }; },
  };
})();
