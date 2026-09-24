'use strict';
/* 梦潮回声航线 — boot, responsive stage (16:10 … 19.5:9, letterboxed beyond), fixed-step loop, background scenes */

(function boot() {
  const cv = $('#cv'), ctx = cv.getContext('2d'), stage = $('#stage'), app = $('#app');
  G.meta = Store.load(); Tele.bind(G.meta); G.run = G.meta.run || null;
  if (!G.meta.seenTitle && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { G.meta.settings.shake = false; G.meta.settings.reduceFlash = true; }
  G.sea = new SeaScene(); G.hub = new HubScene(); G.map = new MapScene();
  try { document.documentElement.style.setProperty('--paper-tex', `url(${makePaper().toDataURL()})`); } catch (e) { /* canvas export blocked */ }
  const hero = { x: 0, y: 0, face: 'idle', blink: 0, blinkT: 2, phase: 0.5, lamp: 1 };

  Input.mapper = (cx, cy) => { const r = cv.getBoundingClientRect(); return { x: ((cx - r.left) / r.width) * G.W, y: ((cy - r.top) / r.height) * LH }; };
  Input.bindCanvasMouse(cv);
  Input.onDevice = (d) => {
    if (G.hudRefs) G.hudLast.br = null;
    $('#touch').hidden = !(d === 'touch' && G.world && !G.paused && Input.gameActive);
    $('#hud').classList.toggle('touchmode', d === 'touch');
    requestAnimationFrame(() => Input.resetJoy());
  };
  const wake = () => { Sound.init(); window.removeEventListener('pointerdown', wake, true); window.removeEventListener('keydown', wake, true); };
  window.addEventListener('pointerdown', wake, true); window.addEventListener('keydown', wake, true);

  let rotateDismissed = false;
  $('#rotate-go').onclick = () => { rotateDismissed = true; $('#rotate').hidden = true; };
  function resize() {
    const r = app.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    const W = clamp(Math.round((w / h) * LH), 1152, 1560);
    const scale = Math.min(w / W, h / LH), cw = W * scale, ch = LH * scale, left = (w - cw) / 2, top = (h - ch) / 2;
    for (const el of [cv, stage]) Object.assign(el.style, { left: left + 'px', top: top + 'px', width: cw + 'px', height: ch + 'px' });
    const dpr = Math.min(window.devicePixelRatio || 1, G.meta.settings.particles === 'low' ? 1 : 2);
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    G.W = W; G.scale = scale; G.dpr = dpr;
    document.documentElement.style.setProperty('--u', scale.toFixed(4));
    applySettings();
    if (G.world) G.world.W = W;
    const coarse = window.matchMedia && matchMedia('(pointer:coarse)').matches;
    $('#rotate').hidden = !(coarse && h > w * 1.1 && !rotateDismissed);
    Input.resetJoy();
  }
  resize();
  window.addEventListener('resize', resize);
  if (window.visualViewport) visualViewport.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.world && Input.gameActive && !G.paused) pauseGame(); });
  window.addEventListener('blur', () => { if (G.world && Input.gameActive && !G.paused && G.world.mode !== 'demo') pauseGame(); });

  // optional runtime capabilities (absent outside the Claude viewer: the game works without them)
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('sample').then((s) => { G.cap.sample = s; }).catch(() => {});
    window.claude.use('downloads').then((d) => { G.cap.downloads = d; }).catch(() => {});
  }
  try { if (window.claude && window.claude.hot && window.claude.hot.snapshot) window.claude.hot.snapshot(() => ({ screen: G.screen })); } catch (e) { /* optional */ }

  applySettings();
  if (G.meta.seenTitle) showHub(); else showTitle();

  /* ---------- background scenes for menus ---------- */
  let grain = null, vig = null, vigW = 0;
  function overlay(W) {
    if (G.meta.settings.particles !== 'low') {
      if (!grain) grain = ctx.createPattern(makePaper(), 'repeat');
      ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.35; ctx.fillStyle = grain; ctx.fillRect(0, 0, W, LH);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (!vig || vigW !== W) {
      vigW = W; vig = makeCanvas(W, LH); const v = vig.getContext('2d');
      const gr = v.createRadialGradient(W / 2, LH / 2, LH * 0.35, W / 2, LH / 2, W * 0.72); gr.addColorStop(0, 'rgba(8,6,26,0)'); gr.addColorStop(1, 'rgba(8,6,26,0.55)');
      v.fillStyle = gr; v.fillRect(0, 0, W, LH);
    }
    ctx.drawImage(vig, 0, 0);
  }
  function drawHero(x, y, scale, t, face) {
    hero.blinkT -= 1 / 60; if (hero.blinkT <= 0) { hero.blink = 1; hero.blinkT = 2 + Math.random() * 3; } hero.blink = Math.max(0, hero.blink - 0.14);
    drawPlayer(ctx, { x, y, scale, face: face || 'idle', blink: hero.blink, phase: hero.phase, lamp: 1, lean: Math.sin(t * 0.7) * 0.08, tail: Math.sin(t * 1.3) * 2 }, t);
  }
  function drawStaff(W, t) {
    ctx.strokeStyle = 'rgba(255,227,138,0.12)'; ctx.lineWidth = 1.4;
    for (let i = 0; i < 5; i++) { ctx.beginPath(); for (let x = 0; x <= W; x += 30) ctx.lineTo(x, LH * 0.58 + i * 14 + Math.sin(x * 0.006 + t * 0.8) * 26); ctx.stroke(); }
    for (let i = 0; i < 7; i++) { const x = ((i * 190 + t * 40) % (W + 100)) - 50, y = LH * 0.58 + Math.sin(x * 0.006 + t * 0.8) * 26 + (i % 5) * 14 - 6; ctx.fillStyle = 'rgba(255,227,138,0.4)'; ctx.font = '22px serif'; ctx.fillText('♪', x, y); }
  }
  function render(t) {
    const k = G.scale * G.dpr, W = G.W;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    switch (G.bg) {
      case 'world':
        if (G.world) { G.world.render(ctx); return; }
        G.sea.draw(ctx, W, LH); break;
      case 'title':
        G.sea.draw(ctx, W, LH); drawStaff(W, t); drawHero(W * 0.3, LH * 0.56, 3.4, t); break;
      case 'hub':
        G.hub.draw(ctx, W, LH); if (G.screen === 'hub') drawHero(W / 2, LH * 0.53, 2.5, t); break;
      case 'map':
        G.map.draw(ctx, W, LH); break;
      case 'rest':
        G.sea.draw(ctx, W, LH); drawHero(W * 0.22, LH * 0.66, 2.2, t, 'sleep'); break;
      default:
        G.sea.draw(ctx, W, LH);
    }
    overlay(W);
  }

  /* ---------- main loop: fixed 120 Hz simulation, render once per frame ---------- */
  const STEP = 1 / 120;
  let last = performance.now(), acc = 0, errored = false;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now; if (dt > 0.1) dt = 0.1; if (dt < 0) dt = 0;
    try {
      Input.update(dt);
      const w = G.world;
      if (w && !G.paused && G.bg === 'world') {
        acc += dt; let n = 0;
        while (acc >= STEP && n < 12) { w.step(STEP); acc -= STEP; n++; }
        if (n >= 12) acc = 0;
        drainWorldEvents();
        if (Input.gameActive && Input.consume('pause')) pauseGame();
      } else {
        acc = 0;
        if (G.bg === 'hub') G.hub.update(dt); else if (G.bg === 'map') G.map.update(dt); else G.sea.update(dt);
      }
      if (!Input.gameActive) navUpdate();
      render(now / 1000);
      updateHud();
      tickDemo(dt);
      if (G.anims.length) tickAnims(now / 1000);
    } catch (e) {
      if (!errored) { errored = true; console.error('[梦潮] frame error', e); }
    }
  }
  requestAnimationFrame(frame);
})();
