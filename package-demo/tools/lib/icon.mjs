// 图标：配置里的 PNG，或游戏包自带的缩略图 → Windows .ico + Mac .icns
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ROOT, resetDir, run } from './common.mjs';
import { electronBinary } from './setup.mjs';

function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach((png, i) => {
    const o = i * 16;
    dir.writeUInt8(png.size >= 256 ? 0 : png.size, o);
    dir.writeUInt8(png.size >= 256 ? 0 : png.size, o + 1);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.buf.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.buf)]);
}

const ICONSET = [
  ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32], ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256], ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
];

export async function makeIcons(ctx, cfg, processed) {
  const dir = path.join(PATHS.work, 'icon');
  resetDir(dir);
  let source = null;
  if (cfg.icon) {
    source = path.isAbsolute(cfg.icon) ? cfg.icon : path.join(ROOT, cfg.icon);
    if (!fs.existsSync(source)) throw new Error(`配置的图标文件不存在：${source}`);
    ctx.note(`图标来源：${path.basename(source)}`);
  } else if (processed.stats.thumbnailSvg) {
    source = path.join(dir, 'thumbnail.svg');
    fs.writeFileSync(source, processed.stats.thumbnailSvg, 'utf8');
    ctx.note('图标来源：游戏包自带的缩略图（想换就在配置里填 icon）');
  } else {
    ctx.warn('没有可用的图标来源，exe 会用 Electron 默认图标。可在配置里填 icon');
    return null;
  }

  const pngDir = path.join(dir, 'png');
  const result = await run(electronBinary(), [path.join(PATHS.tools, 'icon-helper.cjs'), source, pngDir], { timeoutMs: 60000 });
  if (result.code !== 0 || !fs.existsSync(path.join(pngDir, 'icon-256.png'))) {
    throw new Error(`图标转换失败：${(result.stderr || result.stdout).trim().split('\n').pop()}`);
  }
  const png = (size) => fs.readFileSync(path.join(pngDir, `icon-${size}.png`));
  const base = path.join(dir, 'icon');
  fs.writeFileSync(`${base}.ico`, buildIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, buf: png(size) }))));
  fs.copyFileSync(path.join(pngDir, 'icon-512.png'), path.join(PATHS.assets, '图标.png'));
  const icons = { base, ico: `${base}.ico`, icns: null, pngDir };
  if (process.platform === 'darwin') {
    const iconset = path.join(dir, 'icon.iconset');
    fs.mkdirSync(iconset);
    for (const [name, size] of ICONSET) fs.writeFileSync(path.join(iconset, name), png(size));
    const r = await run('iconutil', ['-c', 'icns', iconset, '-o', `${base}.icns`]);
    if (r.code === 0) icons.icns = `${base}.icns`;
    else ctx.warn(`Mac 图标生成失败：${r.stderr.trim()}`);
  }
  ctx.note(`已生成 ${icons.icns ? 'Windows .ico 和 Mac .icns' : 'Windows .ico'}`);
  return icons;
}
