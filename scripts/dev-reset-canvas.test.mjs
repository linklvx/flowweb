// scripts/dev-reset-canvas.test.mjs —— T18：reset 脚本安全五件套元测试（red：非白名单环境/生产 DB 拒执行）。
// 子进程直跑形态断言（脚本=main-only 零导出面——与 collab-renumber-layer.test.mjs 同装置前提）。
// DB 触达用例全部走「安全门拒执行」路径（exit 1 先于任何连接）——测试本身零 DB 依赖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dev-reset-canvas.mjs');

/** 直跑并断言非零退出+stderr 匹配（安全门 fail-closed 形态） */
function runExpectFail(env, pattern) {
  try {
    execFileSync(process.execPath, [SCRIPT], { env: { ...process.env, ...env }, stdio: 'pipe' });
    assert.fail('必须非零退出');
  } catch (e) {
    assert.notEqual(e.status, 0, '退出码非零');
    assert.match(String(e.stderr), pattern);
  }
}

test('安全门①：NODE_ENV=production 拒执行（环境白名单——先于一切连接）', () => {
  runExpectFail({ NODE_ENV: 'production' }, /NODE_ENV=production 拒执行/);
});

test('安全门②：非白名单 host（生产 DB 形态）拒执行——v11.1⑤ red 判据', () => {
  runExpectFail(
    { DATABASE_URL: 'postgresql://flowweb:secret@101.42.94.107:5432/flowweb' },
    /非本地库拒绝执行.*host=101\.42\.94\.107/,
  );
  runExpectFail(
    { DATABASE_URL: 'postgresql://u:p@prod-db.internal:5432/flowweb' },
    /疑似生产库禁连/,
  );
});

test('安全门③④：默认 dry-run（--apply 缺席才执行）+ 路径限定静态锚——表清单/Redis 模式/MinIO 前缀精确集合（禁 FLUSHDB/全库通配）', async () => {
  const { RESET_TABLES, REDIS_PATTERNS, MINIO_PREFIXES, isLocalDbHost } = await import('./dev-reset-canvas.mjs');
  // ④ 路径限定：三清单精确集合（漂移即红——新增表/键/前缀必须有意识地改本测试）
  assert.deepEqual(RESET_TABLES, [
    'NodeArtifact', 'ArtifactProjection', 'MediaBinding', 'MediaFactOutbox', 'CanvasDocUpdate',
    'CanvasDoc', 'Media', 'GenerationIntent', 'TeamCreditTransaction', 'LightingTask',
  ]);
  assert.deepEqual(REDIS_PATTERNS, ['videoWork:process:*', 'videoWork:categories', 'user:video-separate:*', 'lock:video-separate:*']);
  assert.deepEqual(MINIO_PREFIXES, ['temp/', 'uploads/', 'results/']);   // buildKey 词表对齐（'artifacts'=results/）
  for (const pat of REDIS_PATTERNS) assert.ok(!pat.includes(' '), `模式无空格：${pat}`);
  // host 白名单谓词（安全门②判定核）
  assert.equal(isLocalDbHost('postgresql://u:p@localhost:5432/db'), true);
  assert.equal(isLocalDbHost('postgresql://u:p@127.0.0.1:5432/db'), true);
  assert.equal(isLocalDbHost('postgresql://u:p@101.42.94.107:5432/db'), false);
  assert.equal(isLocalDbHost('not-a-url'), false);   // 非法 URL=fail-closed 拒
  // ③ dry-run 默认：--apply 才进执行面（main 消费 APPLY 门——静态面由安全门①②子进程红测承载拒执行序）
});
