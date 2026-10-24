// Y0b-4 T14：check-collab-census.mjs 单元测试（node --test；check-spec-consistency.test.mjs 先例形态）。
// 只测纯 helper（剥离器/分组判定）；端到端走 verify 链的 `node scripts/check-collab-census.mjs`。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stripCommentsAndStrings, classifyCloseLiteral, classifyConsumeCall, extractDiagCalls,
  resolveRelativeImport, extractImportSpec, collectImportClosure,
  classifyWorkerBannedSymbol, isHocuspocusServerImport,
  reconcileRegisteredRed, reconcileWithDocRegistry,
  extractProcessEnvKeys, countDynamicEnvAccess, computeBraceDepth, parseDotEnvKeys, ecosystemEnvKeys,
  parsePrismaUniques, parseRawIndexAnchor, findEquivalentIndexes,
  extractNodeDataWriteKeys, reconcileKeyRegistry, findBareProjectDocNameLines,
  findExecMapAccessLines, findLineOccurrences, reconcileCountWhitelist,
} from './check-collab-census.mjs';

test('stripCommentsAndStrings：行注释/块注释/字符串内容剥离、代码保留、换行保位', () => {
  const src = [
    'const a = 1; // close(1011) 注释',                    // 行注释——剥离后不得命中
    '/* close(4404) 块注释 */ const b = 2;',                // 块注释
    "const s = 'close(1008) 字符串'; const t = 2;",         // 字符串内容剥离（引号保留）
    'const tpl = `close(1011) ${x} tail`;',                 // 模板串内容剥离（含 ${} 嵌套）
    'const keep = close(4404, "x");',                       // 真代码——保留命中
  ].join('\n');
  const out = stripCommentsAndStrings(src);
  assert.equal((out.match(/close\(\d+/g) ?? []).length, 1, '只留真代码一处');
  assert.match(out, /close\(4404/);
  assert.equal(out.split('\n').length, 5, '换行保位（行号可跳转）');
});

// Y0c T34（§0.6 偏离 53）：〔M〕advisory 假阳性根因修复——模板插值自身闭合 `}` 不得透传
// （`${` 开括号已剥为两空格，closer 原样发射=每处插值一枚孤儿 `}`⇒computeBraceDepth 负漂移⇒
// 函数体内 env 读被误标 module-level）。嵌套花括号（frame>1）仍成对透传=自平衡不受影响。
test('T34（偏离 53）：模板插值闭合 `}` 零深度贡献；regex 字面量 {8,64} 自平衡（卡内假设勘正的实证锚）', () => {
  assert.equal(computeBraceDepth(stripCommentsAndStrings('const a = `regen:${tok}`;')), 0, '插值 closer 不再泄漏孤儿 `}`');
  assert.equal(computeBraceDepth(stripCommentsAndStrings('const b = `${ {a:1}.a }` + f(`${x}`);')), 0, '嵌套花括号成对透传自平衡');
  assert.equal(computeBraceDepth(stripCommentsAndStrings('const RE = /^[0-9a-zA-Z_-]{8,64}$/;')), 0, 'regex {8,64} 自平衡（非漂移源）');
  // intent-key.util 形态回归：函数体内 process.env 读行 beforeDepth=1（旧实现被前文插值 orphan 拉到 0⇒假〔M〕）
  const src = [
    'const RE = /^[0-9a-z]{8,64}$/;',
    'export function f(raw) {',
    '  const t = `x${raw}`;',
    '  return Number(process.env.EXEC_X) || 1;',
    '}',
  ].join('\n');
  const lines = stripCommentsAndStrings(src).split('\n');
  let d = 0;
  const depths = lines.map((l) => { const before = d; d += computeBraceDepth(l); return before; });
  assert.equal(extractProcessEnvKeys(lines[3]).length, 1);
  assert.equal(depths[3], 1, 'process.env 读行在函数体内（module-level 判定不得命中）');
});

test('classifyCloseLiteral：1008/1011/4404 裸字面量命中、1000/4410 放行', () => {
  assert.ok(classifyCloseLiteral('if (x) conn.webSocket.close(1008, "r")'));
  assert.ok(classifyCloseLiteral('ws.close(1011)'));
  assert.ok(classifyCloseLiteral('sock.close(4404)'));
  assert.equal(classifyCloseLiteral('ws.close(1000, "normal")'), null);
  assert.equal(classifyCloseLiteral('this.hardClose(c, CollabCloseCode.DOC_OVER_QUOTA, r)'), null);
});

test('classifyConsumeCall：显式 cost 通过、省参 cost 失败（全显式纪律）', () => {
  assert.equal(classifyConsumeCall('this.msgBuckets.consume(socketId, 1)'), null);
  assert.equal(classifyConsumeCall('this.bytesBuckets.consume(sid, bytes)'), null);
  assert.ok(classifyConsumeCall('this.upgradeBucket.consume(ip)').startsWith('省参 cost'));
});

// Y0b-5 T18 ㉒（组⑬）：extractDiagCalls——recordCollabDiag/recordRingOnlyCollabDiag 调用点
// 静态提取（raw 源扫描：type/detail 均字符串字面量，剥字符串面会结构性消失——组⑦同则）。
test('extractDiagCalls：单行调用提取 type/键集/字面量值（含三元两支）', () => {
  const src = [
    "import { recordCollabDiag } from './x';",
    "const a = recordCollabDiag('recover_triggered', { level: t ? 'terminal' : 'transient' });   // 尾注",
  ].join('\n');
  const calls = extractDiagCalls(src);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, 'batch');
  assert.equal(calls[0].type, 'recover_triggered');
  assert.deepEqual(calls[0].keys, ['level']);
  assert.deepEqual(calls[0].literals, { level: ['terminal', 'transient'] });
  assert.equal(calls[0].line, 2);
  assert.equal(calls[0].problem, null);
});

test('extractDiagCalls：跨行对象字面量+简写键（按变量名解析——裁定 25⑵）+无 detail 形态', () => {
  const multi = [
    "recordCollabDiag('invariant_violation', {",
    "  where: 'react-boundary',",
    '  name: error.name,',
    '  frame: first(error.stack),',
    '});',
  ].join('\n');
  let calls = extractDiagCalls(multi);
  assert.deepEqual(calls[0].keys, ['where', 'name', 'frame']);
  assert.deepEqual(calls[0].literals, { where: ['react-boundary'] });

  calls = extractDiagCalls("recordCollabDiag('auth_reject', { reason, terminal });");
  assert.deepEqual(calls[0].keys, ['reason', 'terminal']);
  assert.deepEqual(calls[0].literals, {});

  calls = extractDiagCalls("recordCollabDiag('hydration_fail');");
  assert.deepEqual(calls[0].keys, []);
});

test('extractDiagCalls：ring-only 通道/定义行/注释行排除/非法形态登记', () => {
  const src = [
    'export function recordCollabDiag(type, detail) { return; }',
    "// scope 本身经 recordCollabDiag('conn_scope') 记录",
    'const r = recordRingOnlyCollabDiag("ws_status", { reason: k, used, quota });',
    'const d = recordCollabDiag(someVar);',
    'const s = recordCollabDiag("write_reject", { ...x });',
  ].join('\n');
  const calls = extractDiagCalls(src);
  assert.equal(calls.length, 3); // 定义行+注释行不进调用面
  assert.equal(calls[0].channel, 'ring-only');
  assert.equal(calls[0].type, 'ws_status');
  assert.deepEqual(calls[0].keys, ['reason', 'used', 'quota']);
  assert.equal(calls[1].problem, 'type 非字符串字面量（锚不可静态校验）');
  assert.ok(calls[2].problem.startsWith('detail 展开禁入'));
});

// ── Y0c T2（组⑭⑮）：withDoc 全枚举 + worker 符号级禁令闭包断言 helpers ──

test('resolveRelativeImport：./ ../ 解析到仓内实文件；index.ts 候选；包名与不存在目标=null', () => {
  const procFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/api/src/modules/execution/execution.processor.ts');
  assert.equal(resolveRelativeImport(procFile, './execution.service'), path.resolve(path.dirname(procFile), 'execution.service.ts'));
  assert.equal(resolveRelativeImport(procFile, '../collab/collab-document.service'), path.resolve(path.dirname(procFile), '../collab/collab-document.service.ts'));
  assert.equal(resolveRelativeImport(procFile, 'yjs'), null);                       // 包名=闭包边界
  assert.equal(resolveRelativeImport(procFile, '@flowweb/shared'), null);
  assert.equal(resolveRelativeImport(procFile, './no-such-module'), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'census-idx-'));
  try {
    fs.mkdirSync(path.join(dir, 'barrel'));
    fs.writeFileSync(path.join(dir, 'barrel', 'index.ts'), 'export {};', 'utf8');
    assert.equal(resolveRelativeImport(path.join(dir, 'a.ts'), './barrel'), path.join(dir, 'barrel', 'index.ts'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('extractImportSpec：真 import/export-from 提取；注释行/字符串伪 import（stripped 同行无骨架）放行', () => {
  const pair = (l) => [l, stripCommentsAndStrings(l)];
  assert.equal(extractImportSpec(...pair(`import { ExecutionService } from './execution.service';`)), './execution.service');
  assert.equal(extractImportSpec(...pair(`} from '../collab/collab-document.service';`)), '../collab/collab-document.service');   // 多行 import 尾行
  assert.equal(extractImportSpec(...pair(`export { readFrameType } from './frame-type';`)), './frame-type');                      // re-export 边
  assert.equal(extractImportSpec(...pair(`const m = require('./x');`)), './x');
  assert.equal(extractImportSpec(...pair(`// import { X } from './ghost';`)), null);                                              // 注释伪 import
  assert.equal(extractImportSpec(...pair(`const s = "from './ghost'";`)), null);                                                  // 字符串伪 import
  assert.equal(extractImportSpec(...pair(`const x = 1;`)), null);
});

test('collectImportClosure：传递闭包含环安全、非相对边界（resolve=null）不追踪', () => {
  const files = new Map([
    ['a', { raw: "import { b } from './b';\nimport x from 'pkg';", stripped: "import { b } from '';\nimport x from '';" }],
    ['b', { raw: "export { c } from './c';", stripped: "export { c } from '';" }],
    ['c', { raw: "import { a } from './a';", stripped: "import { a } from '';" }],
    ['outside', { raw: '', stripped: '' }],
  ]);
  const resolve = (from, spec) => (spec === './b' ? 'b' : spec === './c' ? 'c' : spec === './a' ? 'a' : null);
  assert.deepEqual([...collectImportClosure(['a'], files, resolve)].sort(), ['a', 'b', 'c']);
});

test('classifyWorkerBannedSymbol：openDirectConnection/applyUpdate(含 V2) 命中；纯函数与派生词放行', () => {
  assert.equal(classifyWorkerBannedSymbol('const connection = await hocuspocus.openDirectConnection(name)'), 'openDirectConnection');
  assert.equal(classifyWorkerBannedSymbol('Y.applyUpdate(document, u);'), 'applyUpdate');
  assert.equal(classifyWorkerBannedSymbol('Y.applyUpdateV2(document, u);'), 'applyUpdate');
  assert.equal(classifyWorkerBannedSymbol('Y.decodeStateVector(payload)'), null);      // 纯函数允许
  assert.equal(classifyWorkerBannedSymbol('Y.mergeUpdates(list)'), null);              // 纯函数允许
  assert.equal(classifyWorkerBannedSymbol('Y.encodeStateAsUpdate(doc)'), null);        // 纯函数允许
  assert.equal(classifyWorkerBannedSymbol('this.applyUpdates(docs)'), null);           // 派生词
  assert.equal(classifyWorkerBannedSymbol('myopenDirectConnection()'), null);          // 前缀粘连
});

test("isHocuspocusServerImport：真 import/require 命中；注释与字符串伪形态放行", () => {
  const pair = (l) => [l, stripCommentsAndStrings(l)];
  assert.ok(isHocuspocusServerImport(...pair(`import { Server, OutgoingMessage } from '@hocuspocus/server';`)));
  assert.ok(isHocuspocusServerImport(...pair(`import type { onLoadDocumentPayload } from '@hocuspocus/server';`)));
  assert.ok(isHocuspocusServerImport(...pair(`const m = require('@hocuspocus/server');`)));
  assert.equal(isHocuspocusServerImport(...pair(`// 禁 @hocuspocus/server import`)), false);       // 注释提及
  assert.equal(isHocuspocusServerImport(...pair(`const tag = '@hocuspocus/server';`)), false);     // 字符串值
  assert.equal(isHocuspocusServerImport(...pair(`import { Y } from 'yjs';`)), false);
});

test('reconcileRegisteredRed：精确双向对账——未登记/计数漂移/登记红项已消失三分', () => {
  const hits = { 'a.ts': { openDirectConnection: 1 }, 'b.ts': { applyUpdate: 2 } };
  const registered = { 'b.ts': { applyUpdate: { n: 3, until: '片D' } }, 'c.ts': { openDirectConnection: { n: 1, until: '片D' } } };
  const r = reconcileRegisteredRed(hits, registered);
  assert.deepEqual(r.unregistered, [{ file: 'a.ts', symbol: 'openDirectConnection', n: 1 }]);
  assert.deepEqual(r.drift, [{ file: 'b.ts', symbol: 'applyUpdate', want: 3, n: 2 }]);
  assert.deepEqual(r.stale, [{ file: 'c.ts', symbol: 'openDirectConnection', until: '片D' }]);
  const ok = reconcileRegisteredRed({ 'b.ts': { applyUpdate: 3 }, 'c.ts': { openDirectConnection: 1 } }, registered);
  assert.deepEqual(ok, { unregistered: [], drift: [], stale: [] });   // 精确双向相等=全绿
});

test('reconcileWithDocRegistry：未登记调用点/分类合计漂移/登记点消失三分；合计口径', () => {
  const counts = { 'a.ts': 2, 'b.ts': 1 };
  const registry = { 'a.ts': { 'read-only': 1, 'write-via-writer': 1 }, 'c.ts': { '待收编': 1 } };
  assert.deepEqual(reconcileWithDocRegistry(counts, registry), [
    '未登记 withDoc 调用点 b.ts ×1',
    '登记点消失 c.ts（B4 v2 清单需同步）',
  ]);
  const drifted = reconcileWithDocRegistry({ 'a.ts': 3 }, registry);
  assert.ok(drifted.some((d) => d.includes('登记计数漂移 a.ts: 登记合计 2 实际 3')));
});

// ── Y0c T3（组㉑㉒）：env 两分（Z89）+ env 裸读两分（Z79）helpers ──

test('extractProcessEnvKeys：点号/方括号两形态键归一（单键单元素）；整对象与无读行=空数组', () => {
  assert.deepEqual(extractProcessEnvKeys('const port = Number(process.env.COLLAB_PORT) || 3001;'), ['COLLAB_PORT']);
  assert.deepEqual(extractProcessEnvKeys("const dir = process.env['COLLAB_SPOOL_DIR'] ?? '';"), ['COLLAB_SPOOL_DIR']);
  assert.deepEqual(extractProcessEnvKeys('if (process.env.NODE_ENV === "production") {'), ['NODE_ENV']);
  assert.deepEqual(extractProcessEnvKeys('const result = envSchema.safeParse(process.env);'), []);   // 整对象（env 单源入口）
  assert.deepEqual(extractProcessEnvKeys('const env = process.env;'), []);                            // 整对象赋值
  assert.deepEqual(extractProcessEnvKeys('console.log(env.PORT);'), []);                              // 无 process.env 直读
});

// I-1a（T3 评审）：line.match 无 g 标志——同行第二读点不可见漏报。matchAll 后返回全部出现
// （重复键多元素=按出现次数计数）。三实况=评审实测漏报点。
test('extractProcessEnvKeys：同行多读点全提取（I-1a——?:回退/模板插值/同键重复）', () => {
  assert.deepEqual(
    extractProcessEnvKeys('const token = process.env.COLLAB_ADMIN_TOKEN ?? process.env.PROMETHEUS_TOKEN;'),
    ['COLLAB_ADMIN_TOKEN', 'PROMETHEUS_TOKEN'],   // collab-ready.controller.ts:31 实况
  );
  assert.deepEqual(
    extractProcessEnvKeys(stripCommentsAndStrings(
      'notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL || `${process.env.CORS_ORIGIN}/api/recharge/notify/wechat`,',
    )),
    ['WECHAT_PAY_NOTIFY_URL', 'CORS_ORIGIN'],     // team-recharge.service.ts:84 实况（插值体剥离器透传）
  );
  assert.deepEqual(
    extractProcessEnvKeys('const n = Number(process.env.X ?? process.env.X);'),
    ['X', 'X'],                                    // 同键同行两读=两元素（出现次数口径）
  );
});

// I-1b（T3 评审）：process.env[<非字面量>] 动态键形态——键静态不可知，不进键级对账（键级词表
// 原理上无法命中），由本 helper 计数进 advisory 提示 T34 人工并入（读/写两态同报——main.ts
// DB 配置预热 :51 写点实况）。输入须先经剥离器（注释/字符串内伪形态结构性排除）。
test('countDynamicEnvAccess：动态方括号键访问点计数（读/写两态）；字面量/点号形态不计；伪形态经剥离器排除', () => {
  assert.equal(countDynamicEnvAccess('const enabled = process.env[feature];'), 1);             // subscription-feature.guard.ts:18 实况
  assert.equal(countDynamicEnvAccess("value: dbMap.get(key) ?? process.env[key] ?? '';"), 1);  // settings.service.ts:56/:74 实况
  assert.equal(countDynamicEnvAccess('process.env[row.key] = row.value;'), 1);                 // main.ts:51 实况（动态键写点）
  assert.equal(countDynamicEnvAccess('const a = process.env[x] + process.env[y];'), 2);        // 同行双动态读逐个计数
  assert.equal(countDynamicEnvAccess("const dir = process.env['COLLAB_SPOOL_DIR'];"), 0);      // 字面量方括号=键级正常提取
  assert.equal(countDynamicEnvAccess('const port = process.env.COLLAB_PORT;'), 0);             // 点号形态
  assert.equal(countDynamicEnvAccess(stripCommentsAndStrings('// process.env[ghost] 注释提及')), 0);   // 注释伪形态
  assert.equal(countDynamicEnvAccess(stripCommentsAndStrings("const s = 'process.env[ghost]';")), 0);  // 字符串伪形态
});

test('computeBraceDepth：{} 净深累计（模块级/方法体内分类近似输入）', () => {
  assert.equal(computeBraceDepth('const a = { b: 1 };'), 0);
  assert.equal(computeBraceDepth('class A {\n  x = 1;'), 1);                     // 类体未闭合
  assert.equal(computeBraceDepth('constructor() { if (x) { y(); } }'), 0);       // 闭合归零
  assert.equal(computeBraceDepth('const s = "  ";'), 0);                         // 输入须先经剥离器（串内容已剥为空格——本 helper 不剥串）
});

test('parseDotEnvKeys：KEY=VALUE 取键、注释/空行忽略、值含=取首段', () => {
  const text = [
    '# 注释行',
    '',
    'DATABASE_URL=postgres://u:p@h/db',
    'PORT=3000',
    'MINIO_ENDPOINT=http://localhost:9000',   // 值含 = 之后的 :9000
    'EMPTY_KEY=',
  ].join('\n');
  assert.deepEqual(parseDotEnvKeys(text), ['DATABASE_URL', 'PORT', 'MINIO_ENDPOINT', 'EMPTY_KEY']);
});

test('ecosystemEnvKeys：多 app env 块键并集；缺 env 块/缺 apps 抛错', () => {
  assert.deepEqual(
    ecosystemEnvKeys({ apps: [{ name: 'a', env: { A: '1', B: '2' } }, { name: 'b', env: { B: '3', C: '4' } }] }),
    ['A', 'B', 'C'],
  );
  assert.deepEqual(ecosystemEnvKeys({ apps: [{ name: 'a' }] }), []);            // 无 env 块=空集
  assert.throws(() => ecosystemEnvKeys({ apps: 'not-array' }));                 // 结构性错误
  assert.throws(() => ecosystemEnvKeys({}));                                    // 缺 apps
});

// ── Y0c T6 组㉔（Z58 双等价索引 census）：schema 唯一声明解析/baseline raw 锚解析/等价判定 ──
test('parsePrismaUniques：@@unique 块级+字段级 @unique→生成名 <Model>_<cols>_key；enum/收尾不串模型', () => {
  const schema = [
    'enum IntentStatus {',
    '  RUNNING',
    '}',
    'model User {',
    '  email       String  @unique',
    '  phoneNumber String? @unique @db.VarChar(20)',
    '  @@unique([providerId, accountId])',
    '}',
    'model CanvasDocUpdate {',
    '  projectId String',
    '  seq       BigInt',
    '  @@unique([projectId, seq])   // 尾注',
    '}',
  ].join('\n');
  const u = parsePrismaUniques(schema);
  const names = u.map((x) => x.name).sort();
  assert.deepEqual(names, [
    'CanvasDocUpdate_projectId_seq_key',
    'User_email_key',
    'User_phoneNumber_key',
    'User_providerId_accountId_key',
  ]);
  const cdu = u.find((x) => x.name === 'CanvasDocUpdate_projectId_seq_key');
  assert.deepEqual(cdu.columns, ['projectId', 'seq']);
});

test('parseRawIndexAnchor：info string 含 raw-indexes 的 fenced json 块提取；其他 fence 不串；缺块抛错', () => {
  const md = [
    '```bash',
    'echo not-json',
    '```',
    '前文',
    '```json raw-indexes',
    '[',
    '  { "name": "pricing_rule_natural_key", "table": "PricingRule",',
    '    "columns": ["nodeTypeId", "modelId"], "unique": true, "partial": false }',
    ']',
    '```',
    '后文',
    '```json',
    '[{ "name": "decoy" }]',
    '```',
  ].join('\n');
  const entries = parseRawIndexAnchor(md);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'pricing_rule_natural_key');
  assert.equal(entries[0].partial, false);
  assert.throws(() => parseRawIndexAnchor('无锚块文档'));                          // 缺块=结构性错误
});

test('findEquivalentIndexes：full 同表同列集→duplicate-equivalent-index；partial 不判等价；deliberate 豁免+失配 stale', () => {
  const generated = [
    { model: 'PricingRule', columns: ['nodeTypeId', 'modelId', 'resolutionId', 'durationId'], name: 'PricingRule_nodeTypeId_modelId_resolutionId_durationId_key' },
    { model: 'CanvasDocUpdate', columns: ['projectId', 'seq'], name: 'CanvasDocUpdate_projectId_seq_key' },
  ];
  const raws = [
    // partial unique（列集同 full 也非等价——约束子集语义）
    { name: 'generation_intent_active_node_unique', table: 'GenerationIntent', columns: ['projectId', 'nodeId'], unique: true, partial: true },
    // 偏离 52 形态：full 手写唯一列集撞 schema @@unique → 红
    { name: 'pricing_rule_natural_key', table: 'PricingRule', columns: ['durationId', 'resolutionId', 'modelId', 'nodeTypeId'], unique: true, partial: false },
    // constraint 形态=schema @@unique 的 deliberate DB 物化 → 豁免
    { name: 'CanvasDocUpdate_projectId_seq_key', table: 'CanvasDocUpdate', columns: ['projectId', 'seq'], unique: true, partial: false, form: 'constraint', deliberate: true },
  ];
  const r1 = findEquivalentIndexes(generated, raws);
  // pricing_rule_natural_key（full、列序乱序、非 deliberate）=偏离 52 形态本体——即违规；deliberate 豁免
  assert.equal(r1.violations.length, 1);
  assert.equal(r1.violations[0].code, 'duplicate-equivalent-index');
  assert.equal(r1.violations[0].raw, 'pricing_rule_natural_key');
  assert.equal(r1.violations[0].generated, 'PricingRule_nodeTypeId_modelId_resolutionId_durationId_key');
  assert.equal(r1.staleDeliberate.length, 0);
  // deliberate 失配（schema 删了 @@unique 而豁免登记未撤）→ stale
  const r2 = findEquivalentIndexes(generated.filter((g) => g.model !== 'CanvasDocUpdate'), raws);
  assert.deepEqual(r2.staleDeliberate, ['CanvasDocUpdate_projectId_seq_key']);
  // 伪造等价条目（无 deliberate）→ duplicate-equivalent-index 第二条（列序无关）
  const r3 = findEquivalentIndexes(generated, [
    ...raws,
    { name: 'fake_dup_unique', table: 'PricingRule', columns: ['nodeTypeId', 'modelId', 'resolutionId', 'durationId'], unique: true, partial: false },
  ]);
  assert.equal(r3.violations.length, 2);
  assert.ok(r3.violations.some((v) => v.raw === 'fake_dup_unique' && v.generated === 'PricingRule_nodeTypeId_modelId_resolutionId_durationId_key'));
  // 非唯一 raw 索引永不判等价
  const r4 = findEquivalentIndexes(generated, [
    { name: 'some_plain_idx', table: 'PricingRule', columns: ['nodeTypeId', 'modelId', 'resolutionId', 'durationId'], unique: false, partial: true },
  ]);
  assert.equal(r4.violations.length, 0);
});

// ── Y1c T5c（组㉘㉙㉚㉛㉜㉝）：未分类新字段/服务端读者/裸 docName 构造/doc.exec 触碰面/
//    Y.applyUpdate 消费面/DirectConnection 六组新门的纯 helper 负控（每组至少一个故意破坏必须红）──

// ㉘ extractNodeDataWriteKeys：nodes data 写面静态键提取（raw 扫描——对象键/data.set 字面量在
// 剥离面结构性消失，组⑦同则用 raw+注释行过滤）；返回 {key,line}[]（行号可定位——评审 Minor#3）。
test('Y1c T5c ㉘：extractNodeDataWriteKeys 提取 applyNodeDataPatch 对象键+data.set 字面量键（含行号）；注释行/动态键不计', () => {
  const src = [
    "import { x } from './y';",
    "useNodeStore.getState().applyNodeDataPatch(nodeId, { model: modelId });",       // 对象键 model
    "applyNodeDataPatch(nodeId, {",                                                   // 跨行对象
    "  content: prompt,",
    '  prompt: { text, html },',
    '});',
    "if (!isEqual(data.get(k), v)) data.set(k, v);",                                  // 动态键——不计（运行时面归 T24 gate）
    "data.set('width', w);",                                                          // 字面量键 width
    "// applyNodeDataPatch(nodeId, { ghostKey: 1 });  注释行",                         // 注释行不计
    'const patch = applyNodeDataPatch(nodeId, patchVar);',                            // 非对象字面量——键不可静态知
  ].join('\n');
  const keys = extractNodeDataWriteKeys(src);
  assert.deepEqual([...new Set(keys.map((e) => e.key))].sort(), ['content', 'model', 'prompt', 'width']);
  // 行号可定位（1 起）：data.set('width') 在第 8 行；跨行对象键 content 在第 4 行（键所在行）
  const width = keys.find((e) => e.key === 'width');
  const content = keys.find((e) => e.key === 'content');
  assert.equal(width.line, 8);
  assert.equal(content.line, 4);
});

// ㉘ 负控：未入册新键必须红（reconcileKeyRegistry——门自身有效性；violation 保留 file:line 条目）
test('Y1c T5c ㉘ 负控：未入册新字段红——allowed 集外的键进 violations（含定位条目）；入册键零问题', () => {
  const allowed = new Set(['model', 'content', 'prompt']);
  assert.deepEqual(reconcileKeyRegistry([{ key: 'model', line: 1 }, { key: 'content', line: 2 }], allowed), []);
  const bad = reconcileKeyRegistry([
    { key: 'model', line: 1 }, { key: 'brandNewMysteryKey', line: 7, file: 'a.ts' }, { key: 'content', line: 2 },
  ], allowed);
  assert.deepEqual(bad, [{ key: 'brandNewMysteryKey', line: 7, file: 'a.ts' }]);   // 同键去重保留首个
});

// ㉙ 服务端读者清单：计数白名单对账（reconcileCountWhitelist 通用面——㉙㉚㉛㉜㉝ 共用；
// occurrences: file→行号数组——违规明细带 :line，评审 Minor#3 粒度对齐）
test('Y1c T5c ㉙㉚㉛㉜㉝：reconcileCountWhitelist 三分——白名单外新调用点红（带 :line）/计数漂移红/白名单点消失红', () => {
  const whitelist = { 'a.ts': 2, 'b.ts': 1 };
  assert.deepEqual(reconcileCountWhitelist({ 'a.ts': [3, 9], 'b.ts': [5] }, whitelist, '读'), []);
  const details = reconcileCountWhitelist({ 'a.ts': [3, 9, 12], 'c.ts': [7] }, whitelist, '读');
  assert.equal(details.length, 3);   // c.ts 白名单外+a.ts 漂移+b.ts 点消失（三分全触发）
  assert.ok(details.some((d) => d.includes('c.ts:7') && d.includes('白名单外')), `新直读点必须红且带行号：${details}`);
  assert.ok(details.some((d) => d.includes('a.ts') && d.includes('漂移') && d.includes(':3,9,12')), `计数漂移必须红且带行号：${details}`);
  assert.ok(details.some((d) => d.includes('b.ts') && d.includes('消失')), `白名单点消失必须红：${details}`);
  const stale = reconcileCountWhitelist({}, whitelist, '读');
  assert.equal(stale.length, 2);   // 白名单点全消失=清单需同步红
});

// ㉚ 裸 docName 构造行号：raw 扫描+注释行过滤（模板串前缀在剥离面消失——⑦ raw 同则）
test('Y1c T5c ㉚：findBareProjectDocNameLines 记 `project:${` 出现行（同行双读=同行号两元素）——注释行不计', () => {
  const src = [
    'const conn = await server.openDirectConnection(`project:${projectId}`);',   // 1
    'const name2 = `project:${pid}`; const name3 = `project:${p2}`;',            // 2（同行双读全可见）
    '// docName 形如 project:${pid}（注释行——不计）',
    'throw new Error(`invalid doc name project:${name}`);',                      // 1（报错消息同计——census⑦ 分类面）
  ].join('\n');
  assert.deepEqual(findBareProjectDocNameLines(src), [1, 2, 2, 4]);
  assert.deepEqual(findBareProjectDocNameLines('// project:${x} 注释'), []);
  assert.deepEqual(findBareProjectDocNameLines('const a = 1;'), []);
});

// ㉛ doc.exec 触碰行号（raw 面——'exec' 字面量在剥离面结构性消失）
test('Y1c T5c ㉛ 负控：findExecMapAccessLines 记 getMap(\'exec\') 出现行（同行两次=同行号两元素——vacuum 等价校验实况）', () => {
  const stripped = [
    "const exec = doc.getMap('exec');",
    "if ([...oldDoc.getMap('exec').keys()] !== [...newDoc.getMap('exec').keys()]) return false;",
    "const nodes = doc.getMap('nodes');",
  ].join('\n');
  assert.deepEqual(findExecMapAccessLines(stripped), [1, 2, 2]);
  assert.deepEqual(findExecMapAccessLines(stripCommentsAndStrings("// doc.getMap('exec') 注释")), []);
  assert.deepEqual(findExecMapAccessLines("doc.getMap('meta')"), []);
});

// ㉜㉙㉝ 通用行号扫描（stripped 面）：toReadModel(/Y.applyUpdate(/openDirectConnection( 同一 helper
test('Y1c T5c ㉜ 负控：findLineOccurrences 记调用形态出现行（Y.applyUpdate 为例）；同行多次=多元素；零命中=空', () => {
  const src = [
    'Y.applyUpdate(document, frame.payload);',
    'await Y.applyUpdate(doc, bin); Y.applyUpdate(doc, bin2);',   // 同行两次——两元素同行号
    'const r = Y.decodeUpdate(u);',
    'Y.applyUpdateV2(doc, v);',   // V2 变体不计本词面（⑮ classifyWorkerBannedSymbol 另辖）
  ].join('\n');
  assert.deepEqual(findLineOccurrences(src, /Y\.applyUpdate\(/g), [1, 2, 2]);
  assert.deepEqual(findLineOccurrences(src, /toReadModel\(/g), []);
  assert.deepEqual(findLineOccurrences(stripCommentsAndStrings('// Y.applyUpdate(doc, u) 注释'), /Y\.applyUpdate\(/g), []);
});
