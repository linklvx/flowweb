// scripts/check-no-random-ports.test.mjs —— TD-32/C3 T24：随机端口门禁自测（node --test 池消费）。
// 三 section 口径：①随机段宽正则零命中 ②freePort 零残留 ③测试/harness 固定端口档零命中
// （'0'/listen(0) 放行；注释行/自身/测试意图行排除；--list 输出 file:line）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = path.join(ROOT, 'scripts', 'check-no-random-ports.mjs');
const url = (p) => new URL(`file://${GATE.replace(/\\/g, '/')}`).href + `?p=${encodeURIComponent(p)}`;   // 缓存破除（多次 import 不同测试）

async function mod() {
  return import(url(Math.random().toString(36).slice(2))).catch(() => null);
}

test('T24 红①：随机端口宽正则命中/零命中两态（§1）', async () => {
  const m = await mod();
  assert.ok(m, 'check-no-random-ports.mjs 缺失=红');
  const bad = 'serverPort = 20000 + Math.floor(Math.random() * 20000);';
  const hits = m.scanSource('apps/api/src/x.spec.ts', bad, { section: 1 });
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /Math\.random/);
  assert.deepEqual(m.scanSource('apps/api/src/x.spec.ts', 'const port = 0; // ephemeral', { section: 1 }), []);
});

test('T24 红②：freePort 残留命中，但注释行不误报（§2）', async () => {
  const m = await mod();
  assert.equal(m.scanSource('apps/api/src/y.spec.ts', 'const port = await freePort();', { section: 2 }).length, 1);
  assert.deepEqual(m.scanSource('apps/api/src/y.spec.ts', '// freePort 装置退役（历史注记）', { section: 2 }), []);
});

test("T24 红③：测试/harness 固定端口档命中；'0'/listen(0)/测试意图行放行（§3）", async () => {
  const m = await mod();
  assert.equal(m.scanSource('apps/api/src/z.spec.ts', 'await server.listen(3001);', { section: 3 }).length, 1);
  assert.equal(m.scanSource('apps/api/src/z.spec.ts', 'await server.listen(0);', { section: 3 }).length, 0);
  assert.equal(m.scanSource('apps/api/src/z.spec.ts', "await server.listen('3001');", { section: 3 }).length, 1);   // 双审 F7：字符串口漏网补
  assert.equal(m.scanSource('apps/api/src/z.spec.ts', "await server.listen('0');", { section: 3 }).length, 0);
  assert.equal(m.scanSource('apps/api/src/z.spec.ts', "env: { COLLAB_PORT: '3001' }", { section: 3 }).length, 1);
  assert.deepEqual(m.scanSource('apps/api/src/z.spec.ts', "env: { COLLAB_PORT: '0' }", { section: 3 }), []);
  assert.deepEqual(m.scanSource('apps/api/src/z.spec.ts', "expect(envSchema.safeParse({ ...good, COLLAB_PORT: '3001' }).success).toBe(true);", { section: 3 }), []);
  // 生产入口/drill 配置面不在测试/harness 扫描集（listen(env.PORT) 变量形态亦不命中字面量档）
  assert.deepEqual(m.scanSource('apps/api/src/main.ts', 'await app.listen(env.PORT, ...);', { section: 3 }), []);
});

test('卡② K2 红⑤：端口门引号+数字洞六条（§3——反引/双引/无引号数字档+尾边界+路径分类）', async () => {
  const m = await mod();
  // ①反引号固定口命中（原只查单/双引——反引口漏网）
  assert.equal(m.scanSource('apps/api/src/z.spec.ts', 'await server.listen(`3001`);', { section: 3 }).length, 1);
  // ②反引号 '0' 放行
  assert.equal(m.scanSource('apps/api/src/z.spec.ts', 'await server.listen(`0`);', { section: 3 }).length, 0);
  // ③COLLAB_PORT 双引/反引命中（原只查单引）
  assert.equal(m.scanSource('apps/api/src/z.spec.ts', 'env: { COLLAB_PORT: "3001" }', { section: 3 }).length, 1);
  assert.equal(m.scanSource('apps/api/src/z.spec.ts', 'env: { COLLAB_PORT: `3001` }', { section: 3 }).length, 1);
  // ④模板占位符形态不命中
  assert.equal(m.scanSource('apps/api/src/z.spec.ts', 'await server.listen(`${port}`);', { section: 3 }).length, 0);
  // ⑤无引号数字档命中+6 位数字尾边界不命中（非合法端口形态）
  assert.equal(m.scanSource('apps/api/src/z.spec.ts', 'env: { COLLAB_PORT: 3001 }', { section: 3 }).length, 1);
  assert.equal(m.scanSource('apps/api/src/z.spec.ts', 'env: { COLLAB_PORT: 123456 }', { section: 3 }).length, 0);
  // ⑥路径分类双断言：testish 命中/census 脚本（非 testish）零命中
  assert.equal(m.scanSource('apps/api/src/x.spec.ts', 'COLLAB_PORT: 1', { section: 3 }).length, 1);
  assert.equal(m.scanSource('scripts/check-collab-census.mjs', 'COLLAB_PORT: 1', { section: 3 }).length, 0);
});

test('T24 红④：--list 输出 file:line（附录 A 单源）；全仓当前零命中', () => {
  const r = spawnSync(process.execPath, [GATE, '--list'], { encoding: 'utf8', cwd: ROOT, timeout: 120_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /check-no-random-ports/);
  const r2 = spawnSync(process.execPath, [GATE], { encoding: 'utf8', cwd: ROOT, timeout: 120_000 });
  assert.equal(r2.status, 0, `${r2.stdout}\n${r2.stderr}`);
});
