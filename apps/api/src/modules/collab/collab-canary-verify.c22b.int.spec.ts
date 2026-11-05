// apps/api/src/modules/collab/collab-canary-verify.c22b.int.spec.ts
// C2-2b（plan Task C2-2 比对侧——生产就绪收尾批 C2 卡 replay-canary 第四任务·红先行）：canary
// worker verify 面（readAt 重放→hash 主判→**语义摘要深比兜底**〔C2-2b P1 修复——Yjs delete 不进
// SV，SV 互支=同代辅助非等价判据〕→compare-and-delete+TTL 续租）真 PG int 池。
//  ★红⑥-a：「同逻辑状态不同 integration order」构造（两 doc 同内容不同更新序→hash 可能不等）
//    →语义兜底绿不 freeze；红⑥-b：注入删行/改 payload→语义不等→双比红+Sentry（captureCollabException）
//    +OpsGate FROZEN（freeze 实弹——CANARY_FREEZE_ENABLED 生产默认 true）+解冻 ack 演练
//    （unfreezeOpsGateCompact+AuditLog 断言）。
//  ★红⑦：捕获后新帧涌入不误报（pin 坐标锚定 pgSeqAt——后续帧不在重放面）+维护/擦除窗 skip
//    +hashVersion 演进不误报（pin hashVersion≠当前版→skip-stale-pin 档非 mismatch）。
//  骑手 P1（C2-2a 双评审移交·freeze 实弹前置）：vacuumReplace pin 探测位次竞态——gate 检查与
//  pin 探测之间补 CanvasDoc FOR UPDATE（镜像 compact ③ doc 行锁——锁序 advisory→gate→doc 无环）：
//  T1 捕获持 FOR SHARE→T2 vacuum 在 doc 行锁处阻塞（非 upsert 处）→T1 INSERT pin 提交→T2 解锁后
//  defer 非整删（canary 侧零改动：canary 先提交→vacuum 见 pin defer；vacuum 先持锁→canary 阻塞至
//  换代提交→漂移守卫按新 generation 拒）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabCanaryVerifyWorker, svMutuallySupported } from './collab-canary-verify.worker';
import { unfreezeOpsGateCompact } from './collab-ops-gate.service';
import { CANARY_HASH_VERSION, encodeCanonicalUpdate } from './collab-replay-canary.service';
import { semanticDocDigest } from './collab-canary-semantic';
import { collabCanaryCheckedTotal, collabCanaryFreezeTotal } from './collab-canary.metrics';
import { seedRow } from '../../test-utils/canvas-doc-row';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';

vi.mock('../../utils/sentry-scrub', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../utils/sentry-scrub')>();
  return { ...orig, captureCollabException: vi.fn(orig.captureCollabException) };
});
import { captureCollabException } from '../../utils/sentry-scrub';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

const PID = `int-c22b-verify-${Date.now()}`;
const gen = 1;   // fixture 代（c22a seedFrames 同款——懒建档形态 gen=1）

/** 节点相异载荷（c22a frameOf 同款——同字节帧被去重/幂等吞的失真根除）。 */
const frameOf = (key: string, n: number) => {
  const d = new Y.Doc();
  const node = new Y.Map(); const data = new Y.Map();
  data.set('model', `m-${n}`);
  node.set('type', 'textInput'); node.set('data', data);
  (d.getMap('nodes') as Y.Map<unknown>).set(key, node);
  return Y.encodeStateAsUpdate(d);
};
/** actor 单写者播种链（c22a 同款）：头行 raw INSERT+逐帧 appendBatch+水位 CAS 链。 */
async function seedFrames(prisma: PrismaClient, repo: CanvasDocUpdateRepository, pid: string, frames: Uint8Array[], startPg: bigint): Promise<bigint> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "updatedAt") VALUES ($1, 1, 3, now()) ON CONFLICT DO NOTHING`,
    pid,
  );
  let pg = startPg;
  for (let i = 0; i < frames.length; i++) {
    const seq = pg + 1n;
    const r = await repo.appendBatch(pid, [seedRow(frames[i], seq)], { expectedPgSeq: pg, newPgSeq: seq, walCheckpointSeq: seq });
    expect(r.ok).toBe(true);
    pg = seq;
  }
  return pg;
}

/** 手工落 READY pin（坐标+hash+语义摘要——捕获协议五步的等值压缩形态；c22a 手工 pin 先例；
 *  摘要=捕获④ 增算面〔迁移笔三列〕——extra.semanticDigest===null 显式落空=超限降级档构造缝）。 */
async function insertReadyPin(
  prisma: PrismaClient,
  pid: string,
  coords: { snapshotRev: bigint; stateSeq: bigint; pgSeqAt: bigint },
  doc: Y.Doc,
  extra: { hashVersion?: number; hashSkipped?: boolean; contentHash?: string | null; semanticDigest?: string | null } = {},
): Promise<void> {
  const hash = extra.contentHash !== undefined ? extra.contentHash : createHash('sha256').update(encodeCanonicalUpdate(doc)!).digest('hex');
  const digest = extra.semanticDigest !== undefined ? extra.semanticDigest : semanticDocDigest(doc);
  await prisma.$executeRaw`
    INSERT INTO "CanaryPin" ("projectId", status, generation, "snapshotRev", "stateSeq", "pgSeqAt", "contentHash", "semanticDigest", "hashSkipped", "hashVersion", "stateVector", "leaseUntil", "expiresAt")
    VALUES (${pid}::text, 'READY', ${gen}::int, ${coords.snapshotRev}::bigint, ${coords.stateSeq}::bigint, ${coords.pgSeqAt}::bigint,
      ${hash}::char(64), ${digest}::char(64), ${extra.hashSkipped ?? false}::boolean, ${extra.hashVersion ?? CANARY_HASH_VERSION}::int, ${Buffer.from(Y.encodeStateVector(doc))},
      now() + interval '15 minutes', now() + interval '15 minutes')`;
}

/** 帧重放 doc（验证基准态构造——seedFrames 帧集等价重放）。 */
function replayFrames(frames: Uint8Array[]): Y.Doc {
  const d = new Y.Doc();
  for (const f of frames) Y.applyUpdate(d, f);
  return d;
}

/** 计数器快照（prom-client v15 get() 异步且**忽略 label 过滤返回全族序列**——客户端按 labels 过滤
 *  再求和，序列缺席折 0；before/after 差分断言面）。 */
const counterOf = async (
  c: { get: (l: Record<string, string>) => Promise<unknown> },
  labels: Record<string, string>,
): Promise<number> => {
  const family = ((await c.get(labels)) as { values?: Array<{ value: number; labels: Record<string, string> }> } | undefined)?.values ?? [];
  return family
    .filter((v) => Object.entries(labels).every(([k, x]) => v.labels[k] === x))
    .reduce((a, v) => a + v.value, 0);
};

maybe('C2-2b canary 比对面（真 PG——骑手P1+红⑥⑦+verify 管线）', () => {
  const prisma = new PrismaClient();
  const prismaB = new PrismaClient();   // 骑手P1 双实例交错夹具（c21 红③-c 同族）
  const repo = new CanvasDocUpdateRepository(prisma as never);

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID);
    await ensureLeaseFixture(prisma, repo, 'c22b-owner');
  });
  beforeEach(async () => {
    await prisma.canaryPin.deleteMany({ where: {} });
    await prisma.collabCanaryCursor.deleteMany({ where: {} });
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    await prisma.$executeRaw`UPDATE "CollabOpsGate" SET "state" = 'OPEN', "frozenAt" = NULL, "frozenBy" = NULL, "reason" = NULL, "unfrozenAt" = NULL WHERE "gate" = 'compact' AND "projectId" = ${PID}::text`;
  });
  afterAll(async () => {
    await cleanupProjectFixture(prisma, PID);
    await restoreLeaseRow(prisma);
    await prisma.$disconnect();
    await prismaB.$disconnect();
  });

  // ═══ 骑手 P1：vacuumReplace pin 探测位次竞态（freeze 实弹前置） ═══

  it('骑手P1 T1 捕获事务持 CanvasDoc FOR SHARE 未提交 ⇒ T2 vacuum 在 doc 行锁处阻塞（非 upsert 处）；T1 插 pin 提交后 T2 defer 非整删', async () => {
    const pg = await seedFrames(prisma, repo, PID, [frameOf('r1', 1), frameOf('r2', 2)], 0n);
    const rows = await prisma.canvasDocUpdate.findMany({ where: { projectId: PID }, orderBy: { seq: 'asc' } });
    const doc = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID } });

    let releaseT1!: () => void;
    const holdT1 = new Promise<void>((r) => (releaseT1 = r));
    // T1：捕获协议 ① 同位面——CanvasDoc FOR SHARE 短事务持锁未提交（④⑤ 未完成=pin 未插窗）
    const t1 = prismaB.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT generation, "pgSeq", "currentSnapshotRev" FROM "CanvasDoc" WHERE "projectId" = ${PID}::text FOR SHARE`;
      await holdT1;
      // 临界区尾部：INSERT pin（③ pin-first）——T2 若已过 pin 探测位即失锚（修前形态）
      await tx.$executeRaw`
        INSERT INTO "CanaryPin" ("projectId", status, generation, "snapshotRev", "stateSeq", "pgSeqAt", "hashVersion", "leaseUntil", "expiresAt")
        VALUES (${PID}::text, 'READY', ${gen}::int, 0::bigint, 0::bigint, ${pg}::bigint, ${CANARY_HASH_VERSION}::int, now() + interval '15 minutes', now() + interval '15 minutes')`;
      return 'committed' as const;
    }, { timeout: 15_000, maxWait: 5_000 });
    await new Promise((r) => setTimeout(r, 300));   // T1 取得 FOR SHARE

    // T2：vacuumReplace——修后在 gate 检查与 pin 探测之间的 CanvasDoc FOR UPDATE 处阻塞（修前在
    // doc upsert 处阻塞=pin 探测已过→提交后整删增量行→pin 坐标失锚）
    let t2ResolvedAt = 0;
    const t2 = repo.vacuumReplace(PID, Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())), rows.length, doc.generation)
      .then((r) => { t2ResolvedAt = Date.now(); return r; });
    await new Promise((r) => setTimeout(r, 400));
    expect(t2ResolvedAt, 'T1 FOR SHARE 持有期 T2 阻塞（行锁互斥）').toBe(0);

    releaseT1();
    const [ra, rb] = await Promise.all([t1, t2]);
    expect(ra).toBe('committed');
    // T2 解锁后见 pin → defer 本轮（红断言面：修前=照常换代整删行）
    expect(rb).toEqual({ aborted: 'canary-pin-active' });
    expect((await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID } })).generation).toBe(doc.generation);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(Number(pg));
  });

  // ═══ verify 管线主体：readAt 重放→hash 主判→语义摘要深比（SV 同代辅助）→compare-and-delete+TTL 续租 ═══

  /** worker 直构+verifyScope 隔离缝。 */
  const buildWorker = () => {
    const w = new CollabCanaryVerifyWorker(prisma as never, repo);
    w.verifyScope = [PID];
    return w;
  };
  const gateRow = async () => prisma.collabOpsGate.findUniqueOrThrow({ where: { gate_projectId: { gate: 'compact', projectId: PID } } });
  const pinRow = async () => prisma.canaryPin.findUnique({ where: { projectId: PID } });

  it('verify 主路径：pin 坐标重放 hash 相等→ok+pin compare-and-delete+gate OPEN（零 freeze）', async () => {
    const frames = [frameOf('v1', 1), frameOf('v2', 2)];
    const pg = await seedFrames(prisma, repo, PID, frames, 0n);
    await insertReadyPin(prisma, PID, { snapshotRev: 0n, stateSeq: 0n, pgSeqAt: pg }, replayFrames(frames));
    const okBefore = await counterOf(collabCanaryCheckedTotal, { result: 'ok' });
    await buildWorker().tick();
    expect(await counterOf(collabCanaryCheckedTotal, { result: 'ok' })).toBeGreaterThan(okBefore);
    expect(await pinRow(), 'pin 使命完成 compare-and-delete').toBeNull();
    expect((await gateRow()).state).toBe('OPEN');   // 无 mismatch 零 freeze
  });

  it('红⑥-a 同逻辑状态不同 integration order→语义兜底绿不 freeze：①同帧集换序捕获=hash 主判 ok；②hash 红而语义摘要相等=hash-encoding-mismatch 计数不 freeze', async () => {
    const frames = [frameOf('a1', 1), frameOf('a2', 2)];
    const pg = await seedFrames(prisma, repo, PID, frames, 0n);
    // ①同帧集反序构造 doc（Yjs 确定性——同 op 集同编码：unit spec 红⑥-a-① 直证 hash 恒等）
    const reversed = replayFrames([frames[1]!, frames[0]!]);
    await insertReadyPin(prisma, PID, { snapshotRev: 0n, stateSeq: 0n, pgSeqAt: pg }, reversed);
    const okBefore = await counterOf(collabCanaryCheckedTotal, { result: 'ok' });
    await buildWorker().tick();
    expect(await counterOf(collabCanaryCheckedTotal, { result: 'ok' })).toBe(okBefore + 1);
    expect(await pinRow()).toBeNull();
    expect((await gateRow()).state).toBe('OPEN');
    // ②hash 红而语义摘要相等（contentHash=异值〔同逻辑态不同编码形态的等价注入——nodes/edges
    //    canonical JSON 摘要同源〕）：语义兜底=摘要深比语义等→hash-encoding-mismatch 计数不
    //    freeze（charter 语义兜底口径；SV 互支在此构造亦成立=同代辅助同向证据）
    const f3 = frameOf('a3', 3);   // 同字节帧单源（frameOf 每调新建 Y.Doc=随机 client——两调即异 client 假 mismatch）
    await seedFrames(prisma, repo, PID, [f3], pg);
    const frames2 = [...frames, f3];
    const mismatchHash = createHash('sha256').update(Buffer.from('different-encoding-same-opset')).digest('hex');
    await insertReadyPin(prisma, PID, { snapshotRev: 0n, stateSeq: 0n, pgSeqAt: pg + 1n }, replayFrames(frames2), { contentHash: mismatchHash });
    const encBefore = await counterOf(collabCanaryCheckedTotal, { result: 'hash-encoding-mismatch' });
    await buildWorker().tick();
    expect(await counterOf(collabCanaryCheckedTotal, { result: 'hash-encoding-mismatch' })).toBe(encBefore + 1);
    expect(await pinRow()).toBeNull();
    expect((await gateRow()).state).toBe('OPEN');   // 语义等不 freeze
  });

  it('红⑥-b-删行：保护区间行被删→重放缺 op（建节点帧=携带 struct——摘要/SV 双红）→mismatch 双比红+OpsGate FROZEN（freeze 实弹）+Sentry+解冻 ack 演练（AuditLog）', async () => {
    const frames = [frameOf('b1', 1), frameOf('b2', 2), frameOf('b3', 3)];
    const pg = await seedFrames(prisma, repo, PID, frames, 0n);
    await insertReadyPin(prisma, PID, { snapshotRev: 0n, stateSeq: 0n, pgSeqAt: pg }, replayFrames(frames));
    // 注入：删 seq=3 行（保护区间数据丢失形态）
    await prisma.$executeRaw`DELETE FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text AND seq = 3::bigint`;
    const sentrySpy = vi.mocked(captureCollabException);
    sentrySpy.mockClear();
    const mismatchBefore = await counterOf(collabCanaryCheckedTotal, { result: 'mismatch' });
    const freezeBefore = await counterOf(collabCanaryFreezeTotal, { reason: 'semantic-mismatch' });
    await buildWorker().tick();
    // 双比红：hash 主判红（重放缺帧）+语义摘要不等（节点缺失）→mismatch
    expect(await counterOf(collabCanaryCheckedTotal, { result: 'mismatch' })).toBe(mismatchBefore + 1);
    expect(await counterOf(collabCanaryFreezeTotal, { reason: 'semantic-mismatch' })).toBe(freezeBefore + 1);
    expect(sentrySpy).toHaveBeenCalledTimes(1);   // 即时 captureCollabException（mismatch 面）
    expect(sentrySpy.mock.calls[0]![1]).toMatchObject({ reason: 'canary-replay-mismatch' });
    // freeze 实弹：OpsGate 项目行 FROZEN+version+1
    const gate = await gateRow();
    expect(gate.state).toBe('FROZEN');
    expect(gate.frozenBy).toBe('canary-verify');
    expect(gate.version).toBeGreaterThan(0n);
    expect(await pinRow()).toBeNull();   // mismatch 档 pin 亦 compare-and-delete（freeze 先于 delete）
    // 解冻 ack 演练：unfreezeOpsGateCompact+AuditLog 同事务落痕
    const auditBefore = await prisma.auditLog.count({ where: { targetType: 'PROJECT', targetId: PID, action: 'collab_ops_gate_unfreeze' } });
    const ack = await prisma.$transaction((tx) => unfreezeOpsGateCompact(tx, {
      projectId: PID, operatorId: 'c22b-op', operatorName: 'C2-2b 演练', remark: '红⑥-b 解冻 ack 演练',
    }));
    expect(ack.unfrozen).toBe(true);
    expect((await gateRow()).state).toBe('OPEN');
    expect(await prisma.auditLog.count({ where: { targetType: 'PROJECT', targetId: PID, action: 'collab_ops_gate_unfreeze' } })).toBe(auditBefore + 1);
  });

  it('红⑥-b-delete-only（评审 P1 反例）：纯删除帧行被删——Yjs delete 不进 SV（SV 互支成立）而节点复活=语义不等→摘要深比 mismatch+freeze+Sentry（非 encoding-mismatch）', async () => {
    // 构造：f1 建节点 k1；f2 纯删除帧（deleteSet 无新 struct——SV 不前进，用户删节点即此形态）
    const d1 = new Y.Doc();
    {
      const node = new Y.Map(); const data = new Y.Map();
      data.set('model', 'm-del'); node.set('type', 'textInput'); node.set('data', data);
      d1.getMap('nodes').set('k1', node);
    }
    const f1 = Y.encodeStateAsUpdate(d1);
    const d2 = new Y.Doc();
    Y.applyUpdate(d2, f1);
    d2.getMap('nodes').delete('k1');
    const f2 = Y.encodeStateAsUpdate(d2);
    const capDoc = replayFrames([f1, f2]);   // 捕获侧等值：k1 已删（nodes 空）
    expect(capDoc.getMap('nodes').size).toBe(0);
    const pg = await seedFrames(prisma, repo, PID, [f1, f2], 0n);
    await insertReadyPin(prisma, PID, { snapshotRev: 0n, stateSeq: 0n, pgSeqAt: pg }, capDoc);
    // 反例断言面（判据边界直证）：重放侧（f2 帧丢失）SV 互支**成立**而语义摘要**不等**——
    //   SV 互支等价判据在此形态漏报（P1 根因）；摘要深比（nodes+edges canonical JSON）正确判语义不等
    const lostDoc = replayFrames([f1]);
    expect(lostDoc.getMap('nodes').size).toBe(1);   // k1 复活
    expect(svMutuallySupported(Buffer.from(Y.encodeStateVector(capDoc)), lostDoc)).toBe(true);
    expect(semanticDocDigest(capDoc)).not.toBe(semanticDocDigest(lostDoc));
    // 注入：删 f2 行（保护区间纯删除帧——prune bug 误删形态）
    await prisma.$executeRaw`DELETE FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text AND seq = 2::bigint`;
    const sentrySpy = vi.mocked(captureCollabException);
    sentrySpy.mockClear();
    const mismatchBefore = await counterOf(collabCanaryCheckedTotal, { result: 'mismatch' });
    const encBefore = await counterOf(collabCanaryCheckedTotal, { result: 'hash-encoding-mismatch' });
    const freezeBefore = await counterOf(collabCanaryFreezeTotal, { reason: 'semantic-mismatch' });
    await buildWorker().tick();
    // 红（现实现）：SV 互支成立→误归 hash-encoding-mismatch 只计数不 freeze；绿（修后）：摘要深比→mismatch
    expect(await counterOf(collabCanaryCheckedTotal, { result: 'mismatch' })).toBe(mismatchBefore + 1);
    expect(await counterOf(collabCanaryCheckedTotal, { result: 'hash-encoding-mismatch' })).toBe(encBefore);   // 非 encoding 档
    expect(await counterOf(collabCanaryFreezeTotal, { reason: 'semantic-mismatch' })).toBe(freezeBefore + 1);
    expect((await gateRow()).state).toBe('FROZEN');
    expect(sentrySpy).toHaveBeenCalledTimes(1);
    expect(sentrySpy.mock.calls[0]![1]).toMatchObject({ reason: 'canary-replay-mismatch' });
    // 解冻复位（后续用例布景）
    await prisma.$executeRaw`UPDATE "CollabOpsGate" SET "state" = 'OPEN', "frozenAt" = NULL, "frozenBy" = NULL, "reason" = NULL, "unfrozenAt" = NULL WHERE "gate" = 'compact' AND "projectId" = ${PID}::text`;
  });

  it('语义兜底-降级档：pin.semanticDigest 空（超限捕获未落摘要/存量 pin）→SV 同代辅助承载（互支成立=hash-encoding-mismatch 不 freeze——登记盲区）', async () => {
    const frames = [frameOf('g1', 1), frameOf('g2', 2)];
    const pg = await seedFrames(prisma, repo, PID, frames, 0n);
    // 摘要显式落空+异值 hash（同 op 集不同编码形态注入）——SV 互支成立（同帧集）
    await insertReadyPin(prisma, PID, { snapshotRev: 0n, stateSeq: 0n, pgSeqAt: pg }, replayFrames([frames[1]!, frames[0]!]), {
      contentHash: createHash('sha256').update(Buffer.from('other-encoding-same-opset')).digest('hex'),
      semanticDigest: null,
    });
    const encBefore = await counterOf(collabCanaryCheckedTotal, { result: 'hash-encoding-mismatch' });
    await buildWorker().tick();
    expect(await counterOf(collabCanaryCheckedTotal, { result: 'hash-encoding-mismatch' })).toBe(encBefore + 1);
    expect((await gateRow()).state).toBe('OPEN');   // 降级档不误冻结
  });

  it('红⑥-b-改 payload：增量行 payload 换帧（携异 client clock）→SV 互支失败→mismatch+freeze（shadow 档对照=只告警不 freeze）', async () => {
    const frames = [frameOf('c1', 1), frameOf('c2', 2)];
    const pg = await seedFrames(prisma, repo, PID, frames, 0n);
    await insertReadyPin(prisma, PID, { snapshotRev: 0n, stateSeq: 0n, pgSeqAt: pg }, replayFrames(frames));
    // 注入：seq=2 行 payload 换帧（fresh Y.Doc=新 client——重放 SV 越界）
    await prisma.$executeRaw`UPDATE "CanvasDocUpdate" SET update = ${Buffer.from(frameOf('evil', 99))} WHERE "projectId" = ${PID}::text AND seq = 2::bigint`;
    await buildWorker().tick();
    expect((await gateRow()).state).toBe('FROZEN');   // 语义不等 freeze（双比红）
    // shadow 档对照（CANARY_FREEZE_ENABLED='false' 语义=实例缝覆写）：mismatch 告警不 freeze
    await prisma.$executeRaw`UPDATE "CollabOpsGate" SET "state" = 'OPEN', "frozenAt" = NULL, "frozenBy" = NULL, "reason" = NULL, "unfrozenAt" = NULL WHERE "gate" = 'compact' AND "projectId" = ${PID}::text`;
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });   // 布景重置（CAS 链自 0 起——CanvasDoc 行同步重建防 walSeq tripwire）
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    const frames2 = [frameOf('d1', 1)];
    const pg2 = await seedFrames(prisma, repo, PID, frames2, 0n);
    await insertReadyPin(prisma, PID, { snapshotRev: 0n, stateSeq: 0n, pgSeqAt: pg2 }, replayFrames([frameOf('x1', 1), frameOf('x2', 2)]));
    const shadow = buildWorker();
    shadow.freezeEnabled = false;
    const shadowBefore = await counterOf(collabCanaryFreezeTotal, { reason: 'freeze-suppressed' });
    await shadow.tick();
    expect(await counterOf(collabCanaryFreezeTotal, { reason: 'freeze-suppressed' })).toBe(shadowBefore + 1);
    expect((await gateRow()).state).toBe('OPEN');   // shadow=只告警+计数不 freeze
  });

  // ═══ 红⑦：捕获后新帧涌入锚定+维护/擦除窗 skip+hashVersion 演进 ═══

  it('红⑦-新帧涌入：捕获后新帧 pgSeqAt>坐标不入重放面→ok 不误报（pin 坐标锚定）', async () => {
    const frames = [frameOf('n1', 1), frameOf('n2', 2)];
    const pg = await seedFrames(prisma, repo, PID, frames, 0n);
    await insertReadyPin(prisma, PID, { snapshotRev: 0n, stateSeq: 0n, pgSeqAt: pg }, replayFrames(frames));
    // 捕获后新帧涌入（坐标外）
    await seedFrames(prisma, repo, PID, [frameOf('n3', 3), frameOf('n4', 4)], pg);
    const okBefore = await counterOf(collabCanaryCheckedTotal, { result: 'ok' });
    await buildWorker().tick();
    expect(await counterOf(collabCanaryCheckedTotal, { result: 'ok' })).toBe(okBefore + 1);   // 重放面≤pgSeqAt=2——新帧不进比对
    expect((await gateRow()).state).toBe('OPEN');
  });

  it('红⑦-维护窗：maintenanceId 在→skip-maintenance 保 pin 重试；解除后照常 ok', async () => {
    const frames = [frameOf('m1', 1)];
    const pg = await seedFrames(prisma, repo, PID, frames, 0n);
    await insertReadyPin(prisma, PID, { snapshotRev: 0n, stateSeq: 0n, pgSeqAt: pg }, replayFrames(frames));
    await prisma.$executeRaw`UPDATE "CanvasDoc" SET "maintenanceId" = 'mt-c22b' WHERE "projectId" = ${PID}::text`;
    const skipBefore = await counterOf(collabCanaryCheckedTotal, { result: 'skip-maintenance' });
    await buildWorker().tick();
    expect(await counterOf(collabCanaryCheckedTotal, { result: 'skip-maintenance' })).toBe(skipBefore + 1);
    expect(await pinRow(), '维护窗 pin 保（重试）').not.toBeNull();
    expect((await gateRow()).state).toBe('OPEN');
    // 解除后照常 ok+pin 删
    await prisma.$executeRaw`UPDATE "CanvasDoc" SET "maintenanceId" = NULL WHERE "projectId" = ${PID}::text`;
    await buildWorker().tick();
    expect(await pinRow()).toBeNull();
  });

  it('红⑦-擦除窗：lifecycleState 非 ACTIVE→skip-lifecycle 保 pin；hashVersion 演进→skip-stale-pin 删 pin 非 mismatch；换代→skip-generation+cursor generation 重置', async () => {
    const frames = [frameOf('e1', 1)];
    const pg = await seedFrames(prisma, repo, PID, frames, 0n);
    // 擦除窗
    await insertReadyPin(prisma, PID, { snapshotRev: 0n, stateSeq: 0n, pgSeqAt: pg }, replayFrames(frames));
    await prisma.$executeRaw`UPDATE "CanvasProject" SET "lifecycleState" = 'DELETING' WHERE "id" = ${PID}::text`;
    const lcBefore = await counterOf(collabCanaryCheckedTotal, { result: 'skip-lifecycle' });
    await buildWorker().tick();
    expect(await counterOf(collabCanaryCheckedTotal, { result: 'skip-lifecycle' })).toBe(lcBefore + 1);
    expect(await pinRow()).not.toBeNull();
    await prisma.$executeRaw`UPDATE "CanvasProject" SET "lifecycleState" = 'ACTIVE' WHERE "id" = ${PID}::text`;
    // hashVersion 演进（旧版 hash 口径不可比——skip 非 mismatch）
    await prisma.$executeRaw`UPDATE "CanaryPin" SET "hashVersion" = 99 WHERE "projectId" = ${PID}::text`;
    const staleBefore = await counterOf(collabCanaryCheckedTotal, { result: 'skip-stale-pin' });
    await buildWorker().tick();
    expect(await counterOf(collabCanaryCheckedTotal, { result: 'skip-stale-pin' })).toBe(staleBefore + 1);
    expect(await pinRow(), 'stale pin 删（重捕新版）').toBeNull();
    expect((await gateRow()).state).toBe('OPEN');   // 不误报 mismatch
    // 换代：doc generation=2（vacuum 形态）→skip-generation+cursor generation 重置
    await insertReadyPin(prisma, PID, { snapshotRev: 0n, stateSeq: 0n, pgSeqAt: pg }, replayFrames(frames));
    await prisma.$executeRaw`UPDATE "CanvasDoc" SET generation = 2 WHERE "projectId" = ${PID}::text`;
    const gBefore = await counterOf(collabCanaryCheckedTotal, { result: 'skip-generation' });
    await buildWorker().tick();
    expect(await counterOf(collabCanaryCheckedTotal, { result: 'skip-generation' })).toBe(gBefore + 1);
    expect(await pinRow()).toBeNull();
    const cursor = await prisma.collabCanaryCursor.findUnique({ where: { projectId: PID } });
    expect(cursor).toMatchObject({ projectId: PID, generation: 2, lastResult: 'skip-generation' });   // 游标换代重置
    await prisma.$executeRaw`UPDATE "CanvasDoc" SET generation = ${gen}::int WHERE "projectId" = ${PID}::text`;
  });

  it('TTL 续租：verify tick 前批 leaseUntil 延（维护窗 skip 档 pin 保——lease 断言面）', async () => {
    const frames = [frameOf('t1', 1)];
    const pg = await seedFrames(prisma, repo, PID, frames, 0n);
    await insertReadyPin(prisma, PID, { snapshotRev: 0n, stateSeq: 0n, pgSeqAt: pg }, replayFrames(frames));
    await prisma.$executeRaw`UPDATE "CanaryPin" SET "leaseUntil" = now() WHERE "projectId" = ${PID}::text`;
    await prisma.$executeRaw`UPDATE "CanvasDoc" SET "maintenanceId" = 'mt-lease' WHERE "projectId" = ${PID}::text`;   // skip 档=pin 保（续租后可断言）
    await buildWorker().tick();
    const lease = await prisma.$queryRaw<{ s: number }[]>`
      SELECT EXTRACT(EPOCH FROM ("leaseUntil" - now()))::float8 AS s FROM "CanaryPin" WHERE "projectId" = ${PID}::text`;
    expect(lease[0]!.s).toBeGreaterThan(13 * 60);   // 原值 now()（≈0s）→续租后 ≥13min（TTL 15min−观测窗）
    await prisma.$executeRaw`UPDATE "CanvasDoc" SET "maintenanceId" = NULL WHERE "projectId" = ${PID}::text`;
  });
});
