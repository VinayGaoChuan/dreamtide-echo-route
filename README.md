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
| `js/ui.js` | 菜单、大厅、HUD、结算、设置、图鉴 |
| `js/main.js` | 启动、自适应舞台、固定步长主循环 |
| `tools/smoke-sim.js` | 无头冒烟测试（假画布跑三关） |
| `build.py` | 把 js 内联成单个 HTML |

所有代码都是浏览器原生 JS，多个文件共享全局作用域；`World` 的方法分散在几个文件里，用 `Object.assign(World.prototype, {...})` 挂上去。

## 改完之后的检查

```bash
for f in js/*.js tools/*.js; do node --check "$f"; done   # 语法
node tools/smoke-sim.js js                                 # 三关无头通关模拟（约 1~2 分钟）
node tools/smoke-sim.js js 1-2                             # 只跑一关
python3 build.py dist/dreamtide.html                       # 打包单文件（dist/ 不入库）
```

冒烟测试里“不会受伤”的两局必须通关，脚本不能报错；会被击中的普通机器人输了不算失败，只用来看胜率和节奏数据。
GitHub Actions（`.github/workflows/check.yml`）会在每次推送到 main 和每个 PR 上自动跑同样的检查，结果显示在提交旁边。

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
- 美术全部是 Canvas 程序化绘制，不引入外部图片和第三方库。
- 改了存档结构，要在 `js/util.js` 的 `Store` 里写迁移，不能让旧存档读坏。
- 数值按关卡固定，不随玩家变强偷偷给敌人加血。
