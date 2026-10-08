'use strict';
/* 梦潮：回声航线 — 启动、自适应舞台（16:10 … 19.5:9，超出部分留黑边）、固定步长主循环、菜单背景 */

(function boot() {
  const cv = $('#cv'), ctx = cv.getContext('2d'), stage = $('#stage'), app = $('#app');
  G.meta = Store.load(); Station.ensure(G.meta); Tele.bind(G.meta);
  if (!G.meta.seenTitle && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { G.meta.settings.shake = false; G.meta.settings.reduceFlash = true; G.meta.settings.flash = 0.3; }
  G.sea = new SpaceScene(); G.hub = new HubScene(); G.map = new MapScene(); G.stationScene = new StationScene();
  try { document.documentElement.style.setProperty('--paper-tex', `url(${makePaper().toDataURL()})`); } catch (e) { /* canvas export blocked */ }

  // 拖动：整块舞台（含黑边）都能拖，HUD 按钮自己拦截
  Input.bindDrag(app);
  Input.onPadLost = () => pauseGame(); // 手柄断开：暂停（仪式也一起冻结，恢复后接着走，不跳过、不重抽）
  Input.onDevice = (d) => { if (G.hudRefs) { G.hudLast.bk = null; if (G.world) showHint(); } };
  Input.onKind = () => { if (G.hudRefs && G.world) showHint(); }; // 换了键盘 / 鼠标 / 手柄：开局的移动教学跟着换
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
  if (window.K) K.on('host-left', () => toast('房主离开了：你接手了这一局，接着打', '#ffe38a', null, 3500));
  if (window.kitBridge && window.kitBridge.steam) Lobby.connect().then((net) => { net.onInvite = (id) => steamInviteJoin(id); if (net.pendingInvite) steamInviteJoin(net.pendingInvite); }); // 打包版：好友邀请、从好友列表加入（游戏被邀请启动时马上进房）

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
      case 'station': G.stationScene.draw(ctx, W, LH, G.meta); break; // 站
      case 'hub':
        G.hub.draw(ctx, W, LH); if (G.screen === 'hub') { drawTrail(W / 2, LH * 0.4, t); drawHero(cur, W / 2, LH * 0.4, 2.2, t); } break;
      case 'map':
        G.map.draw(ctx, W, LH); break;
      case 'keyart': drawKeyArt(W, t); break; // 商店主图（截图工具用；游戏里不会进这一屏）
      default:
        G.sea.draw(ctx, W, LH);
    }
    overlay(W);
  }

  /* ---------- 商店主图：用游戏自己的画法拼一张关键美术（920×430 主图从 16:9 画面中间裁出来，上下各留约 60 像素） ----------
     左上：标题；左边：拾荒飞船拖着光轨冲出去，三道光枪打进一群族无人机；中间：精英炸开，金光柱从天上砸下来（暗金掉落）；
     右上：日食里缄默主教的剪影；地上还有蓝、绿两道掉落的光柱。G.keyEn = 英文（商店页用） */
  function drawKeyArt(W, t) {
    const en = !!G.keyEn || !/^zh/.test(I18N.lang), sp = G.keySpace || (G.keySpace = new SpaceScene()); // 中文、繁中用中文名，别的语言用英文名（和标题画面一样）
    sp.setTheme('5-3'); sp.dim = 0; sp.t = 6; sp.scroll = 900; sp.draw(ctx, W, LH);
    // 祭司：日食前一个巨大的剪影，只有面具和信号环发光
    ctx.save(); ctx.globalAlpha = 0.85; ctx.translate(W * 0.8, LH * 0.44); ctx.scale(1.3, 1.3); ctx.translate(-W * 0.8, -LH * 0.44); drawPriest(ctx, { x: W * 0.8, y: LH * 0.44, phase: 1, rings: [0, 1, 2].map((i) => ({ a: t * 0.3 + i * 2.1, r: 120 + i * 26 })), swing: t, hitFlash: 0, weakT: 1 }, t); ctx.restore();
    ctx.fillStyle = 'rgba(6,4,14,0.25)'; ctx.fillRect(0, 0, W, LH);
    // 敌弹：几串粉色圆弹和蓝色菱形斜着穿过画面（这是一张射击游戏的图）
    for (let i = 0; i < 18; i++) { const x = W * (0.42 + (i % 6) * 0.07), y = LH * (0.2 + Math.floor(i / 6) * 0.28) + (i % 6) * 9; BulletArt.draw(ctx, i % 3 ? 'pink' : 'blue', x, y, 0, 1); }
    // 族无人机：橙（穿甲矿业）、紫（星砂商会）、电青（电弧公司）
    const foes = [[0.55, 0.36, 'drill', 'jelly', 1.5], [0.6, 0.62, 'ledger', 'tick', 1.4], [0.69, 0.48, 'arc', 'star', 1.6], [0.5, 0.74, 'drill', 'moth', 1.6], [0.73, 0.72, 'ledger', 'jelly', 1.3], [0.64, 0.28, 'arc', 'moth', 1.5], [0.82, 0.6, 'drill', 'boat', 1.4]];
    for (const [fx, fy, race, type, sc] of foes) { ctx.save(); ctx.translate(W * fx, LH * fy); ctx.scale(sc, sc); EnemyArt[type](ctx, { r: 20, hitFlash: 0, base: type, type, race, seed: fx * 10, charge: 0 }, t + fx * 7); ctx.restore(); }
    // 主角的三道光枪
    const px = W * 0.25, py = LH * 0.56;
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (const dy of [-26, 0, 26]) { const x0 = px + 70, x1 = W * 0.6 + dy * 0.6, y = py + dy * 1.4; const gr = ctx.createLinearGradient(x0, y, x1, y); gr.addColorStop(0, 'rgba(120,230,255,0)'); gr.addColorStop(1, 'rgba(210,250,255,0.95)'); ctx.strokeStyle = gr; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(x0, py + dy * 0.3); ctx.lineTo(x1, y); ctx.stroke(); }
    ctx.globalCompositeOperation = 'source-over';
    // 精英炸开：碎片 + 光圈；金光柱从天上砸下来
    const ex = W * 0.6, ey = LH * 0.5;
    // 金光柱：从画面顶上砸下来，两边几道光线
    ctx.globalCompositeOperation = 'lighter';
    const pg = ctx.createLinearGradient(0, 0, 0, ey + 80); pg.addColorStop(0, 'rgba(255,200,90,0)'); pg.addColorStop(0.7, 'rgba(255,214,120,0.55)'); pg.addColorStop(1, 'rgba(255,240,200,0.95)');
    ctx.fillStyle = pg; ctx.fillRect(ex - 34, 0, 68, ey + 80); ctx.fillStyle = 'rgba(255,250,230,0.8)'; ctx.fillRect(ex - 8, 0, 16, ey + 80);
    for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i - 3) * 0.32; ctx.strokeStyle = 'rgba(255,214,140,0.35)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(ex, ey + 70); ctx.lineTo(ex + Math.cos(a) * 260, ey + 70 + Math.sin(a) * 260); ctx.stroke(); }
    drawGlow(ctx, ex, ey, 170, 'rgba(255,214,140,0.9)', 0.9); ctx.globalCompositeOperation = 'source-over';
    const C = ['#ffd76a', '#ff8a3d', '#ffffff', '#d9a443'];
    for (let k = 0; k < 26; k++) { const a = (k / 26) * TAU, r = 40 + (k % 4) * 26; ctx.fillStyle = C[k % 4]; ctx.save(); ctx.translate(ex + Math.cos(a) * r, ey + Math.sin(a) * r * 0.8); ctx.rotate(a); ctx.fillRect(-5, -3, 10 + (k % 3) * 4, 6); ctx.restore(); }
    ctx.strokeStyle = 'rgba(255,230,170,0.8)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(ex, ey, 118, 0, TAU); ctx.stroke();
    const mk = (q, name, x, y, kt) => { const it = Gear.make({ ilvl: 8, q, kind: 'gun' }); it.uni = null; return { item: Object.assign(it, { _label: name }), x, y, t: kt, fx: LOOT_FX[q] }; };
    const drops = [mk('gold', en ? 'THE OLD SCAVENGER' : '老拾荒者', ex + 6, ey + 70, 0.9), mk('blue', en ? 'Blazing Chain Cannon' : '爆燃的链式速射炮', W * 0.44, LH * 0.82, 1.2), mk('green', en ? 'Drill · Engine' : '钻头 · 引擎', W * 0.82, LH * 0.84, 1.1)];
    for (const k of drops) drawLootCrate(ctx, k, t);
    for (const k of drops) drawLootLabel(ctx, k);
    drawTrail(px, py, t); drawHero('moon', px, py, 2.5, t);
    // 标题（左上，避开主角和金光柱）
    ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
    const lx = W * 0.05, ly = LH * 0.27;
    if (en) {
      ctx.font = '800 128px "Baloo 2", "Noto Sans SC", sans-serif'; ctx.lineWidth = 16; ctx.strokeStyle = '#1a0e2c'; ctx.strokeText('EMBERS', lx, ly);
      const tg = ctx.createLinearGradient(0, ly - 100, 0, ly); tg.addColorStop(0, '#fff3c8'); tg.addColorStop(0.55, '#ffd76a'); tg.addColorStop(1, '#d9883a');
      ctx.shadowColor = 'rgba(255,190,90,0.8)'; ctx.shadowBlur = 30; ctx.fillStyle = tg; ctx.fillText('EMBERS', lx, ly); ctx.shadowBlur = 0;
      ctx.font = '800 44px "Baloo 2", "Noto Sans SC", sans-serif'; ctx.lineWidth = 8; ctx.strokeText('LOST VOYAGE', lx + 8, ly + 52); ctx.fillStyle = '#bfe9ff'; ctx.fillText('LOST VOYAGE', lx + 8, ly + 52);
    } else {
      ctx.font = '400 140px "ZCOOL KuaiLe", "Noto Sans SC", sans-serif'; ctx.lineWidth = 10; ctx.strokeStyle = '#1a0e2c'; ctx.strokeText('余烬：迷航', lx, ly);
      ctx.shadowColor = 'rgba(255,190,90,0.8)'; ctx.shadowBlur = 30; ctx.fillStyle = '#ffd76a'; ctx.fillText('余烬：迷航', lx, ly); ctx.shadowBlur = 0;
      ctx.font = '800 30px "Baloo 2", "Noto Sans SC", sans-serif'; ctx.lineWidth = 6; ctx.strokeText('EMBERS: LOST VOYAGE', lx + 8, ly + 44); ctx.fillStyle = '#bfe9ff'; ctx.fillText('EMBERS: LOST VOYAGE', lx + 8, ly + 44);
    }
    ctx.restore();
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
      if (G.bot && performance.now() < G.bot.until) return gameBot(w, S.me); // K.test.run：游戏自带的机器人在玩（联机测试 / 联机自检）
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
        const bot = G.bot && performance.now() < G.bot.until; // K.test.run：游戏自带的机器人在玩
        while (acc >= STEP && n < 12) { w.setInput(w.meIdx, bot ? gameBot(w, w.meIdx) : { mx: Input.out.mx, my: Input.out.my, focus: Input.out.focus, burst: Input.consume('burst'), dx: ddx, dy: ddy }); ddx = ddy = 0; w.step(STEP); acc -= STEP; n++; }
        if (n >= 12) acc = 0;
        drainWorldEvents();
        Input.flushRumble(G.meta.settings.rumble === undefined ? 1 : G.meta.settings.rumble);
        if (Input.gameActive && Input.consume('pause')) pauseGame();
      } else {
        acc = 0; if (waitShown) mpWait('');
        if (G.bg === 'station') G.stationScene.update(dt); else if (G.bg === 'hub') G.hub.update(dt); else if (G.bg === 'map') G.map.update(dt); else G.sea.update(dt);
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
