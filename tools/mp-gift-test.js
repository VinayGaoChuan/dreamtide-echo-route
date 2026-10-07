// 真联机送装备（docs/design.md §13）：本地中转服务器 + 两个无头 Chrome（各自的存档）。甲建房、乙加入，甲从仓库挑一件送给乙：
// 只能挑蓝黄绿（暗金不在列表里）；乙收到一件、标着是谁送的；甲看到回执后待送清空、自己仓库少一件。失败时退出码 1。
// 用法：node tools/mp-gift-test.js（需要本机装 Chrome）
const path = require('path'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { openGame, sleep } = require('./chrome-env');
(async () => {
  const relay = spawn(process.execPath, [path.join(ROOT, 'server/relay.js')], { env: Object.assign({}, process.env, { PORT: '8095' }), stdio: 'ignore' });
  await sleep(800);
  const A = await openGame({ W: 1280, H: 720 }), B = await openGame({ W: 1280, H: 720 });
  try {
    for (const P of [A, B]) { const url = await P.ev('location.href'); await P.page.send('Page.navigate', { url: url.split('?')[0] + '?mp=ws://127.0.0.1:8095/mp' }); }
    await sleep(2500);
    const setup = (nick) => `(() => { const m = Station.ensure(G.meta); m.seenTitle = true; m.firstRunDone = true; m.tutorialDone = true; m.nick = '${nick}'; m.pilot.lv = 10;
      const R = Gear.rng(${Math.floor(Math.random() * 1e6)}); m.gear.stash = []; for (const q of ['blue', 'yellow', 'gold']) Station.addItem(m, q === 'gold' ? Gear.make({ rnd: R, ilvl: 5, q, uni: 'oldScav' }) : Gear.make({ rnd: R, ilvl: 5, q }), true);
      clearScreens(); showMultiplayer(() => {}); return true; })()`;
    await A.ev(setup('甲')); await B.ev(setup('乙')); await sleep(2500);
    await A.ev("document.querySelector('#mp-create').click(); true"); await sleep(2500);
    const code = await A.ev('Lobby.code');
    await B.ev(`(() => { const b = [...document.querySelectorAll('[data-join]')].find((x) => x.dataset.join === '${code}'); if (b) b.click(); return !!b; })()`); await sleep(3000);
    const btns = await A.ev("[...document.querySelectorAll('[data-gift]')].map((b) => [b.dataset.gift, b.disabled])");
    console.log('room', code, 'gift buttons on A:', JSON.stringify(btns));
    await A.ev("document.querySelector('[data-gift]').click(); true"); await sleep(600);
    const picks = await A.ev("[...document.querySelectorAll('[data-giftitem]')].map((b) => b.textContent.trim())");
    console.log('A can give:', JSON.stringify(picks));
    await A.ev("document.querySelector('[data-giftitem]').click(); true"); await sleep(4000);
    const a = await A.ev("({ outbox: G.meta.gear.outbox.length, stash: G.meta.gear.stash.map((i) => i.q) })"), b = await B.ev("({ got: G.meta.gear.giftsGot.length, stash: G.meta.gear.stash.map((i) => i.q + (i.from ? '←' + i.from : '')) })");
    console.log('A after:', JSON.stringify(a)); console.log('B after:', JSON.stringify(b));
    const ok = a.outbox === 0 && b.got === 1 && b.stash.some((x) => x.includes('←甲')) && a.stash.length === 2 && picks.length === 2; // 暗金不能送
    console.log(ok ? '送装备真联机测试通过' : '送装备真联机测试失败'); process.exitCode = ok ? 0 : 1;
  } catch (e) { console.error('ERR', e.message); process.exitCode = 1; }
  finally { A.close(); B.close(); relay.kill(); }
})();
