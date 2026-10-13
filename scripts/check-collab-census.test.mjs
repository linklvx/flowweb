// Y0b-4 T14：check-collab-census.mjs 单元测试（node --test；check-spec-consistency.test.mjs 先例形态）。
// 只测纯 helper（剥离器/分组判定）；端到端走 verify 链的 `node scripts/check-collab-census.mjs`。
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripCommentsAndStrings, classifyCloseLiteral, classifyConsumeCall, extractDiagCalls } from './check-collab-census.mjs';

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
