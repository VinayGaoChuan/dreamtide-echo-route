#!/usr/bin/env python3
"""梦潮联机服务器自动更新（systemd 定时器每 2 分钟跑一次，root 身份）。

GitHub 上 main 有新提交、并且仓库的检查（CI 的 check 任务）通过了，就：
  下载这个提交的源码 → 在低权限用户 dreamtide 下打包网页、跑服务器自测 → 换上新网页和服务器程序 → 服务器程序变了才重启。
不需要任何密钥：仓库是公开的，只读访问 GitHub（未登录每小时 60 次，够用）。检查没通过的提交不会上线。
配置在 /opt/dreamtide/autoupdate.env：REPO=owner/name  BRANCH=main
"""
import datetime, hashlib, json, os, pathlib, shutil, subprocess, tarfile, tempfile, urllib.request

ROOT = pathlib.Path('/opt/dreamtide')
CONF = dict(l.split('=', 1) for l in (ROOT / 'autoupdate.env').read_text(encoding='utf-8').split() if '=' in l)
REPO, BRANCH = CONF['REPO'], CONF.get('BRANCH', 'main')
STATE = ROOT / 'state.json'
HDR = {'User-Agent': 'dreamtide-autoupdate', 'Accept': 'application/vnd.github+json'}


def log(*a):
    print(*a, flush=True)


def get(url, timeout=120):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HDR), timeout=timeout) as r:
        return r.read()


def save(state):
    STATE.write_text(json.dumps(state), encoding='utf-8')


def ci_verdict(sha, committed):
    """'ok' / 'wait' / 'fail'：看这个提交上名为 check 的检查；仓库没有检查时，提交满 15 分钟就靠本机自测把关"""
    runs = json.loads(get(f'https://api.github.com/repos/{REPO}/commits/{sha}/check-runs?per_page=50'))['check_runs']
    check = [r for r in runs if r['name'] == 'check']
    if check:
        r = check[0]
        if r['status'] != 'completed':
            return 'wait'
        return 'ok' if r['conclusion'] == 'success' else 'fail'
    age = (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(committed.replace('Z', '+00:00'))).total_seconds()
    return 'ok' if age > 900 else 'wait'


def safe_extract(tar_bytes, dest):
    """只解普通文件和目录，不许路径跳出目标目录、不解链接"""
    import io
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode='r:gz') as tf:
        for m in tf.getmembers():
            parts = pathlib.PurePosixPath(m.name).parts[1:]  # 去掉 owner-repo-sha/ 这一层
            if not parts or any(p in ('..', '') for p in parts) or m.name.startswith('/'):
                continue
            out = dest.joinpath(*parts)
            if m.isdir():
                out.mkdir(parents=True, exist_ok=True)
            elif m.isfile():
                out.parent.mkdir(parents=True, exist_ok=True)
                with tf.extractfile(m) as src, open(out, 'wb') as dst:
                    shutil.copyfileobj(src, dst)


def as_dreamtide(cmd, cwd):
    return subprocess.run(['runuser', '-u', 'dreamtide', '--'] + cmd, cwd=cwd, capture_output=True, text=True, timeout=300)


def main():
    state = json.loads(STATE.read_text(encoding='utf-8')) if STATE.exists() else {}
    head = json.loads(get(f'https://api.github.com/repos/{REPO}/commits/{BRANCH}'))
    sha, committed = head['sha'], head['commit']['committer']['date']
    if sha in (state.get('deployed'), state.get('rejected')):
        return
    verdict = ci_verdict(sha, committed)
    if verdict == 'wait':
        log('等检查结束', sha[:7]); return
    if verdict == 'fail':
        log('检查没通过，不上线', sha[:7]); state['rejected'] = sha; save(state); return

    work = pathlib.Path(tempfile.mkdtemp(prefix='dreamtide-', dir='/var/tmp'))
    try:
        log('下载', sha[:7])
        safe_extract(get(f'https://codeload.github.com/{REPO}/tar.gz/{sha}', timeout=300), work)
        subprocess.run(['chown', '-R', 'dreamtide:dreamtide', str(work)], check=True)
        for cmd in (['python3', 'build.py', 'dist/dreamtide.html'], ['node', '--check', 'server/relay.js'], ['node', 'tools/relay-test.js']):
            r = as_dreamtide(cmd, work)
            if r.returncode != 0:
                log('自测没通过，不上线', sha[:7], ' '.join(cmd), (r.stdout + r.stderr)[-800:])
                state['rejected'] = sha; save(state); return
        relay_new = (work / 'server' / 'relay.js').read_bytes()
        relay_old = (ROOT / 'relay.js').read_bytes() if (ROOT / 'relay.js').exists() else b''
        page_tmp = ROOT / 'public' / 'index.html.new'
        shutil.copyfile(work / 'dist' / 'dreamtide.html', page_tmp); os.replace(page_tmp, ROOT / 'public' / 'index.html')  # 换网页：原子替换，正在打开的人不受影响
        (ROOT / 'public' / 'version.txt').write_text(sha, encoding='utf-8')
        if hashlib.sha256(relay_new).digest() != hashlib.sha256(relay_old).digest():
            tmp = ROOT / 'relay.js.new'; tmp.write_bytes(relay_new); os.replace(tmp, ROOT / 'relay.js')
            subprocess.run(['systemctl', 'restart', 'dreamtide-relay'], check=True)  # 正在玩的人约 2 秒自动重连
            log('已上线（服务器程序也更新了，已重启）', sha[:7])
        else:
            log('已上线（只换了网页）', sha[:7])
        state['deployed'] = sha; state.pop('rejected', None); save(state)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # 网络抖动、GitHub 限流：下一轮再试
        log('这一轮没更新：', repr(e)[:300])
