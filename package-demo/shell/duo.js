'use strict';
// 联机测试的程序内一侧（套件游戏：K.net、K.game.netcheck、K.test.run）。
// runDuo：打包工具的「两个客户端联机测试」（tools/lib/duo.mjs 启动两个打好的程序，连本机假 Steam）。房主建房，
//   用邀请或让对方从启动参数进房；开局后两边机器人一起玩，每秒记一次进度、同步校验值、卡顿和报错，写进试跑目录。
// createSelfCheck：测试版的「联机自检」。两个真 Steam 账号进同一个房间后房主按快捷键，两边自动打一局、测延迟，
//   结果显示在屏幕上并导出日志；测试者只要把两份日志发回来，不用描述发生了什么。

const fs = require('node:fs');
const path = require('node:path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SELF_SECS = 60;
const SELF_KEY = 'mc_selfcheck';

// 套件已经启动并显示出第一个画面（__K_READY__ 只在网址带 ?test 时才有，打包后的程序没有）
const READY = `!!(globalThis.K && K.scenes && K.scenes.top && K.scenes.top())`;

const CAPS = `(() => {
  const k = globalThis.K;
  return { kit: !!k, ready: !!(k && k.scenes && k.scenes.top && k.scenes.top()),
    online: !!(k && k.net && k.net.available && k.net.available()),
    hook: !!(k && k.game && k.game.netcheck && k.game.netcheck.enter),
    bot: !!(k && k.test && k.test.run),
    steam: !!(k && k.platform && k.platform.steam),
    inputHz: k && k.net && k.net.CFG ? k.net.CFG.inputHz : 30 };
})()`;

const SAMPLE = `(() => {
  const m = K.net.match, s = m && m.session, tr = K.net.transport;
  return { inRoom: !!(tr && tr.connected && tr.connected()), roster: K.net.roster().length,
    match: !!m, me: m ? m.selfIndex : null, frame: s ? s.frame : 0, desync: s && s.desync ? s.desync.frame : null,
    drops: s ? Object.keys(s.drops).map(Number) : [], waiting: K.net.waitingFor(), stalled: +K.net.stalledFor().toFixed(2),
    errors: (K.errors || []).length,
    errorSample: (K.errors || []).slice(-3).map((e) => String(e && (e.message || e.msg) || JSON.stringify(e)).slice(0, 160)),
    top: K.scenes.top() ? K.scenes.top().name : '',
    status: K.game.netcheck && K.game.netcheck.status ? String(K.game.netcheck.status()) : '',
    hashes: s ? [...s.hashLog.entries()].slice(-8) : [] };
})()`;

// 进入联机对局，让游戏自带的机器人玩 secs 秒
const ENTER = (secs) => `(() => {
  K.game.netcheck.enter();
  K.test.run({ secs: ${Number(secs) || 30} }).then((r) => {
    globalThis.__mcDuoBot = { scenes: r.scenes, errors: r.errors.length, issues: r.issues.length };
  });
  return K.scenes.top() ? K.scenes.top().name : '';
})()`;

async function waitFor(ev, expr, ms, every = 250) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const value = await ev(expr);
      if (value) return value;
    } catch {
      // 页面还在加载
    }
    await sleep(every);
  }
  return null;
}

async function sampleOnce(ev) {
  try {
    return await Promise.race([ev(SAMPLE), sleep(4000).then(() => null)]);
  } catch (err) {
    return { failed: String(err && err.message || err) };
  }
}

// ── 两个客户端联机测试（本机假 Steam）──
async function runDuo(win, o) {
  const ev = (expr) => win.webContents.executeJavaScript(expr, true);
  const statusFile = path.join(o.dir, 'duo-status.jsonl');
  const t0 = Date.now();
  const result = { role: o.role, mode: o.mode, ok: false, steps: [], samples: 0, shots: [] };
  const write = (obj) => fs.appendFileSync(statusFile, `${JSON.stringify({ at: Date.now(), ...obj })}\n`, 'utf8');
  const mark = (step, data) => {
    const line = { t: +((Date.now() - t0) / 1000).toFixed(1), at: Date.now(), step, ...(data || {}) };
    result.steps.push(line);
    write({ step, ...(data || {}) });
    o.log.info('duo', step, data);
  };
  const done = (code) => {
    const rec = o.client && o.client.record ? o.client.record : {};
    Object.assign(result, {
      elapsed: Math.round((Date.now() - t0) / 1000),
      consoleErrors: o.runtime.consoleErrors.slice(0, 20),
      crashes: o.runtime.crashes,
      steamCalls: {
        achievements: (rec.achievements || []).slice(0, 50),
        stats: (rec.stats || []).slice(-50),
        presence: (rec.presence || []).slice(-20),
        invites: rec.invites || 0,
        rejected: rec.rejected || [],
      },
      logFile: o.log.file,
    });
    fs.writeFileSync(path.join(o.dir, 'duo-result.json'), JSON.stringify(result, null, 2), 'utf8');
    o.finish(code);
  };
  const shot = async (name) => {
    try {
      const image = await Promise.race([win.webContents.capturePage(), sleep(8000).then(() => null)]);
      if (!image) return;
      const file = `${name}.png`;
      fs.writeFileSync(path.join(o.dir, file), image.toPNG());
      result.shots.push(file);
    } catch {
      // 截图失败不影响测试
    }
  };

  try {
    await new Promise((resolve) => {
      if (!win.webContents.isLoading()) return resolve();
      win.webContents.once('did-finish-load', resolve);
    });
    if (!(await waitFor(ev, READY, 30000))) {
      const kit = await ev('!!globalThis.K').catch(() => false);
      result.skipped = kit ? '套件游戏 30 秒内没有显示出第一个画面' : '不是用金牌制作人套件做的游戏（没有 K.net 联机接口），这一项只能测套件游戏';
      mark('跳过', { reason: result.skipped });
      return done(0);
    }
    const caps = await ev(CAPS);
    result.caps = caps;
    const missing = [!caps.online && '游戏没有开联机（K.config.maxPlayers 或 Steam 联机不可用）', !caps.hook && '游戏没有 K.game.netcheck.enter',
      !caps.bot && '游戏没有 K.test.run', !caps.steam && '程序里没有接上 Steam 桥'].filter(Boolean);
    if (missing.length) {
      result.skipped = missing.join('；');
      mark('跳过', { reason: result.skipped });
      return done(0);
    }
    mark('游戏就绪');

    if (o.role === 'host') {
      await ev(`(() => { K.net.open('main'); return 1; })()`);
      const lobby = await waitFor(ev, `K.net.transport && K.net.transport.connected() ? String(K.platform.steam.lobby.id()) : null`, 15000);
      if (!lobby) throw new Error('房主没能建好房间');
      mark('建好房间', { lobby });
      // 对方可能还没启动完：邀请每 3 秒发一次，直到他进房
      let roster = 0;
      let invitedAt = 0;
      const until = Date.now() + 60000;
      while (Date.now() < until) {
        if (o.mode === 'invite' && Date.now() - invitedAt > 3000) {
          await ev('(() => { K.net.transport.invite(); return 1; })()');
          if (!invitedAt) mark('发出邀请');
          invitedAt = Date.now();
        }
        roster = await ev('K.net.roster().length');
        if (roster >= 2) break;
        await sleep(250);
      }
      if (roster < 2) throw new Error('等了 60 秒，对方没有进房');
      mark('对方进房', { roster });
      await sleep(1500);
      if (o.mode === 'selfcheck') {
        // 联机自检演练：走房主按 Cmd/Ctrl+Shift+N 的同一段代码
        if (!o.selfCheck) throw new Error('程序里没有联机自检（只有测试版有）');
        o.selfCheck.trigger();
        mark('房主发起联机自检');
      } else {
        await ev(`(() => { K.net.start(${o.seed >>> 0}); return 1; })()`);
        mark('房主开始');
      }
    } else {
      const joined = await waitFor(ev, `K.net.transport && K.net.transport.kind === 'steam' && K.net.roster().length >= 2`, 60000);
      if (!joined) throw new Error('等了 60 秒，没能进入房主的房间');
      mark('进入房间', await ev(`({ invite: K.net.pendingInvite, top: K.scenes.top() ? K.scenes.top().name : '' })`));
    }

    if (o.mode === 'selfcheck') {
      if (!o.selfCheck) throw new Error('程序里没有联机自检（只有测试版有）');
      const end = Date.now() + (o.secs + 90) * 1000;
      while (Date.now() < end && !(o.selfCheck.state().last)) await sleep(500);
      result.selfcheck = o.selfCheck.state().last;
      if (!result.selfcheck) throw new Error('联机自检没有结束');
      mark('联机自检结束', { ok: result.selfcheck.ok });
      result.ok = true;
      return done(0);
    }
    if (!(await waitFor(ev, '!!K.net.match', 20000))) throw new Error('20 秒内没有开局');
    mark('开局', { top: await ev(ENTER(o.secs)) });

    const matchT0 = Date.now();
    const end = matchT0 + (o.secs + o.tail) * 1000;
    let shotTaken = false;
    while (Date.now() < end) {
      await sleep(1000);
      const s = await sampleOnce(ev);
      if (!s) {
        mark('页面 4 秒没有响应');
        continue;
      }
      s.t = +((Date.now() - matchT0) / 1000).toFixed(1);
      write({ sample: s });
      result.samples += 1;
      result.last = s;
      if (!shotTaken && Date.now() - matchT0 > Math.min(10, o.secs / 2) * 1000) {
        shotTaken = true;
        await shot(`duo-${o.round}-${o.role}`);
      }
    }
    result.bot = await ev('globalThis.__mcDuoBot || null');
    result.ok = true;
    mark('结束');
    return done(0);
  } catch (err) {
    result.error = String(err && err.message || err);
    mark('中断', { error: result.error });
    await shot(`duo-${o.round}-${o.role}-中断`);
    return done(1);
  }
}

// ── 测试版的联机自检（真 Steam，两个账号）──
const OVERLAY_JS = (id, html, ms) => `(() => {
  const old = document.getElementById(${JSON.stringify(id)}); if (old) old.remove();
  if (!document.body) return;
  const d = document.createElement('div'); d.id = ${JSON.stringify(id)}; d.innerHTML = ${JSON.stringify(html)};
  d.style.cssText = 'position:fixed;left:50%;top:12%;transform:translateX(-50%);z-index:2147483647;max-width:min(720px,90vw);'
    + 'font:16px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#fff;background:rgba(10,12,20,.92);'
    + 'padding:16px 22px;border-radius:10px;border:1px solid rgba(255,255,255,.25);cursor:pointer;white-space:pre-line';
  d.onclick = () => d.remove(); document.body.appendChild(d);
  ${ms ? `setTimeout(() => d.remove(), ${ms});` : ''}
})()`;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function createSelfCheck({ win, bridge, log, exportLogs, secs = SELF_SECS }) {
  const ev = (expr) => win.webContents.executeJavaScript(expr, true);
  const state = { running: false, last: null };
  const toast = (text, ms = 6000) => ev(OVERLAY_JS('__mc_selfcheck_toast', esc(text), ms)).catch(() => {});
  let running = false;
  let seen = null;
  let lobbySeen = null;

  async function run(id) {
    running = true;
    const host = bridge.isOwner();
    const problems = [];
    const facts = [];
    const t0 = Date.now();
    log.info('selfcheck', '开始联机自检', { id, host, members: bridge.members().length });
    state.running = true;
    await toast(`联机自检开始：两边会自动玩一局（约 ${Math.round(secs / 10) * 10 || secs} 秒），不用操作。`, 8000);
    try {
      const caps = await ev(CAPS);
      if (!caps.online || !caps.hook || !caps.bot) throw new Error('这款游戏没有套件的联机测试接口，自检做不了');
      if (host) {
        const roster = await waitFor(ev, `K.net.transport && K.net.transport.kind === 'steam' && K.net.roster().length >= 2 ? K.net.roster().length : 0`, 15000);
        if (!roster) throw new Error('房间里的人没有连上，或者不是同一个游戏版本');
        await ev(`(() => { K.net.start(${(Date.now() % 1e9) >>> 0}); return 1; })()`);
      }
      if (!(await waitFor(ev, '!!K.net.match', 20000))) throw new Error('20 秒内没有开局（房主的开局消息没有传到这台电脑）');
      await ev(ENTER(secs));
      const matchT0 = Date.now();
      let maxStall = 0;
      let last = null;
      while (Date.now() - matchT0 < secs * 1000) {
        bridge.ping();
        await sleep(2000);
        const s = await sampleOnce(ev);
        if (!s || s.failed) continue;
        s.t = Math.round((Date.now() - matchT0) / 1000);
        maxStall = Math.max(maxStall, s.stalled);
        last = s;
        log.info('selfcheck', `第 ${s.t} 秒：第 ${s.frame} 帧`, s);
      }
      const rtt = bridge.rtt().filter((r) => r.ms >= 0 && r.at >= t0).map((r) => r.ms);
      const expected = secs * (caps.inputHz || 30);
      if (!last) throw new Error('读不到游戏的联机状态');
      if (last.desync !== null) problems.push(`两边算出的结果不一样了（第 ${last.desync} 帧不同步）`);
      if (last.frame < expected * 0.6) problems.push(`对局只走到第 ${last.frame} 帧（正常约 ${expected}），一直在等对方的数据`);
      if (maxStall >= 3) problems.push(`最长卡了 ${maxStall.toFixed(1)} 秒`);
      if (last.drops.length) problems.push('对局中有人掉线被移出');
      if (last.errors) problems.push(`游戏报错 ${last.errors} 条：${last.errorSample.join('；')}`);
      if (!rtt.length) problems.push('测延迟的消息一条都没收到回音（Steam 的点对点消息没有通）');
      if (rtt.length) {
        const avg = Math.round(rtt.reduce((a, b) => a + b, 0) / rtt.length);
        // 跨国走 Valve 中继时延迟本来就可能偏高；是否影响游玩由上面的卡顿和进度判断
        facts.push(`来回延迟：平均 ${avg} 毫秒，最高 ${Math.max(...rtt)} 毫秒（${rtt.length} 次）${avg > 250 ? '，偏高：操作可能会觉得慢半拍' : ''}`);
      }
      facts.push(`对局进度：第 ${last.frame} 帧（正常约 ${expected}），最长卡顿 ${maxStall.toFixed(1)} 秒`);
    } catch (err) {
      problems.push(String(err && err.message || err));
    }
    const ok = !problems.length;
    log[ok ? 'info' : 'warn']('selfcheck', ok ? '联机自检通过' : '联机自检没通过', { problems, facts, seconds: Math.round((Date.now() - t0) / 1000) });
    const lines = [ok ? '✅ 联机自检通过' : '❌ 联机自检没通过', ...problems.map((p) => `· ${p}`), ...facts.map((f) => `· ${f}`),
      '', '日志已经导出到桌面：两台电脑的日志文件都发给开发者就行。（点这里关闭）'];
    await ev(OVERLAY_JS('__mc_selfcheck_result', esc(lines.join('\n')), 0)).catch(() => {});
    exportLogs();
    state.last = { ok, problems, facts };
    state.running = false;
    running = false;
  }

  // 每台电脑每秒看一次房间数据：房主写入新的自检编号就开始
  const watch = setInterval(() => {
    if (running || win.isDestroyed()) return;
    let id = null;
    try {
      const lobby = bridge.lobbyId();
      id = lobby ? bridge.lobbyData(SELF_KEY) : null;
      if (lobby !== lobbySeen) {
        lobbySeen = lobby;
        // 刚进房前一刻发起的自检照样参加；更早一轮留下的旧编号不算（编号是房主电脑的时间，留 30 秒给两台电脑的时差）
        if (!(id && Math.abs(Date.now() - Number(id)) < 30000)) {
          seen = id;
          return;
        }
      }
    } catch {
      return;
    }
    if (id && id !== seen) {
      seen = id;
      run(id).catch((err) => {
        running = false;
        log.error('selfcheck', '联机自检出错', { error: String(err && err.stack || err) });
      });
    }
  }, 1000);

  return {
    trigger() {
      if (running) return toast('联机自检正在进行。');
      if (!bridge.lobbyId()) return toast('先进入联机房间（一边邀请、一边加入），再按这个键。');
      if (!bridge.isOwner()) return toast('请在房主的电脑上按这个键。');
      if (bridge.members().length < 2) return toast('房间里至少要有两个人。');
      const id = String(Date.now());
      if (!bridge.setLobbyData(SELF_KEY, id)) return toast('没能通知房间里的人，看日志。');
      log.info('selfcheck', '房主发起联机自检', { id, members: bridge.members().length });
      return null;
    },
    state: () => ({ running: state.running, last: state.last }),
    close: () => clearInterval(watch),
  };
}

module.exports = { runDuo, createSelfCheck };
