// apps/api/src/modules/artifact-core/media-fact-write.int.spec.ts —— C2-2（地基修复批·C2 卡）
// 写点改道+双函数版本纪律红测（spec 2026-11-11-foundation-batch-design.md §3.1-2，plan v3）。
// 五族：①版本单调（EXCLUDED.factVersion > 当前行吞旧版本）②并发两写者（bump 行锁串行+两行双落）
// ③无 projectId 媒体也有 natural fact（doneNatural 服务路径——MediaFact 无 projectId 列，union 门死）
// ④confirm 后 state fact 存在且 factVersion=DB 递增后真实值（禁预读+1 猜测）
// ⑤probe 终态失败 bump+probeRunId CAS（非终态重试零递增零 fact）。
// 负控：已 increment 路径误调 bump → 版本恰多 +1（双递增错位机理钉——①不递增/bump 单递增两半各证）。
// 真连 PG（C2-1 同款：无 DATABASE_URL 自动 skip；deleteTeamsWithPass 级联清理；20s 超时）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Readable } from 'node:stream';
import { PrismaService } from '../../prisma/prisma.service';
import type { MinioService } from '../minio/minio.service';
import { deleteTeamsWithPass } from '../../test-utils/intent-fixture';
import { upsertMediaFactInTx, bumpFactVersionAndUpsert } from './media-fact-write';
import { MediaRegistrationService } from './media-registration.service';
import { MediaProbePoller } from '../media/media-probe.poller';

const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();

const UID = `it-c22w-owner-${Date.now()}`;
let TID = '';
const createdMedia: string[] = [];

/** 上传形态行（probe/confirm 服务路径用——不经 prepareUpload 配额面，直接落 DB 等价行） */
async function makeMedia(opts: {
  status?: 'pending' | 'completed'; factVersion?: bigint; probeRunId?: string; projectId?: string | null;
} = {}): Promise<string> {
  const status = opts.status ?? 'completed';
  const m = await prisma.media.create({
    data: {
      userId: UID, teamId: TID, bucket: 'flowai',
      key: `uploads/${UID}/it-c22/${Date.now()}-${Math.random().toString(36).slice(2)}`,
      originalName: 'a.bin', mimeType: 'image/png', size: 10n, type: 'uploaded',
      status,
      ...(status === 'pending' ? { pendingExpiresAt: new Date(Date.now() + 3600_000) } : {}),
      ...(status === 'completed' ? { sniffedMimeType: 'image/png', probeState: 'pending' as const } : {}),
      factVersion: opts.factVersion ?? 0n,
      ...(opts.probeRunId ? { probeRunId: opts.probeRunId } : {}),
      ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
    },
  });
  createdMedia.push(m.id);
  return m.id;
}

/** minio 桩：junkStream=可读垃圾流（sharp 解码失败→mismatch permanent）；throwing→download transient */
function stubMinio(junk: 'junkStream' | 'throwing') {
  return {
    getObject: junk === 'junkStream'
      ? async () => Readable.from([Buffer.from('definitely not an image')])
      : async () => { throw new Error('ECONNRESET'); },
  } as unknown as MinioService;
}

(hasDb ? describe : describe.skip)('C2-2：MediaFact 写点改道+双函数版本纪律（真 PG）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'it-c22w', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'it-c22w', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
  }, 20_000);

  afterAll(async () => {
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  }, 20_000);

  it('①版本单调：已有 natural v5 行→upsert v3 被 WHERE EXCLUDED>当前 吞（仍 v5）→upsert v7 前进（payload+updatedAt 同步）', async () => {
    const id = await makeMedia({ factVersion: 5n });
    await prisma.mediaFact.create({
      data: { mediaId: id, factType: 'natural', factVersion: 5n, payload: { naturalWidth: 55 }, updatedAt: new Date() },
    });
    await prisma.$transaction((tx) => upsertMediaFactInTx(tx, {
      mediaId: id, factType: 'natural', factVersion: 3n, payload: { naturalWidth: 999 }, now: new Date(),
    }));
    let row = await prisma.mediaFact.findUnique({ where: { mediaId_factType: { mediaId: id, factType: 'natural' } } });
    expect(row!.factVersion).toBe(5n);                                    // 旧版本被吞（单调门）
    expect((row!.payload as { naturalWidth: number }).naturalWidth).toBe(55);

    const sentAt = new Date();
    await prisma.$transaction((tx) => upsertMediaFactInTx(tx, {
      mediaId: id, factType: 'natural', factVersion: 7n, payload: { naturalWidth: 77 }, now: sentAt,
    }));
    row = await prisma.mediaFact.findUnique({ where: { mediaId_factType: { mediaId: id, factType: 'natural' } } });
    expect(row!.factVersion).toBe(7n);                                    // 新版本前进
    expect((row!.payload as { naturalWidth: number }).naturalWidth).toBe(77);
    expect(Math.abs(row!.updatedAt.getTime() - sentAt.getTime())).toBeLessThanOrEqual(1_000);   // Date 参数绑定 instant round-trip（tsz）
  }, 20_000);

  it('②并发两写者（v6/v7 交错）：双事务 bump state/natural → 两行双落（各自最新版本）+Media.factVersion=7', async () => {
    const id = await makeMedia({ factVersion: 5n });
    await Promise.all([
      prisma.$transaction((tx) => bumpFactVersionAndUpsert(tx, id, 'state', { status: 'processing' })),
      prisma.$transaction((tx) => bumpFactVersionAndUpsert(tx, id, 'natural', { naturalWidth: 1, naturalHeight: 2, source: 'probe' })),
    ]);
    const [state, natural, media] = await Promise.all([
      prisma.mediaFact.findUnique({ where: { mediaId_factType: { mediaId: id, factType: 'state' } } }),
      prisma.mediaFact.findUnique({ where: { mediaId_factType: { mediaId: id, factType: 'natural' } } }),
      prisma.media.findUnique({ where: { id }, select: { factVersion: true } }),
    ]);
    expect(state).toBeTruthy();
    expect(natural).toBeTruthy();                                         // 两行双落（(mediaId,'state')与(mediaId,'natural') 各自在）
    // bump 行锁串行：两写者各恰递增一次——版本恰为 {6,7}（交错序不定），Media=全局最新 7
    expect(new Set([state!.factVersion.toString(), natural!.factVersion.toString()])).toEqual(new Set(['6', '7']));
    expect(media!.factVersion).toBe(7n);
  }, 20_000);

  it('③无 projectId 媒体也有 natural fact：doneNatural（probeRunId CAS 命中）→ natural 行落+版本递增', async () => {
    const id = await makeMedia({ factVersion: 3n, projectId: null, probeRunId: 'run-c22-3' });
    const poller = new MediaProbePoller(prisma as unknown as PrismaService, stubMinio('throwing'));
    const ok = await poller.doneNatural({
      mediaId: id, probeRunId: 'run-c22-3', naturalWidth: 11, naturalHeight: 22, naturalRotation: null,
    });
    expect(ok).toBe(true);
    const fact = await prisma.mediaFact.findUnique({ where: { mediaId_factType: { mediaId: id, factType: 'natural' } } });
    expect(fact).toBeTruthy();                                           // 旧 outbox 路径此形态零行（union 门）——改道后必有
    expect((fact!.payload as { naturalWidth: number; source: string }).naturalWidth).toBe(11);
    expect((fact!.payload as { naturalWidth: number; source: string }).source).toBe('probe');
    expect(fact!.factVersion).toBe(4n);
    expect((await prisma.media.findUnique({ where: { id }, select: { factVersion: true } }))!.factVersion).toBe(4n);
  }, 20_000);

  it('④confirm 后 state fact 存在且 factVersion=DB 递增后真实值（禁预读+1）：fact 行版本≡同事务读回的 Media.factVersion', async () => {
    const id = await makeMedia({ status: 'pending', factVersion: 0n });
    const registration = new MediaRegistrationService(prisma as unknown as PrismaService, {} as MinioService);
    await registration.confirmUpload({ mediaId: id, actualSize: 100n, sniffedMimeType: 'image/png' });

    const media = await prisma.media.findUnique({ where: { id }, select: { factVersion: true, status: true } });
    expect(media!.status).toBe('completed');
    const fact = await prisma.mediaFact.findUnique({ where: { mediaId_factType: { mediaId: id, factType: 'state' } } });
    expect(fact).toBeTruthy();                                           // 上传 confirm 同事务 state fact（spec §1 基线2 缺口收口）
    expect((fact!.payload as { status: string }).status).toBe('completed');
    expect(fact!.factVersion).toBe(media!.factVersion);                  // =读回真实递增值（非预读+1 猜测）
    expect(media!.factVersion).toBe(1n);                                 // 0→1 恰一次递增（无双递增）
  }, 20_000);

  it('⑤probe 终态失败 bump：已有 processing state v1 → mismatch permanent 终态后 state={failed,scope:probe} 且版本=1+1=2', async () => {
    const id = await makeMedia({ factVersion: 1n, probeRunId: 'run-c22-5a' });
    await prisma.mediaFact.create({
      data: { mediaId: id, factType: 'state', factVersion: 1n, payload: { status: 'processing' }, updatedAt: new Date() },
    });
    const row = await prisma.media.findUnique({ where: { id } });
    const poller = new MediaProbePoller(prisma as unknown as PrismaService, stubMinio('junkStream'));
    await poller.probeRow(row!);

    const media = await prisma.media.findUnique({ where: { id }, select: { probeState: true, factVersion: true } });
    expect(media!.probeState).toBe('failed');                            // mismatch permanent 一轮即终
    const fact = await prisma.mediaFact.findUnique({ where: { mediaId_factType: { mediaId: id, factType: 'state' } } });
    expect(fact).toBeTruthy();
    expect(fact!.payload).toMatchObject({ status: 'failed', scope: 'probe' });   // probe 失败语义（spec §3.1-2 钉死）
    expect(fact!.factVersion).toBe(2n);                                  // N+1（bump 单次递增）
    expect(media!.factVersion).toBe(2n);                                 // state 行≡Media.factVersion
  }, 20_000);

  it('⑤b非终态重试不写 fact：transient（download）→ pending+attempts+1，零 fact 行+factVersion 不动（中间态不落 MediaFact）', async () => {
    const id = await makeMedia({ factVersion: 1n, probeRunId: 'run-c22-5b' });
    const row = await prisma.media.findUnique({ where: { id } });
    const poller = new MediaProbePoller(prisma as unknown as PrismaService, stubMinio('throwing'));
    await poller.probeRow(row!);

    const media = await prisma.media.findUnique({ where: { id }, select: { probeState: true, probeAttempts: true, factVersion: true } });
    expect(media!.probeState).toBe('pending');                           // 瞬态回 pending（退避重试面）
    expect(media!.probeAttempts).toBe(1);
    expect(media!.factVersion).toBe(1n);                                 // 零递增
    expect(await prisma.mediaFact.count({ where: { mediaId: id } })).toBe(0);   // 零 fact
  }, 20_000);

  it('负控（双函数纪律）：①upsert 不递增（Media 留在读回值）∨ 误调 bump 恰多 +1——bump 与 RETURNING 读回不可叠加', async () => {
    const id = await makeMedia({ factVersion: 5n });
    // 正确路径（已 increment→读回→①）：Media 与 fact 行都停在读回值 6（零额外递增）
    await prisma.$transaction(async (tx) => {
      await tx.media.updateMany({ where: { id }, data: { factVersion: { increment: 1 } } });
      const { factVersion } = await tx.media.findUniqueOrThrow({ where: { id }, select: { factVersion: true } });
      await upsertMediaFactInTx(tx, { mediaId: id, factType: 'state', factVersion, payload: { status: 'completed' }, now: new Date() });
    });
    const afterCorrect = await prisma.media.findUnique({ where: { id }, select: { factVersion: true } });
    expect(afterCorrect!.factVersion).toBe(6n);                          // ①不递增——这是 bump 不可叠加的判别面
    let fact = await prisma.mediaFact.findUnique({ where: { mediaId_factType: { mediaId: id, factType: 'state' } } });
    expect(fact!.factVersion).toBe(6n);

    // 误用形态（已 increment 读回 v=7 后再调 bump）：版本=8=读回值+1——恰多吃了 1（正确语义应=7）
    await prisma.$transaction(async (tx) => {
      await tx.media.updateMany({ where: { id }, data: { factVersion: { increment: 1 } } });
      const { factVersion } = await tx.media.findUniqueOrThrow({ where: { id }, select: { factVersion: true } });
      expect(factVersion).toBe(7n);                                     // 读回值=正确语义应写的版本
      await bumpFactVersionAndUpsert(tx, id, 'state', { status: 'processing' });
    });
    const afterMisuse = await prisma.media.findUnique({ where: { id }, select: { factVersion: true } });
    expect(afterMisuse!.factVersion).toBe(8n);                           // 8=7+1——bump 在已 increment 路径上多吃了 1
    fact = await prisma.mediaFact.findUnique({ where: { mediaId_factType: { mediaId: id, factType: 'state' } } });
    expect(fact!.factVersion).toBe(8n);                                  // fact 行被推到错位版本（≠读回值 7）
  }, 20_000);
});
