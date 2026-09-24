"""Inline js/*.js into one self-contained HTML (used for the published Artifact)."""
import pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist' / 'dreamtide.html'
html = (root / 'index.html').read_text(encoding='utf-8-sig')

def inline(m):
    src = (root / m.group(1)).read_text(encoding='utf-8-sig')
    if '</script' in src:
        raise SystemExit(f'{m.group(1)} contains a closing script tag')
    return f'<script>\n{src}\n</script>'

html = re.sub(r'<script src="(js/[\w.-]+\.js)"(?: charset="utf-8")?></script>', inline, html)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding='utf-8')
print(out, f'{out.stat().st_size / 1024:.0f} KB')
