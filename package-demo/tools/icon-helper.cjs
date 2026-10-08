'use strict';
// 用 Electron 自带的浏览器内核把任意图片（PNG/JPG/WebP/SVG）缩放成各尺寸 PNG。
// 用法：electron icon-helper.cjs <源图片> <输出目录>
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const [src, outDir] = process.argv.slice(-2);
// 桌面（ico/icns）与安卓（各密度图标、自适应图标前景）需要的尺寸
const SIZES = [16, 24, 32, 48, 64, 72, 96, 108, 128, 144, 162, 192, 216, 256, 324, 432, 512, 1024];
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif' };

function render(url, sizes, isVector) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const out = {};
      for (const size of sizes) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const g = canvas.getContext('2d');
        g.imageSmoothingEnabled = false;
        const w = img.naturalWidth || size;
        const h = img.naturalHeight || size;
        const scale = isVector ? size / Math.max(w, h) : Math.min(size / w, size / h);
        const dw = Math.round(w * scale);
        const dh = Math.round(h * scale);
        g.drawImage(img, Math.floor((size - dw) / 2), Math.floor((size - dh) / 2), dw, dh);
        out[size] = canvas.toDataURL('image/png').split(',')[1];
      }
      resolve(out);
    };
    img.onerror = () => reject(new Error('图片无法解码'));
    img.src = url;
  });
}

app.disableHardwareAcceleration();
if (app.dock) app.dock.hide();

app.whenReady().then(async () => {
  const ext = path.extname(src).toLowerCase();
  let data = fs.readFileSync(src);
  if (ext === '.svg') {
    let svg = data.toString('utf8');
    if (!/<svg[^>]*\swidth=/.test(svg)) svg = svg.replace(/<svg/, '<svg width="1024" height="1024"');
    data = Buffer.from(svg, 'utf8');
  }
  const url = `data:${MIME[ext] || 'image/png'};base64,${data.toString('base64')}`;
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const result = await win.webContents.executeJavaScript(`(${render.toString()})(${JSON.stringify(url)}, ${JSON.stringify(SIZES)}, ${ext === '.svg'})`);
  fs.mkdirSync(outDir, { recursive: true });
  for (const size of SIZES) fs.writeFileSync(path.join(outDir, `icon-${size}.png`), Buffer.from(result[size], 'base64'));
  app.exit(0);
}).catch((err) => {
  console.error(err && err.message ? err.message : err);
  app.exit(1);
});
