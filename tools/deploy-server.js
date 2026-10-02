// 把联机服务器部署到一台 Debian / Ubuntu 主机：装 Node（没有的话）→ 上传 relay.js 和打包好的网页 → systemd 常驻 → 检查健康。
// 只用 SSH 密钥登录（BatchMode，不会问密码）；先让服务器信任这把公钥：ssh-copy-id -i ~/.ssh/dreamtide_ed25519.pub root@主机
// 用法：node tools/deploy-server.js root@主机 [端口=8080] [私钥=~/.ssh/dreamtide_ed25519]
// macOS / Linux / Windows（自带 OpenSSH）都能跑；需要先 python3 build.py dist/dreamtide.html（脚本会自动打包）。
const { spawnSync } = require('child_process'), path = require('path'), os = require('os'), fs = require('fs'), http = require('http');

const target = process.argv[2], port = +(process.argv[3] || 8080);
const key = process.argv[4] || path.join(os.homedir(), '.ssh', 'dreamtide_ed25519');
if (!target || !/^[\w.-]+@[\w.-]+$/.test(target)) { console.error('用法：node tools/deploy-server.js root@主机 [端口] [私钥]'); process.exit(2); }
const host = target.split('@')[1], root = path.join(__dirname, '..');
const sshOpts = ['-i', key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=12'];
const run = (cmd, args, opt = {}) => { const r = spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opt)); if (r.error) throw r.error; return r; };
const ssh = (script) => run('ssh', [...sshOpts, target, 'bash -s'], { input: script });
const step = (name) => console.log(`\n▶ ${name}`);
function must(r, what) { if (r.status !== 0) { console.error(`✗ ${what} 失败\n${(r.stderr || '') + (r.stdout || '')}`.trim()); process.exit(1); } return r; }

step('打包网页');
const py = process.platform === 'win32' ? ['py', ['-3']] : ['python3', []];
must(run(py[0], [...py[1], path.join(root, 'build.py'), path.join(root, 'dist', 'dreamtide.html')]), '打包');
const page = path.join(root, 'dist', 'dreamtide.html'), relay = path.join(root, 'server', 'relay.js');

step(`连接 ${target}（只用密钥）`);
const hello = ssh('echo ok; . /etc/os-release; echo "$PRETTY_NAME"');
if (hello.status !== 0) {
  console.error(`✗ 连不上 ${target}：${(hello.stderr || '').trim()}\n  如果是 Permission denied：先在自己的终端里运行  ssh-copy-id -i ${key}.pub ${target}  （会问一次密码，由你输入）`);
  process.exit(1);
}
console.log('  ' + hello.stdout.trim().split('\n').join(' · '));

step('安装 Node.js（已有就跳过）并准备目录');
must(ssh(`set -e
if ! command -v node >/dev/null 2>&1; then export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y -qq nodejs >/dev/null; fi
node --version
id dreamtide >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin dreamtide
mkdir -p /opt/dreamtide/public`), '安装 Node.js');

step('上传服务器程序和网页');
must(run('scp', [...sshOpts, relay, `${target}:/opt/dreamtide/relay.js`]), '上传 relay.js');
must(run('scp', [...sshOpts, page, `${target}:/opt/dreamtide/public/index.html`]), '上传网页');

step(`设置常驻服务（端口 ${port}）`);
must(ssh(`set -e
cat > /etc/systemd/system/dreamtide-relay.service <<'UNIT'
[Unit]
Description=Dreamtide multiplayer relay
After=network-online.target
[Service]
User=dreamtide
ExecStart=/usr/bin/env node /opt/dreamtide/relay.js ${port} /opt/dreamtide/public
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable dreamtide-relay >/dev/null 2>&1
systemctl restart dreamtide-relay
sleep 1
systemctl is-active dreamtide-relay
node -e "require('http').get('http://127.0.0.1:${port}/health', (r) => r.pipe(process.stdout)).on('error', (e) => { console.error(e.message); process.exit(1); })"; echo
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q active; then ufw allow ${port}/tcp >/dev/null && echo "ufw: 已放行 ${port}"; fi`), '启动服务');

step('从这台电脑检查能不能访问');
http.get({ host, port, path: '/health', timeout: 8000 }, (res) => {
  let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { console.log(`✓ 外网可以访问：${b}\n\n游戏地址：http://${host}:${port}/`); });
}).on('error', (e) => { console.log(`✗ 服务器上已经在运行，但外网连不上 ${host}:${port}（${e.code || e.message}）\n  → 到云服务器控制台的安全组里放行 TCP ${port} 入方向`); process.exitCode = 3; })
  .on('timeout', function () { this.destroy(new Error('timeout')); });
