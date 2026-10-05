// 联机中转服务器自测：本机起一个 relay.js，用两个最小 WebSocket 客户端检查——
// 握手 / hello、在场状态转发、同房间收完整状态 / 房间外只收摘要、ping、断开后通知、超大状态被拒。
// 用法：node tools/relay-test.js（失败时退出码 1；Node 18+，不需要任何依赖）
const http = require('http'), crypto = require('crypto'), path = require('path'), { spawn } = require('child_process');
const PORT = 18000 + Math.floor(Math.random() * 2000);
const relay = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'relay.js'), String(PORT), path.join(__dirname, '..')], { stdio: ['ignore', 'ignore', 'inherit'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0; const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failed++; };

function client(name) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/mp', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } });
    req.on('upgrade', (res, sock) => {
      const c = { name, sock, msgs: [], buf: Buffer.alloc(0), state: {} }; // state：按服务器的完整 / 增量消息合并出来的每个人的在场状态
      c.send = (obj) => { const p = Buffer.from(JSON.stringify(obj)), mask = crypto.randomBytes(4), n = p.length;
        const head = n < 126 ? Buffer.from([0x81, 0x80 | n]) : Buffer.from([0x81, 0x80 | 126, n >> 8, n & 255]);
        const body = Buffer.from(p); for (let i = 0; i < n; i++) body[i] ^= mask[i & 3]; sock.write(Buffer.concat([head, mask, body])); };
      sock.on('data', (d) => { c.buf = Buffer.concat([c.buf, d]);
        while (c.buf.length >= 2) { let len = c.buf[1] & 0x7f, off = 2; if (len === 126) { len = c.buf.readUInt16BE(2); off = 4; } else if (len === 127) { len = Number(c.buf.readBigUInt64BE(2)); off = 10; }
          if (c.buf.length < off + len) break; const op = c.buf[0] & 0x0f, data = c.buf.subarray(off, off + len); c.buf = c.buf.subarray(off + len);
          if (op === 1) { const m = JSON.parse(data.toString()); c.msgs.push(m);
            if (m.t === 'hi') for (const q of m.peers) c.state[q.peer] = q.p;
            if (m.t === 'u') for (const q of m.peers) { if (q.p) c.state[q.peer] = q.p; else { const s = Object.assign({}, c.state[q.peer] || {}); for (const k in q.d) { if (q.d[k] === null) delete s[k]; else s[k] = q.d[k]; } c.state[q.peer] = s; } }
            if (m.t === 'bye') delete c.state[m.peer]; } } });
      c.until = async (pred, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { if (pred(c.state)) return true; await sleep(20); } return false; };
      c.wait = async (pred, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(20); } return null; };
      resolve(c);
    });
    req.on('error', reject); req.end();
  });
}

(async () => {
  for (let i = 0; i < 50; i++) { try { await new Promise((ok, no) => http.get({ host: '127.0.0.1', port: PORT, path: '/health' }, ok).on('error', no)); break; } catch (e) { await sleep(100); } }
  const a = await client('a'), b = await client('b');
  a.send({ t: 'hello', id: 'Waaaaaaaa1', ch: 'test' }); await a.wait((m) => m.t === 'hi');
  b.send({ t: 'hello', id: 'Wbbbbbbbb2', ch: 'test' });
  const hi = await b.wait((m) => m.t === 'hi'); check(hi && hi.you === 'Wbbbbbbbb2' && hi.peers.some((p) => p.peer === 'Waaaaaaaa1'), 'hello：拿到自己的身份和已在线的人');
  // a 建房、带操作帧（操作帧单独在 ls 字段）；b 还没进房 → 只能看到摘要
  a.send({ t: 'p', d: { mp: { code: 'ROOM', host: true, name: '甲', plane: 'moon', prof: { s: { dmgK: 1 } }, start: null }, ls: { g: 'G1', r: [[0, 0, 'IIAgg']] } } });
  const okLite = await b.until((s) => s.Waaaaaaaa1 && s.Waaaaaaaa1.mp && s.Waaaaaaaa1.mp.code === 'ROOM');
  const la = b.state.Waaaaaaaa1 || {}; check(okLite && la.mp.name === '甲' && la.ls === undefined && la.mp.prof === undefined, '房间外：只收到房间摘要，不带操作帧和资料');
  b.send({ t: 'p', d: { mp: { code: 'ROOM', host: false, name: '乙', plane: 'cloud' } } });
  check(await b.until((s) => s.Waaaaaaaa1 && s.Waaaaaaaa1.ls && s.Waaaaaaaa1.mp.prof), '进房后：收到房主的完整状态（含操作帧、资料）');
  check(await a.until((s) => s.Wbbbbbbbb2 && s.Wbbbbbbbb2.mp && s.Wbbbbbbbb2.mp.name === '乙'), '房主看到新成员');
  // 对局中只改操作帧：服务器只发 ls 这一个字段（资料 / 开局单不重发）
  b.msgs.length = 0; a.send({ t: 'p', d: { ls: { g: 'G1', r: [[0, 0, 'IIAggIIAgg']] } } });
  const upd = await b.wait((m) => m.t === 'u' && m.peers.some((p) => p.peer === 'Waaaaaaaa1'));
  const ent = upd && upd.peers.find((p) => p.peer === 'Waaaaaaaa1');
  check(!!(ent && ent.d && Object.keys(ent.d).join() === 'ls' && b.state.Waaaaaaaa1.mp.prof), '对局中的更新只带变化的字段（只有操作帧）');
  a.send({ t: 'ping', c: 42 }); check(!!(await a.wait((m) => m.t === 'pong' && m.c === 42)), 'ping / pong');
  a.send({ t: 'p', d: { big: 'x'.repeat(9000) } }); check(!!(await a.wait((m) => m.t === 'err' && m.code === 'too_large')), '超过 8 KiB 的状态被拒');
  a.sock.destroy();
  check(!!(await b.wait((m) => m.t === 'bye' && m.peer === 'Waaaaaaaa1', 3000)), '有人断开：其他人收到离开通知');
  const page = await new Promise((ok) => http.get({ host: '127.0.0.1', port: PORT, path: '/' }, (r) => { let s = ''; r.on('data', (d) => (s += d)); r.on('end', () => ok(s)); }));
  check(page.includes('window.DREAMTIDE_WS = "/mp"'), '网页：写入了同源联机地址');
  b.sock.destroy(); relay.kill();
  console.log(failed ? `中转服务器测试失败 ${failed} 项` : '中转服务器测试通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); relay.kill(); process.exit(1); });
