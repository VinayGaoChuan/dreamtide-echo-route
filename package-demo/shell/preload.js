'use strict';
// 存档镜像：游戏照常用 localStorage；这里把它同步到 save.json，Steam 云存档同步这个文件。
// 规则：save.json 比本地新（换了电脑、云端有更新）→ 启动时写回 localStorage；之后本地有变动就导出。

const { contextBridge, ipcRenderer } = require('electron');

// 给页面的入口：导出日志（测试版角标用）、Steam 客户端语言、打开商店页（「加入愿望单」）
contextBridge.exposeInMainWorld('__wgpNative', {
  exportLogs: () => ipcRenderer.send('wgp:export-logs'),
  steamLanguage: () => ipcRenderer.sendSync('wgp:steam-language'),
  hasStore: () => ipcRenderer.sendSync('wgp:store-ready'),
  openStore: () => ipcRenderer.sendSync('wgp:open-store'),
});

// 金牌制作人套件的 kitBridge（K.platform 读它）：退出、全屏、打开网页；Steam 就绪时再加 steam（房间、P2P 消息、
// 好友邀请加入、成就、统计、好友列表状态、覆盖层）。Steam 没就绪就不给 steam，游戏按单机运行，不显示联机入口。
const listeners = { lobby: [], message: [], join: [] };
const call = (list, ...args) => list.forEach((fn) => {
  try {
    fn(...args);
  } catch {
    // 页面里的回调出错不影响别的回调
  }
});
ipcRenderer.on('kit:lobby-change', (event, reason) => call(listeners.lobby, reason));
ipcRenderer.on('kit:message', (event, from, text) => call(listeners.message, from, text));
ipcRenderer.on('kit:join-request', (event, lobbyId) => call(listeners.join, lobbyId));

function steamApi() {
  const info = ipcRenderer.sendSync('kit:steam-info') || {};
  return {
    language: () => info.language || null,
    name: () => info.name || '',
    isSteamDeck: () => Boolean(info.steamDeck),
    cloudEnabled: () => Boolean(info.cloud),
    achievement: (name) => ipcRenderer.send('kit:achievement', String(name)),
    hasAchievement: (name) => Boolean(ipcRenderer.sendSync('kit:achievement-get', String(name))),
    stat: { set: (name, value) => ipcRenderer.send('kit:stat-set', String(name), Number(value)), get: (name) => ipcRenderer.sendSync('kit:stat-get', String(name)) },
    presence: (key, value) => ipcRenderer.send('kit:presence', String(key), value == null ? null : String(value)),
    overlay: (page) => ipcRenderer.send('kit:overlay', String(page)),
    lobby: {
      create: (max) => ipcRenderer.invoke('kit:lobby-create', Number(max) || 4),
      join: (id) => ipcRenderer.invoke('kit:lobby-join', String(id)),
      leave: () => ipcRenderer.send('kit:lobby-leave'),
      id: () => ipcRenderer.sendSync('kit:lobby-id'),
      members: () => ipcRenderer.sendSync('kit:lobby-members') || [],
      owner: () => ipcRenderer.sendSync('kit:lobby-owner'),
      setData: (key, value) => ipcRenderer.send('kit:lobby-set', String(key), String(value)),
      getData: (key) => ipcRenderer.sendSync('kit:lobby-get', String(key)),
      invite: () => ipcRenderer.send('kit:lobby-invite'),
      onChange: (fn) => { listeners.lobby.push(fn); },
      // 好友邀请或好友列表「加入游戏」：fn(lobbyId)；游戏是被邀请启动的，注册时立刻收到那一次
      onJoinRequest: (fn) => {
        listeners.join.push(fn);
        if (info.joinRequest) fn(info.joinRequest);
      },
    },
    net: {
      me: () => info.me,
      send: (steamId, text) => ipcRenderer.send('kit:send', String(steamId), String(text)),
      onMessage: (fn) => { listeners.message.push(fn); },
    },
  };
}

contextBridge.exposeInMainWorld('kitBridge', {
  steam: ipcRenderer.sendSync('kit:steam-ready') ? steamApi() : null,
  quit: () => ipcRenderer.send('kit:quit'),
  openURL: (url) => ipcRenderer.send('kit:open-url', String(url)),
  fullscreen: (on) => ipcRenderer.send('kit:fullscreen', Boolean(on)),
});

const STAMP = '__mc_saved_at';
let lastExported = null;

function snapshot() {
  const items = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key !== STAMP) items[key] = localStorage.getItem(key);
  }
  return items;
}

function restore() {
  const saved = ipcRenderer.sendSync('save:load');
  if (!saved || !saved.items) return;
  const localStamp = Number(localStorage.getItem(STAMP) || 0);
  if (Number(saved.savedAt) <= localStamp) return;
  localStorage.clear();
  for (const [key, value] of Object.entries(saved.items)) localStorage.setItem(key, value);
  localStorage.setItem(STAMP, String(saved.savedAt));
  lastExported = JSON.stringify(saved.items);
}

function flush() {
  try {
    const items = snapshot();
    const json = JSON.stringify(items);
    if (json === lastExported) return;
    const savedAt = Date.now();
    if (ipcRenderer.sendSync('save:store', { savedAt, items })) {
      localStorage.setItem(STAMP, String(savedAt));
      lastExported = json;
    }
  } catch {
    // 存档镜像失败不影响游戏本身（localStorage 仍然有效）
  }
}

try {
  restore();
} catch {
  // 同上
}

setInterval(flush, 10000);
window.addEventListener('mc:flush-save', flush);
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
