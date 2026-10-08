// scripts/deploy-guard.test.mjs —— 判据载体自测（A11；node --test scripts/ 消费）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePre, decidePost, epochPreFromRaw, spoolTotal } from './lib/gate-decision.mjs';

test('P0-1 回归：无 pending=unobservable 且 --force 不覆盖', () => {
  const r = decidePre({ ready: false, reason: 'draining', epoch: '5' });
  assert.equal(r.verdict, 'unobservable'); assert.match(r.why, /pending/);
});
test('own 四零=pass（SV11 维持）；stranded 透出 WARNING 不拒', () => {
  const r = decidePre({ ready: false, reason: 'draining', pending: { projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, strandedFiles: 3 } });
  assert.equal(r.verdict, 'pass'); assert.match(r.why, /stranded/);
});
test('spool-unwritable=fail（可 force）；drain 未生效=wait', () => {
  assert.equal(decidePre({ reason: 'spool-unwritable', pending: {} }).verdict, 'fail');
  assert.equal(decidePre({ reason: 'pg-down', pending: { projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0 } }).verdict, 'wait');
});
test('decidePre：draining+pending 非零=wait（生产最常命中——预算耗尽逼 force 的典型档）', () => {
  const r = decidePre({ ready: false, reason: 'draining', pending: { projects: 2, batches: 1, spoolFiles: 0, spoolBytes: 0 } });
  assert.equal(r.verdict, 'wait'); assert.match(r.why, /未排空/);
});
test('P31/P39/B23 回归：epoch 基线 NaN/缺失=null 往返=fail（禁恒真静默通过）', () => {
  assert.equal(decidePost({ ready: true, epoch: '7', pending: { spoolFiles: 0 } }, NaN).verdict, 'fail');
  // 真实路径探针：state 写 {"epochPre":null}（JSON NaN 往返形态）→ epochPreFromRaw 必产 NaN → fail
  const roundTripped = JSON.parse(JSON.stringify({ epochPre: NaN }));
  assert.ok(Number.isNaN(epochPreFromRaw(roundTripped.epochPre)));
  assert.ok(Number.isNaN(epochPreFromRaw('unavailable')));
  assert.equal(epochPreFromRaw(5), 5);   // 合法数值透传
});
test('epoch 未递增=fail；递增+归零=pass', () => {
  assert.equal(decidePost({ ready: true, epoch: '5', pending: {} }, 5).verdict, 'fail');
  const ok = decidePost({ ready: true, epoch: '7', pending: { spoolFiles: 0, strandedFiles: 2 } }, 5);
  assert.equal(ok.verdict, 'pass'); assert.match(ok.why, /WARNING stranded=2files/);   // 格式与实现 why 串一致（WARNING 前 stranded 后）
});
test('P39 degraded 档：legacy/unreachable 放行→epoch 断言 N/A 显式打印（不 fail）', () => {
  const r = decidePost({ ready: true, epoch: '7', pending: { spoolFiles: 0 } }, NaN, 'legacy');
  assert.equal(r.verdict, 'pass'); assert.match(r.why, /N\/A.*legacy/s); assert.match(r.why, /下一次非降级部署/);
  assert.equal(decidePost({ ready: true, epoch: '7', pending: { spoolFiles: 0 } }, NaN, 'unreachable').verdict, 'pass');
});
test('post：own spool 未归零=wait；无 pending=unobservable', () => {
  assert.equal(decidePost({ ready: true, epoch: '7', pending: { spoolFiles: 2 } }, 5).verdict, 'wait');
  assert.equal(decidePost({ ready: true, epoch: '7' }, 5).verdict, 'unobservable');
});
test('decidePost：!ready=wait（实例未起的最常见瞬态）', () => {
  const r = decidePost({ ready: false, reason: 'starting', pending: { spoolFiles: 0 } }, 5);
  assert.equal(r.verdict, 'wait'); assert.match(r.why, /未就绪/);
});
test('spoolTotal（P35：+5 判据 total 口径）', () => {
  assert.equal(spoolTotal({ spoolFiles: 3, strandedFiles: 2 }), 5);
  assert.equal(spoolTotal(undefined), 0);
});
