@echo off
chcp 65001 >nul
rem 整理测试者发来的日志（Windows：双击运行）：先把日志文件放进「收到的日志」文件夹
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js。请先安装 https://nodejs.org （选 LTS 版本）。
  if not defined MC_NO_PAUSE pause
  exit /b 1
)
node tools\logs.mjs
set CODE=%ERRORLEVEL%
if not defined MC_NO_PAUSE pause
exit /b %CODE%
