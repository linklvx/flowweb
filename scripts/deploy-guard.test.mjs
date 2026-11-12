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
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
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

// ===== Y1c T30 收口批（评审 spec 1C+2I+4M / quality 3I+5M——9 必修红例） =====
// 判别性优先：行为例（quarantine 两态注记/--hold-after 缺值/串行锁全链红）+ 源文本契约例
// （backend_type 过滤/writeState 原子化——.mjs 脚本无导出面，锚形态=deploy.sh 契约测试同款文本锚）。
const SCRIPT_PATH_30 = pathResolve(pathFileURLToPath(import.meta.url), '../reset-collab.mjs');
const STATE_PATH_30 = pathResolve(pathFileURLToPath(import.meta.url), '../../.reset-collab-state.json');
const SRC_30 = resetCollab ? readFileSync(SCRIPT_PATH_30, 'utf8') : '';

test('收口 spec I2（quality M-2 邻面）：quarantineNote 两态——「目录不存在」态+本链非零 DROP 前计数=显式注记（不强红）；「quarantine 保证据」态/全零计数/缺 detail=null', () => {
  assert.ok(resetCollab, 'reset-collab.mjs 须在档');
  const quarantine态 = 'quarantine=/x/.quarantine-2026-11-03T00-00-00（保证据）';
  const 不存在态 = 'spool-目录不存在（/x/collab-spool）=已完成语义';
  const 非零丢弃面 = '丢弃面 GenerationIntent=3 CanvasDocUpdate=7';
  const 零丢弃面 = '丢弃面 GenerationIntent=0 CanvasDocUpdate=0';
  const note = resetCollab.quarantineNote(不存在态, 非零丢弃面);
  assert.ok(typeof note === 'string' && /注记/.test(note), '不存在态+非零计数=注记行');
  assert.match(note, /GenerationIntent=3/);
  assert.equal(resetCollab.quarantineNote(不存在态, 零丢弃面), null);        // 全零=空库 reset 合法无注记
  assert.equal(resetCollab.quarantineNote(quarantine态, 非零丢弃面), null);  // 保证据在档=无需注记
  assert.equal(resetCollab.quarantineNote(null, 非零丢弃面), null);          // 缺 detail（旧版状态文件）=不注记
});

test('收口 quality I-1：--hold-after 缺值=exit 2+refusal（旗标在场独立于值判空——现形态缺值=等价无 hold 直跑破坏性全链，评审实弹复现面）', () => {
  const before = existsSync(STATE_PATH_30);
  const r = spawnSync(process.execPath, [SCRIPT_PATH_30, '--rebuild-db', '--confirm', '--hold-after'], { encoding: 'utf8', timeout: 150_000 });
  assert.equal(r.status, 2, '--hold-after 缺值须 exit 2（非 0 非 1——与确认拒/运行错分档）');
  assert.match((r.stderr ?? '') + (r.stdout ?? ''), /缺值|未知阶段/);
  assert.equal(existsSync(STATE_PATH_30), before, '缺值拒在 DSN 读/状态写之前——零副作用');
});

test('收口 quality I-2/spec M3 源文本：消费者计数查询过滤 backend_type=\'client backend\'（autovacuum worker 假红）且判据消费过滤后计数；明细全量保留透出 backend_type', () => {
  assert.ok(resetCollab);
  assert.match(SRC_30, /AND backend_type = 'client backend'/, '计数查询须过滤 client backend（autovacuum/walsender 不计消费者）');
  assert.match(SRC_30, /activeConnections: clientRows\.length/, 'decideResetGuard 消费过滤后计数（非全量 detailRows.length）');
  assert.match(SRC_30, /backend_type,/, '明细行透出 backend_type 供人判读（全量保留非过滤面）');
});

test('收口 quality M-1 源文本：writeState 原子化=tmp+renameSync（kill 落在 truncate-then-write 窗口=断点全丢、重跑必再 DROP）', () => {
  assert.ok(resetCollab);
  assert.match(SRC_30, /writeFileSync\(\s*tmp/, '写须经 .tmp 中转');
  assert.match(SRC_30, /renameSync\(\s*tmp,\s*STATE_PATH\s*\)/, 'tmp 原子 rename 落档');
});

test('收口 quality I-3（微批 M-3/Minor-2 强化）：串行锁被占=第二实例红不排队+位置锚（红点在取锁点先于 drop——防锁回缩 migrate-only 退化盲区）', async (t) => {
  assert.ok(resetCollab);
  // DB 可达性探测：无本地 PG（如 CI 无服务容器）=skip 非红（int 池 skip-on-no-DB 同先例）
  const requireApi = createRequire(pathResolve(pathFileURLToPath(import.meta.url), '../../apps/api/package.json'));
  let pg; try { pg = requireApi('pg'); } catch { return t.skip('apps/api pg 不可解析'); }
  let dsn = process.env.DATABASE_URL;
  if (!dsn) {
    try { dsn = readFileSync(pathResolve(pathFileURLToPath(import.meta.url), '../../apps/api/.env'), 'utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^"|"$/g, ''); } catch { /* 无 DSN=skip */ }
  }
  if (!dsn) return t.skip('无 DATABASE_URL（apps/api/.env 或环境变量）');
  const holder = new pg.Client({ connectionString: dsn, connectionTimeoutMillis: 2_000 });
  try { await holder.connect(); await holder.query('SELECT 1'); } catch { return t.skip(`本地 PG 不可达（${dsn.replace(/:\/\/([^:/@]+):[^@]*@/, '://$1:***@')}）——全链锁例降级 skip`); }
  // 测试卫生（微批 spec M-3）：快照仓根状态文件——在档则记内容 finally 还原，禁盲写盲删（防摧毁真实中断态）
  const hadState = existsSync(STATE_PATH_30);
  const stateSnapshot = hadState ? readFileSync(STATE_PATH_30, 'utf8') : null;
  const fabricate = (stages) => writeFileSync(STATE_PATH_30, JSON.stringify({ v: 1, startedAt: new Date().toISOString(), mode: 'rebuild-db', stages }));
  try {
    const locked = await holder.query(`SELECT pg_try_advisory_lock(hashtext('flowweb:reset-collab:migrate')::bigint) AS ok`);
    assert.equal(locked.rows[0].ok, true, '前置：探测连接须取得串行锁（否则测试装置自矛盾）');
    // 场景一（位置锚 quality Minor-2）：仅 precheck 完成的续跑态+锁被占——红点必须在取锁点（先于 drop-recreate）：
    // 断言输出不含 schema rebuilt（锁若回缩 migrate-only，此场景会先执行 DROP 再在 migrate 红——退化即抓）
    fabricate({ precheck: { done: true, at: new Date().toISOString() } });
    const r1 = spawnSync(process.execPath, [SCRIPT_PATH_30, '--rebuild-db', '--confirm'], { encoding: 'utf8', timeout: 60_000 });
    const out1 = (r1.stderr ?? '') + (r1.stdout ?? '');
    assert.equal(r1.status, 1, '场景一：锁被占须 exit 1');
    assert.match(out1, /串行锁/, '场景一：红因=串行锁未取得（非排队等待/非其他错因）');
    assert.ok(!out1.includes('schema rebuilt'), '位置锚：DROP 未执行（取锁点先于 drop-recreate——锁回缩 migrate-only 即红）');
    assert.ok(!out1.includes('STAGE drop-recreate done'), '位置锚：drop-recreate 未落盘');
    // 场景二（跨实例续跑态——原形态）：precheck+drop-recreate 已完成→SKIP×2 后同样红在取锁点
    fabricate({ precheck: { done: true, at: new Date().toISOString() }, 'drop-recreate': { done: true, at: new Date().toISOString() } });
    const r2 = spawnSync(process.execPath, [SCRIPT_PATH_30, '--rebuild-db', '--confirm'], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(r2.status, 1, '场景二：锁被占须 exit 1');
    assert.match((r2.stderr ?? '') + (r2.stdout ?? ''), /串行锁/, '场景二：红因=串行锁未取得');
  } finally {
    if (hadState) writeFileSync(STATE_PATH_30, stateSnapshot);   // 还原快照（真实中断态保真）
    else rmSync(STATE_PATH_30, { force: true });
    await holder.end().catch(() => {});
  }
});

// ===== Y1c T30b：旧版一次性切换演练装置（drill-cutover——§16 八步序本地实弹）红组 =====
// 先红裁定（Controller）：①装置红=§16 演练序列落成可重复执行脚本（scripts/ 下 drill 装置），
// 其缺失/断言缺失时测试红；②顺序断言红=装置内嵌「旧消费者在线即 reset=红」实弹步骤
// （对 T30 precheck 的真实环境复证，非仅单测）。绿相=scripts/drill-cutover.mjs 落地（三模式：
// --cutover §16 ①-⑦ 计时全序 / --rollback ⑦ 一次性硬切回滚+两向 4406 / --final-reset 空库终态链）。
const drillCutover = await import('./drill-cutover.mjs').catch(() => null);
const DRILL_PATH_30B = pathResolve(pathFileURLToPath(import.meta.url), '../drill-cutover.mjs');
const DRILL_SRC_30B = drillCutover ? readFileSync(DRILL_PATH_30B, 'utf8') : '';

test('T30b 红①：演练装置在档可 import（scripts/drill-cutover.mjs——§16 八步序的本地实弹装置，装置缺失=红）', () => {
  assert.ok(drillCutover, 'scripts/drill-cutover.mjs 须存在且零副作用可 import（import 容错不炸整文件——resetCollab 同款形态）');
});

test('T30b 红②：DRILL_STEPS 顺序断言（§16 八步序：freeze→drain→〔红③ probe 在消费者在线窗〕停消费者→快照→reset→部署新树→RB1 起序→smoke——乱序=破坏性）', () => {
  assert.ok(drillCutover, '装置须在档');
  assert.deepEqual(drillCutover.DRILL_STEPS, ['freeze', 'drain-wait', 'reset-refusal-probe', 'stop-consumers', 'snapshot', 'reset', 'deploy-new', 'rb1-start', 'smoke']);
  const idx = (n) => drillCutover.DRILL_STEPS.indexOf(n);
  assert.ok(idx('reset-refusal-probe') < idx('stop-consumers'), '红③ probe 必须在停消费者之前（消费者在线窗——停了之后 probe 无实弹意义）');
  assert.ok(idx('stop-consumers') < idx('snapshot') && idx('snapshot') < idx('reset'), '②停消费者→③快照→④reset 顺序（快照=回退锚必先于 reset）');
  assert.ok(idx('reset') < idx('deploy-new') && idx('deploy-new') < idx('rb1-start') && idx('rb1-start') < idx('smoke'), '④reset→⑤部署新树→⑥RB1 起序→⑦smoke 顺序');
});

test('T30b 红③：旧消费者在线即 reset=红 的实弹步骤在装置内（resetRefusalProbeLive——对 T30 precheck 的真实环境复证，非仅单测）', () => {
  assert.ok(drillCutover, '装置须在档');
  assert.equal(typeof drillCutover.resetRefusalProbeLive, 'function', 'probe 须为可独立调用的实弹步骤（驱动真实 reset CLI）');
  assert.match(DRILL_SRC_30B, /'--rebuild-db',\s*'--confirm'/, 'probe 驱动真实 reset-collab CLI（spawn 实弹形态——非 mock 判据）');
  assert.match(DRILL_SRC_30B, /消费者在线/, 'probe 断言判据=decideResetGuard 消费者在线红文案（真实环境复证面）');
});

test('T30b 红④：装置破坏性守卫（--confirm 缺失=exit 非 0+refusal 文案——reset-collab --confirm 同律）', () => {
  assert.ok(existsSync(DRILL_PATH_30B), 'scripts/drill-cutover.mjs 须在档');
  const r = spawnSync(process.execPath, [DRILL_PATH_30B, '--cutover'], { encoding: 'utf8', timeout: 30_000 });
  assert.notEqual(r.status, 0, '缺 --confirm 须 exit 非 0');
  assert.match((r.stderr ?? '') + (r.stdout ?? ''), /confirm|破坏性/);
});

test('T30b 红⑤：装置源文本锚（三查①DB 连接口径同源/③pg_dump+⑦pg_restore 快照回退锚/两向 4406/RB1 ready 超时失败分支）', () => {
  assert.ok(drillCutover, '装置须在档');
  assert.match(DRILL_SRC_30B, /backend_type = 'client backend'/, '三查① DB 连接口径=client backend 过滤（reset-collab precheck 同源——autovacuum 不计）');
  assert.match(DRILL_SRC_30B, /pg_dump/, '③DB 快照（pg_dump -Fc——回退锚）');
  assert.match(DRILL_SRC_30B, /pg_restore/, '⑦回滚=快照恢复（pg_restore 实弹——一次性硬切语义）');
  assert.match(DRILL_SRC_30B, /4406/, '两向版本门实弹（旧 bundle+新服务端→4406；新 bundle+旧服务端→不可用）');
  assert.match(DRILL_SRC_30B, /不起 worker/, 'RB1 ready 超时失败分支（M-B 同款——60 轮空转无失败分支的形态不复存在）');
});

// ===== Y1c T30b 演练实弹发现：T24 sv 上行缺口——既有 smoke 装置 URL 对当前服务端 4406 恒拒 =====
// 实弹证据：cutover 首跑预写 provider synced 超时，服务端 log=[onAuthenticate] client history/protocol
// outdated（sv 缺失（旧 bundle））——collab-smoke/exec-smoke URL 止于 csv（T19 形态），T24 收口 M-1
// 起 sv 为硬门三元（缺失=4406）——装置先于 T24 定型即破。红例先钉（文本锚=deploy.sh 契约测试同款）。
const SMOKE_SRC_30B = (() => {
  try {
    return readFileSync(pathResolve(pathFileURLToPath(import.meta.url), '../../apps/api/scripts/collab-smoke.mjs'), 'utf8')
      + '\n' + readFileSync(pathResolve(pathFileURLToPath(import.meta.url), '../../apps/api/scripts/exec-smoke.mjs'), 'utf8');
  } catch { return ''; }
})();

test('T30b 红⑥：smoke 装置 URL 带 sv=CANVAS_DOC_SCHEMA_VERSION（T24 三元上行——collab-smoke/exec-smoke 单源读 shared，禁字面量）', () => {
  assert.ok(SMOKE_SRC_30B, 'smoke 装置源须可读');
  assert.match(SMOKE_SRC_30B, /CANVAS_DOC_SCHEMA_VERSION/, 'sv 单源=shared CANVAS_DOC_SCHEMA_VERSION（T19 CSV 单源根修同律）');
  const urls = SMOKE_SRC_30B.match(/url: `[^`]*\$\{CSV\}[^`]*`/g) ?? [];
  assert.ok(urls.length >= 2, `两 smoke 装置的 provider URL 须被锚到（实得 ${urls.length}）`);
  for (const u of urls) assert.match(u, /sv=\$\{SV\}/, `URL 缺 sv 上行（${u}——当前服务端版本门 4406 恒拒）`);
});

test('T30b 红⑦：collab-smoke 哨兵节点=T9+ 节点信封（type+data 容器——fillDoc 同形；旧 kind 信封=frame-deny node-key 恒拒 4411）', () => {
  const src = SMOKE_SRC_30B.slice(0, SMOKE_SRC_30B.indexOf('\n// apps/api/scripts/exec-smoke.mjs'));   // collab-smoke 段
  assert.doesNotMatch(src, /\[\['kind', 'smoke'\]\]/, 'kind 信封=pre-T9 形态——frame-deny 节点信封键白名单外（node-key:kind→4411 恒拒，实弹复证面）');
  assert.match(src, /set\('type', 'textInput'\)/, '哨兵节点须按 T9+ 信封（type 标量+data Map 容器——exec-smoke 播种同形）');
  assert.doesNotMatch(src, /set\('content', /, 'data.content string 写=xml 域容器违规（textInput.content=XmlFragment〔T16〕——container-replacement 4411，实弹复证面；哨兵走 lww 键 model）');
});

test('T30b 红⑧：exec-smoke 环1/环2b 按 T23 UNKNOWN 纪律断言（超时/网络中断/5xx=外呼结果不明≠确定失败——reserve 保留禁自动退款；Y0b-5 T17 旧 EXECUTION_FAILED/退款环语义已被 spec §6.3 偏离 36-④ 取代）', () => {
  const execSrc = SMOKE_SRC_30B.slice(SMOKE_SRC_30B.indexOf('// apps/api/scripts/exec-smoke.mjs'));
  assert.match(execSrc, /TEXT_PROVIDER_UNKNOWN/, '环1/环2b 期望码=T23 TEXT_PROVIDER_UNKNOWN（api-caller text 链 fetch 失败/5xx 统一档）');
  assert.doesNotMatch(execSrc, /errorCode 应为 EXECUTION_FAILED/, '旧「传输失败降级档=EXECUTION_FAILED」期望=pre-T23 语义（实弹复证：现档=TEXT_PROVIDER_UNKNOWN）');
  assert.match(execSrc, /UNKNOWN 纪律/, '环断言处注记 T23 语义来源（spec §6.3/偏离 36-④——reserve 保留+人工对账面）');
});

test('T30b 红⑨：feed 追平断言归 drill 装置（node.deleted〔FEED_TOMBSTONE〕确定性事件经 HTTP 游标枚举——卡文⑥「feed 追平」；两进程形态注记：worker 终态 exec 投影走 write-batch 旧通道〔doc.exec——T32 删除在列〕，exec.status feed 面归 T32 后形态）', () => {
  assert.ok(drillCutover, '装置须在档');
  assert.match(DRILL_SRC_30B, /runtime-feed/, 'drill 须打 /api/collab/runtime-feed 端点（snapshot cursor+events 枚举——追平判据）');
  assert.match(DRILL_SRC_30B, /node\.deleted/, '追平判据事件=node.deleted（删除墓碑——lifecycle observer 与帧前缀同事务落 feed）');
  assert.match(DRILL_SRC_30B, /feed 追平/, '断言处注记语义（cursor 非零+事件可枚举）');
  const execSrc = SMOKE_SRC_30B.slice(SMOKE_SRC_30B.indexOf('// apps/api/scripts/exec-smoke.mjs'));
  assert.doesNotMatch(execSrc, /events\?after=0/, 'exec-smoke 不承载 feed 枚举断言（两进程形态 worker 终态走 doc.exec 旧通道——run17 实弹裁定）');
});

// ===== Y1c T31：restore 收尾 bump 的 epoch 写入时区形态锚（T31 P-1 历史根修；C1 rebaseline 后语义翻转） =====
// 史实（T31 restore-fence 演练实弹挖出，C1 前 naive 列时代）：SystemHistory.epochStartedAt 列当时=
// timestamp without time zone（Prisma DateTime 缺省），SQL `now()` 写入按 DB 会话时区（生产
// Asia/Shanghai）转墙钟存储——Prisma 读侧按 UTC 解释墙钟 ⇒ epoch 漂移 +UTC 偏移量（+8h），忘 bump
// 场景的时间戳栅栏（段头 lastWriteAt>epochStartedAt 触发 recoverySuspect）对「epoch 后 8h 内写入的段」
// 全部失效（恢复后立即重启的段恰在此窗=已回滚内容复活面）。当时的根修=写入侧补偿式时区转换单源 UTC 墙钟。
// C1 rebaseline 终态：全列 timestamptz(3)——裸 now() 即 timestamptz 瞬时值（会话时区无关），补偿式转换
// 已拆除；断言翻转为「裸 now()+timestamptz 列语义」——AT TIME ZONE 形态=naive 列时代残留，出现即红。
const SCHEMA_SRC_T31 = readFileSync(pathResolve(pathFileURLToPath(import.meta.url), '../../apps/api/prisma/schema.prisma'), 'utf8');
const SYSTEM_HISTORY_MODEL = /model SystemHistory \{[\s\S]*?\n\}/.exec(SCHEMA_SRC_T31)?.[0] ?? '';
function assertBumpBareNow(label, bumpSql) {
  assert.match(bumpSql, /"epochStartedAt"\s*=\s*now\(\)/, `${label}：epochStartedAt 写入=裸 now()`);
  assert.match(bumpSql, /"updatedAt"\s*=\s*now\(\)/, `${label}：updatedAt 写入=裸 now()`);
  assert.doesNotMatch(bumpSql, /AT TIME ZONE/i, `${label}：补偿式时区转换=naive 列时代残留（C1 后禁）`);
  assert.match(SYSTEM_HISTORY_MODEL, /epochStartedAt\s+DateTime\s+@db\.Timestamptz\(3\)/, 'SystemHistory.epochStartedAt=timestamptz(3)（裸 now() 语义成立的前提）');
}
test('T31-P1 红①（C1 后语义）：reset-collab bump SQL 必须裸 now()+timestamptz 列语义（会话时区无关；补偿式时区转换已随 rebaseline 拆除）', () => {
  const src = readFileSync(pathResolve(pathFileURLToPath(import.meta.url), '../reset-collab.mjs'), 'utf8');
  const bumpFn = src.slice(src.indexOf('async function stageBumpHistory'));
  const bumpSql = /UPDATE "SystemHistory"[^;]+/.exec(bumpFn)?.[0] ?? '';
  assertBumpBareNow('reset-collab', bumpSql);
});
test('T31-P1 红②（C1 后语义）：T31 演练装置 bumpHistoryId 同律——裸 now()（装置 bump 与产品工具同形）', () => {
  const src = readFileSync(pathResolve(pathFileURLToPath(import.meta.url), '../drill-fault.mjs'), 'utf8');
  const bumpSql = /UPDATE "SystemHistory"[^;]+/.exec(src)?.[0] ?? '';
  assertBumpBareNow('drill-fault', bumpSql);
});
