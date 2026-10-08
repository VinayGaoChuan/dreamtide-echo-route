// 打包报告：一个本地 HTML 页面，打开就能看结果
import path from 'node:path';
import { PATHS, ROOT, STATUS_ICON, dirSize, formatBytes, readText, writeText } from './common.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STATUS_TEXT = { ok: '通过', warn: '有提醒', skipped: '跳过', failed: '失败', running: '未完成' };

export function writeReport(recorder, data) {
  const { cfg, buildId, packs = [], smoke, duo, steam, processed, android, androidSmoke, logs } = data;
  const failed = recorder.failed;
  const warnings = recorder.warnings;
  const seconds = ((Date.now() - recorder.startedAt.getTime()) / 1000).toFixed(0);
  const toolVersion = (() => { try { return JSON.parse(readText(path.join(ROOT, 'package.json'))).version; } catch { return '?'; } })();
  const verdict = failed ? { cls: 'bad', text: '打包失败' } : warnings.length ? { cls: 'warn', text: '打包完成（有提醒）' } : { cls: 'good', text: '打包完成' };

  const steps = recorder.steps.map((s) => `
    <li class="step ${s.status}">
      <div class="step-head"><span class="icon">${STATUS_ICON[s.status] || '…'}</span><span class="title">${esc(s.title)}</span>
        <span class="tag">${STATUS_TEXT[s.status] || s.status}</span><span class="time">${s.ms ? `${(s.ms / 1000).toFixed(1)} 秒` : ''}</span></div>
      ${s.error ? `<p class="error">${esc(s.error)}</p>` : ''}
      ${s.warnings.length ? `<ul class="warns">${s.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${s.notes.length ? `<ul class="notes">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </li>`).join('');

  const shots = smoke && smoke.shots ? smoke.shots.map((s) => `
    <figure><img src="报告素材/${encodeURIComponent(s.file)}" alt="${esc(s.file)}"><figcaption>${esc(s.file.replace(/\.png$/, ''))}</figcaption></figure>`).join('') : '';

  const figure = (file) => `<figure><img src="报告素材/${encodeURIComponent(file)}" alt="${esc(file)}"><figcaption>${esc(file.replace(/\.png$/, ''))}</figcaption></figure>`;
  const mark = { fail: '❌', warn: '⚠️', ok: '✅' };
  const duoSection = !duo ? '' : duo.skipped ? `<h2>两个客户端联机测试</h2><p class="muted">跳过：${esc(duo.skipped)}</p>` : `<h2>两个客户端联机测试</h2>
<p class="muted">在这台电脑上同时运行两个打好的程序，用本机假 Steam 连起来（消息延迟 ${duo.config.latencyMs}±${duo.config.jitterMs} 毫秒）。Valve 的服务器那一段（真实建房、跨网络中继、覆盖层邀请界面）这里测不到，用测试版的联机自检。</p>
${duo.rounds.map((r) => `<h3>${esc(r.label)}</h3><ul class="notes">${r.checks.map((c) => `<li class="${c.level === 'fail' ? 'error' : c.level === 'warn' ? 'warnline' : ''}">${mark[c.level]} ${esc(c.text)}</li>`).join('')}</ul>`).join('')}
${duo.shots.length ? `<div class="shots">${duo.shots.map(figure).join('')}</div>` : ''}`;

  const smokeFacts = smoke ? [
    ['帧率', typeof smoke.fps === 'number' ? `${smoke.fps} 帧/秒` : '—'],
    ['联网请求', smoke.blocked.length ? `${smoke.blocked.length} 次（已拦截）` : '0（完全离线）'],
    ['脚本报错', `${(smoke.realErrors || []).length} 条`],
    ['存档同步', smoke.save && smoke.save.restored && smoke.save.exported ? '正常' : '异常'],
    ['Steam', { 'module-loaded': '组件正常（未填 App ID）', ready: '已连上，正版校验通过', 'init-failed': '正版校验生效（本机未通过 Steam 运行）' }[smoke.steam.state] || smoke.steam.state],
  ].map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join('') : '';

  const products = packs.map((p) => {
    const launch = p.target.platform === 'win32' ? `${cfg.executableName}.exe` : `${cfg.executableName}.app`;
    return `<tr><td>${esc(p.target.label)}</td><td><code>${esc(path.relative(path.dirname(PATHS.output), p.dir))}</code></td><td>${formatBytes(dirSize(p.dir))}</td><td><code>${esc(launch)}</code></td></tr>`;
  }).join('');

  const bot = smoke && smoke.bot;
  const botSection = bot ? `<h3>机器人试玩</h3>
<div class="facts">
  <div class="fact"><span>时长 / 操作</span><b>${bot.elapsed} 秒 / ${bot.actions} 次</b></div>
  <div class="fact"><span>经过的不同画面</span><b>${bot.screens}</b></div>
  <div class="fact"><span>报错 / 崩溃</span><b>${bot.errors} / ${bot.crashed ? '是' : '否'}</b></div>
  <div class="fact"><span>无响应 / 画面停滞</span><b>${bot.hangs} / ${bot.stalls}</b></div>
  <div class="fact"><span>帧率（最低/平均）</span><b>${bot.fps.length ? `${Math.min(...bot.fps)} / ${Math.round(bot.fps.reduce((s, v) => s + v, 0) / bot.fps.length)}` : '—'}</b></div>
  <div class="fact"><span>内存（开始→结束）</span><b>${bot.heapStart !== null ? `${bot.heapStart}→${bot.heapEnd} MB` : '—'}</b></div>
</div>
${bot.shots.length ? `<div class="shots" style="margin-top:12px">${bot.shots.map((s) => `<figure><img src="报告素材/${encodeURIComponent(s.file)}" alt="${esc(s.file)}"><figcaption>${esc(s.file.replace(/\.png$/, ''))}（第 ${s.t} 秒）</figcaption></figure>`).join('')}</div>` : ''}
<details><summary>经过的画面（按首次出现）</summary><ul class="notes">${bot.timeline.map((x) => `<li>${x.t} 秒：${esc(x.text)}</li>`).join('')}</ul></details>
<details><summary>识别到的可点击元素</summary><p class="muted">${bot.labels ? bot.labels.map(esc).join('　') : ''}</p></details>
<details><summary>最后 40 个操作（复现问题用，随机种子 ${bot.seed}）</summary><ul class="notes">${bot.recent.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>
<p class="muted">机器人能证明游戏可以被持续操作、没有报错卡死；不能证明好不好玩、数值是否平衡。</p>` : '';

  const logSection = logs ? `<h2>日志</h2>
<p>本机试跑日志：<code>输出/报告素材/本机试跑日志.jsonl</code>；摘要：<code>输出/日志摘要.md</code>${logs.mirror ? `；已同步到技能目录 <code>${esc(logs.mirror)}</code>` : ''}。</p>
<p class="muted">测试者：${cfg.debugLog ? '本次是测试版，画面左下角有版本号' : '本次是正式版（只记录报错和崩溃）'}，按 Ctrl+Shift+L（Mac 为 Cmd+Shift+L）${cfg.debugLog ? '或点左下角版本号' : ''}导出日志到桌面，${cfg.debugLog ? '安卓版点左下角版本号分享日志，' : ''}发给你后放进项目的「收到的日志」文件夹，双击「整理日志」或重新打包即可生成摘要。</p>
${logs.feedback.length ? `<div class="table-wrap"><table><tr><th>收到的日志</th><th>报错</th><th>警告</th><th>崩溃</th><th>卡死</th><th>最常见的报错</th></tr>${logs.feedback.map((f) => `<tr><td>${esc(f.file)}</td><td>${f.counts.error}</td><td>${f.counts.warn}</td><td>${f.crashes}</td><td>${f.hangs}</td><td>${esc((f.groups[0] || {}).msg || '—')}</td></tr>`).join('')}</table></div>` : '<p class="muted">「收到的日志」里暂时没有文件。</p>'}` : '';

  const androidShots = androidSmoke && androidSmoke.shots ? androidSmoke.shots.map((s) => `
    <figure><img src="报告素材/${encodeURIComponent(s.file)}" alt="${esc(s.file)}"><figcaption>${esc(s.file.replace(/\.png$/, ''))}</figcaption></figure>`).join('') : '';
  const androidRows = android ? [
    android.apk ? `<tr><td>APK（直接安装 / 国内商店）</td><td><code>${esc(path.relative(path.dirname(PATHS.output), android.apk))}</code></td><td>${formatBytes(dirSize(android.apk))}</td></tr>` : '',
    android.aab ? `<tr><td>AAB（Google Play）</td><td><code>${esc(path.relative(path.dirname(PATHS.output), android.aab))}</code></td><td>${formatBytes(dirSize(android.aab))}</td></tr>` : '',
  ].join('') : '';
  const androidSection = android ? `<h2>安卓版</h2>
${androidShots ? `<div class="shots">${androidShots}</div>` : ''}
<div class="table-wrap"><table><tr><th>文件</th><th>位置</th><th>大小</th></tr>${androidRows}</table></div>
<p>包名 <code>${esc(cfg.android.packageId)}</code>，版本 ${esc(cfg.version)}（versionCode ${android.versionCode}）。签名证书 SHA-256：<code>${esc(android.signing.sha256)}</code></p>
<p class="${android.signing.created ? 'warnline' : 'muted'}">签名密钥在 <code>secrets/</code> 文件夹。${android.signing.created ? '这是本次新生成的，请立刻备份整个文件夹：' : ''}丢失后就无法再更新已上架的应用。</p>` : '';

  const obf = processed && processed.stats.obfuscated ? processed.stats.scripts.map((s) => `
    <p class="muted">游戏代码 ${formatBytes(s.before)} → ${formatBytes(s.after)}，原始函数名残留 ${s.residual.kept}/${s.residual.total}</p>
    <pre>${esc(s.excerpt)}…</pre>`).join('') : '<p class="muted">本次未开启代码混淆。</p>';

  const steamText = !steam ? '未执行' : {
    'no-app-id': '还没有 App ID，已跳过。拿到后填进 配置.jsonc 的 steam.appId。',
    'no-depot': '已有 App ID，但还没填 depot 编号。',
    'script-only': `已生成上传脚本 build/steam-scripts/app_build_${cfg.steam.appId}.vdf，未上传（steam.upload = false）。`,
    uploaded: `已上传：Steam BuildID ${steam.steamBuildId}${steam.setLive ? `，已设为 ${steam.setLive} 分支当前版本` : ''}。`,
  }[steam.state] || steam.state;

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(cfg ? cfg.gameName : '')} 打包报告</title>
<style>
:root{--bg:#0f0d12;--panel:#18151d;--line:#2a2530;--text:#ece4d6;--muted:#9a90a3;--good:#5fbf7a;--warn:#e6b84a;--bad:#e0564a;--accent:#f2c14e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:1080px;margin:0 auto;padding:32px 16px 64px}h1{margin:0;font-size:26px}h2{font-size:18px;margin:36px 0 12px;color:var(--accent)}h3{font-size:16px;margin:24px 0 8px}details{margin-top:10px;color:var(--muted)}summary{cursor:pointer}
.meta{color:var(--muted);margin-top:6px}.verdict{display:inline-block;margin-top:14px;padding:6px 14px;border-radius:999px;font-weight:600}
.verdict.good{background:#1f3a27;color:var(--good)}.verdict.warn{background:#3a3120;color:var(--warn)}.verdict.bad{background:#3d1f1c;color:var(--bad)}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}figure{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
figure img{display:block;width:100%;height:auto}figcaption{padding:6px 10px;color:var(--muted);font-size:13px}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:12px}.fact{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.fact span{display:block;color:var(--muted);font-size:13px}.fact b{font-size:16px}
ol.steps{list-style:none;padding:0;margin:0}.step{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--good);border-radius:8px;padding:10px 14px;margin-bottom:8px}
.step.warn{border-left-color:var(--warn)}.step.failed{border-left-color:var(--bad)}.step.skipped{border-left-color:var(--muted)}
.step-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.title{font-weight:600}.tag{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:0 8px}.time{margin-left:auto;color:var(--muted);font-size:13px}
.notes,.warns{margin:6px 0 0;padding-left:22px}.notes li{color:var(--muted)}.warns li{color:var(--warn)}.error{color:var(--bad);margin:6px 0 0}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500}
code{background:#241f2a;padding:1px 6px;border-radius:4px;font-size:13px;word-break:break-all}pre{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;white-space:pre-wrap;word-break:break-all;font-size:12px;color:var(--muted)}
.muted{color:var(--muted)}.warnline{color:var(--warn);font-weight:600}.table-wrap{overflow-x:auto}
</style></head><body><main>
<h1>${esc(cfg ? cfg.gameName : '')} · 打包报告</h1>
<div class="meta">工具链 v${esc(toolVersion)}　版本 ${esc(cfg ? cfg.version : '')}　构建号 ${esc(buildId || '')}　用时 ${seconds} 秒　${esc(new Date().toLocaleString('zh-CN'))}</div>
<div class="verdict ${verdict.cls}">${verdict.text}${warnings.length ? `（${warnings.length} 条提醒）` : ''}</div>

${smoke ? `<h2>自动试跑</h2><div class="shots">${shots}</div><div class="facts">${smokeFacts}</div>${botSection}` : ''}

${duoSection}

<h2>打包步骤</h2><ol class="steps">${steps}</ol>

${products ? `<h2>产物（上传 Steam 用的就是这些文件夹）</h2><div class="table-wrap"><table><tr><th>平台</th><th>文件夹</th><th>大小</th><th>启动文件</th></tr>${products}</table></div>` : ''}

${androidSection}

${logSection}

<h2>代码保护</h2>${obf}
<ul class="notes">
<li>正式版（debugLog=false）代码强混淆；测试版用轻档以便看报错。</li>
<li>程序封进 app.asar 并校验完整性，改一个字节就拒绝启动；调试入口已关闭。</li>
<li>填了 App ID 且 requireSteam=true 时，不是从 Steam 启动、或账号没买，游戏拒绝运行。</li>
<li>全程离线，任何联网请求都被拦截。</li>
<li><b>还要做一步（现成的）</b>：在 Steamworks 后台给可执行文件套一层 Steam DRM（Edit Steamworks Settings → Installation → Steam DRM）。这是 Steam 自带的加壳，属基础防护，叠在上面用。</li>
<li>离线游戏不存在绝对不可破解；以上是把破解代价抬高，不是杜绝。</li>
</ul>

<h2>Steam</h2><p>${esc(steamText)}</p>
<div class="table-wrap"><table>
<tr><th>Steamworks 后台设置</th><th>填写内容</th></tr>
<tr><td>启动选项（Windows）</td><td>可执行文件 <code>${esc(cfg ? cfg.executableName : '')}.exe</code>，操作系统 Windows</td></tr>
<tr><td>启动选项（Mac）</td><td>可执行文件 <code>${esc(cfg ? cfg.executableName : '')}.app</code>，操作系统 macOS</td></tr>
<tr><td>Steam 云（Auto-Cloud）Windows</td><td>根目录 <code>WinAppDataRoaming</code>，子目录 <code>${esc(cfg ? cfg.executableName : '')}/save</code>，文件 <code>*</code></td></tr>
<tr><td>Steam 云（Auto-Cloud）Mac</td><td>根目录 <code>MacAppSupport</code>，子目录 <code>${esc(cfg ? cfg.executableName : '')}/save</code>，文件 <code>*</code></td></tr>
</table></div>
<p class="muted">以上字段名以 Steamworks 后台当时的界面为准。</p>
</main></body></html>`;

  const file = path.join(PATHS.output, '打包报告.html');
  writeText(file, html);
  writeText(path.join(PATHS.assets, '打包日志.txt'), recorder.lines.join('\n'));
  if (smoke) writeText(path.join(PATHS.assets, '试跑原始数据.json'), JSON.stringify(smoke, null, 2));
  if (duo) writeText(path.join(PATHS.assets, '联机测试原始数据.json'), JSON.stringify(duo, null, 2));
  return file;
}
