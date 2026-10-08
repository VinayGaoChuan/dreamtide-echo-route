// 单独整理日志（不打包）：node tools/logs.mjs
// 把测试者发来的日志文件放进「收到的日志」，运行本脚本，摘要写到「输出/日志摘要.md」，并同步一份到技能目录。
import { PATHS } from './lib/common.mjs';
import { loadConfig } from './lib/setup.mjs';
import { collectLogs } from './lib/logs.mjs';

const ctx = { note: (m) => console.log(`· ${m}`), warn: (m) => console.log(`⚠️ ${m}`), skip: (m) => console.log(`⏭️ ${m}`), fail: (m) => console.log(`❌ ${m}`) };
try {
  const cfg = loadConfig(ctx);
  const result = collectLogs(ctx, cfg, { smoke: null, buildId: '' });
  console.log(`\n✅ 已整理 ${result.feedback.length} 个日志文件，摘要：${PATHS.output}/日志摘要.md`);
  for (const f of result.feedback) {
    console.log(`   ${f.file}：报错 ${f.counts.error}，警告 ${f.counts.warn}，崩溃 ${f.crashes}，卡死 ${f.hangs}`);
  }
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exitCode = 1;
}
