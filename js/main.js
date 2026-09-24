'use strict';
/* 梦潮：回声航线 — 启动、自适应舞台（16:10 … 19.5:9，超出部分留黑边）、固定步长主循环、菜单背景 */

(function boot() {
  const cv = $('#cv'), ctx = cv.getContext('2d'), stage = $('#stage'), app = $('#app');
  G.meta = Store.load(); Tele.bind(G.meta);
  if (!G.meta.seenTitle && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { G.meta.settings.shake = false; G.meta.settings.reduceFlash = true; }
  G.sea = new SeaScene(); G.hub = new HubScene(); G.map = new MapScene();
  try { document.documentElement.style.setProperty('--paper-tex', `url(${makePaper().toDataURL()})`); } catch (e) { /* canvas export blocked */ }

  // 拖动：整块舞台（含黑边）都能拖，HUD 按钮自己拦截
  Input.bindDrag(app);
  Input.onDevice = (d) => { if (G.hudRefs) { G.hudLast.bk = null; if (G.world) showHint(); } };
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
  }
  resize();
  window.addEventListener('resize', resize);
  if (window.visualViewport) visualViewport.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  window.addEventListener('blur', () => pauseGame());

  // 可选的运行时能力（Claude 查看器之外不存在；游戏不依赖它们）
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('sample').then((s) => { G.cap.sample = s; }).catch(() => {});
    window.claude.use('downloads').then((d) => { G.cap.downloads = d; }).catch(() => {});
  }

  applySettings();
  if (G.meta.seenTitle && G.meta.firstRunDone) showHub(); else showTitle();

  /* ---------- 菜单背景 ---------- */
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
  const hero = { blink: 0, blinkT: 2 };
  function drawHero(id, x, y, scale, t) {
    hero.blinkT -= 1 / 60; if (hero.blinkT <= 0) { hero.blink = 1; hero.blinkT = 2 + Math.random() * 3; } hero.blink = Math.max(0, hero.blink - 0.14);
    drawGlow(ctx, x, y + 6, 130 * scale / 2.6, PLANES[id].colors.accent, 0.35);
    drawPlane(ctx, id, x, y + Math.sin(t * 1.6) * 8, scale, t, { tilt: Math.sin(t * 0.9) * 0.08, blink: hero.blink, happy: true });
  }
  function drawTrail(x, y, t) {
    const cols = (COSMETICS.trail.find((c) => c.id === G.meta.cosmetics.trail) || COSMETICS.trail[0]).colors;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 22; i++) { const k = i / 22; ctx.globalAlpha = (1 - k) * 0.5; ctx.fillStyle = cols[i % cols.length]; ctx.beginPath(); ctx.arc(x - 60 - i * 16, y + Math.sin(t * 1.6 - i * 0.25) * 8 + Math.sin(i * 1.7) * 4, 9 * (1 - k) + 2, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function render(t) {
    const k = G.scale * G.dpr, W = G.W;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    const cur = G.meta.current;
    switch (G.bg) {
      case 'world':
        if (G.world) { G.world.render(ctx); return; }
        G.sea.draw(ctx, W, LH); break;
      case 'title':
        G.sea.draw(ctx, W, LH); drawTrail(W * 0.3, LH * 0.56, t); drawHero(cur, W * 0.3, LH * 0.56, 2.6, t); break;
      case 'hub':
        G.hub.draw(ctx, W, LH); if (G.screen === 'hub') { drawTrail(W / 2, LH * 0.4, t); drawHero(cur, W / 2, LH * 0.4, 2.2, t); } break;
      case 'map':
        G.map.draw(ctx, W, LH); break;
      default:
        G.sea.draw(ctx, W, LH);
    }
    overlay(W);
  }

  /* ---------- 主循环：固定 120 Hz 模拟，每帧渲染一次 ---------- */
  const STEP = 1 / 120;
  let last = performance.now(), acc = 0, errored = false;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now; if (dt > 0.1) dt = 0.1; if (dt < 0) dt = 0;
    try {
      Input.update(dt);
      const d = Input.consumeDrag(), w = G.world;
      if (w && !G.paused && !w.done && G.bg === 'world') {
        if (Input.gameActive) { const s = G.meta.settings.dragSens / G.scale; w.dragDX += d.dx * s; w.dragDY += d.dy * s; }
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
      tickPreview(dt);
    } catch (e) {
      if (!errored) { errored = true; console.error('[梦潮] frame error', e); }
    }
  }
  requestAnimationFrame(frame);
})();
