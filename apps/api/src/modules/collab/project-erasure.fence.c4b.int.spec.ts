// apps/api/src/modules/collab/project-erasure.fence.c4b.int.spec.ts
// C4-b（plan Task C4-2 ★红⑨ a-d——生产就绪收尾批·project-erasure）：fence 三态（真 PG+**双真
// PrismaClient 连接交错**——a 档双连接形态）。断言面：
//  a) 写事务持 FOR SHARE（fenceProject）→ 并发 tombstone UPDATE **等待**（行锁互斥——不丢序）→
//     写提交 → tombstone 才落 → 该写事务落定的业务行随 scope 批删（DRAINING 批删面模拟）→ 零行
//     （写者在 fence 门内=合法先行写；批删后零残留）；
//  b) tombstone 先 → 写事务 FOR SHARE 见 DELETING → ProjectErasingError 拒（零业务行写入）；
//  c) **fence 自锁根修实证**：同一条 scrub/detach 形 UPDATE——ErasureContext（withErasure）内成功、
//     app ctx（无包裹）被拒（worker=唯一合法 DELETING 写者）；
//  d) RR 写事务同样被 FOR SHARE 挡（隔离级别不豁免行锁）；负控：plain SELECT 版（无行锁）穿——
//     tombstone 在 RR 读者事务开窗内落定（正确性由行锁承担、非快照隔离的证明形态）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { ErasureContextService, fenceProject, lockProject, ProjectErasingError } from './project-lock';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

maybe('C4-b ★红⑨ fence 三态（真 PG·双真连接交错）', () => {
  const writer = new PrismaClient();     // 写者连接（append/admit 形事务）
  const eraser = new PrismaClient();     // tombstone/DRAINING 连接（请求事务/worker 形）
  const owner = `c4b9-owner-${Date.now().toString(36)}`;
  const teamId = `c4b9-team-${Date.now().toString(36)}`;
  let seq = 0;
  const mkProject = async (): Promise<string> => {
    const pid = `${teamId}-p${seq++}`;
    await eraser.canvasProject.create({ data: { id: pid, name: pid, teamId, userId: owner } });
    return pid;
  };

  beforeAll(async () => {
    await eraser.user.upsert({
      where: { id: owner }, update: {},
      create: { id: owner, name: owner, email: `${owner}@local.test`, emailVerified: true },
    });
    await eraser.team.create({ data: { id: teamId, name: 'c4b9-team', ownerId: owner } });
    await eraser.teamMember.create({ data: { teamId, userId: owner, role: 'OWNER' } });
  });

  afterAll(async () => {
    await eraser.projectErasureRun.deleteMany({ where: { scopeId: teamId } }).catch(() => undefined);
    await eraser.media.deleteMany({ where: { teamId } }).catch(() => undefined);
    await eraser.canvasProject.deleteMany({ where: { teamId } }).catch(() => undefined);
    await eraser.teamMember.deleteMany({ where: { teamId } }).catch(() => undefined);
    await eraser.team.deleteMany({ where: { id: teamId } }).catch(() => undefined);
    await eraser.user.deleteMany({ where: { id: owner } }).catch(() => undefined);
    await Promise.all([writer.$disconnect(), eraser.$disconnect()]);
  }, 20_000);

  it('⑨a 写事务持 FOR SHARE → tombstone UPDATE 等待 → 写提交 → tombstone 落 → scope 批删零行', async () => {
    const pid = await mkProject();
    // 写者事务（admit/append 形）：advisory→FOR SHARE fence（ACTIVE 放行）→业务行写入（未提交）
    let writerResolve: () => void;
    const writerGate = new Promise<void>((r) => { writerResolve = r; });
    const writerTx = writer.$transaction(async (tx) => {
      await lockProject(tx as never, pid);
      await fenceProject(tx as never, pid);   // ACTIVE → 放行+持 CanvasProject 行 FOR SHARE
      await tx.media.create({ data: { id: `${pid}-m`, userId: owner, teamId, projectId: pid, bucket: 'flowai', key: `${pid}/a.bin`, originalName: 'a', mimeType: 'application/octet-stream', size: 1n, type: 'generated' } });
      await writerGate;   // 双连接交错锚：写者持锁窗口
      return 'committed';
    }, { timeout: 8_000 }).catch((e: unknown) => `failed:${(e as Error).message}`);

    // tombstone UPDATE（eraser 连接）在写者持 FOR SHARE 期间发起 → 必须等待（行锁互斥）
    await new Promise((r) => setTimeout(r, 150));   // 写者先到（fence 已执行）——交错序锚
    let tombstoneDone = false;
    const tombstone = eraser.$transaction(async (tx) => {
      await tx.canvasProject.update({ where: { id: pid }, data: { lifecycleState: 'DELETING' } });
      tombstoneDone = true;
    }, { timeout: 8_000 }).catch((e: unknown) => `failed:${(e as Error).message}`);

    await new Promise((r) => setTimeout(r, 400));
    expect(tombstoneDone).toBe(false);   // 等待中（FOR SHARE 持有者未提交——红⑨a 序直证）

    writerResolve!();   // 写者提交（业务行落定）
    expect(await writerTx).toBe('committed');
    await tombstone;   // tombstone 才落（写者先行序保持——零丢序）
    expect((await eraser.canvasProject.findUnique({ where: { id: pid } }))!.lifecycleState).toBe('DELETING');

    // DRAINING 批删面（worker 形——scope 批删模拟）：写者落定的业务行随批删归零
    const deleted = await eraser.media.deleteMany({ where: { projectId: pid } });
    expect(deleted.count).toBe(1);   // 写者行在册（fence 门内合法先行写）
    expect(await eraser.media.count({ where: { projectId: pid } })).toBe(0);   // 批删后零行
  }, 15_000);

  it('⑨b tombstone 先 → 写事务 FOR SHARE 见 DELETING → ProjectErasingError 拒（零业务行）', async () => {
    const pid = await mkProject();
    await eraser.canvasProject.update({ where: { id: pid }, data: { lifecycleState: 'DELETING' } });
    await expect(
      writer.$transaction(async (tx) => {
        await lockProject(tx as never, pid);
        await fenceProject(tx as never, pid);   // DELETING → 拒
        await tx.media.create({ data: { id: `${pid}-m2`, userId: owner, teamId, projectId: pid, bucket: 'flowai', key: `${pid}/b.bin`, originalName: 'b', mimeType: 'application/octet-stream', size: 1n, type: 'generated' } });
      }),
    ).rejects.toBeInstanceOf(ProjectErasingError);
    expect(await writer.media.count({ where: { projectId: pid } })).toBe(0);   // 零业务行（整事务回滚）
  });

  it('⑨c fence 自锁根修实证：同 scrub/detach UPDATE——worker ctx（withErasure）成功、app ctx 被拒', async () => {
    const pid = await mkProject();
    await eraser.canvasProject.update({ where: { id: pid }, data: { lifecycleState: 'DELETING' } });
    const detach = (tx: Prisma.TransactionClient) => tx.videoWork.updateMany({
      where: { canvasProjectId: pid }, data: { canvasProjectId: null },
    });
    // app ctx：fence 拒（同 UPDATE 形态）
    await expect(
      writer.$transaction(async (tx) => {
        await lockProject(tx as never, pid);
        await fenceProject(tx as never, pid);
        await detach(tx);
      }),
    ).rejects.toBeInstanceOf(ProjectErasingError);
    // worker ctx：豁免放行（唯一合法 DELETING 写者）
    await new ErasureContextService().withErasure('c4b9-run', () =>
      writer.$transaction(async (tx) => {
        await lockProject(tx as never, pid);
        await fenceProject(tx as never, pid);   // DELETING∧ctx → 豁免
        await detach(tx);   // scrub/detach UPDATE 成功
      }),
    );
  });

  it('⑨d RR 写事务同被 FOR SHARE 挡；负控 plain SELECT 版穿（正确性由行锁承担非快照隔离）', async () => {
    const pid = await mkProject();
    // RR + FOR SHARE：tombstone 等待（隔离级别不豁免行锁——RR 下 locking read 亦最新提交）
    let rrRelease: () => void;
    const rrGate = new Promise<void>((r) => { rrRelease = r; });
    const rrTx = writer.$transaction(async (tx) => {
      await fenceProject(tx as never, pid);
      await rrGate;
      return 'rr-committed';
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 8_000 }).catch((e: unknown) => `failed:${(e as Error).message}`);
    await new Promise((r) => setTimeout(r, 150));
    let rrTombstoneDone = false;
    const rrTombstone = eraser.canvasProject.update({ where: { id: pid }, data: { lifecycleState: 'DELETING' } })
      .then(() => { rrTombstoneDone = true; })
      .catch((e: unknown) => `failed:${(e as Error).message}`);
    await new Promise((r) => setTimeout(r, 400));
    expect(rrTombstoneDone).toBe(false);   // RR+FOR SHARE 挡住
    rrRelease!();
    expect(await rrTx).toBe('rr-committed');
    await rrTombstone;

    // 负控：RR + plain SELECT（无行锁）——tombstone 在读者事务开窗内落定（穿）
    const pid2 = await mkProject();
    let plainRelease: () => void;
    const plainGate = new Promise<void>((r) => { plainRelease = r; });
    const plainTx = writer.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "lifecycleState" FROM "CanvasProject" WHERE "id" = ${pid2}::text`;   // plain（无 FOR SHARE）
      await plainGate;
      return 'plain-committed';
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 8_000 }).catch((e: unknown) => `failed:${(e as Error).message}`);
    await new Promise((r) => setTimeout(r, 150));
    await eraser.canvasProject.update({ where: { id: pid2 }, data: { lifecycleState: 'DELETING' } });   // 不等待（穿——负控直证）
    plainRelease!();
    expect(await plainTx).toBe('plain-committed');
  }, 15_000);
});
