'use strict';
/* 梦潮回声航线 — one input layer for keyboard+mouse, gamepad and touch (same actions everywhere) */

const Input = (() => {
  const DEFAULT_BINDS = {
    up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    cut: ['KeyJ', 'KeyZ'], dash: ['Space', 'KeyK'], perform: ['KeyL', 'KeyX'], focus: ['ShiftLeft', 'ShiftRight'],
    pause: ['Escape', 'KeyP'], fire: ['KeyU', 'KeyC'],
  };
  const ACTION_NAMES = { up: '上移', down: '下移', left: '左移', right: '右移', cut: '切 / 弹反', dash: '闪避', perform: '梦境演奏', focus: '精确移动（慢速）', pause: '暂停', fire: '手动射击（关闭自动攻击时）' };
  let binds = JSON.parse(JSON.stringify(DEFAULT_BINDS));
  const held = new Set();
  const presses = {};
  const nav = {};
  let device = 'kbm', onDevice = null, gameActive = false, rebind = null, keyboardNav = false;
  const mouse = { x: 0, y: 0, left: false, has: false };
  const touch = { joyId: null, ox: 0, oy: 0, jx: 0, jy: 0, aimId: null, aox: 0, aoy: 0, ax: 0, ay: 0, aimOn: false, fire: false, R: 60 };
  const pad = { idx: -1, prev: [], navT: 0, navDir: '', mx: 0, my: 0, ax: 0, ay: 0, fire: false, focus: false };
  let toLogical = (cx, cy) => ({ x: cx, y: cy });
  const els = {};

  const out = { mx: 0, my: 0, aimX: 0, aimY: 0, aimOn: false, aimPoint: null, fire: false, focus: false };

  function setDevice(d) { if (d !== device) { device = d; if (onDevice) onDevice(d); } }
  function press(a) { presses[a] = performance.now(); }
  function consume(a, buffer = 130) {
    const t = presses[a];
    if (t && performance.now() - t <= buffer) { presses[a] = 0; return true; }
    return false;
  }
  function peek(a, buffer = 130) { const t = presses[a]; return !!t && performance.now() - t <= buffer; }
  function clearPresses() { for (const k in presses) presses[k] = 0; for (const k in nav) nav[k] = 0; }
  function navPress(d) { nav[d] = performance.now(); }
  function consumeNav(d) { const t = nav[d]; if (t && performance.now() - t < 200) { nav[d] = 0; return true; } return false; }

  function actionsFor(code) { const r = []; for (const a in binds) if (binds[a].includes(code)) r.push(a); return r; }
  function isHeld(a) { for (const c of binds[a]) if (held.has(c)) return true; return false; }

  window.addEventListener('keydown', (e) => {
    if (rebind) {
      e.preventDefault();
      if (e.code !== 'Escape') { const a = rebind.action; binds[a] = [e.code, ...binds[a].filter((c) => c !== e.code).slice(0, 1)]; }
      const cb = rebind.cb; rebind = null; if (cb) cb(binds);
      return;
    }
    setDevice('kbm'); keyboardNav = true;
    const acts = actionsFor(e.code);
    if (gameActive && acts.length) e.preventDefault();
    if (!e.repeat) { held.add(e.code); for (const a of acts) press(a); }
    // menu navigation keys
    if (!gameActive) {
      const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Escape: 'back' };
      if (map[e.code]) { navPress(map[e.code]); if (e.code !== 'Escape') e.preventDefault(); }
    }
  });
  window.addEventListener('keyup', (e) => { held.delete(e.code); });
  window.addEventListener('blur', () => { held.clear(); mouse.left = false; });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') {
      const p = toLogical(e.clientX, e.clientY); mouse.x = p.x; mouse.y = p.y; mouse.has = true;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) setDevice('kbm');
    }
  }, { passive: true });
  window.addEventListener('pointerdown', (e) => {
    keyboardNav = false;
    if (e.pointerType === 'touch' || e.pointerType === 'pen') setDevice('touch');
    else if (e.pointerType === 'mouse') setDevice('kbm');
  }, true);
  function bindCanvasMouse(el) {
    el.addEventListener('mousedown', (e) => {
      if (!gameActive) return;
      if (e.button === 0) mouse.left = true;
      if (e.button === 2) press('cut');
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; });
    el.addEventListener('contextmenu', (e) => { if (gameActive) e.preventDefault(); });
  }

  /* ---------- touch: floating joystick on the left, aim/fire drag on the right, buttons ---------- */
  function bindTouch(root) {
    const zone = root.querySelector('.zone'), aim = root.querySelector('.aimzone'), joy = root.querySelector('.joy');
    Object.assign(els, { zone, aim, joy, root });
    const rel = (e) => { const r = root.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const showJoy = (x, y, idle) => { joy.style.left = x + 'px'; joy.style.top = y + 'px'; joy.classList.toggle('idle', !!idle); };
    const knob = () => joy.firstElementChild;
    zone.addEventListener('pointerdown', (e) => {
      if (touch.joyId !== null) return;
      e.preventDefault(); zone.setPointerCapture(e.pointerId);
      touch.joyId = e.pointerId; const p = rel(e); touch.ox = p.x; touch.oy = p.y; touch.jx = touch.jy = 0;
      touch.R = joy.getBoundingClientRect().width * 0.42 || 60;
      showJoy(p.x, p.y, false); knob().style.transform = '';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== touch.joyId) return;
      const p = rel(e); let dx = p.x - touch.ox, dy = p.y - touch.oy; const d = Math.hypot(dx, dy), R = touch.R;
      if (d > R * 1.6) { touch.ox += dx * (1 - (R * 1.6) / d); touch.oy += dy * (1 - (R * 1.6) / d); showJoy(touch.ox, touch.oy, false); dx = p.x - touch.ox; dy = p.y - touch.oy; }
      const k = Math.min(1, Math.hypot(dx, dy) / R), a = Math.atan2(dy, dx);
      touch.jx = Math.cos(a) * k; touch.jy = Math.sin(a) * k;
      if (Math.hypot(dx, dy) < 6) touch.jx = touch.jy = 0;
      knob().style.transform = `translate(${touch.jx * R}px,${touch.jy * R}px)`;
    });
    const endJoy = (e) => {
      if (e.pointerId !== touch.joyId) return;
      touch.joyId = null; touch.jx = touch.jy = 0; knob().style.transform = ''; resetJoy();
    };
    zone.addEventListener('pointerup', endJoy); zone.addEventListener('pointercancel', endJoy);
    aim.addEventListener('pointerdown', (e) => {
      if (touch.aimId !== null) return;
      e.preventDefault(); aim.setPointerCapture(e.pointerId);
      touch.aimId = e.pointerId; const p = rel(e); touch.aox = p.x; touch.aoy = p.y; touch.fire = true; touch.aimOn = false;
    });
    aim.addEventListener('pointermove', (e) => {
      if (e.pointerId !== touch.aimId) return;
      const p = rel(e), dx = p.x - touch.aox, dy = p.y - touch.aoy, d = Math.hypot(dx, dy);
      if (d > 14) { touch.ax = dx / d; touch.ay = dy / d; touch.aimOn = true; }
    });
    const endAim = (e) => { if (e.pointerId !== touch.aimId) return; touch.aimId = null; touch.fire = false; touch.aimOn = false; };
    aim.addEventListener('pointerup', endAim); aim.addEventListener('pointercancel', endAim);
    for (const b of root.querySelectorAll('.tbtn')) {
      const act = b.dataset.act;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); press(act); b.classList.add('down'); });
      const up = () => b.classList.remove('down');
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    }
    resetJoy();
  }
  function resetJoy() {
    if (!els.joy || !els.zone) return;
    const r = els.root.getBoundingClientRect();
    els.joy.style.left = r.width * 0.13 + 'px'; els.joy.style.top = r.height * 0.74 + 'px'; els.joy.classList.add('idle');
  }

  /* ---------- gamepad ---------- */
  function pollPad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) { pad.mx = pad.my = pad.ax = pad.ay = 0; pad.fire = pad.focus = false; return; }
    const b = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
    const edge = (i) => b(i) && !pad.prev[i];
    const dz = (v) => (Math.abs(v) < 0.22 ? 0 : (v - Math.sign(v) * 0.22) / 0.78);
    let mx = dz(gp.axes[0] || 0), my = dz(gp.axes[1] || 0);
    if (b(14)) mx = -1; if (b(15)) mx = 1; if (b(12)) my = -1; if (b(13)) my = 1;
    pad.mx = mx; pad.my = my;
    pad.ax = dz(gp.axes[2] || 0); pad.ay = dz(gp.axes[3] || 0);
    pad.fire = b(7); pad.focus = b(6) || b(4);
    let any = Math.abs(mx) + Math.abs(my) + Math.abs(pad.ax) + Math.abs(pad.ay) > 0.3;
    for (let i = 0; i < gp.buttons.length; i++) if (b(i)) any = true;
    if (any) { setDevice('pad'); keyboardNav = true; }
    if (edge(0)) { press('dash'); navPress('ok'); }
    if (edge(2) || edge(1)) press('cut');
    if (edge(1)) navPress('back');
    if (edge(3) || edge(5)) press('perform');
    if (edge(9)) { press('pause'); navPress('back'); }
    // menu navigation with auto-repeat
    const dir = Math.abs(mx) > Math.abs(my) ? (mx > 0.5 ? 'right' : mx < -0.5 ? 'left' : '') : my > 0.5 ? 'down' : my < -0.5 ? 'up' : '';
    if (dir && dir !== pad.navDir) { navPress(dir); pad.navT = 0.38; }
    else if (dir) { pad.navT -= dt; if (pad.navT <= 0) { navPress(dir); pad.navT = 0.12; } }
    pad.navDir = dir;
    pad.prev = gp.buttons.map((x) => x.pressed || x.value > 0.5);
  }

  function update(dt) {
    pollPad(dt);
    let mx = (isHeld('right') ? 1 : 0) - (isHeld('left') ? 1 : 0);
    let my = (isHeld('down') ? 1 : 0) - (isHeld('up') ? 1 : 0);
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    if (Math.abs(pad.mx) + Math.abs(pad.my) > 0.01) { mx = pad.mx; my = pad.my; const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; } }
    if (touch.joyId !== null) { mx = touch.jx; my = touch.jy; }
    out.mx = mx; out.my = my;
    out.focus = isHeld('focus') || pad.focus;
    out.fire = isHeld('fire') || mouse.left || pad.fire || touch.fire;
    out.aimOn = false; out.aimPoint = null;
    if (Math.hypot(pad.ax, pad.ay) > 0.3) { const l = Math.hypot(pad.ax, pad.ay); out.aimX = pad.ax / l; out.aimY = pad.ay / l; out.aimOn = true; }
    else if (touch.aimOn) { out.aimX = touch.ax; out.aimY = touch.ay; out.aimOn = true; }
    else if (device === 'kbm' && mouse.has) { out.aimPoint = { x: mouse.x, y: mouse.y }; out.aimOn = true; }
  }

  function keyLabel(code) {
    if (!code) return '—';
    const m = { Space: '空格', Escape: 'Esc', ShiftLeft: 'Shift', ShiftRight: '右Shift', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Tab: 'Tab', ControlLeft: 'Ctrl', AltLeft: 'Alt' };
    if (m[code]) return m[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
  }
  function hintFor(action) {
    if (device === 'pad') return { cut: 'X', dash: 'A', perform: 'Y', pause: 'Start', focus: 'LT', fire: 'RT' }[action] || '';
    return keyLabel(binds[action][0]);
  }

  return {
    update, consume, peek, press, clearPresses, consumeNav, bindTouch, bindCanvasMouse, resetJoy, keyLabel, hintFor,
    out, ACTION_NAMES, DEFAULT_BINDS,
    get device() { return device; },
    get keyboardNav() { return keyboardNav; },
    set onDevice(fn) { onDevice = fn; },
    set gameActive(v) { gameActive = v; if (!v) { mouse.left = false; } },
    get gameActive() { return gameActive; },
    set mapper(fn) { toLogical = fn; },
    get binds() { return binds; },
    setBinds(b) { binds = JSON.parse(JSON.stringify(b || DEFAULT_BINDS)); for (const k in DEFAULT_BINDS) if (!binds[k]) binds[k] = DEFAULT_BINDS[k].slice(); },
    startRebind(action, cb) { rebind = { action, cb }; },
    get rebinding() { return !!rebind; },
  };
})();
