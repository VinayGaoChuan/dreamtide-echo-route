# 梦潮：回声航线

Q 版手绘横版弹幕 Roguelite 的 HTML Demo：把敌人的弹幕弹回去，编成自己的梦境音乐。

在线游玩：https://vinaygaochuan.github.io/dreamtide-echo-route/

## 操作

| 操作 | 键鼠 | 手柄 | 触屏 |
|---|---|---|---|
| 移动 | WASD / 方向键（Shift 慢速） | 左摇杆 | 左侧摇杆 |
| 切 / 弹反 | J | X | 切 |
| 闪避 | 空格 | A | 闪 |
| 梦境演奏 | L | Y / RB | 奏 |
| 暂停 | Esc | Start | 右上角 |

射击默认自动瞄准、自动攻击，可在设置里改。存档保存在各自浏览器里。

## 本地运行与开发

- 直接双击 `index.html` 即可离线游玩。
- 冒烟测试：`node tools/smoke-sim.js`（无头跑教学、各类房间、四把武器打 Boss 三乐章）。
- 打包单文件：`python3 build.py <输出.html>`。
