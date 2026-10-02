# 梦潮：回声航线

Q 版手绘风的横版自动射击 Roguelite（HTML / Canvas Demo，目标平台 Steam：键鼠 + 手柄 / Steam Deck）。
一关是一串主目标：普通怪群 → 厚甲怪 → 厚甲编队 → 带队精英 → 多方向来敌 → 场景惊喜 → Boss；升级靠地图装置和精英核心的升级仪式。

在线游玩：https://vinaygaochuan.github.io/dreamtide-echo-route/

## 操作

| 操作 | 键鼠 | 手柄 |
|---|---|---|
| 移动 | WASD / 方向键，或按住鼠标拖动（Shift 慢速） | 左摇杆 / 十字键 |
| 射击 | 自动开火，子弹固定向右 | 同左 |
| 大招 | 空格 | A（任意主按钮） |
| 暂停 | Esc | Start |

存档保存在各自浏览器的 localStorage（key `dreamtide.echo-route.v3`）。

## 本地运行

不需要安装依赖，也没有构建步骤：

- 直接用浏览器打开 `index.html`；或者
- 在仓库根目录起一个静态服务：`python3 -m http.server 8000`（Windows：`py -3 -m http.server 8000`），再打开 http://localhost:8000/

## 目录

| 文件 | 内容 |
|---|---|
| `index.html` | 页面骨架、全部 CSS、SVG 图标、脚本加载顺序（顺序有依赖，新增脚本要按依赖插进去） |
| `js/util.js` | 小工具、存档 `Store`（含旧版存档迁移）、默认设置 |
| `js/data.js` | **所有可调数据**：飞机、技能、联动、流派 `BUILD_PATHS`、关卡 `STAGES`、目标链 `STAGE_PLANS`、地图装置、受伤复盘文案、验收指标 |
| `js/audio.js` | 程序化音乐与音效（WebAudio） |
| `js/input.js` | 键鼠 / 手柄输入、手柄震动 |
| `js/art.js` · `js/mapart.js` | 程序化美术（飞机、敌人、场景、地图装置） |
| `js/world.js` | 战斗主循环：玩家、敌人、子弹、大招、粒子、渲染、HUD 快照 |
| `js/foes.js` | 厚甲怪、带队精英、残骸刷怪核心、顿帧与击杀反馈 |
| `js/director.js` | 目标调度：目标链、优势窗口、预告、各种入场方式、首次大招教学 |
| `js/offers.js` | 局内 Build 与升级仪式（候选、品质提升、卡片、中央展示、飞进槽位） |
| `js/mapfx.js` | 地图互动：梦灯屋、风车塔、星砂矿、救援吊舱、伙伴 |
| `js/surprise.js` | 场景惊喜：月亮怪、贴纸拟态、拟态梦灯屋 |
| `js/boss.js` · `js/captain.js` | 失控闹钟 Boss、关卡队长 |
| `js/net.js` | 联机：帧同步会话 `LockstepSession`、操作编码、转发层（Claude 房间 / 本机多窗口）、联机房间 `Lobby` |
| `js/ui.js` | 菜单、大厅、联机房间、HUD、结算、设置、图鉴 |
| `js/main.js` | 启动、自适应舞台、固定步长主循环、联机主循环 |
| `tools/smoke-sim.js` | 无头冒烟测试（假画布跑三关） |
| `tools/mp-sim.js` | 联机同步测试：几个独立 JS 环境各跑一份同一局，逐帧比对状态 |
| `build.py` | 把 js 内联成单个 HTML |
| `docs/` | 全部策划文档和美术规范；先看 [docs/README.md](docs/README.md)（阅读顺序、冲突时以哪份为准、哪些部分已不做） |

所有代码都是浏览器原生 JS，多个文件共享全局作用域；`World` 的方法分散在几个文件里，用 `Object.assign(World.prototype, {...})` 挂上去。

## 改完之后的检查

```bash
for f in js/*.js tools/*.js; do node --check "$f"; done   # 语法
node tools/smoke-sim.js js                                 # 三关无头通关模拟（约 1~2 分钟）
node tools/smoke-sim.js js 1-2                             # 只跑一关
node tools/mp-sim.js js all 2 direct                       # 联机：2 人跑三关，逐帧比对是否同步
node tools/mp-sim.js js 1-2 3 net 0.2 100 5                # 联机：3 人，20% 丢包、100 毫秒延迟、缓冲 5 帧
node tools/mp-sim.js js 1-1 2 net 0.15 80 4 1@2500         # 联机：第 2 位玩家在第 2500 帧掉线
python3 build.py dist/dreamtide.html                       # 打包单文件（dist/ 不入库）
```

冒烟测试里“不会受伤”的两局必须通关，脚本不能报错；会被击中的普通机器人输了不算失败，只用来看胜率和节奏数据。
GitHub Actions（`.github/workflows/check.yml`）会在每次推送到 main 和每个 PR 上自动跑同样的检查，结果显示在提交旁边。

## 联机（2–4 人合作）

**玩法**：大厅点「联机」→ 创建房间或加入别人的房间 → 房主选关、点开始。每人开自己的飞机、带自己的天赋和共享等级，**局内各有一套**：
- **升级**：装置、精英核心、场景惊喜给的升级，每架飞机各来一次、各选各的（主炮 / 支援 / 大招改造 / 联动 / 流派都是自己的）。联机时升级仪式只在自己屏幕上演，战场不慢放；选的那位套着护盾、不受伤也不开火，队友头上能看到“选升级中”。
- **掉落**：每次掉落每人各一份，只有自己看得见、吸得到；自己机型和自己联动带来的额外掉落只给自己。
- **资源**：星砂、宝箱、碎片、升级次数各记各的，结算时各领各的。连杀、击破数是全队的。
- **倒下**：队友飞过去贴住 1 秒就地救起（2 颗心、短暂无敌）；没人来救的话 10 秒后在队友身边自动复活。

有人掉线或退出，所有人在同一帧把那架飞机移除，其余人继续。联机时公开按人数加厚：大型敌人血量 ×(1 + 0.6 × (人数 − 1))，Boss ×(1 + 0.7 × (人数 − 1))。暂停菜单不会冻结联机战斗，只是自己的飞机原地不动。

**同步方式：帧同步，只发操作**。每秒 30 个操作帧，每帧推进 4 个模拟步（1/120 秒）；每人每帧只发 5 个字符（方向、慢速、大招、拖动），各端用同一个种子、同样的操作各自模拟同一局，不发游戏状态。本机操作晚几帧生效（房间里可选“网络缓冲 短 / 标准 / 长”），用来盖住网络延迟；凑不齐某一帧所有人的操作就等（画面提示“等待 XX 的操作…”）。每 30 帧各端交换一次状态哈希，对不上会提示。

**改玩法代码必须守的规则**（否则联机会分叉，`tools/mp-sim.js` 会报出第一帧和差异字段）：

- 影响玩法的随机数一律用 `srand / srandi / spick`（这一局的种子）；`rand / randi / pick`（`Math.random`）只能用在纯画面效果上。
- 模拟里不读真实时间（`Date.now`、`performance.now`），不读设置项、窗口尺寸；联机时画面宽度固定 1280。
- `this.me` 只用于画面、HUD、音效和震动；模拟里的“当前玩家”是 `this.player`（`withPlayer(q, fn)` 切换），找目标用 `nearestPlayer / pickTarget`。
- 新实体的 id 用 `this.eid++`；画面代码（render、HUD）不能改任何玩法状态。
- Build 和资源是每架飞机一份：`this.gun / support / bmod / links / ritual / picks …` 读写的是 `this.player` 那架的（offers.js 顶部的访问器），资源记在 `p.res`；掉落用 `dropPickup`（多人时自动每人一份，`mineDrop()` 只给当前这架）。只给本机看 / 听的表现（音效、横幅、仪式画面、图鉴解锁）用 `this.mine()` 判断，玩法数据不许放在这种判断里面。

**转发层**（`js/net.js`，接口都是“在场状态”：`peers() / presence(patch) / onChange / connected / close`）：

| 环境 | 转发 | 说明 |
|---|---|---|
| 在 Claude 里打开的游戏 Artifact | `RoomNet`：Claude Artifact 的 `room` 能力 | 打开同一个链接、已登录的同组织成员互相可见；每人的在场状态 ≤ 4 KiB、约 30 次 / 秒、只保留最新——所以每份状态都带着“别人还缺的那段操作帧”，丢了下一份补上 |
| GitHub Pages / 本地 / 未登录 | `LocalNet`：BroadcastChannel | 只连同一浏览器的多个窗口，用来测试：同一个地址开两个窗口就能进同一个房间 |
| Steam（下一步） | 待做：Steam 大厅 + `ISteamNetworkingMessages`（Electron + steamworks.js） | 实现同一套在场状态接口即可，帧同步和游戏代码不用改 |

标签页切到后台时浏览器会停掉画面刷新，联机由 Worker 计时器（`NetTicker`）继续采操作、跑模拟，队友不用等。

## 协作流程

1. 开工前先同步：`git pull`（等于 fetch + merge；不要用 rebase）。
2. 改动尽量小而集中，一次提交说清一件事；提交说明用中文写“改了什么、为什么”。
3. 推送前在本地跑一遍上面的检查。
4. `git push` 到 main 后，GitHub Pages 大约 1 分钟内自动更新线上版本——**推上去就是对外版本**，没把握的改动可以先开 PR，等检查变绿再合并。
5. 多人同时改 `js/data.js` 或 `index.html` 最容易冲突，动之前在群里说一声。

不要提交：`.ai/`（本地临时区）、`dist/`（打包产物）、`.DS_Store`、`node_modules/`（已写进 `.gitignore`）。

## 约定

- 只做 Steam（键鼠 + 手柄 / Steam Deck）：不做手机适配，也不做商业化运营（付费、广告、战令等）。
- 玩家看到的文字一律中文，一句话说清，不写系统规则长文；代码注释也用中文。
- 机制 / 技能的说明统一写成：图标 + 名字，换行一句话（不写伤害、冷却、百分比这类数值），强弱用箭头——绿色 ▲ 加强、红色 ▼ 削弱，1~3 个表示幅度。数据写在 `js/data.js`（技能的 `lv` 一句话 + `fx` 箭头），网页用 `fxHtml` / `abilityHtml`，画布用 `drawFx`。
- 美术全部是 Canvas 程序化绘制，不引入外部图片和第三方库。
- 改了存档结构，要在 `js/util.js` 的 `Store` 里写迁移，不能让旧存档读坏。
- 数值按关卡固定，不随玩家变强偷偷给敌人加血（联机按人数加厚是公开规则，见上文）。
