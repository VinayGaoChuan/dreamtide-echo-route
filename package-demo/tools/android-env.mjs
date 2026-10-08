// 单独安装/检查安卓环境：node tools/android-env.mjs [--emulator] [--accept-licenses]
// 一键打包在启用 android 平台时会自动调用同样的逻辑，这个入口用于提前准备环境。
import { ensureAndroidEnv } from './lib/android-env.mjs';

const args = new Set(process.argv.slice(2));
const started = Date.now();
try {
  const env = await ensureAndroidEnv({
    withEmulator: args.has('--emulator'),
    acceptLicenses: args.has('--accept-licenses'),
    log: (m) => console.log(m),
  });
  console.log(`\n✅ 安卓环境就绪（${Math.round((Date.now() - started) / 1000)} 秒）\n   JDK：${env.jdk}\n   SDK：${env.root}`);
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
}
