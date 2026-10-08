'use strict';
/* Steam 联机（打包后的程序：外壳给 window.kitBridge.steam —— 好友房间 + 点对点消息）。和 WsNet、LocalNet 一样是“在场状态”接口：
   房间 = Steam 大厅（只有好友能进，邀请或从好友列表加入）；每人把自己在场状态的变化发给房间里每个人，每秒再补发一份完整的
   （新进房的人、慢一步的人对齐用）。开局时刻的共同时钟以大厅主人为准：向主人发 ping，主人回自己的时钟。
   打包后的程序不能连外网，所以打包版只走这一条；网页版仍走自己的联机服务器。 */
class SteamNet {
  constructor(steam) {
    this.kind = 'steam'; this.steam = steam; this.selfId = String(steam.net.me()); this.subs = []; this.others = new Map(); this.me = {}; this.pending = null;
    this.members = []; this.lobby = null; this.sentAt = 0; this.fullAt = 0; this.pingAt = 0; this.rtt = null; this.rtts = []; this.rttHi = null;
    this.clock = []; this.clockOff = null; this.clockOwner = null; this.syncedAt = 0; this.pendingInvite = null; this.onInvite = null;
    steam.net.onMessage((from, text) => this.onMsg(String(from), text));
    steam.lobby.onChange(() => this.syncMembers());
    steam.lobby.onJoinRequest((id) => { this.pendingInvite = String(id); if (this.onInvite) this.onInvite(String(id)); });
    this.off = NetTicker.on((now) => this.tick(now));
    this.syncMembers();
  }
  lobbyId() { try { return this.steam.lobby.id() || null; } catch (e) { return null; } }
  owner() { try { return String(this.steam.lobby.owner() || ''); } catch (e) { return ''; } }
  isOwner() { return !!this.lobbyId() && this.owner() === this.selfId; }
  async createLobby() { if (!this.lobbyId()) await this.steam.lobby.create(MP_MAX); this.syncMembers(); return this.lobbyId(); }
  async joinLobby(id) { if (this.lobbyId() !== String(id)) await this.steam.lobby.join(String(id)); if (this.pendingInvite === String(id)) this.pendingInvite = null; this.syncMembers(); return this.lobbyId(); }
  leaveLobby() { if (this.lobbyId()) { try { this.steam.lobby.leave(); } catch (e) { /* 已经不在房间里 */ } } this.syncMembers(); }
  invite() { try { this.steam.lobby.invite(); } catch (e) { /* 没有覆盖层时什么也不做 */ } }
  /* 大厅成员变了：不在房间里的人的状态删掉；新进房的人先收到一份完整的 */
  syncMembers() {
    const id = this.lobbyId();
    let ms = []; try { ms = id ? (this.steam.lobby.members() || []).map(String) : []; } catch (e) { ms = []; }
    const added = ms.filter((x) => x !== this.selfId && !this.members.includes(x));
    this.members = ms; let changed = false;
    for (const k of [...this.others.keys()]) if (!ms.includes(k)) { this.others.delete(k); changed = true; }
    if (id !== this.lobby) { this.lobby = id; this.syncedAt = performance.now(); this.clock = []; this.clockOff = null; this.clockOwner = null; this.others.clear(); changed = true; }
    for (const to of added) this.sendTo(to, { t: 'f', p: this.me });
    if (changed || added.length) this.emit();
  }
  sendTo(to, obj) { try { this.steam.net.send(to, JSON.stringify(obj)); } catch (e) { /* 对方刚离开 */ } }
  sendAll(obj) { const text = JSON.stringify(obj); for (const to of this.members) if (to !== this.selfId) { try { this.steam.net.send(to, text); } catch (e) { /* 对方刚离开 */ } } }
  onMsg(from, text) {
    if (from === this.selfId) return;
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (!this.members.includes(from)) { this.syncMembers(); if (!this.members.includes(from)) return; } // 只认同一个房间里的人
    if (m.t === 'f' || m.t === 'd') {
      const cur = this.others.get(from), pres = m.t === 'f' ? Object.assign({}, m.p || {}) : Object.assign({}, cur ? cur.presence : {});
      if (m.t === 'd') for (const k in m.d || {}) { if (m.d[k] === null) delete pres[k]; else pres[k] = m.d[k]; }
      this.others.set(from, { presence: Object.freeze(pres), updatedAt: Date.now() }); this.emit();
    } else if (m.t === 'ping') this.sendTo(from, { t: 'pong', c: m.c, s: this.isOwner() ? performance.now() : null });
    else if (m.t === 'pong') {
      const now = performance.now(), rtt = now - m.c; this.rtt = Math.round(rtt);
      this.rtts = this.rtts.concat(rtt).slice(-6); this.rttHi = Math.round(Math.max(...this.rtts));
      if (typeof m.s === 'number' && from === this.owner()) {
        if (this.clockOwner !== from) { this.clock = []; this.clockOwner = from; }
        this.clock.push({ rtt, off: m.s + rtt / 2 - now }); if (this.clock.length > 8) this.clock.shift();
        this.clockOff = this.clock.reduce((a, b) => (b.rtt < a.rtt ? b : a)).off; // 最近几次里延迟最小的那次最准
      }
    }
  }
  /* 共同时钟（毫秒）：大厅主人自己的时钟；其他人按对时换算。还没对上时是 null（开局等对上再算） */
  serverNow() { if (!this.lobbyId()) return null; if (this.isOwner()) return performance.now(); return this.clockOff === null ? null : performance.now() + this.clockOff; }
  localPerfOf(ms) { return this.isOwner() || this.clockOff === null ? ms : ms - this.clockOff; }
  tick(now) {
    if (!this.lobbyId()) return;
    if (this.pending && now - this.sentAt >= 16) { this.sendAll({ t: 'd', d: this.pending }); this.pending = null; this.sentAt = now; }
    if (now - this.fullAt > 1000) { this.fullAt = now; this.sendAll({ t: 'f', p: this.me }); }
    const own = this.owner(); // 向大厅主人对时（主人换了就重新对）；也顺便量延迟
    if (own && own !== this.selfId && now - this.pingAt > (this.clock.length < 4 ? 400 : 1000)) { this.pingAt = now; this.sendTo(own, { t: 'ping', c: now }); }
    else if (own === this.selfId && this.members.length > 1 && now - this.pingAt > 1000) { this.pingAt = now; const to = this.members.find((x) => x !== this.selfId); if (to) this.sendTo(to, { t: 'ping', c: now }); } // 主人也量一下延迟（定缓冲用）
  }
  emit() { for (const fn of this.subs) { try { fn(); } catch (e) { console.error('[联机] Steam', e); } } }
  peers() { return [{ peer: this.selfId, isMe: true, presence: this.me, updatedAt: Date.now() }, ...[...this.others].map(([peer, p]) => ({ peer, isMe: false, presence: p.presence, updatedAt: p.updatedAt }))]; }
  presence(patch) {
    const m = Object.assign({}, this.me); for (const k in patch) { if (patch[k] === null) delete m[k]; else m[k] = patch[k]; } this.me = m;
    this.pending = Object.assign(this.pending || {}, patch); this.tick(performance.now()); return Promise.resolve();
  }
  onChange(fn) { this.subs.push(fn); }
  connected() { return true; } // Steam 在跑就算在线；没进房间时房间里只有自己
  stale() { return false; }
  close() { if (this.off) this.off(); this.leaveLobby(); this.subs = []; }
}
