// apps/api/src/modules/collab/collab-canary-verify.c22b.int.spec.ts
// C2-2b（plan Task C2-2 比对侧——生产就绪收尾批 C2 卡 replay-canary 第四任务·红先行）：canary
// worker verify 面（readAt 重放→hash 主判→SV 互支语义兜底→compare-and-delete+TTL 续租）真 PG int 池。
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
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CANARY_HASH_VERSION } from './collab-replay-canary.service';
import { seedRow } from '../../test-utils/canvas-doc-row';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';

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
const modelOf = (d: Y.Doc, key: string): unknown =>
  ((d.getMap('nodes').get(key) as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('model');

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
});
