'use strict';
/* 金牌制作人套件的接口（打包工具的“两个客户端联机测试”、测试版的“联机自检”、Steam 外壳都按它来找游戏）。
   这款游戏不是用套件做的：这里把它自己的联机（Lobby、LockstepSession、SteamNet）、画面和机器人包装成套件的样子。
   网页版也会加载，但没有 Steam 时 K.net.available() 是 false，什么都不做。 */
(function () {
  const steam = () => (typeof window !== 'undefined' && window.kitBridge && window.kitBridge.steam) || null;
  const handlers = {};
  const stall = { frame: -1, at: 0, secs: 0 };
  const K = {
    errors: [],
    on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    emit(name, ...args) { for (const fn of handlers[name] || []) { try { fn(...args); } catch (e) { K.errors.push(e); } } },
    scenes: { top() { const s = G.world && !G.world.done && G.bg === 'world' ? 'play' : G.screen; return s ? { name: s } : null; } },
    platform: { get steam() { return steam(); } },
    net: {
      CFG: { inputHz: LOCKSTEP.hz },
      available() { return !!steam(); },
      get transport() { const n = Lobby.net; return n && n.kind === 'steam' ? { kind: 'steam', connected: () => !!n.lobbyId(), invite: () => n.invite() } : null; },
      get pendingInvite() { return Lobby.net ? Lobby.net.pendingInvite || null : null; },
      /* 房主建房（测试和自检用；玩家走联机界面的“创建房间”是同一条路） */
      open() {
        if (!steam()) return false;
        Lobby.connect(); armStart();
        if (!G.meta.nick) G.meta.nick = '玩家' + Math.floor(100 + Math.random() * 900);
        if (!Lobby.code) Lobby.create(mpProfile());
        return true;
      },
      roster() { return Lobby.code ? Lobby.members() : []; },
      start() { armStart(); return Lobby.start('1-1', 0, 'coop', 'real', 0); }, // 合作、自动缓冲、从第 1 关开始（试玩版也一样）
      get match() {
        const S = Lobby.session; if (!S || !G.mpLoop || !G.world || G.world.done) return null;
        const drops = Object.assign({}, S.drops); for (let j = 0; j < S.n; j++) if (drops[j] === undefined && S.openAway(j)) drops[j] = S.openAway(j)[0]; // 断线中（席位保留、不再等他）也算移出
        return { selfIndex: S.me, session: { frame: S.simFrame, desync: S.desync ? { frame: S.desync.frame } : null, drops, hashLog: S.hashLog } };
      },
      waitingFor() { const S = Lobby.session; return S && G.mpLoop ? S.waitingFor() : []; },
      stalledFor() { return stall.secs; },
    },
    game: {
      netcheck: {
        enter() { armStart(); return !!(G.mpLoop && G.world); }, // 开局已经由 Lobby.onStart 进了对局
        status() { const S = Lobby.session; return S && G.mpLoop ? `第 ${S.simFrame} 帧 · ${S.n} 人` : Lobby.code ? `房间 ${Lobby.code} · ${K.net.roster().length} 人` : '不在房间里'; },
      },
    },
    /* 让游戏自带的机器人玩 secs 秒。联机时只开机器人（它的操作照常进帧同步）；
       单人时走一遍整个流程：标题 → 站（装备栏、仓库）→ 出击让机器人打 → 结束本局 → 结算 → 回站，每个画面都过一遍 */
    test: {
      run(o) {
        const secs = Math.max(1, Number(o && o.secs) || 30), scenes = new Set(), t0 = performance.now(), until = t0 + secs * 1000, errors0 = K.errors.length;
        const online = !!(G.mpLoop && Lobby.session), tour = online || secs < 20 ? [] : [
          [0, () => { endRunNow(); showTitle(); }],
          [2, () => { G.st.panel = 'equip'; showHub(); }],
          [4, () => { G.st.panel = 'stash'; showHub(); }],
          [6, () => { G.st.panel = null; startRun(stationStart()); G.bot = { until: until - 8000 }; }],
          [secs - 8, () => { G.bot = null; endRunNow(); }],
          [secs - 3, () => { G.st.panel = null; showHub(); }],
        ];
        if (!tour.length) G.bot = { until };
        return new Promise((resolve) => {
          const iv = setInterval(() => {
            const now = performance.now();
            while (tour.length && now - t0 >= tour[0][0] * 1000) { const [, f] = tour.shift(); try { f(); } catch (e) { K.errors.push(e); } }
            const top = K.scenes.top(); if (top) scenes.add(top.name);
            if (now >= until) { clearInterval(iv); G.bot = null; resolve({ scenes: [...scenes], errors: K.errors.slice(errors0), issues: [] }); }
          }, 250);
        });
      },
    },
  };
  /* 测试流程里结束本局：和暂停菜单里的“结束本局”一样结算（单人） */
  function endRunNow() { const w = G.world; if (!w || w.done || G.mpRun) return; w.done = true; const r = w.result(false); r.abandoned = true; G.paused = false; onRunEnd(r); }
  /* 开局的回调：联机界面没打开时（测试从标题直接建房）也要能进对局 */
  function armStart() { if (!Lobby.onStart) Lobby.onStart = (st) => { if (G.mpRun) return false; startMpRun(st); return true; }; }
  /* 卡顿：联机对局里帧号多久没动 */
  NetTicker.on((now) => {
    const S = Lobby.session;
    if (!S || !G.mpLoop) { stall.frame = -1; stall.secs = 0; return; }
    if (S.simFrame !== stall.frame) { stall.frame = S.simFrame; stall.at = now; stall.secs = 0; } else stall.secs = +((now - stall.at) / 1000).toFixed(2);
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => K.errors.push({ message: String(e.message || e) }));
    window.addEventListener('unhandledrejection', (e) => K.errors.push({ message: String(e.reason && e.reason.message || e.reason) }));
    window.K = K;
  }
})();
