// C3a-4（plan v3 Task C3a-4——spec 2026-11-11-foundation-batch-design.md §0 水位不变量/§3.2-2 SAVEPOINT
// 失败隔离/§3.2-3 连续投影前缀）：appendBatch 组合闭包+帧/binding 水位两 UPDATE 解耦 真 PG 红测。
// 闭包形态=plan Step 2 片段（actor 侧装配——真投影器归 C3a-5，本文件注入 throw/成功两形态桩）：
//   lifecycle persist（SAVEPOINT 外——binding 回滚不连坐）→SAVEPOINT media_binding_projection→投影
//   →RELEASE；异常→ROLLBACK TO+同事务置 dirty；闭包返回 typed {bindingCovered}——repository 据此
//   决定 ②（binding 水位）执行。红测消费面=repository 契约（void 返回=无投影面不覆盖）。
// 三族（spec §3.2-8 前三锚）+四档（② 执行条件矩阵——①零行/①成功+covered/懒建档/covered=false），
// 每档断言恒 mediaBindingSeq<=pgSeq。
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow, FIXTURE_TEAM, FIXTURE_USER } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';
import * as Y from 'yjs';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'c3a4-binding-tx-int';
const MEDIA_ID = 'c3a4-binding-media-1';

/** 帧载荷工厂（逐帧内容相异——@@unique(projectId,generation,updateHash) 幂等轴不互吞）。 */
let frameNonce = 0;
const frameUpdate = (): Uint8Array => {
  const d = new Y.Doc();
  d.getMap('nodes').set('n', ++frameNonce);
  return Y.encodeStateAsUpdate(d);
};

/** C3a-4 测试侧组合闭包（plan Step 2 片段形态）：lifecycle 桩（SAVEPOINT 外——写 NodeLifecycle 行）
 *  →SAVEPOINT→注入投影桩→RELEASE；异常→ROLLBACK TO+同事务置 dirty。返回 typed {bindingCovered}。 */
async function combinedInTx(
  tx: Prisma.TransactionClient,
  lifecycleNodeId: string,
  projectBindings: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<{ bindingCovered: boolean; lifecycleCounts: number }> {
  const lifecycleCounts = (await tx.nodeLifecycle.createMany({
    data: [{ projectId: PID, nodeId: lifecycleNodeId, lifecycleSeq: 1n, isCurrent: true, state: 'ACTIVE', walSeq: 0n }],
  })).count;   // SAVEPOINT 外（spec §3.2-2——binding 回滚不连坐 lifecycle 行）
  await tx.$executeRaw`SAVEPOINT media_binding_projection`;
  let covered = false;
  try {
    await projectBindings(tx);
    await tx.$executeRaw`RELEASE SAVEPOINT media_binding_projection`;
    covered = true;
  } catch {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT media_binding_projection`;
    // 置 dirty 用 updateMany：行缺（懒建档布景）下 delegate update 0 行抛 P2025 会连坐整事务回滚
    // ——违 spec §3.2-2「binding 失败不连坐帧」；该形态的 dirty 由懒建档 INSERT 显式置位兜底。
    await tx.canvasDoc.updateMany({ where: { projectId: PID }, data: { bindingsDirty: true } });
  }
  return { bindingCovered: covered, lifecycleCounts };
}

/** 注入投影桩（C3a-5 MediaBindingProjector 替身）：成功形态=写一条 binding。 */
const projectorSuccess = (slotNodeId: string) => async (tx: Prisma.TransactionClient): Promise<void> => {
  await tx.mediaBinding.create({
    data: { mediaId: MEDIA_ID, projectId: PID, nodeId: slotNodeId, teamId: FIXTURE_TEAM, role: 'primary', targetField: 'fileId', targetItemId: '' },
  });
};

/** 注入投影桩：throw 形态=先写一条 binding 再抛（证明 ROLLBACK TO 回滚投影写）。 */
const projectorThrowAfterWrite = (slotNodeId: string) => async (tx: Prisma.TransactionClient): Promise<void> => {
  await projectorSuccess(slotNodeId)(tx);
  throw new Error('BindingProjectionInjectedFailure');
};

/** per-test 布景重置：binding/lifecycle/帙行全清+建 CanvasDoc 行（初始水位三元+代）。 */
async function resetDoc(
  prisma: PrismaClient,
  init: { pgSeq: bigint; mediaBindingSeq: bigint; dirty: boolean; generation?: number },
): Promise<void> {
  await prisma.$transaction([
    prisma.mediaBinding.deleteMany({ where: { projectId: PID } }),
    prisma.nodeLifecycle.deleteMany({ where: { projectId: PID } }),
    prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } }),
    prisma.canvasDoc.deleteMany({ where: { projectId: PID } }),
  ]);
  await prisma.canvasDoc.create({
    data: {
      projectId: PID, generation: init.generation ?? 1, schemaVersion: 3,
      pgSeq: init.pgSeq, walCheckpointSeq: init.pgSeq,   // CHECK pgSeq<=walCheckpointSeq 守恒
      mediaBindingSeq: init.mediaBindingSeq, bindingsDirty: init.dirty,
    },
  });
}

/** 清帙+去行（懒建档布景）。 */
async function dropDocAndRows(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction([
    prisma.mediaBinding.deleteMany({ where: { projectId: PID } }),
    prisma.nodeLifecycle.deleteMany({ where: { projectId: PID } }),
    prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } }),
    prisma.canvasDoc.deleteMany({ where: { projectId: PID } }),
  ]);
}

maybe('C3a-4：appendBatch 组合闭包+两 UPDATE+SAVEPOINT（真 PG）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID);
    await prisma.media.deleteMany({ where: { id: MEDIA_ID } });
    await prisma.media.create({
      data: { id: MEDIA_ID, userId: FIXTURE_USER, teamId: FIXTURE_TEAM, key: `c3a4/${MEDIA_ID}`, originalName: 'binding-tx.png', mimeType: 'image/png', size: 1n, type: 'uploaded' },
    });
  });
  beforeEach(async () => { await ensureLeaseFixture(prisma, repo); });
  afterAll(async () => {
    await prisma.media.deleteMany({ where: { id: MEDIA_ID } });
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID);
    await prisma.$disconnect();
  });

  const docState = async () => {
    const d = await prisma.canvasDoc.findUnique({ where: { projectId: PID } });
    return { pgSeq: d?.pgSeq ?? null, mediaBindingSeq: d?.mediaBindingSeq ?? null, dirty: d?.bindingsDirty ?? null };
  };
  /** 恒 mediaBindingSeq<=pgSeq（§0 水位不变量——逐档断言）。 */
  const expectInvariant = (s: { pgSeq: bigint | null; mediaBindingSeq: bigint | null }) => {
    expect(s.pgSeq).not.toBeNull();
    expect(s.mediaBindingSeq).not.toBeNull();
    expect(s.mediaBindingSeq! <= s.pgSeq!, `不变量 mediaBindingSeq(${s.mediaBindingSeq})<=pgSeq(${s.pgSeq})`).toBe(true);
  };

  // ── 族①（spec §3.2-8「投影注入异常→帧仍提交+dirty+水位不进」五断言合并锚）──
  it('族①：注入投影 throw→帧行落 PG∧pgSeq 前进∧lifecycle 行在∧binding 缺（投影零写）∧dirty=true∧mediaBindingSeq 不进', async () => {
    await resetDoc(prisma, { pgSeq: 5n, mediaBindingSeq: 5n, dirty: false });
    const r = await repo.appendBatch(PID, [seedRow(frameUpdate(), 10n)], { expectedPgSeq: 5n, newPgSeq: 10n, walCheckpointSeq: 10n },
      (tx) => combinedInTx(tx, 'lifecycle-a', projectorThrowAfterWrite('slot-a')));
    expect(r).toEqual({ ok: true, rows: 1 });   // 投影失败不连坐帧（SAVEPOINT 隔离——整事务照常提交）
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID, seq: 10n } })).toBe(1);   // ① 帧行落 PG
    expect(await prisma.nodeLifecycle.count({ where: { projectId: PID, nodeId: 'lifecycle-a' } })).toBe(1);   // ② lifecycle 行在（SAVEPOINT 外）
    expect(await prisma.mediaBinding.count({ where: { projectId: PID } })).toBe(0);   // ③ binding 缺——ROLLBACK TO 回滚投影写
    const s = await docState();
    expect(s.pgSeq).toBe(10n);   // ④ 帧水位前进（① 永远推进——与 binding 无关）
    expect(s.dirty).toBe(true);   // ⑤ 同事务置 dirty（闭包 catch 分支）
    expect(s.mediaBindingSeq).toBe(5n);   // ⑥ binding 水位不进（covered=false→② 不执行）
    expectInvariant(s);
  });

  // ── 族②（spec §3.2-8「批 N 失败批 N+1 成功→水位停在 N−1 且 dirty（不跳 gap）」）──
  it('族②：批 N 投影 throw 批 N+1 成功→binding 水位停在 N−1 且 dirty 保持（不跳 gap）', async () => {
    await resetDoc(prisma, { pgSeq: 5n, mediaBindingSeq: 5n, dirty: false });
    await repo.appendBatch(PID, [seedRow(frameUpdate(), 10n)], { expectedPgSeq: 5n, newPgSeq: 10n, walCheckpointSeq: 10n },
      (tx) => combinedInTx(tx, 'lifecycle-b1', projectorThrowAfterWrite('slot-b1')));   // 批 N（脏化）
    const r2 = await repo.appendBatch(PID, [seedRow(frameUpdate(), 15n)], { expectedPgSeq: 10n, newPgSeq: 15n, walCheckpointSeq: 15n },
      (tx) => combinedInTx(tx, 'lifecycle-b2', projectorSuccess('slot-b2')));   // 批 N+1（投影成功）
    expect(r2).toEqual({ ok: true, rows: 1 });
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'slot-b2' } })).toBe(1);   // N+1 投影照常提交
    const s = await docState();
    expect(s.pgSeq).toBe(15n);   // 帧水位照常推进（两 UPDATE 解耦——binding CAS 失败不卡 pgSeq）
    expect(s.dirty).toBe(true);   // dirty 保持（增量不得清——仅 C3a-6 rebuild 清）
    expect(s.mediaBindingSeq).toBe(5n);   // binding 水位停 N−1：dirty 期间任何增量成功不得推进（不跳 gap）
    expectInvariant(s);
  });

  // ── 族③（spec §3.2-3 连续 CAS 形态——红驱动：旧代码无 ②）──
  it('族③：bindingCovered∧非 dirty→binding 水位 CAS 推进到 newPg', async () => {
    await resetDoc(prisma, { pgSeq: 5n, mediaBindingSeq: 5n, dirty: false });
    const r = await repo.appendBatch(PID, [seedRow(frameUpdate(), 10n)], { expectedPgSeq: 5n, newPgSeq: 10n, walCheckpointSeq: 10n },
      (tx) => combinedInTx(tx, 'lifecycle-c', projectorSuccess('slot-c')));
    expect(r).toEqual({ ok: true, rows: 1 });
    const s = await docState();
    expect(s.pgSeq).toBe(10n);
    expect(s.mediaBindingSeq).toBe(10n);   // 红：旧代码无 ② ——停 5
    expect(s.dirty).toBe(false);
    expectInvariant(s);
  });

  // ── 档1（① UPDATE 零行→② 不执行）：rows 代≠doc 代 → ① CAS 代谓词 miss+adopt 同谓词 miss → fenced
  //    （确定性「① 零行且无成功出口」布景——② 在事务内与 adopt/convergence 出口均无执行面）──
  it('档1：① UPDATE 零行（fenced 形）→② 不执行——mediaBindingSeq 不进且不变量成立', async () => {
    await resetDoc(prisma, { pgSeq: 5n, mediaBindingSeq: 5n, dirty: false, generation: 7 });
    const r = await repo.appendBatch(PID, [seedRow(frameUpdate(), 10n, 8)], { expectedPgSeq: 5n, newPgSeq: 10n, walCheckpointSeq: 10n },
      (tx) => combinedInTx(tx, 'lifecycle-d', projectorSuccess('slot-d')));   // rows generation=8≠doc 7
    expect(r).toEqual({ ok: false, reason: 'fenced' });
    const s = await docState();
    expect(s.pgSeq).toBe(5n);   // ① 未落定
    expect(s.mediaBindingSeq).toBe(5n);   // ② 无执行面（fenced 解析无成功出口）
    expect(s.dirty).toBe(false);
    // 注：闭包在主事务内已跑且事务提交——binding/lifecycle 行在而水位双停（保守 lag，非超前进）
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'slot-d' } })).toBe(1);
    expect(await prisma.nodeLifecycle.count({ where: { projectId: PID, nodeId: 'lifecycle-d' } })).toBe(1);
    expectInvariant(s);
  });

  // ── 档2-cas-miss（adoopt 出口：崩溃窗 expected 陈旧→主 CAS miss→adopt 真值重 CAS 落定）──
  it('档2：cas-miss adopt 出口——expected 陈旧（内存水位滞后）→adopt 落定后 ② 以锁外实读 pgSeq 推进', async () => {
    await resetDoc(prisma, { pgSeq: 5n, mediaBindingSeq: 5n, dirty: false });
    // 前批正常落定 pgSeq=10/mediaBindingSeq=10（模拟「CAS 已提交而 confirm 未跑」崩溃窗起点）
    await repo.appendBatch(PID, [seedRow(frameUpdate(), 10n)], { expectedPgSeq: 5n, newPgSeq: 10n, walCheckpointSeq: 10n },
      (tx) => combinedInTx(tx, 'lifecycle-e1', projectorSuccess('slot-e1')));
    // 本批 expected=5（陈旧）≠实际 10→主 CAS miss→adopt 以实读 pgSeq=10 重 CAS 落定→② 接力
    const r2 = await repo.appendBatch(PID, [seedRow(frameUpdate(), 15n)], { expectedPgSeq: 5n, newPgSeq: 15n, walCheckpointSeq: 15n },
      (tx) => combinedInTx(tx, 'lifecycle-e2', projectorSuccess('slot-e2')));
    expect(r2).toEqual({ ok: true, rows: 1 });
    const s = await docState();
    expect(s.pgSeq).toBe(15n);
    expect(s.mediaBindingSeq).toBe(15n);   // 红：② 以 row.pgSeq=10 为 expectedContiguous（同 adopt 真值形）——旧代码无 ② 停 10
    expectInvariant(s);
  });

  // ── 档2-cas-miss（convergence 出口：旧批幂等重发 pgSeq 已≥newPg——② 单调防回退门）──
  it('档2：convergence 出口——旧批幂等重发（pgSeq 已超前）→② 防回退门保 mediaBindingSeq 不下退', async () => {
    await resetDoc(prisma, { pgSeq: 5n, mediaBindingSeq: 5n, dirty: false });
    const u = frameUpdate();
    await repo.appendBatch(PID, [seedRow(u, 15n)], { expectedPgSeq: 5n, newPgSeq: 15n, walCheckpointSeq: 15n },
      (tx) => combinedInTx(tx, 'lifecycle-f1', projectorSuccess('slot-f1')));
    // 模拟后续批已推进 pgSeq=20（不变量形 mediaBindingSeq==pgSeq）
    await prisma.canvasDoc.update({ where: { projectId: PID }, data: { pgSeq: 20n, walCheckpointSeq: 20n, mediaBindingSeq: 20n } });
    // 旧批重发（同 hash 同 seq——INSERT 被 PK 吞；expected=5 陈旧→① miss→convergence 出口 pgSeq=20≥15）
    const r2 = await repo.appendBatch(PID, [seedRow(u, 15n)], { expectedPgSeq: 5n, newPgSeq: 15n, walCheckpointSeq: 15n },
      (tx) => combinedInTx(tx, 'lifecycle-f2', projectorSuccess('slot-f2')));
    expect(r2).toEqual({ ok: true, rows: 0 });   // 幂等重发零实插
    const s = await docState();
    expect(s.pgSeq).toBe(20n);
    expect(s.mediaBindingSeq).toBe(20n);   // 单调门（mediaBindingSeq<newPg 不成立）——不因重发旧批下退到 15
    expectInvariant(s);
  });

  // ── 档3（懒建档显式初始化——第七轮 P0-4：防新项目 0<pgSeq 非 dirty 永久 bail-out）──
  it('档3：懒建档——covered→mediaBindingSeq=newPg 直接初始化；不 covered→mediaBindingSeq=0 且 bindingsDirty=true', async () => {
    // covered 形
    await resetDoc(prisma, { pgSeq: 5n, mediaBindingSeq: 5n, dirty: false });
    await dropDocAndRows(prisma);   // 去行=懒建档布景（行缺失与 fenced 不可区分形态）
    const r1 = await repo.appendBatch(PID, [seedRow(frameUpdate(), 10n)], { expectedPgSeq: 5n, newPgSeq: 10n, walCheckpointSeq: 10n },
      (tx) => combinedInTx(tx, 'lifecycle-g1', projectorSuccess('slot-g1')));
    expect(r1).toEqual({ ok: true, rows: 1 });
    let s = await docState();
    expect(s.pgSeq).toBe(10n);
    expect(s.mediaBindingSeq).toBe(10n);   // 红：旧 INSERT 不写该列——默认 0
    expect(s.dirty).toBe(false);
    expectInvariant(s);
    // 不 covered 形（投影 throw→ROLLBACK+闭包置 dirty——行缺 no-op；建档 INSERT 兜底置位）
    await dropDocAndRows(prisma);
    const r2 = await repo.appendBatch(PID, [seedRow(frameUpdate(), 15n)], { expectedPgSeq: 5n, newPgSeq: 15n, walCheckpointSeq: 15n },
      (tx) => combinedInTx(tx, 'lifecycle-g2', projectorThrowAfterWrite('slot-g2')));
    expect(r2).toEqual({ ok: true, rows: 1 });
    s = await docState();
    expect(s.pgSeq).toBe(15n);
    expect(s.mediaBindingSeq).toBe(0n);   // 建档不 covered：0（无连续前缀可指）
    expect(s.dirty).toBe(true);   // 红：旧 INSERT 默认 false——新项目 0<pgSeq 非 dirty 永久 bail-out
    expectInvariant(s);
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'slot-g2' } })).toBe(0);   // ROLLBACK 回滚投影写（行缺布景同验）
    expect(await prisma.nodeLifecycle.count({ where: { projectId: PID, nodeId: 'lifecycle-g2' } })).toBe(1);
  });
});
