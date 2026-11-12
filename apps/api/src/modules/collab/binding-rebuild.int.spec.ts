// apps/api/src/modules/collab/binding-rebuild.int.spec.ts
// C3a-6（plan v3 Task C3a-6——spec 2026-11-11-foundation-batch-design.md §0 水位不变量/§3.2-3）：
// 水位不变量闭环 真 PG 红测——仅全量 rebuild 清 dirty+推 mediaBindingSeq；四族+谓词：
//   ①backfill 选中条件（boot 判定/backfill 候选集=dirty ∨ mediaBindingSeq<pgSeq ∨ replayed>0
//     ——spec §3.2-3 恢复四路 boot 腿的谓词单源；BackfillRunner 枚举面归 C3a-8，本任务锁条件本身）；
//   ②rebuild 读 (G,S) 后 append→CAS 四条件（mediaBindingSeq=expected ∧ pgSeq=S ∧ generation=G ∧
//     dirty=true——第七轮补 generation）失败→dirty 保持；再 rebuild 至新 S→清 dirty 且
//     binding 集==递归重算（collectMediaRefs(doc@S) 聚合）+全量替换（stale 行/错 mediaId 行收敛）；
//   ③rebuild 读 S 后 vacuum 换代（pgSeq 不变 generation+1）→CAS generation 门失败→dirty 保持
//     （第七轮 P0-5 核心——loadForHydrationAt 定代的意义）；
//   ④持续写→持续 dirty（增量投影成功不得推水位——§3.2-3「dirty 期间任何增量成功不得推进」）
//     +「持续 dirty」可观测=needsBindingRebuild 恒选中（spec §3.2-7 指标面无 binding_dirty 项
//     ——gap_seq/watermark_lag 归 C3a-8 落，本处记录性注释：分诊面=选中谓词+CAS miss 日志）；
//   ⑤loadForHydrationAt 定代：stateSeq<=S 最新快照+(stateSeq,S] 同代尾（换代行排除——禁 live doc）。
// 红态=binding-rebuild.service 模块不存在（编译级红——C3a-5 projector 先例）。
// genesis 种子含引用→同事务置 dirty 的 genesis 面红测在 canvas-doc-genesis.int.spec.ts（同批）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int binding-rebuild
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import * as Y from 'yjs';
import { collectMediaRefs } from '@flowweb/shared';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { BindingRebuildService, needsBindingRebuild } from './binding-rebuild.service';
import { projectBindings } from './media-binding-projector';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow, FIXTURE_TEAM, FIXTURE_USER } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';
import { createCanvasDoc } from './canvas-doc.factory';
import { toDocLike } from './doc-like.util';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'c3a6-binding-rebuild-int';
const PID_H = 'c3a6-hydrate-at-int';
const SEL_PIDS = ['c3a6-sel-a', 'c3a6-sel-b', 'c3a6-sel-c', 'c3a6-sel-d'] as const;
const M1 = 'c3a6-media-1';
const M2 = 'c3a6-media-2';

/** 媒体引用帧（nodeId+fileId——C3a-1 collectMediaRefsForNode 扫描域=data 域标量槽）。 */
const mediaFrame = (nodeId: string, mediaId: string): Uint8Array => {
  const d = new Y.Doc();
  const node = new Y.Map<unknown>();
  const data = new Y.Map<unknown>();
  data.set('fileId', mediaId);
  node.set('type', 'image');
  node.set('data', data);
  (d.getMap('nodes') as Y.Map<unknown>).set(nodeId, node);
  return Y.encodeStateAsUpdate(d);
};

/** 普通标记帧（无媒体引用——⑤族节点标记专用）。 */
const nodeFrame = (nodeId: string): Uint8Array => {
  const d = new Y.Doc();
  (d.getMap('nodes') as Y.Map<unknown>).set(nodeId, new Y.Map([['type', 'textInput']]));
  return Y.encodeStateAsUpdate(d);
};

/** per-test 布景重置（C3a-4 resetDoc 同款）：binding/帙/快照行全清+建 CanvasDoc 行。 */
async function resetDoc(prisma: PrismaClient, init: { pgSeq: bigint; mediaBindingSeq: bigint; dirty: boolean; generation?: number }, pid: string = PID): Promise<void> {
  await prisma.$transaction([
    prisma.mediaBinding.deleteMany({ where: { projectId: pid } }),
    prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } }),
    prisma.canvasDocSnapshot.deleteMany({ where: { projectId: pid } }),
    prisma.canvasDoc.deleteMany({ where: { projectId: pid } }),
  ]);
  await prisma.canvasDoc.create({
    data: {
      projectId: pid, generation: init.generation ?? 1, schemaVersion: 3,
      pgSeq: init.pgSeq, walCheckpointSeq: init.pgSeq,   // CHECK pgSeq<=walCheckpointSeq 守恒
      mediaBindingSeq: init.mediaBindingSeq, bindingsDirty: init.dirty,
    },
  });
}

const docState = async (prisma: PrismaClient, pid: string = PID) => {
  const d = await prisma.canvasDoc.findUnique({ where: { projectId: pid } });
  return { pgSeq: d?.pgSeq ?? null, mediaBindingSeq: d?.mediaBindingSeq ?? null, dirty: d?.bindingsDirty ?? null, generation: d?.generation ?? null };
};

/** binding 槽集（断言面——nodeId|targetField|targetItemId=>mediaId）。 */
const slotKeysOf = (rs: Array<{ nodeId: string; targetField: string; targetItemId: string; mediaId: string }>) =>
  rs.map((r) => `${r.nodeId}|${r.targetField}|${r.targetItemId || ''}=>${r.mediaId}`).sort();

// ── 谓词（纯——无 DB 恒跑）：spec §3.2-3 boot 判定三或 ──
describe('C3a-6 needsBindingRebuild 谓词（spec §3.2-3 恢复四路 boot：replayed>0 ∨ mediaBindingSeq<pgSeq ∨ dirty）', () => {
  it('三或全假=false（干净已覆盖项目不重建）', () => {
    expect(needsBindingRebuild({ replayed: 0, mediaBindingSeq: 5n, pgSeq: 5n, bindingsDirty: false })).toBe(false);
  });
  it('replayed>0 → true（boot 回灌帧未经投影面——即便水位已齐）', () => {
    expect(needsBindingRebuild({ replayed: 1, mediaBindingSeq: 5n, pgSeq: 5n, bindingsDirty: false })).toBe(true);
  });
  it('mediaBindingSeq<pgSeq → true（lag——连续前缀未证）', () => {
    expect(needsBindingRebuild({ replayed: 0, mediaBindingSeq: 0n, pgSeq: 5n, bindingsDirty: false })).toBe(true);
  });
  it('dirty → true（即便 0==0 假覆盖形态——genesis/SAVEPOINT 回滚置位）', () => {
    expect(needsBindingRebuild({ replayed: 0, mediaBindingSeq: 0n, pgSeq: 0n, bindingsDirty: true })).toBe(true);
  });
});

maybe('C3a-6：水位不变量闭环——rebuild CAS 四条件+loadForHydrationAt 定代（真 PG）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);
  const svc = new BindingRebuildService(prisma as never, repo as never);

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID);
    await ensureProjectFixture(prisma, PID_H);
    for (const p of SEL_PIDS) await ensureProjectFixture(prisma, p);
    await prisma.media.deleteMany({ where: { id: { in: [M1, M2] } } });
    for (const id of [M1, M2]) await prisma.media.create({
      data: { id, userId: FIXTURE_USER, teamId: FIXTURE_TEAM, key: `c3a6/${id}`, originalName: `${id}.png`, mimeType: 'image/png', size: 1n, type: 'uploaded' },
    });
  });
  beforeEach(async () => { await ensureLeaseFixture(prisma, repo); });
  afterAll(async () => {
    await prisma.media.deleteMany({ where: { id: { in: [M1, M2] } } });
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID);
    await cleanupProjectFixture(prisma, PID_H);
    for (const p of SEL_PIDS) await cleanupProjectFixture(prisma, p);
    await prisma.$disconnect();
  });

  // ── 族①：backfill 选中条件（dirty ∨ lag 的项目集=重建候选——C3a-8 BackfillRunner 枚举消费本谓词）──
  it('族①：候选集=dirty ∨ mediaBindingSeq<pgSeq（谓词≡过滤等价——JS findMany 过滤形态非 SQL WHERE〔C3a-6 评审遗留改名〕；干净已覆盖项目不在列）', async () => {
    // 四形态布景：a=纯 dirty / b=纯 lag / c=dirty∧lag / d=干净已覆盖
    const shapes: Record<string, { pgSeq: bigint; mediaBindingSeq: bigint; dirty: boolean }> = {
      [SEL_PIDS[0]]: { pgSeq: 5n, mediaBindingSeq: 5n, dirty: true },
      [SEL_PIDS[1]]: { pgSeq: 5n, mediaBindingSeq: 0n, dirty: false },
      [SEL_PIDS[2]]: { pgSeq: 7n, mediaBindingSeq: 3n, dirty: true },
      [SEL_PIDS[3]]: { pgSeq: 5n, mediaBindingSeq: 5n, dirty: false },
    };
    for (const [pid, s] of Object.entries(shapes)) await resetDoc(prisma, s, pid);
    // SQL 枚举（C3a-8 BackfillRunner 的选中面形态）
    const rows = await prisma.canvasDoc.findMany({ where: { projectId: { in: [...SEL_PIDS] } } });
    const bySql = rows.filter((r) => r.bindingsDirty || r.mediaBindingSeq < r.pgSeq).map((r) => r.projectId).sort();
    const byPredicate = rows.filter((r) => needsBindingRebuild({ replayed: 0, mediaBindingSeq: r.mediaBindingSeq, pgSeq: r.pgSeq, bindingsDirty: r.bindingsDirty })).map((r) => r.projectId).sort();
    expect(bySql).toEqual([...SEL_PIDS.slice(0, 3)].sort());   // a/b/c 在列（replayed 腿纯测已锁——SQL 枚举域恒 0）
    expect(byPredicate).toEqual(bySql);   // 谓词==SQL 枚举（单源锁定）
    for (const pid of SEL_PIDS) await prisma.canvasDoc.deleteMany({ where: { projectId: pid } });
  });

  // ── 族②：rebuild×append 交错——CAS 四条件失败→dirty 保持；收敛 rebuild→清 dirty+binding 集==重算 ──
  it('族②：anchor 读 (G,S) 后 append→CAS 失败（pgSeq 门）→dirty 保持；再 rebuild 至新 S→清 dirty∧binding 集==collectMediaRefs 重算∧全量替换（stale/错 mediaId 收敛）', async () => {
    // 布景：lag 形（appendBatch 无闭包=replayAll catch-up 形——covered=false 不推 binding 水位不置 dirty）
    await resetDoc(prisma, { pgSeq: 0n, mediaBindingSeq: 0n, dirty: false });
    expect(await repo.appendBatch(PID, [seedRow(mediaFrame('r1', M1), 5n)], { expectedPgSeq: 0n, newPgSeq: 5n, walCheckpointSeq: 5n })).toEqual({ ok: true, rows: 1 });
    let s = await docState(prisma);
    expect(s.pgSeq).toBe(5n);
    expect(s.mediaBindingSeq).toBe(0n);   // lag：0<5（重建候选——族①b 形态）
    expect(s.dirty).toBe(false);
    // 交错：锁外读 anchor 后并发 append（新帙行落 pgSeq=10）
    const anchor = await svc.snapshotAnchor(PID);
    if (!anchor) throw new Error('snapshotAnchor 返回 null（CanvasDoc 行缺失布景错误）');
    expect(anchor).toEqual({ generation: 1, pgSeq: 5n, expectedBindingSeq: 0n });
    expect(await repo.appendBatch(PID, [seedRow(mediaFrame('r2', M2), 10n)], { expectedPgSeq: 5n, newPgSeq: 10n, walCheckpointSeq: 10n })).toEqual({ ok: true, rows: 1 });
    // 写面（doc@5 重放——只含 r1）+全量替换布景：stale 行（doc 外节点）+错 mediaId 行（r1 槽指 M2）
    await prisma.mediaBinding.createMany({ data: [
      { mediaId: M1, projectId: PID, nodeId: 'ghost', teamId: FIXTURE_TEAM, role: 'primary', targetField: 'fileId', targetItemId: '' },
      { mediaId: M2, projectId: PID, nodeId: 'r1', teamId: FIXTURE_TEAM, role: 'primary', targetField: 'fileId', targetItemId: '' },
    ] });
    await svc.writeBindingsAt(PID, anchor);
    // CAS 四条件：pgSeq=5 门失（现 10）→失败→dirty 保持（下轮重试）
    const miss = await svc.commitByCas(PID, anchor);
    expect(miss.outcome).toBe('cas-miss');
    s = await docState(prisma);
    expect(s.dirty).toBe(true);   // CAS 失败→dirty 保持（spec §0——修锁外分页写覆盖竞态）
    expect(s.mediaBindingSeq).toBe(0n);
    expectInvariant(s);
    // 收敛轮：rebuild 至新 S=10→清 dirty+推水位+binding 集==递归重算
    const done = await svc.rebuildProjectBindings(PID);
    expect(done).toMatchObject({ outcome: 'cleared', pgSeq: 10n });
    s = await docState(prisma);
    expect(s.dirty).toBe(false);
    expect(s.mediaBindingSeq).toBe(10n);
    expectInvariant(s);
    const rs = await prisma.mediaBinding.findMany({ where: { projectId: PID } });
    expect(rs.every((r) => r.nodeId !== 'ghost')).toBe(true);   // 全量替换：doc 外 stale 行清
    // 递归重算 oracle：loadForHydrationAt 定代重放 doc@10 → collectMediaRefs 聚合（C3a-1 单源）
    const oracleDoc = createCanvasDoc();
    try {
      const at = await repo.loadForHydrationAt(PID, { generation: 1, pgSeq: 10n });
      if (at.state) Y.applyUpdate(oracleDoc, new Uint8Array(at.state));
      for (const u of at.updates) Y.applyUpdate(oracleDoc, new Uint8Array(u));
      const oracle = slotKeysOf(collectMediaRefs(toDocLike(oracleDoc)).map((r) => ({ nodeId: r.nodeId, targetField: r.targetField, targetItemId: r.targetItemId, mediaId: r.mediaId })));
      expect(slotKeysOf(rs)).toEqual(oracle);   // binding 集==递归重算结果（r1→M1 修正+r2→M2）
      expect(oracle).toContain(`r1|fileId|=>${M1}`);   // 错 mediaId 行（r1→M2）被全量替换修正
      expect(oracle).toContain(`r2|fileId|=>${M2}`);
    } finally { oracleDoc.destroy(); }
  });

  // ── 族③：vacuum 换代门（第七轮 P0-5——pgSeq 不变 generation+1→CAS generation 门失败）──
  it('族③：anchor 读 (G,S) 后换代（pgSeq 不变、generation+1）→CAS 失败（generation 门）→dirty 保持', async () => {
    await resetDoc(prisma, { pgSeq: 0n, mediaBindingSeq: 0n, dirty: false });
    await repo.appendBatch(PID, [seedRow(mediaFrame('g1', M1), 5n)], { expectedPgSeq: 0n, newPgSeq: 5n, walCheckpointSeq: 5n });
    const anchor = await svc.snapshotAnchor(PID);
    if (!anchor) throw new Error('snapshotAnchor 返回 null（CanvasDoc 行缺失布景错误）');
    // 模拟 vacuum 换代：pgSeq 不重置、generation+1（vacuumReplace 新代快照基线=旧代 maxSeq——内容变）
    await prisma.canvasDoc.update({ where: { projectId: PID }, data: { generation: 2 } });
    await svc.writeBindingsAt(PID, anchor);   // 定代重放 G=1 旧代 doc@5（换代行排除）
    const miss = await svc.commitByCas(PID, anchor);
    expect(miss.outcome).toBe('cas-miss');   // pgSeq=5 仍匹配——唯一失配谓词=generation（门语义隔离断言）
    const s = await docState(prisma);
    expect(s.dirty).toBe(true);   // 换代竞窗→dirty 保持（下轮以新代 anchor 重试）
    expect(s.mediaBindingSeq).toBe(0n);
    expectInvariant(s);
  });

  // ── 族④：持续写→持续 dirty（§3.2-3「dirty 期间任何增量成功不得推进」）──
  it('族④：dirty 期连续 append（投影成功 covered=true）→mediaBindingSeq 冻结∧dirty 保持；「持续 dirty」可观测=needsBindingRebuild 恒选中（§3.2-7 无 binding_dirty 指标——记录性注释）', async () => {
    await resetDoc(prisma, { pgSeq: 5n, mediaBindingSeq: 5n, dirty: true });   // SAVEPOINT 回滚置位形
    const covered = (nodeId: string, mediaId: string) => async (tx: Prisma.TransactionClient) => {
      await projectBindings(tx, PID, FIXTURE_TEAM, new Map([[nodeId, [{ nodeId, mediaId, role: 'primary' as const, targetField: 'fileId' as const, targetItemId: '' }]]]));
      return { bindingCovered: true };
    };
    await repo.appendBatch(PID, [seedRow(mediaFrame('w1', M1), 10n)], { expectedPgSeq: 5n, newPgSeq: 10n, walCheckpointSeq: 10n }, covered('w1', M1));
    await repo.appendBatch(PID, [seedRow(mediaFrame('w2', M2), 15n)], { expectedPgSeq: 10n, newPgSeq: 15n, walCheckpointSeq: 15n }, covered('w2', M2));
    const s = await docState(prisma);
    expect(s.pgSeq).toBe(15n);   // 帧水位照常推进（两 UPDATE 解耦）
    expect(s.mediaBindingSeq).toBe(5n);   // 持续 dirty：增量成功不推 binding 水位（不跳 gap）
    expect(s.dirty).toBe(true);
    expectInvariant(s);
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: { in: ['w1', 'w2'] } } })).toBe(2);   // 增量投影行照写（dirty 只冻水位）
    // 可观测面（spec §3.2-7 指标清单无 binding_dirty 项——gap_seq/watermark_lag 归 C3a-8 metric 落；
    // 本任务分诊面=选中谓词恒真+rebuild CAS miss 日志——binding-rebuild.service 头注记录性注释）
    expect(needsBindingRebuild({ replayed: 0, mediaBindingSeq: s.mediaBindingSeq!, pgSeq: s.pgSeq!, bindingsDirty: s.dirty! })).toBe(true);
    // rebuild 收敛退出持续 dirty
    expect((await svc.rebuildProjectBindings(PID))).toMatchObject({ outcome: 'cleared', pgSeq: 15n });
    const after = await docState(prisma);
    expect(after.dirty).toBe(false);
    expect(after.mediaBindingSeq).toBe(15n);
  });

  // ── 族⑤：loadForHydrationAt 定代（固定 generation 选 stateSeq<=S 最新快照+(stateSeq,S] 同代尾）──
  it('族⑤：loadForHydrationAt——最新 stateSeq<=S 快照+同代尾；换代行（G+1 同 seq）排除', async () => {
    await resetDoc(prisma, { pgSeq: 10n, mediaBindingSeq: 10n, dirty: false }, PID_H);
    // 累积快照（真发布语义：state=该 seq 的全前缀态——逐代叠加 marker 后编码）
    const base = new Y.Doc();
    const mkSnap = async (generation: number, rev: bigint, stateSeq: bigint, marker: string) => {
      if (generation === 1) base.getMap('nodes').set(marker, new Y.Map([['type', 'textInput']]));
      const d = generation === 1 ? base : new Y.Doc();   // G2 换代快照独立基线（换代内容变——本测只验排除）
      if (generation !== 1) d.getMap('nodes').set(marker, new Y.Map([['type', 'textInput']]));
      await prisma.canvasDocSnapshot.create({ data: {
        projectId: PID_H, generation, snapshotRev: rev, stateSeq,
        state: Buffer.from(Y.encodeStateAsUpdate(d)), stateHash: `c3a6-${generation}-${rev}-${stateSeq}-`.padEnd(64, '0'),
        vacuumEpoch: 0, schemaVersion: 3,
      } });
      if (generation !== 1) d.destroy();
    };
    await mkSnap(1, 0n, 0n, 's0');
    await mkSnap(1, 1n, 3n, 's3');
    await mkSnap(1, 2n, 7n, 's7');
    await mkSnap(2, 0n, 7n, 'g2s7');   // 换代快照（G2）
    const mkUpd = (generation: number, seq: bigint, marker: string) => prisma.canvasDocUpdate.create({ data: {
      projectId: PID_H, generation, seq, firstWalSeq: seq, frameCount: 1,
      updateHash: `c3a6u${generation}-${seq}-`.padEnd(64, '0'), update: Buffer.from(nodeFrame(marker)),
    } });
    for (const [gen, seq, m] of [[1, 1n, 'u1'], [1, 2n, 'u2'], [1, 4n, 'u4'], [1, 5n, 'u5'], [1, 8n, 'u8'], [1, 9n, 'u9'], [1, 10n, 'u10'], [2, 8n, 'g2u8']] as const) await mkUpd(gen, seq, m);
    const replayNodes = async (r: { state: Buffer | null; updates: Buffer[] }) => {
      const doc = createCanvasDoc();
      try {
        if (r.state) Y.applyUpdate(doc, new Uint8Array(r.state));
        for (const u of r.updates) Y.applyUpdate(doc, new Uint8Array(u));
        return [...doc.getMap('nodes').keys()].sort();
      } finally { doc.destroy(); }
    };
    // S=5：快照=stateSeq3 最新（s0/s3 基线）+尾 (3,5]={u4,u5}
    const at5 = await repo.loadForHydrationAt(PID_H, { generation: 1, pgSeq: 5n });
    expect(at5.stateSeq).toBe(3n);
    expect(at5.updates).toHaveLength(2);
    expect(await replayNodes(at5)).toEqual(['s0', 's3', 'u4', 'u5']);
    // S=10：快照=stateSeq7+尾 (7,10]={u8,u9,u10}——G2 同 seq 行（g2u8）排除（换代行不混代）
    const at10 = await repo.loadForHydrationAt(PID_H, { generation: 1, pgSeq: 10n });
    expect(at10.stateSeq).toBe(7n);
    expect(at10.updates).toHaveLength(3);
    expect(await replayNodes(at10)).toEqual(['s0', 's3', 's7', 'u10', 'u8', 'u9']);
    // S=2：快照回落 stateSeq0+尾 (0,2]={u1,u2}（S 之下最新快照选取）
    const at2 = await repo.loadForHydrationAt(PID_H, { generation: 1, pgSeq: 2n });
    expect(at2.stateSeq).toBe(0n);
    expect(await replayNodes(at2)).toEqual(['s0', 'u1', 'u2']);
  });

  /** 恒 mediaBindingSeq<=pgSeq（§0 水位不变量——逐族断言）。 */
  function expectInvariant(s: { pgSeq: bigint | null; mediaBindingSeq: bigint | null }): void {
    expect(s.pgSeq).not.toBeNull();
    expect(s.mediaBindingSeq).not.toBeNull();
    expect(s.mediaBindingSeq! <= s.pgSeq!, `不变量 mediaBindingSeq(${s.mediaBindingSeq})<=pgSeq(${s.pgSeq})`).toBe(true);
  }
});
