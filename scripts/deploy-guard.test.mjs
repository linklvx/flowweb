// scripts/deploy-guard.test.mjs —— 判据载体自测（A11；node --test scripts/ 消费）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePre, decidePost, epochPreFromRaw, spoolTotal } from './lib/gate-decision.mjs';
import { diffMigrationDirs, diffAppliedMigrations } from './lib/migration-set.mjs';

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

// ===== Y0b-5 T12-0a：post-restart 迁移集合断言（tar 先清后传的服务器侧防线） =====
test('T12-0a 验收锚：远端留仓外目录→集合断言红（runbook:96 实录 44 目录残留形态——tar 只覆盖不删除）', () => {
  const r = diffMigrationDirs(['20261009140100_y0b2_init', '20261011180000_y0b4_vacuum_generation', '20260101000000_zombie_old'], ['20261009140100_y0b2_init', '20261011180000_y0b4_vacuum_generation']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.extraOnRemote, ['20260101000000_zombie_old']);
  assert.deepEqual(r.missingOnRemote, []);
});

test('T12-0a：仓内有远端缺→红（传输缺失形态——双向比对另一半）', () => {
  const r = diffMigrationDirs(['20261009140100_y0b2_init'], ['20261009140100_y0b2_init', '20261011180000_y0b4_vacuum_generation']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingOnRemote, ['20261011180000_y0b4_vacuum_generation']);
});

test('T12-0a：集合相等→ok', () => {
  assert.equal(diffMigrationDirs(['A', 'B'], ['B', 'A']).ok, true);   // 顺序无关
});

test('T12-0a：_prisma_migrations「库有仓无」applied 行→红；applied ⊆ 仓→ok', () => {
  const bad = diffAppliedMigrations(['20261009140100_y0b2_init', '20260101000000_dropped_in_squash'], ['20261009140100_y0b2_init', '20261011180000_y0b4_vacuum_generation']);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.dbHasRepoLacks, ['20260101000000_dropped_in_squash']);
  const ok = diffAppliedMigrations(['20261009140100_y0b2_init'], ['20261009140100_y0b2_init', '20261011180000_y0b4_vacuum_generation']);
  assert.equal(ok.ok, true);   // 仓未应用（部署中点）不是本断言对象——migrate deploy 负责补齐
});
