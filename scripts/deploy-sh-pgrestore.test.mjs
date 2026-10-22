// scripts/deploy-sh-pgrestore.test.mjs —— T18 spec 评审 P1#1 契约测试：
// deploy.sh REBUILD_DB 段（破坏性 DROP SCHEMA 前）必须持有三件——
//   ① dump 存在性 fail-fast（②pre-migrate dump 缺失=不可逆操作无回退锚⇒ exit 1 中止）；
//   ② 打印可直接复制执行的 pg_restore -c --if-exists 回滚命令（v11.2 ②失败回滚=restore——
//     恢复语义权威 full-stack-backup.md §3，此处只产命令不复刻语义）；
//   ③ 语法可解析（bash -n）。
// 背景：commit edc09fb8 消息曾声称本面但 diff 零变更（虚报）——本测试把契约钉进 verify 链防再犯。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SH = readFileSync(path.join(ROOT, 'deploy.sh'), 'utf8');
// 切块：REBUILD_DB echo 起→该段 rebuild-db.mjs 执行步行尾（③migrate deploy 首现于文件头部注释——
// 不可作终点标记；rebuild-db.mjs 调用行=DROP 执行步，以其行尾为界）。
const startIdx = SH.indexOf('REBUILD_DB：DROP SCHEMA 重建');
const dropIdx = SH.indexOf("rebuild-db.mjs \"$DSN\"", startIdx);
const rebuildBlock = SH.slice(startIdx, dropIdx + "rebuild-db.mjs \"$DSN\"".length);

test('① dump 存在性 fail-fast：REBUILD_DB 段 DROP 前置 dump 缺失⇒exit 1 中止（回退锚前置不可绕）', () => {
  assert.ok(rebuildBlock.includes('ls -t ~/backups/pre-migrate-*.dump'), '解析②最新 dump（ls -t | head -1）');
  assert.match(rebuildBlock, /if \[ -z "\$DUMP" \]; then[^\n]*FAIL-FAST[^\n]*无回退锚[^\n]*\n?[^\n]*exit 1/, 'dump 缺失⇒FAIL-FAST+exit 1');
  // fail-fast 步必须先于 rebuild-db.mjs 执行步（DROP 在后者内）——顺序契约
  assert.ok(rebuildBlock.indexOf('FAIL-FAST') < rebuildBlock.indexOf('rebuild-db.mjs'), 'fail-fast 先于 DROP 执行步');
});

test('② 回滚=restore 命令打印：pg_restore -d "$DSN" -c --if-exists（\$DSN 打印字面占位非展开——DSN 含口令禁入终端/日志）', () => {
  // 远端 echo 内 \"\$DSN\"：本地单引号串保 \|，远端双引号内 \$=字面 $——打印 pg_restore -d "$DSN" 占位
  assert.ok(rebuildBlock.includes('pg_restore -d \\"\\$DSN\\" -c --if-exists $DUMP'), '打印完整 pg_restore 命令（\\$DSN 字面占位）');
  assert.ok(!rebuildBlock.includes('pg_restore -d \\"$DSN'), '不存在可展开的 $DSN 泄漏形态（防口令入终端/日志）');
  assert.ok(rebuildBlock.includes('回退锚就绪'), 'dump 就绪留痕（回退锚文件名打印）');
});

test('③ deploy.sh 语法可解析（bash -n）', () => {
  execFileSync('bash', ['-n', path.join(ROOT, 'deploy.sh')]);   // 解析失败即抛=测试红
});
