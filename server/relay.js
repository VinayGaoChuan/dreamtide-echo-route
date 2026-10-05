'use strict';
/* 梦潮：回声航线 — 联机中转服务器（零依赖，Node 18+）。
   只转发每个玩家的“在场状态”（和游戏里 RoomNet / LocalNet 同一种语义：每人一个对象，最新的覆盖旧的），不跑任何游戏逻辑：
   帧同步的操作帧就装在在场状态里，所有判定都在各个客户端用同一个种子各自模拟。
   · 同一个端口：HTTP 提供游戏网页（public/index.html，打包好的单文件），/mp 是 WebSocket；网页和连接同源，不需要证书。
   · 频道：客户端 hello 里带 ch（游戏版本），不同版本互不干扰。
   · 省流量：同一房间（mp.code 相同）的人收完整状态；其他人只收房间摘要（房间号、名字、机型、是否开局），用于大厅列表。
     只发变了的字段：对每个接收者记住上次发给他的每个字段，下一次只发变化（对局中基本只有操作帧 ls 在变，资料 / 开局单不再重发）。
   · 保护：每人状态 ≤ 8 KiB、每秒消息数、每个 IP 连接数、每频道人数都有上限；15 秒没有心跳就断开。
   用法：node relay.js [端口=8080] [网页目录=./public] */
const http = require('http'), crypto = require('crypto'), fs = require('fs'), path = require('path');

const PORT = +(process.argv[2] || process.env.PORT || 8080);
const PUBLIC = path.resolve(process.argv[3] || process.env.PUBLIC_DIR || path.join(__dirname, 'public'));
const LIMIT = { presence: 8192, frame: 65536, perIp: 8, perChannel: 64, msgPerSec: 90, pingMs: 5000, deadMs: 15000 };
const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ---------- HTTP：网页 + 健康检查 ---------- */
const channels = new Map(); // ch -> Map(peerId -> peer)
/* 当前网页的版本（打包时写进去的哈希）和部署的提交：告诉客户端“有新版本了，刷新一下” */
let pageInfo = { mtime: 0, build: null };
function pageBuild() {
  try { const f = path.join(PUBLIC, 'index.html'), st = fs.statSync(f); if (st.mtimeMs !== pageInfo.mtime) { const m = /DREAMTIDE_BUILD = "([\w-]+)"/.exec(fs.readFileSync(f, 'utf8').slice(0, 4096)); pageInfo = { mtime: st.mtimeMs, build: m ? m[1] : null }; } } catch (e) { pageInfo = { mtime: 0, build: null }; }
  return pageInfo.build;
}
function deployedSha() { try { return fs.readFileSync(path.join(PUBLIC, 'version.txt'), 'utf8').trim().slice(0, 40); } catch (e) { return null; } }
function stats() { let n = 0; for (const c of channels.values()) n += c.size; return { ok: true, peers: n, channels: channels.size, uptime: Math.round(process.uptime()), build: pageBuild(), commit: deployedSha() }; }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(stats())); return; }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    fs.readFile(path.join(PUBLIC, 'index.html'), 'utf8', (err, html) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('还没有部署游戏网页'); return; }
      // 告诉网页：联机走同源的 /mp
      const tag = '<script>window.DREAMTIDE_WS = "/mp";</script>';
      html = /<meta charset="utf-8">/i.test(html) ? html.replace(/<meta charset="utf-8">/i, (m) => m + tag) : tag + html;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); res.end(html);
    });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found');
});

/* ---------- 最小的 WebSocket（RFC 6455）：握手、文本帧、ping / pong、关闭 ---------- */
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x'), key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/mp' || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const ip = (req.headers['x-forwarded-for'] || socket.remoteAddress || '').split(',')[0].trim();
  if (ipCount(ip) >= LIMIT.perIp) { socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const conn = { socket, ip, buf: Buffer.alloc(0), frag: null, alive: Date.now(), peer: null, msgT: 0, msgN: 0, closed: false };
  conns.add(conn);
  socket.on('data', (d) => onData(conn, d));
  socket.on('end', () => drop(conn)); // HTTP 服务器的连接是半开的：对方只发 FIN（没发关闭帧）时只有 end，没有 close
  socket.on('close', () => drop(conn));
  socket.on('error', () => drop(conn));
});
const conns = new Set();
function ipCount(ip) { let n = 0; for (const c of conns) if (c.ip === ip) n++; return n; }
function frame(op, payload) {
  const n = payload.length, head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : null;
  if (!head) { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return Buffer.concat([h, payload]); }
  return Buffer.concat([head, payload]);
}
function send(conn, obj) { if (!conn.closed && conn.socket.writable) conn.socket.write(frame(1, Buffer.from(JSON.stringify(obj)))); }
function onData(conn, d) {
  conn.buf = Buffer.concat([conn.buf, d]);
  while (conn.buf.length >= 2) {
    const b = conn.buf, fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80; let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; } else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    if (len > LIMIT.frame || !masked) { close(conn, 1009); return; } // 客户端发来的帧必须带掩码
    if (b.length < off + 4 + len) return;
    const mask = b.subarray(off, off + 4), data = Buffer.from(b.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    conn.buf = b.subarray(off + 4 + len);
    conn.alive = Date.now();
    if (op === 0x8) { close(conn, 1000); return; }
    if (op === 0x9) { conn.socket.write(frame(0xA, data)); continue; }
    if (op === 0xA) continue;
    if (op === 0x1 || op === 0x2) conn.frag = fin ? null : [data];
    else if (op === 0x0 && conn.frag) { conn.frag.push(data); if (!fin) continue; }
    if (!fin) continue;
    const msg = op === 0x0 ? Buffer.concat(conn.frag || [data]) : data; conn.frag = null;
    if (msg.length > LIMIT.frame) { close(conn, 1009); return; }
    onMessage(conn, msg.toString('utf8'));
  }
}
function close(conn, code) { if (conn.closed) return; const p = Buffer.alloc(2); p.writeUInt16BE(code); try { conn.socket.write(frame(0x8, p)); conn.socket.end(); } catch (e) { /* ignore */ } drop(conn); }

/* ---------- 在场状态 ---------- */
function onMessage(conn, text) {
  const now = Date.now();
  if (now - conn.msgT > 1000) { conn.msgT = now; conn.msgN = 0; }
  if (++conn.msgN > LIMIT.msgPerSec) return; // 太快的直接丢（客户端最多约 60 次 / 秒）
  let m; try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'ping') { send(conn, { t: 'pong', c: m.c, s: Date.now() }); return; } // 带上服务器时间：客户端据此对时，大家同一刻开局
  if (m.t === 'hello' && !conn.peer) return hello(conn, m);
  if (m.t === 'p' && conn.peer && m.d && typeof m.d === 'object') {
    const P = conn.peer, next = Object.assign({}, P.presence);
    for (const k of Object.keys(m.d)) { if (m.d[k] === null) delete next[k]; else next[k] = m.d[k]; }
    const json = JSON.stringify(next);
    if (Buffer.byteLength(json) > LIMIT.presence) { send(conn, { t: 'err', code: 'too_large' }); return; }
    const room = roomOf(P);
    P.presence = next; P.json = json; P.at = now; P.fj = fieldsJson(next); P.lfj = fieldsJson(liteView(next));
    markDirty(P, room !== roomOf(P)); // 换了房间：他看别人的视图也全变了
  }
}
function hello(conn, m) {
  const ch = String(m.ch || 'main').slice(0, 40), id = /^[\w-]{6,40}$/.test(m.id || '') ? m.id : 'P' + crypto.randomBytes(6).toString('hex');
  let C = channels.get(ch); if (!C) { C = new Map(); channels.set(ch, C); }
  const old = C.get(id);
  if (old) { old.conn.peer = null; close(old.conn, 4000); } // 同一个标签页重连：顶掉旧连接，身份不变
  if (C.size >= LIMIT.perChannel) { send(conn, { t: 'err', code: 'full' }); close(conn, 4001); return; }
  const P = { id, ch, conn, presence: old ? old.presence : {}, json: old ? old.json : '{}', at: Date.now(), sent: new Map() };
  P.fj = fieldsJson(P.presence); P.lfj = fieldsJson(liteView(P.presence));
  conn.peer = P; C.set(id, P); markDirty(P, false);
  send(conn, { t: 'hi', you: id, build: pageBuild(), peers: [...C.values()].filter((q) => q !== P).map((q) => ({ peer: q.id, p: JSON.parse(viewJson(P, q)), at: q.at })) });
  for (const q of C.values()) if (q !== P) P.sent.set(q.id, Object.assign({}, viewFJ(P, q)));
  log('join', ch, id, conn.ip, `(${C.size})`);
}
const roomOf = (p) => (p.presence.mp && typeof p.presence.mp.code === 'string' ? p.presence.mp.code : null);
const sameRoom = (a, b) => { const r = roomOf(a); return !!r && r === roomOf(b); };
/* 房间外的人只需要大厅列表要用的字段（不带操作帧和资料） */
function liteView(pres) {
  const mp = pres.mp; if (!mp || typeof mp !== 'object') return {};
  return { mp: { code: mp.code, host: mp.host, name: mp.name, plane: mp.plane, stage: mp.stage, start: mp.start ? { id: mp.start.id } : null } };
}
function fieldsJson(obj) { const o = {}; for (const k of Object.keys(obj)) o[k] = JSON.stringify(obj[k]); return o; }
function viewFJ(rcv, q) { return sameRoom(rcv, q) ? q.fj : q.lfj; }
function viewJson(rcv, q) { const f = viewFJ(rcv, q); return '{' + Object.keys(f).map((k) => JSON.stringify(k) + ':' + f[k]).join(',') + '}'; }
function drop(conn) {
  if (conn.closed) return; conn.closed = true; conns.delete(conn);
  try { conn.socket.destroy(); } catch (e) { /* ignore */ }
  const P = conn.peer; if (!P) return;
  const C = channels.get(P.ch); if (!C || C.get(P.id) !== P) return;
  C.delete(P.id);
  for (const q of C.values()) { q.sent.delete(P.id); send(q.conn, { t: 'bye', peer: P.id }); }
  if (!C.size) channels.delete(P.ch);
  log('leave', P.ch, P.id, `(${C.size})`);
}

/* 有变化就转发：收到谁的新状态，马上把变了的字段推给同频道的人（同一轮事件循环里到的几条合并成一次）。
   以前固定每 33 毫秒批量推一次，操作帧平均要多等十几毫秒、最多 33 毫秒；帧同步里这段等待会直接变成所有人的操作延迟。 */
const dirtyPeers = new Set(), dirtyViewers = new Set(); let flushQueued = false;
function markDirty(P, viewer) { dirtyPeers.add(P); if (viewer) dirtyViewers.add(P); if (!flushQueued) { flushQueued = true; setImmediate(flushDirty); } }
function flushDirty() {
  flushQueued = false;
  const outs = new Map(); // 接收者 -> 这次要发的若干条
  const push = (rcv, q) => {
    const want = viewFJ(rcv, q), had = rcv.sent.get(q.id) || {}, d = [];
    for (const k of Object.keys(want)) if (had[k] !== want[k]) d.push(JSON.stringify(k) + ':' + want[k]);
    for (const k of Object.keys(had)) if (!(k in want)) d.push(JSON.stringify(k) + ':null');
    if (!d.length) return;
    rcv.sent.set(q.id, Object.assign({}, want));
    let o = outs.get(rcv); if (!o) outs.set(rcv, (o = new Map()));
    o.set(q.id, '{"peer":' + JSON.stringify(q.id) + ',"d":{' + d.join(',') + '}}');
  };
  const live = (P) => { const C = channels.get(P.ch); return C && C.get(P.id) === P ? C : null; };
  for (const q of dirtyPeers) { const C = live(q); if (C) for (const rcv of C.values()) if (rcv !== q) push(rcv, q); }
  for (const rcv of dirtyViewers) { const C = live(rcv); if (C) for (const q of C.values()) if (q !== rcv) push(rcv, q); }
  dirtyPeers.clear(); dirtyViewers.clear();
  for (const [rcv, o] of outs) if (!rcv.conn.closed && rcv.conn.socket.writable) rcv.conn.socket.write(frame(1, Buffer.from('{"t":"u","peers":[' + [...o.values()].join(',') + ']}')));
}
/* 心跳：每 5 秒 ping 一次，15 秒没动静就断开（拔网线这类不会主动断的连接） */
setInterval(() => {
  const now = Date.now();
  for (const c of conns) { if (now - c.alive > LIMIT.deadMs) close(c, 1001); else if (c.socket.writable) c.socket.write(frame(0x9, Buffer.alloc(0))); }
}, LIMIT.pingMs);

server.listen(PORT, () => log(`梦潮联机服务器已启动：http://0.0.0.0:${PORT}/  网页目录 ${PUBLIC}`));
process.on('SIGTERM', () => { log('stopping'); server.close(); process.exit(0); });
