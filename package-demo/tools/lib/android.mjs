// 安卓打包：Capacitor 安卓工程 + 游戏 → 横屏全屏、图标、签名 → APK / AAB → 检查 → 模拟器试跑
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import AdmZip from 'adm-zip';
import { PATHS, ROOT, dirSize, formatBytes, readText, resetDir, run, writeText } from './common.mjs';
import { ANDROID, ensureAndroidEnv, sdkTools } from './android-env.mjs';

const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';
export const SECRETS = path.join(ROOT, 'secrets');
const CAP_CLI = path.join(ROOT, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const xmlEscape = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": "\\'", '"': '\\"' }[c]));

export function versionCode(version) {
  const [a, b, c] = version.split('.').map(Number);
  return Math.max(1, a * 10000 + b * 100 + c);
}

// 子进程输出一边显示在终端，一边留存（出错时写进报告）
function runTee(cmd, args, { cwd, env, prefix = '     ', timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: IS_WIN, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    let pending = '';
    const onData = (chunk) => {
      text += chunk;
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) if (/^> Task|BUILD|FAIL|error:|What went wrong|Downloading/i.test(line)) process.stdout.write(`${prefix}${line.slice(0, 160)}\n`);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = timeoutMs ? setTimeout(() => { child.kill(); reject(new Error(`运行超时：${path.basename(cmd)}`)); }, timeoutMs) : null;
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, text }); });
  });
}

function runBuffer(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, buf: Buffer.concat(chunks) }));
  });
}

// ── 签名密钥：第一次自动生成，之后一直用同一把 ──
async function ensureKeystore(ctx, cfg, env) {
  const file = path.join(SECRETS, 'android-release.jks');
  const meta = path.join(SECRETS, 'android-signing.json');
  if (fs.existsSync(file) && fs.existsSync(meta)) return { ...JSON.parse(readText(meta)), file, created: false };
  if (fs.existsSync(file) || fs.existsSync(meta)) {
    throw new Error('secrets 文件夹里的签名文件不完整（密钥和密码只剩一个）。请从备份恢复，不要重新生成，否则已上架的应用无法更新');
  }
  fs.mkdirSync(SECRETS, { recursive: true });
  const password = crypto.randomBytes(24).toString('base64url');
  const keytool = path.join(env.JAVA_HOME, 'bin', `keytool${EXE}`);
  const keyEnv = { ...env, WGP_KS_PASS: password };
  const gen = await run(keytool, ['-genkeypair', '-keystore', file, '-storetype', 'PKCS12', '-alias', 'upload', '-keyalg', 'RSA',
    '-keysize', '4096', '-validity', '36500', '-storepass:env', 'WGP_KS_PASS', '-keypass:env', 'WGP_KS_PASS',
    '-dname', `CN=${cfg.executableName}, O=${cfg.executableName}, C=CN`, '-noprompt'], { env: keyEnv });
  if (gen.code !== 0) throw new Error(`生成签名密钥失败：${gen.stderr.trim()}`);
  const list = await run(keytool, ['-list', '-v', '-keystore', file, '-storepass:env', 'WGP_KS_PASS'], { env: keyEnv });
  const sha256 = (list.stdout.match(/SHA256:\s*([0-9A-F:]+)/i) || [])[1] || '';
  const info = { keystore: path.basename(file), alias: 'upload', storePassword: password, keyPassword: password, sha256, createdAt: new Date().toISOString() };
  writeText(meta, JSON.stringify(info, null, 2));
  writeText(path.join(SECRETS, '必读-备份说明.txt'), [
    '这个文件夹里是安卓签名密钥和它的密码。',
    '一旦丢失：已经上架的应用将无法再发布更新（只能换新包名重新上架）。',
    '请立刻把整个 secrets 文件夹备份到安全的地方（加密 U 盘、密码管理器等），不要上传到网盘公开分享，也不要放进 Git。',
    `证书指纹 SHA-256：${sha256}`,
  ].join('\n'));
  ctx.warn('已自动生成安卓签名密钥（secrets/ 文件夹）。请马上备份这个文件夹，丢了就无法更新已上架的应用');
  return { ...info, file, created: true };
}

// ── 生成并定制安卓工程 ──
function capacitor(args, cwd, env) {
  return run(process.execPath, [CAP_CLI, ...args], { cwd, env: { ...env, CI: '1' }, timeoutMs: 10 * 60 * 1000 });
}

function findFile(dir, name) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (d.name === name) return full;
  }
  return null;
}

// 修改模板文件，并确认结果里有预期内容（模板变了会明确报错，而不是悄悄打出错误的包）
function patch(file, fn, expected) {
  const after = fn(readText(file));
  for (const text of [].concat(expected)) {
    if (!after.includes(text)) throw new Error(`安卓模板结构和预期不一致，没能修改 ${path.basename(file)}（缺少：${text}）`);
  }
  writeText(file, after);
}

// Java 字符串字面量：非 ASCII 字符转成 \uXXXX，避免源码编码问题
const javaStr = (v) => JSON.stringify(String(v)).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

// 测试版：页面里装一个帧率采样器、左下角显示版本号（点一下分享日志），每次调用返回最近的帧率
const ANDROID_MONITOR_JS = (mark) => `(function(){var w=window;var n=performance.now();
if(!w.__wgpPerf||n-w.__wgpPerf.l>2000){var p={f:0,w:0,l:n,s:n};w.__wgpPerf=p;var t=function(x){p.f++;p.w=Math.max(p.w,x-p.l);p.l=x;requestAnimationFrame(t);};requestAnimationFrame(t);}
if(!document.getElementById('__wgp_mark')&&document.body){var d=document.createElement('div');d.id='__wgp_mark';d.textContent=${JSON.stringify(mark)};
d.style.cssText='position:fixed;left:8px;bottom:6px;z-index:2147483647;font:12px/1.4 sans-serif;color:rgba(255,255,255,.75);background:rgba(0,0,0,.45);padding:4px 10px;border-radius:4px;user-select:none';
d.onclick=function(){var st='';try{st=JSON.stringify(localStorage);}catch(e){}var C=w.Capacitor;if(C&&C.nativePromise)C.nativePromise('WgpLog','exportLogs',{storage:st});};document.body.appendChild(d);}
var q=w.__wgpPerf,now=performance.now(),r={fps:Math.round(q.f*1000/Math.max(1,now-q.s)),worstFrameMs:Math.round(q.w),heapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null};q.f=0;q.w=0;q.s=now;return JSON.stringify(r);})()`;

const WGP_BUILD = (pkg, cfg, buildId) => `package ${pkg};

// 由打包工具生成：本次构建的信息与日志宏
final class WgpBuild {
    static final boolean DEBUG_LOG = ${cfg.debugLog ? 'true' : 'false'};
    static final String GAME = ${javaStr(cfg.gameName)};
    static final String FILE_NAME = ${javaStr(cfg.executableName)};
    static final String VERSION = ${javaStr(cfg.version)};
    static final String BUILD_ID = ${javaStr(buildId)};
    static final String MONITOR_JS = ${javaStr(ANDROID_MONITOR_JS(`测试版 ${cfg.version} · ${buildId} · 点这里分享日志`))};

    private WgpBuild() {}
}
`;

const WGP_LOG = (pkg) => `package ${pkg};

import android.content.Context;
import android.os.Build;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

// 由打包工具生成：运行日志，写在 files/logs/*.jsonl，格式与电脑版相同（每行一条 JSON）
final class WgpLog {
    private static final int MAX_LINES = 20000;
    private static File file;
    private static File dir;
    private static boolean verbose;
    private static int lines;

    private WgpLog() {}

    static synchronized void init(Context ctx, boolean verboseLog) {
        verbose = verboseLog;
        dir = new File(ctx.getFilesDir(), "logs");
        dir.mkdirs();
        File[] old = dir.listFiles((d, n) -> n.endsWith(".jsonl"));
        if (old != null && old.length > 9) {
            Arrays.sort(old);
            for (int i = 0; i < old.length - 9; i++) old[i].delete();
        }
        file = new File(dir, stamp() + ".jsonl");
    }

    static String stamp() {
        return new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date());
    }

    static synchronized void write(String lvl, String src, String msg, JSONObject data) {
        if (file == null || lines >= MAX_LINES) return;
        if ("debug".equals(lvl) && !verbose) return;
        lines++;
        try (Writer w = new OutputStreamWriter(new FileOutputStream(file, true), StandardCharsets.UTF_8)) {
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            iso.setTimeZone(TimeZone.getTimeZone("UTC"));
            JSONObject o = new JSONObject();
            o.put("t", iso.format(new Date()));
            o.put("lvl", lvl);
            o.put("src", src);
            o.put("msg", msg == null ? "" : (msg.length() > 4000 ? msg.substring(0, 4000) : msg));
            if (data != null) o.put("data", data);
            w.write(o.toString());
            w.write('\\n');
        } catch (Exception ignored) {
            // 日志写不进去不影响游戏
        }
    }

    static String system() {
        String webview = "";
        if (Build.VERSION.SDK_INT >= 26) {
            android.content.pm.PackageInfo p = android.webkit.WebView.getCurrentWebViewPackage();
            if (p != null) webview = p.packageName + " " + p.versionName;
        }
        return Build.MANUFACTURER + " " + Build.MODEL + "; Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + "); WebView " + webview;
    }

    // 把全部日志（新的在前，最多约 8 MB）+ 系统信息 + 存档合成一个文本文件，放在 cache 里供分享
    static synchronized File export(Context ctx, String storage) throws Exception {
        File outDir = new File(ctx.getCacheDir(), "wgp-export");
        outDir.mkdirs();
        File out = new File(outDir, WgpBuild.FILE_NAME + "-log-" + stamp() + ".txt");
        StringBuilder sb = new StringBuilder();
        sb.append("=== ").append(WgpBuild.GAME).append(" \\u65e5\\u5fd7\\u5bfc\\u51fa\\uff08").append(WgpBuild.VERSION).append(" / ").append(WgpBuild.BUILD_ID).append("\\uff09 ===\\n\\n");
        sb.append("=== \\u7cfb\\u7edf ===\\n").append(system()).append("\\n\\n");
        sb.append("=== \\u5b58\\u6863 localStorage ===\\n").append(storage == null ? "" : storage).append("\\n\\n");
        File[] logs = dir.listFiles((d, n) -> n.endsWith(".jsonl"));
        if (logs != null) {
            Arrays.sort(logs);
            long budget = 8L * 1024 * 1024;
            for (int i = logs.length - 1; i >= 0 && budget > 0; i--) {
                byte[] bytes = new byte[(int) Math.min(logs[i].length(), budget)];
                try (FileInputStream in = new FileInputStream(logs[i])) {
                    int read = in.read(bytes);
                    if (read > 0) {
                        sb.append("=== \\u65e5\\u5fd7 ").append(logs[i].getName()).append(" ===\\n").append(new String(bytes, 0, read, StandardCharsets.UTF_8)).append('\\n');
                        budget -= read;
                    }
                }
            }
        }
        try (Writer w = new OutputStreamWriter(new FileOutputStream(out), StandardCharsets.UTF_8)) {
            w.write(sb.toString());
        }
        return out;
    }
}
`;

const WGP_PLUGIN = (pkg) => `package ${pkg};

import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

// 由打包工具生成：页面里点版本号 → 导出日志并调起系统分享（微信、QQ、邮件等）
@CapacitorPlugin(name = "WgpLog")
public class WgpLogPlugin extends Plugin {
    @PluginMethod
    public void exportLogs(PluginCall call) {
        try {
            File f = WgpLog.export(getContext(), call.getString("storage", ""));
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, f.getName());
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, "\\u53d1\\u9001\\u65e5\\u5fd7\\u7ed9\\u5f00\\u53d1\\u8005"));
            WgpLog.write("info", "export", "export logs", null);
            call.resolve();
        } catch (Exception e) {
            WgpLog.write("error", "export", "export failed: " + e, null);
            call.reject(e.toString());
        }
    }
}
`;

const MAIN_ACTIVITY = (pkg) => `package ${pkg};

import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import org.json.JSONObject;

// 由打包工具生成：全屏沉浸、屏幕常亮、刘海区域铺满、声音不需要先点击；运行日志与测试版角标
public class MainActivity extends BridgeActivity {
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        WgpLog.init(this, WgpBuild.DEBUG_LOG);
        WgpLog.write("info", "env", "\\u542f\\u52a8", env());
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            WgpLog.write("error", "crash", "\\u5e94\\u7528\\u5d29\\u6e83: " + error, stack(error));
            if (previous != null) previous.uncaughtException(thread, error);
        });
        registerPlugin(WgpLogPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
            webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
                @Override
                public boolean onConsoleMessage(ConsoleMessage m) {
                    String lvl = m.messageLevel() == ConsoleMessage.MessageLevel.ERROR ? "error"
                        : m.messageLevel() == ConsoleMessage.MessageLevel.WARNING ? "warn" : "debug";
                    if (!"warn".equals(lvl) || WgpBuild.DEBUG_LOG) {
                        JSONObject where = new JSONObject();
                        try { where.put("source", m.sourceId()); where.put("line", m.lineNumber()); } catch (Exception ignored) { }
                        WgpLog.write(lvl, "console", m.message(), where);
                    }
                    return super.onConsoleMessage(m);
                }
            });
        }
        hideSystemBars();
        if (WgpBuild.DEBUG_LOG) handler.postDelayed(monitor, 4000);
    }

    private final Runnable monitor = new Runnable() {
        @Override
        public void run() {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(WgpBuild.MONITOR_JS, value -> {
                    try {
                        JSONObject perf = new JSONObject(new JSONObject("{\\"v\\":" + value + "}").getString("v"));
                        WgpLog.write("debug", "perf", "fps " + perf.optInt("fps"), perf);
                    } catch (Exception ignored) {
                        // 页面还没准备好
                    }
                });
            }
            handler.postDelayed(this, 5000);
        }
    };

    private static JSONObject env() {
        JSONObject o = new JSONObject();
        try {
            o.put("game", WgpBuild.GAME);
            o.put("version", WgpBuild.VERSION);
            o.put("buildId", WgpBuild.BUILD_ID);
            o.put("debugLog", WgpBuild.DEBUG_LOG);
            o.put("device", WgpLog.system());
            o.put("os", "Android " + Build.VERSION.RELEASE);
        } catch (Exception ignored) { }
        return o;
    }

    private static JSONObject stack(Throwable e) {
        JSONObject o = new JSONObject();
        try { o.put("stack", Log.getStackTraceString(e)); } catch (Exception ignored) { }
        return o;
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
`;

const ICON_SIZES = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };

function customizeProject(ctx, cfg, androidDir, icons, buildId) {
  const app = path.join(androidDir, 'app');
  const main = path.join(app, 'src', 'main');
  const pkg = cfg.android.packageId;

  patch(path.join(app, 'build.gradle'), (s) => s
    .replace(/versionCode \d+/, `versionCode ${versionCode(cfg.version)}`)
    .replace(/versionName "[^"]*"/, `versionName "${cfg.version}"`)
    .replace(/android \{\n/, `android {
    signingConfigs {
        release {
            storeFile file(System.getenv('WGP_KEYSTORE'))
            storePassword System.getenv('WGP_STORE_PASSWORD')
            keyAlias System.getenv('WGP_KEY_ALIAS')
            keyPassword System.getenv('WGP_KEY_PASSWORD')
        }
    }
`)
    .replace(/release \{\n(\s*)minifyEnabled false/, (m, indent) => `release {\n${indent}signingConfig signingConfigs.release\n${indent}minifyEnabled false`),
  [`applicationId "${pkg}"`, `versionCode ${versionCode(cfg.version)}`, `versionName "${cfg.version}"`, 'signingConfig signingConfigs.release', "System.getenv('WGP_KEYSTORE')"]);

  const orientation = cfg.android.orientation === 'portrait' ? 'sensorPortrait' : 'sensorLandscape';
  patch(path.join(main, 'AndroidManifest.xml'), (s) => s.replace('android:name=".MainActivity"', `android:name=".MainActivity"\n            android:screenOrientation="${orientation}"`),
    `android:screenOrientation="${orientation}"`);

  const activity = findFile(path.join(main, 'java'), 'MainActivity.java');
  if (!activity) throw new Error('安卓工程里找不到 MainActivity.java');
  const activityPkg = (readText(activity).match(/^package\s+([\w.]+);/m) || [])[1];
  if (activityPkg !== pkg) throw new Error(`MainActivity 的包名（${activityPkg}）和配置（${pkg}）不一致`);
  writeText(activity, MAIN_ACTIVITY(pkg));
  const javaDir = path.dirname(activity);
  writeText(path.join(javaDir, 'WgpBuild.java'), WGP_BUILD(pkg, cfg, buildId));
  writeText(path.join(javaDir, 'WgpLog.java'), WGP_LOG(pkg));
  writeText(path.join(javaDir, 'WgpLogPlugin.java'), WGP_PLUGIN(pkg));
  ctx.note(`运行日志已接入${cfg.debugLog ? '（测试版：左下角显示版本号，点一下分享日志）' : '（正式版：只记录报错和崩溃）'}`);

  const name = xmlEscape(cfg.gameName);
  patch(path.join(main, 'res', 'values', 'strings.xml'), (s) => s
    .replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${name}</string>`)
    .replace(/<string name="title_activity_main">[^<]*<\/string>/, `<string name="title_activity_main">${name}</string>`),
  [`<string name="app_name">${name}</string>`, `<string name="title_activity_main">${name}</string>`]);

  // 启动画面：去掉 Capacitor 默认 logo，改成黑底（Android 12+ 的系统启动页显示游戏图标）
  patch(path.join(main, 'res', 'values', 'styles.xml'), (s) => s.replace(
    '<item name="android:background">@drawable/splash</item>',
    '<item name="android:background">@android:color/black</item>\n        <item name="windowSplashScreenBackground">@android:color/black</item>',
  ).replace(
    '<item name="android:background">@null</item>',
    '<item name="android:background">@null</item>\n        <item name="android:windowBackground">@android:color/black</item>',
  ), ['windowSplashScreenBackground', 'android:windowBackground']);
  for (const d of fs.readdirSync(path.join(main, 'res'))) {
    const splash = path.join(main, 'res', d, 'splash.png');
    if (d.startsWith('drawable') && fs.existsSync(splash)) fs.rmSync(splash);
  }

  if (icons && icons.pngDir) {
    for (const [density, [legacy, fg]] of Object.entries(ICON_SIZES)) {
      const dir = path.join(main, 'res', `mipmap-${density}`);
      const png = (size) => fs.readFileSync(path.join(icons.pngDir, `icon-${size}.png`));
      fs.writeFileSync(path.join(dir, 'ic_launcher.png'), png(legacy));
      fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), png(legacy));
      fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), png(fg));
    }
    patch(path.join(main, 'res', 'values', 'ic_launcher_background.xml'), (s) => s.replace(/#[0-9A-Fa-f]{6,8}/, '#000000'), '#000000');
    ctx.note('图标已换成游戏图标（含 Android 8+ 自适应图标）');
  } else {
    ctx.warn('没有图标，安卓包会带 Capacitor 默认图标');
  }

  fs.appendFileSync(path.join(androidDir, 'gradle.properties'), '\norg.gradle.jvmargs=-Xmx2048m\norg.gradle.daemon.idletimeout=600000\n', 'utf8');
  if (!IS_WIN) fs.chmodSync(path.join(androidDir, 'gradlew'), 0o755);
}

// 安卓环境模块的日志自带缩进和圆点；进度百分比只打在终端，不进报告
function envLog(ctx) {
  return (m) => (/\d+%/.test(m) ? console.log(m) : ctx.note(String(m).replace(/^\s*·?\s*/, '')));
}

export async function packAndroid(ctx, cfg, processed, icons, buildId) {
  const envInfo = await ensureAndroidEnv({ log: envLog(ctx), withEmulator: cfg.android.smokeTest && cfg.android.smokeDevice !== 'usb' });
  const env = envInfo.env;
  const signing = await ensureKeystore(ctx, cfg, env);

  const proj = path.join(PATHS.work, 'android');
  resetDir(proj);
  fs.cpSync(processed.gameDir, path.join(proj, 'www'), { recursive: true });
  const capVersion = JSON.parse(readText(path.join(ROOT, 'node_modules', '@capacitor', 'android', 'package.json'))).version;
  writeText(path.join(proj, 'package.json'), JSON.stringify({
    name: cfg.executableName.toLowerCase(), version: cfg.version, private: true,
    dependencies: { '@capacitor/android': capVersion, '@capacitor/core': capVersion },
  }, null, 2));
  writeText(path.join(proj, 'capacitor.config.json'), JSON.stringify({
    appId: cfg.android.packageId, appName: cfg.gameName, webDir: 'www',
    android: { backgroundColor: '#000000' },
  }, null, 2));
  const add = await capacitor(['add', 'android'], proj, env);
  if (add.code !== 0 || !fs.existsSync(path.join(proj, 'android', 'app', 'build.gradle'))) {
    throw new Error(`生成安卓工程失败：${(add.stderr || add.stdout).trim().split('\n').slice(-3).join(' ')}`);
  }
  ctx.note(`安卓工程已生成（Capacitor ${capVersion}，目标 API ${ANDROID.platform.split('-').pop()}）`);
  const androidDir = path.join(proj, 'android');
  customizeProject(ctx, cfg, androidDir, icons, buildId);

  const tasks = [];
  if (cfg.android.outputs.includes('apk')) tasks.push('assembleRelease');
  if (cfg.android.outputs.includes('aab')) tasks.push('bundleRelease');
  ctx.note(`Gradle 构建：${tasks.join('、')}（第一次要下载 Gradle 和依赖，可能要几分钟）`);
  const gradlew = path.join(androidDir, IS_WIN ? 'gradlew.bat' : 'gradlew');
  const build = await runTee(gradlew, [...tasks, '--console=plain', '--warning-mode=none'], {
    cwd: androidDir,
    env: { ...env, WGP_KEYSTORE: signing.file, WGP_STORE_PASSWORD: signing.storePassword, WGP_KEY_ALIAS: signing.alias, WGP_KEY_PASSWORD: signing.keyPassword },
    timeoutMs: 40 * 60 * 1000,
  });
  if (build.code !== 0) {
    const reason = build.text.split('What went wrong:')[1] || build.text.slice(-800);
    throw new Error(`Gradle 构建失败：${reason.trim().split('\n').slice(0, 6).join(' ')}`);
  }

  const outDir = path.join(PATHS.build, 'android');
  resetDir(outDir);
  const base = `${cfg.executableName}-${cfg.version}`;
  const result = { dir: outDir, signing: { sha256: signing.sha256, created: signing.created }, versionCode: versionCode(cfg.version) };
  const apkSrc = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  const aabSrc = path.join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  if (tasks.includes('assembleRelease')) {
    result.apk = path.join(outDir, `${base}.apk`);
    fs.copyFileSync(apkSrc, result.apk);
  }
  if (tasks.includes('bundleRelease')) {
    result.aab = path.join(outDir, `${base}.aab`);
    fs.copyFileSync(aabSrc, result.aab);
  }
  ctx.note(`输出：${[result.apk, result.aab].filter(Boolean).map((f) => `build/android/${path.basename(f)}（${formatBytes(fs.statSync(f).size)}）`).join('，')}`);
  return result;
}

// ── 安卓产物检查 ──
function buildTool(name) {
  const dir = path.join(sdkTools().buildToolsDir, ANDROID.buildTools.split('/')[1]);
  const exts = IS_WIN ? ['.bat', '.exe', ''] : [''];
  for (const ext of exts) if (fs.existsSync(path.join(dir, name + ext))) return path.join(dir, name + ext);
  return null;
}

export async function verifyAndroid(ctx, cfg, android, processed) {
  const { env } = await ensureAndroidEnv({ log: () => {}, withEmulator: false });
  const add = (ok, text) => (ok ? ctx.note(text) : ctx.warn(text));
  const gameHash = sha1(fs.readFileSync(path.join(processed.gameDir, 'index.html')));
  if (android.apk) {
    const apksigner = buildTool('apksigner');
    const sig = await run(apksigner, ['verify', '--print-certs', android.apk], { env, shell: IS_WIN });
    const digest = (sig.stdout.match(/certificate SHA-256 digest:\s*([0-9a-f]+)/i) || [])[1] || '';
    const expected = android.signing.sha256.replace(/:/g, '').toLowerCase();
    add(sig.code === 0 && digest === expected, sig.code === 0 && digest === expected ? 'APK 签名校验通过，证书与 secrets 里的密钥一致' : `APK 签名异常：${(sig.stderr || sig.stdout).trim().split('\n').pop()}`);

    const aapt2 = buildTool('aapt2');
    const badging = (await run(aapt2, ['dump', 'badging', android.apk], { env })).stdout;
    const pkg = (badging.match(/package: name='([^']+)'/) || [])[1];
    const vc = (badging.match(/versionCode='(\d+)'/) || [])[1];
    const target = (badging.match(/targetSdkVersion:'(\d+)'/) || [])[1];
    add(pkg === cfg.android.packageId, `包名 ${pkg}`);
    add(Number(vc) === android.versionCode, `版本 ${cfg.version}（versionCode ${vc}）`);
    add(Number(target) >= 36, `目标 API ${target}（Google Play 要求 ≥ 36）`);
    const manifest = (await run(aapt2, ['dump', 'xmltree', '--file', 'AndroidManifest.xml', android.apk], { env })).stdout;
    add(/screenOrientation/.test(manifest), /screenOrientation/.test(manifest) ? `屏幕方向已锁定为${cfg.android.orientation === 'portrait' ? '竖屏' : '横屏'}` : '屏幕方向没有锁定');

    const zip = new AdmZip(android.apk);
    const entry = zip.getEntry('assets/public/index.html');
    add(Boolean(entry) && sha1(entry.getData()) === gameHash, entry ? '包内游戏文件与本次处理（混淆）后的完全一致' : '包内缺少游戏文件');
    const dex = zip.getEntries().filter((e) => /^classes\d*\.dex$/.test(e.entryName)).map((e) => e.getData());
    const cls = (name) => dex.some((d) => d.includes(`L${cfg.android.packageId.replace(/\./g, '/')}/${name};`));
    add(cls('WgpLog') && cls('WgpLogPlugin'), cls('WgpLog') && cls('WgpLogPlugin') ? '运行日志模块已编进安卓包' : '安卓包里缺少运行日志模块');
    const splash = zip.getEntries().filter((e) => /\/splash\.png$/.test(e.entryName));
    add(!splash.length, splash.length ? `包内还有 ${splash.length} 张 Capacitor 默认启动图` : '没有残留 Capacitor 默认启动图');
  }
  if (android.aab) {
    const zip = new AdmZip(android.aab);
    const entry = zip.getEntry('base/assets/public/index.html');
    add(Boolean(entry) && sha1(entry.getData()) === gameHash, entry ? 'AAB（Google Play 用）内容完整' : 'AAB 缺少游戏文件');
  }
}

// ── 模拟器试跑 ──
function pngStats(buf) {
  if (buf.length < 33 || buf.toString('ascii', 1, 4) !== 'PNG') return { width: 0, height: 0, litRatio: 0 };
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || (type !== 2 && type !== 6)) return { width, height, litRatio: null };
  const bpp = type === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  let prev = Buffer.alloc(stride);
  let lit = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
    if (y % 8 === 0) {
      for (let x = 0; x < width; x += 8) {
        samples += 1;
        if (cur[x * bpp] + cur[x * bpp + 1] + cur[x * bpp + 2] > 60) lit += 1;
      }
    }
    prev = cur;
  }
  return { width, height, litRatio: samples ? lit / samples : 0 };
}

async function adbDevices(adb, env) {
  const out = (await run(adb, ['devices'], { env })).stdout;
  return out.split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2 && p[1] === 'device').map((p) => p[0]);
}

async function findOurEmulator(adb, env) {
  for (const serial of (await adbDevices(adb, env)).filter((s) => s.startsWith('emulator-'))) {
    const name = (await run(adb, ['-s', serial, 'emu', 'avd', 'name'], { env })).stdout.split('\n')[0].trim();
    if (name === ANDROID.avdName) return serial;
  }
  return null;
}

// 模拟器数据分区固定 6 GB，启动时要求约 7.4 GB 空闲磁盘（实测 API 36 镜像）
const EMULATOR_FREE_GB = 7.5;

export async function smokeAndroid(ctx, cfg, android) {
  if (!android.apk) {
    ctx.skip('没有打 APK（配置 android.outputs 里没有 "apk"），跳过试跑');
    return null;
  }
  const useUsb = cfg.android.smokeDevice === 'usb';
  const { env, tools } = await ensureAndroidEnv({ log: envLog(ctx), withEmulator: !useUsb });
  const adb = tools.adb;
  let serial = null;
  let started = false;
  if (useUsb) {
    serial = (await adbDevices(adb, env)).find((s) => !s.startsWith('emulator-')) || null;
    if (!serial) {
      ctx.skip('配置为用 USB 真机试跑，但没有检测到手机。请用数据线连接安卓手机，打开「开发者选项 → USB 调试」，并在手机上允许这台电脑');
      return null;
    }
    ctx.note(`使用 USB 连接的手机 ${serial} 试跑（只会安装和清空这个游戏自己的数据）`);
  } else {
    serial = await findOurEmulator(adb, env);
  }
  if (!serial) {
    const freeGb = (() => { try { const s = fs.statfsSync(os.homedir()); return (s.bavail * s.bsize) / 1024 ** 3; } catch { return 99; } })();
    if (freeGb < EMULATOR_FREE_GB) {
      ctx.skip(`磁盘只剩 ${freeGb.toFixed(1)} GB，模拟器运行需要约 ${EMULATOR_FREE_GB} GB 空闲空间，本次跳过试跑（APK/AAB 已正常打好）。清理磁盘后重跑；或连上安卓手机，把配置里 android.smokeDevice 改成 "usb" 用真机试跑`);
      return null;
    }
    ctx.note(`启动模拟器 ${ANDROID.avdName}（无窗口，冷启动约 1–3 分钟）…`);
    const logFile = path.join(PATHS.work, 'emulator.log');
    const fd = fs.openSync(logFile, 'w');
    const child = spawn(tools.emulator, ['-avd', ANDROID.avdName, '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot', '-gpu', 'swiftshader_indirect'],
      { env: { ...process.env, ...env }, detached: true, stdio: ['ignore', fd, fd] });
    let exited = null;
    child.on('exit', (code) => { exited = code; });
    child.unref();
    fs.closeSync(fd);
    started = true;
    const deadline = Date.now() + 6 * 60 * 1000;
    while (Date.now() < deadline && !serial) {
      await sleep(3000);
      if (exited !== null) {
        const fatal = readText(logFile).split('\n').filter((l) => /FATAL|ERROR/.test(l)).slice(-2).join(' ');
        if (/Not enough space/i.test(fatal)) {
          ctx.skip(`磁盘空间不够，模拟器没能启动，本次跳过试跑（APK/AAB 已正常打好）：${fatal.replace(/\s+/g, ' ').trim()}`);
          return null;
        }
        throw new Error(`模拟器启动失败：${fatal || `退出码 ${exited}`}`);
      }
      serial = await findOurEmulator(adb, env);
    }
    if (!serial) throw new Error('模拟器 6 分钟内没有启动起来');
  }
  const sh = (...args) => run(adb, ['-s', serial, 'shell', ...args], { env });
  const bootDeadline = Date.now() + 6 * 60 * 1000;
  while ((await sh('getprop', 'sys.boot_completed')).stdout.trim() !== '1') {
    if (Date.now() > bootDeadline) throw new Error('模拟器开机超时');
    await sleep(3000);
  }
  ctx.note(`模拟器已就绪：${serial}（Android ${(await sh('getprop', 'ro.build.version.release')).stdout.trim()}）`);

  const pkg = cfg.android.packageId;
  const result = { serial, shots: [], errors: [] };
  try {
    let inst = await run(adb, ['-s', serial, 'install', '-r', android.apk], { env, timeoutMs: 180000 });
    if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(inst.stdout + inst.stderr)) {
      // 设备上装着签名不同的旧版（例如调试包）。测试模拟器上直接卸掉重装；真机上不动玩家的存档，改为提示
      if (!serial.startsWith('emulator-')) throw new Error('手机上已装有签名不同的同名应用，请先在手机上手动卸载它再试跑（卸载会清掉这个游戏在手机上的存档）');
      ctx.note('测试模拟器上有签名不同的旧版本，已卸载后重装');
      await run(adb, ['-s', serial, 'uninstall', cfg.android.packageId], { env });
      inst = await run(adb, ['-s', serial, 'install', '-r', android.apk], { env, timeoutMs: 180000 });
    }
    if (inst.code !== 0 || !/Success/.test(inst.stdout)) throw new Error(`安装 APK 失败：${(inst.stdout + inst.stderr).trim().split('\n').pop()}`);
    ctx.note('APK 安装成功');
    await sh('pm', 'clear', pkg);
    await run(adb, ['-s', serial, 'logcat', '-c'], { env });
    await sh('am', 'start', '-W', '-n', `${pkg}/.MainActivity`);

    const shot = async (name) => {
      const { buf } = await runBuffer(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], env);
      const file = `${name}.png`;
      fs.writeFileSync(path.join(PATHS.assets, file), buf);
      const stats = pngStats(buf);
      result.shots.push({ file, ...stats, hash: sha1(buf) });
      return stats;
    };
    await sleep((cfg.smoke.bootSeconds + 6) * 1000);
    const first = await shot('安卓-1-启动画面');
    for (let i = 0; i < cfg.smoke.clicks; i += 1) {
      await sh('input', 'tap', String(Math.round(first.width / 2)), String(Math.round(first.height / 2)));
      await sleep((cfg.smoke.stepSeconds + 2) * 1000);
      await shot(`安卓-${i + 2}-点击${i + 1}次后`);
    }
    result.alive = Boolean((await sh('pidof', pkg)).stdout.trim());
    const log = (await run(adb, ['-s', serial, 'logcat', '-d', '-v', 'brief', 'Capacitor/Console:*', 'AndroidRuntime:E', '*:S'], { env })).stdout;
    result.errors = log.split('\n').filter((l) => /Uncaught|FATAL EXCEPTION/.test(l)).map((l) => l.trim().slice(0, 240));
    result.landscape = first.width > first.height;
  } finally {
    if (started && !cfg.android.keepEmulator) await run(adb, ['-s', serial, 'emu', 'kill'], { env });
  }

  const dark = result.shots.filter((s) => s.litRatio !== null && s.litRatio < 0.02);
  if (dark.length) ctx.warn(`${dark.length} 张截图几乎全黑：${dark.map((s) => s.file).join('、')}`);
  else ctx.note(`截图 ${result.shots.length} 张，画面正常（非黑屏）`);
  if (result.shots.length >= 2 && result.shots[0].hash === result.shots[result.shots.length - 1].hash) ctx.warn('点击前后画面完全相同，游戏可能没有响应触摸');
  else if (result.shots.length >= 2) ctx.note('点击后画面有变化，游戏在响应触摸');
  if (cfg.android.orientation !== 'portrait') {
    if (result.landscape) ctx.note('游戏以横屏运行');
    else ctx.warn('游戏没有以横屏显示');
  }
  if (!result.alive) ctx.fail('试跑结束时游戏进程已经不在了（可能闪退）');
  if (result.errors.length) ctx.fail(`运行时出现未捕获的错误 ${result.errors.length} 条：${result.errors.slice(0, 2).join(' | ')}`);
  else ctx.note('日志里没有脚本报错或崩溃');
  return result;
}

export function androidOutputSize(android) {
  return android ? dirSize(android.dir) : 0;
}
