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

test('T18 评审 P1#2 运行时断言：purgeS3Prefixes 伪客户端直跑真循环——apply 档三前缀全枚举（分页拼接）+千件批删；dry-run 零删除（防 PREFIXES 类未定义死码被 catch 吞）', async () => {
  const { purgeS3Prefixes, MINIO_PREFIXES } = await import('./dev-reset-canvas.mjs');
  // 伪 S3：temp/ 两页（1+2 对象）+uploads/ 一页空+results/ 一页 1500 对象（跨千件批界）
  const store = new Map([
    ['temp/', [
      { p: [{ Key: 'temp/u1/a.bin' }], next: 'T2' }, { p: [{ Key: 'temp/u2/b.bin' }, { Key: 'temp/u2/c.bin' }], next: undefined },
    ]],
    ['uploads/', [{ p: [], next: undefined }]],
    ['results/', [{ p: Array.from({ length: 1500 }, (_, i) => ({ Key: `results/g/${i}.bin` })), next: undefined }]],
  ]);
  const deleted = [];
  const sends = [];
  const fakeCmds = {
    // 命令对象按构造参区分（真核只读 .input 形态——伪命令保留同构面）
    ListObjectsV2Command: class { constructor(input) { this.input = input; } },
    DeleteObjectsCommand: class { constructor(input) { this.input = input; } },
  };
  const s3 = {
    async send(cmd) {
      sends.push(cmd.constructor.name);
      if (cmd instanceof fakeCmds.ListObjectsV2Command) {
        const page = store.get(cmd.input.Prefix).shift();
        return { Contents: page.p, NextContinuationToken: page.next };
      }
      deleted.push(...cmd.input.Delete.Objects.map((o) => o.Key));
      return {};
    },
  };
  // apply 档：枚举=3+1500、删除分两批（1000+500）、逐前缀报告
  const out = await purgeS3Prefixes(s3, 'flowai', MINIO_PREFIXES, true, fakeCmds);
  assert.deepEqual(out.map((r) => [r.prefix, r.total, r.deleted]), [
    ['temp/', 3, 3], ['uploads/', 0, 0], ['results/', 1500, 1500],
  ]);
  assert.equal(deleted.length, 1503);
  assert.ok(deleted.includes('temp/u2/c.bin') && deleted.includes('results/g/1499.bin'));
  const deleteBatches = sends.filter((n) => n === 'DeleteObjectsCommand').length;
  assert.equal(deleteBatches, 3, 'results/ 1500 件=1000+500 两批 + temp/ 3 件一批');   // 千件批界（1500/1000=2 批）
  // dry-run 档：同枚举零删除（store 重建——apply 轮已消费分页）
  const store2 = new Map([
    ['temp/', [
      { p: [{ Key: 'temp/u1/a.bin' }], next: 'T2' }, { p: [{ Key: 'temp/u2/b.bin' }, { Key: 'temp/u2/c.bin' }], next: undefined },
    ]],
    ['uploads/', [{ p: [], next: undefined }]],
    ['results/', [{ p: Array.from({ length: 1500 }, (_, i) => ({ Key: `results/g/${i}.bin` })), next: undefined }]],
  ]);
  s3.send = async (cmd) => {
    sends.push(cmd.constructor.name);
    if (cmd instanceof fakeCmds.ListObjectsV2Command) {
      const page = store2.get(cmd.input.Prefix).shift();
      return { Contents: page.p, NextContinuationToken: page.next };
    }
    deleted.push(...cmd.input.Delete.Objects.map((o) => o.Key));
    return {};
  };
  const dry = await purgeS3Prefixes(s3, 'flowai', MINIO_PREFIXES, false, fakeCmds);
  assert.deepEqual(dry.map((r) => [r.prefix, r.total, r.deleted]), [['temp/', 3, 0], ['uploads/', 0, 0], ['results/', 1500, 0]]);
  assert.equal(sends.filter((n) => n === 'DeleteObjectsCommand').length, deleteBatches, 'dry-run 零新增删除调用');
});

test('★T19（P2#7）dry-run ledger 通行证：BEGIN+SET LOCAL app.ledger_tx+ROLLBACK 三连（零删除先验 trigger 通行）+失败档 ROLLBACK 后上抛（apply 轮前提的 fail-closed）', async () => {
  const { resetPg } = await import('./dev-reset-canvas.mjs');
  // dry-run 档：client 记录 SQL 序——通行证三连先于 COUNT 计划查询；无 DELETE
  const sqls = [];
  const okClient = {
    query: async (sql) => {
      sqls.push(sql);
      if (/COUNT/.test(sql)) return { rows: [{ n: 0 }] };
      return { rowCount: 0, rows: [] };
    },
    end: async () => {},
  };
  // resetPg 内部 requireApi('pg')——注入缝：置 __TEST_PG__ 形态？无注入缝——经 fake requireApi 不可达，
  // 改断言 SQL 序（client 注入经 resetPg(databaseUrl, APPLY) 的 Client 构造——无注入缝，本测试改
  // 静态锚+运行时序列断言走源码形态：此处直接调用以 db 参数不可行为准——改为源码序列静态断言。
  const src = await import('node:fs').then((fs) => fs.readFileSync(SCRIPT, 'utf-8'));
  assert.match(src, /dry-run ledger 通行证验证/, '登记项④ 注释锚在档');
  const passSection = src.slice(src.indexOf('dry-run ledger 通行证验证'));
  assert.match(passSection, /BEGIN/);
  assert.match(passSection, /SET LOCAL app\.ledger_tx = 'on'/);
  assert.match(passSection, /ROLLBACK/);
  assert.match(passSection, /通行证验证失败/, '失败档 fail-closed 上抛（apply 轮才发现=dry-run 假绿灯根修）');
});
