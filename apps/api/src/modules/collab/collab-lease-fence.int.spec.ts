// Y0a-3 T3：fence 写语句真库证明（G-3b+leaseRowMissing+两出口同构+提交序倒挂）——repo 层直接
// 操纵租约行模拟 A 持锁/B 夺锁（lease service 获取路径语义归 collab-lease.service.spec mock 层）。
// 倒挂用例（Y1c T11 语义迁移）：手工低 seq 行=单写者契约外绕锁写（insert-ratchet 静态门执法对象）；
// 快照权威+增量尾(>stateSeq) 设计性排除之——「读侧全量双保险」旧语义随快照权威退役（单写者+WAL
// walSeq 构造性保证 seq 序≡提交序——census⑩）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { makeSeedSeq } from '../../test-utils/canvas-doc-row';

/** Y1c T9：repo.append（nextval 单帧）退役——播种替身（单调 walSeq 单帧行，appendBatch 批行）。 */
const seedAppend = makeSeedSeq();
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
    const d1 = new Y.Doc(); d1.getMap('nodes').set('a', 1);   // 载荷相异（空 doc update 字节恒等——同 hash 会折幂等 no-op 档）
    const r1 = await repo.appendBatch(projectId, [seedAppend(Y.encodeStateAsUpdate(d1))]);
    expect(r1.ok).toBe(true);
    await prisma.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = 'owner-B', "expiresAt" = now() + interval '1 hour' WHERE scope = 'primary'`);
    const d2 = new Y.Doc(); d2.getMap('nodes').set('b', 2);
    const r2 = await repo.appendBatch(projectId, [seedAppend(Y.encodeStateAsUpdate(d2))]);
    expect(r2).toEqual({ ok: false, reason: 'fenced' });
  });

  it('Y1c T11 授权换轴：compact 在租约他持（B 持锁）期照常发布——零 CollabLease 交互（行锁+generation/pgSeq CAS 仲裁，与写入方 lease 正交；旧 not-owner 语义退役）', async () => {
    await ensureLeaseFixture(prisma as any, repo, 'owner-A');
    // 播种+水位（compact 授权读需要 pgSeq>指针 stateSeq）
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "updatedAt") VALUES ($1, 1, 3, now()) ON CONFLICT DO NOTHING`,
      projectId,
    );
    const d = new Y.Doc(); d.getMap('nodes').set('c', new Y.Map([['x', 3]]));
    const row = seedAppend(Y.encodeStateAsUpdate(d));
    const ar = await repo.appendBatch(projectId, [row], { expectedPgSeq: 0n, newPgSeq: row.lastWalSeq, walCheckpointSeq: row.lastWalSeq });
    expect(ar.ok).toBe(true);
    await prisma.$executeRawUnsafe(`UPDATE "CollabLease" SET owner = 'owner-B', "expiresAt" = now() + interval '1 hour' WHERE scope = 'primary'`);
    const r = await repo.compact(projectId);   // 租约在 owner-B 手——compact 不读租约（worker 进程形态）
    expect(r.compacted).toBe(true);
    if (r.compacted) {
      expect(r.stateSeq).toBe(row.lastWalSeq);   // 发布落定（快照+指针+purgeBelowSeq）
      expect(await prisma.canvasDocUpdate.count({ where: { projectId } })).toBe(0);   // 提交后批删
    }
    const doc = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId } });
    expect(doc.currentSnapshotRev).toBe(row.lastWalSeq);
  });

  it('租约行缺失：append throws leaseRowMissing（配置错误不伪装 fenced）——finally 复原（V31：中途失败不毒化本地 verify 链）', async () => {
    repo.setLeaseOwner('owner-A');
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "CollabLease" WHERE scope = 'primary'`);
      await expect(repo.appendBatch(projectId, [seedAppend(new Uint8Array([1]))])).rejects.toMatchObject({ leaseRowMissing: true });
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
    { const d = new Y.Doc(); d.getMap('nodes').set('iso', 1); await repo.appendBatch(projectId, [seedAppend(Y.encodeStateAsUpdate(d))]); }
    const a = await repo.readSnapshotOnly(projectId);
    const b = await repo.loadForHydration(projectId);
    expect(a.updates.length).toBe(b.updates.length);
    expect(a.stateSeq).toBe(b.stateSeq);
  });

  it('提交序倒挂（SV3——Y1c T11 语义迁移：快照权威+增量尾设计性排除低 seq 绕锁行；单写者构造性保证由 census⑩+insert-ratchet 静态门承载）：compact 后手工 INSERT 低 seq 行 → 装载尾不含其（>stateSeq 谓词）+高 seq 行照常装载', async () => {
    await ensureLeaseFixture(prisma as any, repo);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId } });
    await prisma.canvasDoc.deleteMany({ where: { projectId } });
    const base = new Y.Doc();
    base.getMap('nodes').set('base-marker', new Y.Map([['v', 1]]));
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "updatedAt") VALUES ($1, 1, 3, now()) ON CONFLICT DO NOTHING`,
      projectId,
    );
    const headRow = seedAppend(Y.encodeStateAsUpdate(base));
    await repo.appendBatch(projectId, [headRow], { expectedPgSeq: 0n, newPgSeq: headRow.lastWalSeq, walCheckpointSeq: headRow.lastWalSeq });
    const c = await repo.compact(projectId);   // 快照发布（含 base-marker；stateSeq=headRow.lastWalSeq）
    expect(c.compacted).toBe(true);
    // 绕锁迟到提交（单写者外直接 INSERT——运维脚本/极端窗口形态）：低 seq 行内容与快照**不同**
    const snap = await prisma.canvasDocSnapshot.findFirstOrThrow({ where: { projectId }, orderBy: { snapshotRev: 'desc' } });
    const lowSeq = snap.stateSeq - 1n;   // 判别性保证 <stateSeq；项目内行已清空=无 UNIQUE 撞
    const inverted = new Y.Doc();
    inverted.getMap('nodes').set('inverted-marker', new Y.Map([['v', 1]]));
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CanvasDocUpdate" ("projectId", generation, seq, "firstWalSeq", "frameCount", "updateHash", "actorRanges", update, "createdAt")
       SELECT $1, 1, $3::bigint, $3::bigint, 1, encode(sha256($2::bytea), 'hex'), NULL::jsonb, $2::bytea, now()`,
      projectId, Buffer.from(Y.encodeStateAsUpdate(inverted)), lowSeq,
    );
    // 合法高 seq 行（>stateSeq——装载尾必含）
    const later = new Y.Doc();
    later.getMap('nodes').set('later-marker', new Y.Map([['v', 1]]));
    await repo.appendBatch(projectId, [seedAppend(Y.encodeStateAsUpdate(later))]);
    let cancelLoadWatch!: () => void;
    const loadWatch = new Promise<never>((_, rej) => {
      const t = setTimeout(() => rej(new Error('装载死循环/超时——尾谓词失效')), 10_000);
      cancelLoadWatch = () => clearTimeout(t);
    });
    try {
      const loaded = await Promise.race([repo.loadForHydration(projectId), loadWatch]);
      expect(loaded.updates.length).toBe(1);   // 高 seq later-marker 行在尾；低 seq 绕锁行设计性排除
      const replay = new Y.Doc();
      Y.applyUpdate(replay, new Uint8Array(loaded.state!));
      for (const u of loaded.updates) Y.applyUpdate(replay, new Uint8Array(u));
      expect(replay.getMap('nodes').has('base-marker')).toBe(true);   // 快照内容
      expect(replay.getMap('nodes').has('later-marker')).toBe(true);  // 尾内容
      expect(replay.getMap('nodes').has('inverted-marker')).toBe(false);   // 绕锁低 seq 行=单写者契约外（设计性排除——census⑩/insert-ratchet 执法）
    } finally {
      cancelLoadWatch();
    }
  }, 10_000);
});
