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

// ===== Y1c T29：生产前置批 charter 判据（spec 偏离 35 D10+偏离 38⑳——任一未过不得开放生产流量） =====
import * as gateDecisionNs from './lib/gate-decision.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve as pathResolve } from 'node:path';
import { fileURLToPath as pathFileURLToPath } from 'node:url';

const decideCharter = (c) => gateDecisionNs.decideCharter(c);

const item = (over = {}) => ({ id: 'pitr', requirement: 'PITR RPO≤5min/RTO≤30min', owner: 'FlowWeb Dev', date: '2026-11-03', status: 'pending', ...over });

test('T29：production 档 pending/armed 项=fail（任一未过不得开放生产流量——armed 须先裁决为 passed[已实施]或 waived[实测豁免]）', () => {
  assert.equal(decideCharter({ trafficTier: 'production', items: [item()] }).verdict, 'fail');
  assert.match(decideCharter({ trafficTier: 'production', items: [item()] }).why, /pitr/);
  assert.equal(decideCharter({ trafficTier: 'production', items: [item({ status: 'armed' })] }).verdict, 'fail');
});

test('T29：production 档 passed/waived/na 全过=pass；waived 缺 evidence=fail（豁免须实测证据——空豁免=空挂）', () => {
  assert.equal(decideCharter({ trafficTier: 'production', items: [item({ status: 'passed', evidence: 'drill 记录 2026-11-03' })] }).verdict, 'pass');
  assert.equal(decideCharter({ trafficTier: 'production', items: [item({ status: 'waived', evidence: 'cold p95=1.2s 实测未超标' })] }).verdict, 'pass');
  assert.equal(decideCharter({ trafficTier: 'production', items: [item({ status: 'na' })] }).verdict, 'pass');
  assert.equal(decideCharter({ trafficTier: 'production', items: [item({ status: 'waived' })] }).verdict, 'fail');
});

test('T29：dev-test/beta 档=pass+诚实登记（pending/armed 计数+未开放生产流量限制句）；未知档=fail-closed', () => {
  const r = decideCharter({ trafficTier: 'dev-test', items: [item(), item({ id: 'slo', status: 'armed' }), item({ id: 'ha', status: 'passed' })] });
  assert.equal(r.verdict, 'pass');
  assert.match(r.why, /dev-test/);
  assert.match(r.why, /2/);   // pending+armed 计数透出
  const b = decideCharter({ trafficTier: 'beta', items: [item()] });
  assert.equal(b.verdict, 'pass');
  assert.equal(decideCharter({ trafficTier: 'staging', items: [] }).verdict, 'fail');
});

test('T29：空挂检测（偏离 38⑳「空挂=没闭环」机器化）——项缺 id/owner/date/requirement/status 任一，或 items 空，任何档均 fail', () => {
  assert.equal(decideCharter({ trafficTier: 'dev-test', items: [] }).verdict, 'fail');
  for (const miss of ['id', 'owner', 'date', 'requirement', 'status']) {
    const broken = { ...item() }; delete broken[miss];
    const r = decideCharter({ trafficTier: 'dev-test', items: [broken] });
    assert.equal(r.verdict, 'fail', `缺 ${miss} 字段应 fail`);
    assert.match(r.why, /空挂|owner|date|requirement|status|id/);
  }
});

test('T29：真实 charter 数据回归——scripts/production-charter.json 判据通过（dev-test 档）且 13 项全登记', () => {
  const charterPath = pathResolve(pathFileURLToPath(import.meta.url), '../production-charter.json');
  const charter = JSON.parse(readFileSync(charterPath, 'utf8'));
  const r = decideCharter(charter);
  assert.equal(r.verdict, 'pass', `真实 charter 须在当前档通过：${r.why ?? ''}`);
  assert.equal(charter.items.length, 13);
});

// ===== Y1c T30：reset-collab 破坏性 reset 判据（decideResetGuard）+ 阶段状态机 + --confirm 守卫 =====
// spec §4.4（恢复：restore 收尾必 bump historyId+旧 WAL 整段 quarantine）+偏离 38⑳（T30「清本地缓存」
// 口径=generation/4410 客户端自清——服务端无此能力）+偏离 35（restore 契约）。红组=T29 同文件追加先例。
const decideResetGuard = (i) => gateDecisionNs.decideResetGuard(i);
const NOW30 = 1_700_000_000_000;

test('T30：旧消费者在线=fail（activeConnections>0——deploy --rebuild-db 顺序断言的判据面：停全部旧 DB 消费者之前 reset 必红）', () => {
  const r = decideResetGuard({ activeConnections: 3, leaseRow: null, pending: null });
  assert.equal(r.verdict, 'fail');
  assert.match(r.why, /activeConnections=3/);
});

test('T30：租约 held=fail；过期/无持有=放行——与 decideLeaseVerdict（collab-rebuild-gen.mjs）语义对拍', async () => {
  const held = decideResetGuard({ activeConnections: 0, leaseRow: { owner: 'api-proc-1', expiresAtMs: NOW30 + 60_000 }, nowMs: NOW30 });
  assert.equal(held.verdict, 'fail');
  assert.match(held.why, /api-proc-1/);
  const expired = decideResetGuard({ activeConnections: 0, leaseRow: { owner: 'old-proc', expiresAtMs: NOW30 - 1 }, nowMs: NOW30 });
  assert.equal(expired.verdict, 'pass');
  // 对拍：decideResetGuard 内嵌租约判定与 CLI 侧 decideLeaseVerdict 同形态（gate-decision 零 import 纪律——语义等价由本断言钉死）
  const { decideLeaseVerdict } = await import('./collab-rebuild-gen.mjs');
  for (const row of [null, { owner: null, expiresAtMs: null }, { owner: '', expiresAtMs: NOW30 + 60_000 },
    { owner: 'x', expiresAtMs: NOW30 + 60_000 }, { owner: 'x', expiresAtMs: NOW30 - 1 }, { owner: 'x', expiresAtMs: null }]) {
    const g = decideResetGuard({ activeConnections: 0, leaseRow: row, nowMs: NOW30 });
    assert.equal(g.verdict === 'fail', decideLeaseVerdict(row, NOW30).ok === false, `租约形态对拍失败：${JSON.stringify(row)}`);
  }
});

test('T30：pending 可观测时 inflight（projects/batches，/api/ready 口径）>0=fail', () => {
  const r = decideResetGuard({ activeConnections: 0, leaseRow: null, nowMs: NOW30, pending: { projects: 2, batches: 1, spoolFiles: 0, spoolBytes: 0 } });
  assert.equal(r.verdict, 'fail');
  assert.match(r.why, /projects=2/);
  assert.match(r.why, /batches=1/);
});

test('T30：stranded>0=fail（比 decidePre 严——reset 语境外来段=未决数据阻断；decidePre 同输入=pass+WARNING）', () => {
  const pending = { projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, strandedFiles: 2 };
  assert.equal(decidePre({ reason: 'draining', pending }).verdict, 'pass');   // pre 档=WARNING 不拒（既有语义对照）
  const r = decideResetGuard({ activeConnections: 0, leaseRow: null, nowMs: NOW30, pending });
  assert.equal(r.verdict, 'fail');
  assert.match(r.why, /stranded=2/);
});

test('T30：全零=pass；pending 不可观测（消费者已停常态）=pass+显式注记（inflight 观测责任=维护关写/drain 步）', () => {
  const ok = decideResetGuard({ activeConnections: 0, leaseRow: null, nowMs: NOW30, pending: { projects: 0, batches: 0, spoolFiles: 0, spoolBytes: 0, strandedFiles: 0 } });
  assert.equal(ok.verdict, 'pass');
  const na = decideResetGuard({ activeConnections: 0, leaseRow: null, nowMs: NOW30, pending: null });
  assert.equal(na.verdict, 'pass');
  assert.match(na.why, /未观测/);
});

// ── 阶段状态机（reset-collab.mjs export——node:test 消费面；红=模块 ENOENT，import 容错不炸整文件）──
const resetCollab = await import('./reset-collab.mjs').catch(() => null);

test('T30：RESET_STAGES 七阶段序固定（precheck→verify——破坏性发布顺序的机器承载）', () => {
  assert.ok(resetCollab, 'scripts/reset-collab.mjs 须存在且零副作用可 import');
  assert.deepEqual(resetCollab.RESET_STAGES, ['precheck', 'drop-recreate', 'migrate', 'seed', 'quarantine-spool', 'bump-history', 'verify']);
});

test('T30：parseResetState——合法态透传；损坏 JSON/版本不符/stages 非对象=fail-closed throw（不静默重来：中途状态靠落盘不靠人工判断）', () => {
  assert.ok(resetCollab);
  const good = resetCollab.parseResetState(JSON.stringify({ v: 1, startedAt: '2026-11-03T00:00:00.000Z', mode: 'rebuild-db', stages: { precheck: { done: true, at: '2026-11-03T00:00:01.000Z' } } }));
  assert.equal(good.stages.precheck.done, true);
  for (const bad of ['{oops', JSON.stringify({ v: 2, startedAt: 'x', mode: 'rebuild-db', stages: {} }), JSON.stringify({ v: 1, startedAt: 'x', mode: 'rebuild-db', stages: 'nope' }), JSON.stringify({ v: 1, startedAt: 'x', mode: 'rebuild-db', stages: { precheck: { done: false } } })]) {
    assert.throws(() => resetCollab.parseResetState(bad), /fail-closed|损坏|状态文件/, `须拒：${bad}`);
  }
});

test('T30：nextStage/shouldSkip——已完成阶段跳过+未完成续跑+全完成=null（kill -9 后重跑感知已完成阶段）', () => {
  assert.ok(resetCollab);
  const fresh = resetCollab.parseResetState(JSON.stringify({ v: 1, startedAt: 'x', mode: 'rebuild-db', stages: {} }));
  assert.equal(resetCollab.nextStage(fresh), 'precheck');
  let s = fresh;
  for (const name of ['precheck', 'drop-recreate', 'migrate']) s = resetCollab.markStageDone(s, name);
  assert.equal(resetCollab.shouldSkip(s, 'precheck'), true);
  assert.equal(resetCollab.shouldSkip(s, 'drop-recreate'), true);
  assert.equal(resetCollab.shouldSkip(s, 'migrate'), true);
  assert.equal(resetCollab.shouldSkip(s, 'seed'), false);
  assert.equal(resetCollab.nextStage(s), 'seed');   // 中断于 migrate 后：续跑自 seed 起
  for (const name of ['seed', 'quarantine-spool', 'bump-history', 'verify']) s = resetCollab.markStageDone(s, name, `${name} 详情`);
  assert.equal(resetCollab.nextStage(s), null);     // 全完成=无续跑面
  assert.equal(s.stages.seed.detail, 'seed 详情');
});

test('T30：--confirm 缺失=拒（exit 非 0+refusal 文案+零副作用——状态文件不因拒执行而出现/变化）', () => {
  const scriptPath = pathResolve(pathFileURLToPath(import.meta.url), '../reset-collab.mjs');
  const statePath = pathResolve(pathFileURLToPath(import.meta.url), '../../.reset-collab-state.json');
  const before = existsSync(statePath);
  const r = spawnSync(process.execPath, [scriptPath, '--rebuild-db'], { encoding: 'utf8', timeout: 30_000 });
  assert.notEqual(r.status, 0, '缺 --confirm 须 exit 非 0');
  assert.match((r.stderr ?? '') + (r.stdout ?? ''), /confirm|破坏性/);
  assert.equal(existsSync(statePath), before, '拒执行零副作用——不落状态文件');
});
