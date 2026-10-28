// apps/api/src/modules/collab/canvas-doc-update.append-serialize.int.spec.ts
// Y1c T27 收尾微批 I-3'（Controller 裁定 (a) 接线）：appendBatch $transaction 首语句=per-project
// advisory xact lock（lockProject 单源——vacuumReplace 同键 T12 锚）真库行为锚。
// 红形态（修前=appendBatch 无锁先行）：外持同键 advisory 锁（racer 事务——vacuumReplace/CLI 同键
// 形态）→ appendBatch **阻塞不返回**（首语句取锁=与 flush↔reconciler 并发窗的 lifecycle inTx 写面
// 互斥——T10 删锁论据只覆盖帙行面不覆盖 lifecycleSeq MAX+1 分配面）；锁释放后正常落定。
// 选择形=锁占位断言（确定性——T22 C-3 racer 先例 c29ff6c3 的 pg_sleep/外持锁同款；真并发双
// appendBatch 形态的命中窗概率性，弃）。
// 运行：DATABASE_URL=postgresql://… pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { createHash } from 'node:crypto';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d('appendBatch 串行化（I-3\' 接线裁定——advisory 锁先行）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);
  const projectId = 'y1c-t27-append-lock-int';

  beforeAll(async () => {
    repo.setLeaseOwner('t27-lock-owner');
    await ensureProjectFixture(prisma as never, projectId);
    await ensureLeaseFixture(prisma as never, repo, 't27-lock-owner');
  });
  afterAll(async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId } });
    await restoreLeaseRow(prisma as never);
    await cleanupProjectFixture(prisma as never, projectId);
    await prisma.$disconnect();
  });

  it("红（I-3'）：racer 事务外持同键 advisory xact lock → appendBatch 阻塞不返回（首语句取锁）；释放后 ok 落定", async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId } });
    const doc = new Y.Doc(); doc.getMap('nodes').set('lock-a', 1);
    const payload = Y.encodeStateAsUpdate(doc);
    const row = CanvasDocUpdateRepository.singleFrameRow({
      generation: 0, walSeq: 910n, frameHash: createHash('sha256').update(payload).digest(), update: payload,
    });
    // racer：持同键 advisory xact lock（vacuumReplace lockProject 同语句——hashtext(projectId) 单源），
    // 主测试释放闸门后才提交（xact 域自动放锁）。
    let racerLockTaken!: () => void;
    let releaseRacer!: () => void;
    const lockTaken = new Promise<void>((r) => { racerLockTaken = r; });
    const racer = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId})::bigint)`;
      racerLockTaken();
      await new Promise<void>((r) => { releaseRacer = r; });   // 持锁等待（8s 事务上界内）
    }, { timeout: 8_000 });
    await lockTaken;   // 锁已占位（确定性——racer 事务已执行取锁语句）

    let settled = false;
    const appendP = repo.appendBatch(projectId, [row]).then((r) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 600));
    // ★ 红=修前 appendBatch 无锁先行——racer 持锁期间即返回（settled=true）；修后=首语句取锁阻塞
    expect(settled, 'appendBatch 应阻塞在 per-project advisory lock（I-3\' 首语句取锁——修前直落=红）').toBe(false);
    releaseRacer!();
    await racer;
    const r = await appendP;
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toBe(1);
  }, 15_000);
});
