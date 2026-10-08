"""Inline js/*.js into one self-contained HTML (used for the published Artifact)."""
import hashlib, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent
argv = sys.argv[1:]
pkg = argv[argv.index('--pkg') + 1] if '--pkg' in argv else None  # 打包用：写成一个文件夹（index.html + 本地字体），打包后的程序不能联网
args = [a for i, a in enumerate(argv) if not a.startswith('--') and not (i and argv[i - 1] == '--pkg')]
demo = '--demo' in sys.argv  # 试玩版（docs/design.md §21）：只开第 1 张图
out = pathlib.Path(args[0]) if args else root / 'dist' / ('dreamtide-demo.html' if demo else 'dreamtide.html')
html = (root / 'index.html').read_text(encoding='utf-8-sig')

def inline(m):
    src = (root / m.group(1)).read_text(encoding='utf-8-sig')
    if '</script' in src:
        raise SystemExit(f'{m.group(1)} contains a closing script tag')
    return f'<script>\n{src}\n</script>'

argv0 = sys.argv[1:]
if '--pkg' not in argv0:  # 打包用的文件夹保留 js/*.js 外部脚本：打包工具的文件夹模式只混淆 .js 文件
    html = re.sub(r'<script src="(js/[\w.-]+\.js)"(?: charset="utf-8")?></script>', inline, html)
# 版本号 = 打包内容的哈希：联机时不同版本的网页进不了同一个频道（防止玩法代码不一致而不同步），旧网页会提示刷新
code = '' if '--pkg' not in argv0 else ''.join((root / f).read_text(encoding='utf-8-sig') for f in re.findall(r'<script src="(js/[\w.-]+\.js)"', html))  # 打包文件夹：脚本在外面，也算进版本号
build = hashlib.sha256((html + code + ('|demo' if demo else '')).encode('utf-8')).hexdigest()[:10]  # 试玩版和正式版不同号：联机进不了同一个频道
html = html.replace('<meta charset="utf-8">', f'<meta charset="utf-8"><script>window.DREAMTIDE_BUILD = "{build}";{" window.DREAMTIDE_DEMO = 1;" if demo else ""}</script>', 1)
if demo: html = html.replace('<title>余烬：迷航</title>', '<title>余烬：迷航 试玩版</title>', 1)
zip_to = None
if pkg and pkg.endswith('.zip'):  # 打包项目的「放游戏包」收 zip：先写进临时文件夹，再整个压缩
    import tempfile
    zip_to, pkg = pkg, tempfile.mkdtemp(prefix='dreamtide-pkg-')
if pkg:
    import shutil
    out = pathlib.Path(pkg) / 'index.html'
    html = re.sub(r'<link rel="preconnect"[^>]*>\n?', '', html)
    html = re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>', '<link rel="stylesheet" href="fonts/fonts.css">', html)
    if 'googleapis' in html: raise SystemExit('还有外网字体链接')
    shutil.rmtree(pathlib.Path(pkg) / 'fonts', ignore_errors=True)
    shutil.copytree(root / 'fonts', pathlib.Path(pkg) / 'fonts')
    shutil.rmtree(pathlib.Path(pkg) / 'js', ignore_errors=True)
    import subprocess  # 多语言：把给玩家看的中文改写成查表（tools/i18n.js），再带上所有语言的句子表
    subprocess.run(['node', str(root / 'tools' / 'i18n.js'), 'transform', str(pkg)], check=True)
    html = html.replace('<script src="js/i18n.js"', '<script src="js/i18n-data.js" charset="utf-8"></script>\n<script src="js/i18n.js"', 1)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding='utf-8')
print(out, f'{out.stat().st_size / 1024:.0f} KB', build)
if zip_to:
    import shutil
    pathlib.Path(zip_to).parent.mkdir(parents=True, exist_ok=True)
    made = shutil.make_archive(str(pathlib.Path(zip_to).with_suffix('')), 'zip', pkg)
    shutil.rmtree(pkg, ignore_errors=True)
    print(made)
