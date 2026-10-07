// Y0a-3 T3：fence 写语句真库证明（G-3b+leaseRowMissing+两出口同构+提交序倒挂）——repo 层直接
// 操纵租约行模拟 A 持锁/B 夺锁（lease service 获取路径语义归 collab-lease.service.spec mock 层）。
// 倒挂用例判别性设计：手工低 seq 行的内容与 compact 进快照的内容**不同**（快照含 base 标记、
// 低 seq 行含 inverted 标记）——水位过滤旧实现（cursor=stateSeq）会把低 seq 行永久跳过=断言红。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import {
  ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow,
} from '../../test-utils/db-fixtures';

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d('fence 下沉真库（G-3b+SV3 倒挂）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);
  const projectId = 'y0a3-fence-int';

  beforeAll(async () => { await ensureProjectFixture(prisma as any, projectId); });
  afterAll(async () => {
    await restoreLeaseRow(prisma as any);   // V23：复原全局租约行（防残留 fixture 挡 dev API 下一次获取）
    await cleanupProjectFixture(prisma as any, projectId);
    await prisma.$disconnect();
  });

  it('A 持锁 append ok → B 夺锁（行 UPDATE owner=B）→ A append={ok:false,fenced}（写语句级，非内存布尔）', async () => {
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId } });
    await ensureLeaseFixture(prisma as any, repo, 'owner-A');
    const r1 = await repo.append(projectId, Y.encodeStateAsUpdate(new Y.Doc()));
    expect(r1.ok).toBe(true);
    await prisma.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = 'owner-B', "expiresAt" = now() + interval '1 hour' WHERE scope = 'primary'`);
    const r2 = await repo.append(projectId, Y.encodeStateAsUpdate(new Y.Doc()));
    expect(r2).toEqual({ ok: false, reason: 'fenced' });
  });

  it('A 的 compact 在 B 持锁期不删行（{compacted:false,reason:"not-owner"}+CanvasDocUpdate 行数不减）', async () => {
    await ensureLeaseFixture(prisma as any, repo, 'owner-A');
    await repo.append(projectId, Y.encodeStateAsUpdate(new Y.Doc()));
    const before = await prisma.canvasDocUpdate.count({ where: { projectId } });
    await prisma.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = 'owner-B', "expiresAt" = now() + interval '1 hour' WHERE scope = 'primary'`);
    const r = await repo.compact(projectId);
    expect(r).toEqual({ compacted: false, reason: 'not-owner' });
    expect(await prisma.canvasDocUpdate.count({ where: { projectId } })).toBe(before);
  });

  it('租约行缺失：append throws leaseRowMissing（配置错误不伪装 fenced）——finally 复原（V31：中途失败不毒化本地 verify 链）', async () => {
    repo.setLeaseOwner('owner-A');
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "CollabLease" WHERE scope = 'primary'`);
      await expect(repo.append(projectId, new Uint8Array([1]))).rejects.toMatchObject({ leaseRowMissing: true });
    } finally {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "CollabLease" (scope, owner, epoch, "expiresAt") VALUES ('primary', NULL, 0, NULL)
         ON CONFLICT (scope) DO NOTHING`,
      );
    }
  });

  it('readSnapshotOnly 与 loadForHydration 同构（同一 readConsistent 两出口）', async () => {
    await ensureLeaseFixture(prisma as any, repo);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId } });
    await prisma.canvasDoc.deleteMany({ where: { projectId } });
    await repo.append(projectId, Y.encodeStateAsUpdate(new Y.Doc()));
    const a = await repo.readSnapshotOnly(projectId);
    const b = await repo.loadForHydration(projectId);
    expect(a.updates.length).toBe(b.updates.length);
    expect(a.stateSeq).toBe(b.stateSeq);
  });

  it('提交序倒挂（SV3 证明——10s 超时防死循环形态）：compact 后手工 INSERT 低 seq 行 → 装载必含其内容', async () => {
    await ensureLeaseFixture(prisma as any, repo);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId } });
    await prisma.canvasDoc.deleteMany({ where: { projectId } });
    const base = new Y.Doc();
    base.getMap('nodes').set('base-marker', new Y.Map([['v', 1]]));
    await repo.append(projectId, Y.encodeStateAsUpdate(base));
    const c = await repo.compact(projectId);   // stateSeq 落定（快照含 base-marker）
    expect(c.compacted).toBe(true);
    // 模拟绕锁迟到提交（advisory lock 之外的直接 INSERT——运维脚本/极端窗口形态）：低 seq 行,
    // 内容与快照**不同**（inverted-marker 只在本行——水位过滤会永久跳过=断言红）
    const docRow = await prisma.canvasDoc.findUnique({ where: { projectId } });
    const lowSeq = docRow!.stateSeq - 1n;   // 判别性保证 <stateSeq；项目内行已清空=无 UNIQUE 撞
    const inverted = new Y.Doc();
    inverted.getMap('nodes').set('inverted-marker', new Y.Map([['v', 1]]));
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CanvasDocUpdate" (id, "projectId", seq, update, "createdAt")
       SELECT gen_random_uuid()::text, $1, $3::bigint, $2::bytea, now()`,
      projectId, Buffer.from(Y.encodeStateAsUpdate(inverted)), lowSeq,
    );
    let cancelLoadWatch!: () => void;
    const loadWatch = new Promise<never>((_, rej) => {
      const t = setTimeout(() => rej(new Error('装载死循环/超时——cursor 未从 0 起')), 10_000);
      cancelLoadWatch = () => clearTimeout(t);
    });
    try {
      const loaded = await Promise.race([repo.loadForHydration(projectId), loadWatch]);
      expect(loaded.updates.length).toBe(1);   // 低 seq 行被装载（非跳过）
      const replay = new Y.Doc();
      for (const u of loaded.updates) Y.applyUpdate(replay, new Uint8Array(u));
      expect(replay.getMap('nodes').has('inverted-marker')).toBe(true);
    } finally {
      cancelLoadWatch();   // 装载先完成时撤销看门狗——迟到 rej 不成 unhandled rejection
    }
  }, 10_000);
});
