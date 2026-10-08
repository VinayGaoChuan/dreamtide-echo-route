@echo off
chcp 65001 >nul
rem 网页游戏一键打包（Windows：双击运行）
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js。请先安装 https://nodejs.org （选 LTS 版本），装好后再双击本文件。
  if not defined MC_NO_PAUSE pause
  exit /b 1
)
node tools\build.mjs
set CODE=%ERRORLEVEL%
if not defined MC_NO_PAUSE pause
exit /b %CODE%
