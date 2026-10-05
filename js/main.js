'use strict';
/* 梦潮：回声航线 — 启动、自适应舞台（16:10 … 19.5:9，超出部分留黑边）、固定步长主循环、菜单背景 */

(function boot() {
  const cv = $('#cv'), ctx = cv.getContext('2d'), stage = $('#stage'), app = $('#app');
  G.meta = Store.load(); Home.ensure(G.meta); Tele.bind(G.meta);
  if (!G.meta.seenTitle && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { G.meta.settings.shake = false; G.meta.settings.reduceFlash = true; G.meta.settings.flash = 0.3; }
  G.sea = new SeaScene(); G.hub = new HubScene(); G.map = new MapScene(); G.homeScene = new HomeScene();
  try { document.documentElement.style.setProperty('--paper-tex', `url(${makePaper().toDataURL()})`); } catch (e) { /* canvas export blocked */ }

  // 拖动：整块舞台（含黑边）都能拖，HUD 按钮自己拦截
  Input.bindDrag(app);
  Input.onPadLost = () => pauseGame(); // 手柄断开：暂停（仪式也一起冻结，恢复后接着走，不跳过、不重抽）
  Input.onDevice = (d) => { if (G.hudRefs) { G.hudLast.bk = null; if (G.world) showHint(); } };
  const wake = () => { Sound.init(); window.removeEventListener('pointerdown', wake, true); window.removeEventListener('keydown', wake, true); };
  window.addEventListener('pointerdown', wake, true); window.addEventListener('keydown', wake, true);

  function resize() {
    const r = app.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    const W = G.mpLock ? 1280 : clamp(Math.round((w / h) * LH), 1152, 1560); // 联机时宽度固定，各端世界一样大
    const scale = Math.min(w / W, h / LH), cw = W * scale, ch = LH * scale, left = (w - cw) / 2, top = (h - ch) / 2;
    for (const el of [cv, stage]) Object.assign(el.style, { left: left + 'px', top: top + 'px', width: cw + 'px', height: ch + 'px' });
    const dpr = Math.min(window.devicePixelRatio || 1, G.meta.settings.particles === 'low' ? 1 : 2);
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    G.W = W; G.scale = scale; G.dpr = dpr;
    document.documentElement.style.setProperty('--u', scale.toFixed(4));
    applySettings();
    if (G.world) G.world.W = W;
    // 只做 Steam 横版：窗口被拉成竖长条时暂停并提示拉宽，不暴露挤在一起的界面
    const narrow = h > w * 1.02; $('#narrow').hidden = !narrow; if (narrow) pauseGame();
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
  const invite = inviteCode(), resumeRoom = Lobby.savedRoom();
  if (invite && !(resumeRoom && resumeRoom.code === invite)) { G.meta.seenTitle = true; showMultiplayer(showHub, invite); } // 朋友点邀请链接：直接进那个房间
  else if (resumeRoom) { G.meta.seenTitle = true; showMultiplayer(showHub, null, resumeRoom); } // 刷新页面：回到刚才的联机房间（那一局还在打就回到原对局）
  else if (G.meta.seenTitle && G.meta.firstRunDone) showHub(); else showTitle();

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
        G.sea.dim = 0;
        G.sea.draw(ctx, W, LH); drawTrail(W * 0.3, LH * 0.56, t); drawHero(cur, W * 0.3, LH * 0.56, 2.6, t); break;
      case 'home': G.homeScene.draw(ctx, W, LH, G.meta, G.homeUI); break; // 家园：浮空港
      case 'hub':
        G.hub.draw(ctx, W, LH); if (G.screen === 'hub') { drawTrail(W / 2, LH * 0.4, t); drawHero(cur, W / 2, LH * 0.4, 2.2, t); } break;
      case 'map':
        G.map.draw(ctx, W, LH); break;
      default:
        G.sea.draw(ctx, W, LH);
    }
    overlay(W);
  }

  /* ---------- 联机主循环：按真实时间推进；本机每 1/30 秒采一帧操作，凑齐所有人的这一帧才往下模拟 ---------- */
  // 每个操作帧 = 4 个模拟步；步按真实时间一个个跑（画面平滑），只在帧的第一步换上新操作。暂停菜单不冻结联机战斗，只是本机不操作。
  // 浏览器会在标签页后台、窗口被遮住、游戏框滚出视野时停掉或降频 requestAnimationFrame（不一定伴随 document.hidden），
  // 所以联机始终由 NetTicker（Worker 计时，约 40 次 / 秒）推进；画面刷新时再顺带推进一次，画面更平滑。两边都按真实时间算，谁先到谁跑。
  function mpTick(now) {
    const w = G.world, L = G.mpLoop, S = Lobby.session;
    if (!w || !L || !S || w.done) return;
    if (S.kicked !== undefined) { // 断线太久，队友已经把我移出这一局
      toast('断线超过 60 秒，已按退出处理', '#ffb2a8', null, 4000);
      w.done = true; const r = w.result(false); r.abandoned = true; r.kicked = true; Lobby.leave(); onRunEnd(r); return;
    }
    if (Lobby.orphaned()) { // 队友那边这一局已经结束了，本机等不到后面的操作
      toast('队友那边这一局已经结束了', '#ffe38a', null, 4000);
      w.done = true; const r = w.result(false); r.abandoned = true; r.orphan = true; onRunEnd(r); return;
    }
    // 本机操作：拖动累计量化成每帧 ±31 像素；暂停 / 菜单 / 后台时发中性操作
    const active = Input.gameActive && !G.paused && !document.hidden;
    MpDriver.tick(w, L, S, now, () => {
      const qx = clamp(Math.round(L.dx), -31, 31), qy = clamp(Math.round(L.dy), -31, 31); L.dx -= qx; L.dy -= qy;
      return active ? { mx: Input.out.mx, my: Input.out.my, focus: Input.out.focus, burst: Input.consume('burst'), dx: qx, dy: qy } : NEUTRAL_INPUT;
    });
    if (S.desync && !L.desyncShown) { L.desyncShown = true; console.warn('[联机] 状态不一致', S.desync); toast('联机画面和队友对不上了：这局结果可能不同，结束后请重开', '#ffb2a8', null, 5000); }
  }
  NetTicker.on((now) => { if (G.mpLoop) { try { mpTick(now); drainWorldEvents(); } catch (e) { console.error('[联机] 计时', e); } } });
  function mpWaitText() {
    const L = G.mpLoop, S = Lobby.session; if (!L || !S) return '';
    if (S.replaying) return `正在追上队友… ${S.replayPct || 0}%`;
    if (S.awayMe) return '网络断开过，正在恢复…';
    if (L.waitT < 0.35) return '';
    const who = S.waitingFor().map((j) => (Lobby.roster[j] && Lobby.roster[j].name) || `${j + 1}P`);
    return who.length ? `等待 ${who.join('、')} 的操作…` : '';
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
      if (w && G.mpLoop && !w.done) {
        if (Input.gameActive && !G.paused) { const s = G.meta.settings.dragSens / G.scale; G.mpLoop.dx += d.dx * s; G.mpLoop.dy += d.dy * s; }
        mpTick(now); acc = 0;
        drainWorldEvents();
        Input.flushRumble(G.meta.settings.rumble === undefined ? 1 : G.meta.settings.rumble);
        if (Input.gameActive && Input.consume('pause')) pauseGame();
        mpWait(mpWaitText());
      } else if (w && !G.paused && !w.done && G.bg === 'world') {
        let ddx = 0, ddy = 0;
        if (Input.gameActive) { const s = G.meta.settings.dragSens / G.scale; ddx = d.dx * s; ddy = d.dy * s; }
        acc += dt; let n = 0;
        // 单人：每一步把本机操作交给 World（多人走 net.js 的帧同步，不经过这里）
        while (acc >= STEP && n < 12) { w.setInput(w.meIdx, { mx: Input.out.mx, my: Input.out.my, focus: Input.out.focus, burst: Input.consume('burst'), dx: ddx, dy: ddy }); ddx = ddy = 0; w.step(STEP); acc -= STEP; n++; }
        if (n >= 12) acc = 0;
        drainWorldEvents();
        Input.flushRumble(G.meta.settings.rumble === undefined ? 1 : G.meta.settings.rumble);
        if (Input.gameActive && Input.consume('pause')) pauseGame();
      } else {
        acc = 0; if (waitShown) mpWait('');
        if (G.bg === 'home') G.homeScene.update(dt); else if (G.bg === 'hub') G.hub.update(dt); else if (G.bg === 'map') G.map.update(dt); else G.sea.update(dt);
      }
      if (!Input.gameActive) navUpdate();
      render(now / 1000);
      updateHud();
      tickPreview(dt);
    } catch (e) {
      if (!errored) { errored = true; console.error('[梦潮] frame error', e); }
    }
  }
  let waitShown = '';
  function mpWait(t) { if (t === waitShown) return; waitShown = t; const el = $('#mpwait'); el.textContent = t; el.hidden = !t; }
  requestAnimationFrame(frame);
})();
