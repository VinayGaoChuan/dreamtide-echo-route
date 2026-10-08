#!/bin/bash
# 网页游戏一键打包（macOS：双击运行）
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。请先安装 https://nodejs.org （选 LTS 版本），装好后再双击本文件。"
  [ -z "$MC_NO_PAUSE" ] && read -r -p "按回车关闭…" _
  exit 1
fi
node tools/build.mjs
code=$?
[ -z "$MC_NO_PAUSE" ] && { echo; read -r -p "按回车关闭窗口…" _; }
exit $code
