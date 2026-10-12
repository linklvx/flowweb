// Y0b-4 T14：check-collab-census.mjs 单元测试（node --test；check-spec-consistency.test.mjs 先例形态）。
// 只测纯 helper（剥离器/分组判定）；端到端走 verify 链的 `node scripts/check-collab-census.mjs`。
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripCommentsAndStrings, classifyCloseLiteral, classifyConsumeCall } from './check-collab-census.mjs';

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
