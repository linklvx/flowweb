// apps/api/src/modules/collab/project-erasure.drain.c4b.int.spec.ts
// C4-b（plan Task C4-2 ★红⑧-a——生产就绪收尾批·project-erasure）：DRAINING manifest 顺序红测（真 PG）。
// **manifest-before-detach**（plan v3.1 ⑥）：worker 后续 detach/删除只从 manifest 读——顺序钉死：
//  - 错误序红证：先 detach（canvasProjectId 置 NULL）再采集 ⇒ live 查询 `WHERE canvasProjectId=pid`
//    零行=Redis/对象清理空转（work/media 行集全失锚——红⑧a 字面「清理空转」形态直证）；
//  - 正确序绿证：DRAINING 采集先行（manifest 含全行）→ 模拟 detach 后 manifest 仍零残留覆盖
//    （cleanup 全集=manifest 行集——detach 后清理不空转）。
// 另证：poller.processProjectRun 端到端（claim→RUNNING→DRAINING 排干+manifest→PURGING_DB 前置位
// 即停+DB 索引行 manifestPath/manifestSha256+NDJSON 读取面 footer SHA 复算）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { ErasureContextService, lockProject, fenceProject, ProjectErasingError } from './project-lock';
import { ProjectErasureRunPoller } from './project-erasure.poller';
import {
  writeErasureManifest, readErasureManifest, collectSpoolSegments, deriveRedisKeys,
  type ErasureManifestInputs,
} from './project-erasure.manifest';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

maybe('C4-b ★红⑧-a DRAINING manifest 唯一采集面+顺序（真 PG）', () => {
  const prisma = new PrismaClient();
  const prismaService = new PrismaService();
  const ledger = new CreditLedgerService(prismaService as never);
  const poller = new ProjectErasureRunPoller(prismaService as never, ledger as never, new ErasureContextService());
  const owner = `c4b-owner-${Date.now().toString(36)}`;
  const teamId = `c4b-team-${Date.now().toString(36)}`;
  const pid = `${teamId}-p0`;
  let manifestDir: string;
  const mediaIds: string[] = [];

  beforeAll(async () => {
    manifestDir = mkdtempSync(join(tmpdir(), 'c4b-manifest-'));
    process.env.ERASURE_MANIFEST_DIR = manifestDir;
    await prisma.user.upsert({
      where: { id: owner }, update: {},
      create: { id: owner, name: owner, email: `${owner}@local.test`, emailVerified: true },
    });
    await prisma.team.create({ data: { id: teamId, name: 'c4b-team', ownerId: owner } });
    await prisma.teamMember.create({ data: { teamId, userId: owner, role: 'OWNER' } });
    await prisma.canvasProject.create({ data: { id: pid, name: pid, teamId, userId: owner } });
    for (let i = 0; i < 3; i++) {
      const mid = `${pid}-m${i}`;
      await prisma.media.create({
        data: { id: mid, userId: owner, teamId, projectId: pid, bucket: 'flowai', key: `${pid}/media-${i}.bin`, originalName: `m${i}`, mimeType: 'application/octet-stream', size: BigInt(1024 + i), type: 'generated', thumbnailKey: `${pid}/thumb-${i}`, objectKey: `${pid}/obj-${i}` },
      });
      mediaIds.push(mid);
    }
    await prisma.videoWork.create({
      data: { id: `${pid}-w0`, title: 'w', authorName: owner, videoKey: `${pid}/work-video.mp4`, coverKey: `${pid}/cover.jpg`, canvasProjectId: pid },
    });
  });

  afterAll(async () => {
    await prisma.projectErasureRun.deleteMany({ where: { scopeId: pid } }).catch(() => undefined);
    // C4-c1：第二 tick 进执行体后 VideoWork 已 detach（canvasProjectId=NULL）——按 id 清（防孤儿行）
    await prisma.videoWork.deleteMany({ where: { id: `${pid}-w0` } }).catch(() => undefined);
    await prisma.videoWork.deleteMany({ where: { canvasProjectId: pid } }).catch(() => undefined);
    await prisma.media.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
    await prisma.canvasProject.deleteMany({ where: { id: pid } }).catch(() => undefined);
    await prisma.teamMember.deleteMany({ where: { teamId } }).catch(() => undefined);
    await prisma.team.deleteMany({ where: { id: teamId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: owner } }).catch(() => undefined);
    rmSync(manifestDir, { recursive: true, force: true });
    await prisma.$disconnect();
    await prismaService.$disconnect().catch(() => undefined);
  }, 20_000);

  it('红⑧a 错误序红证：先 detach 再采集 ⇒ live 查询零行（清理空转——manifest 序为唯一正确序）', async () => {
    // 采集 SQL 与 poller.processProjectRun 同谓词（live 面函数化证明：detach 后采集=空集）
    const collectLive = async (p: PrismaClient): Promise<{ media: number; work: number }> => {
      const [media, work] = await Promise.all([
        p.$queryRaw<{ id: string }[]>`SELECT id FROM "Media" WHERE "projectId" = ${pid}::text`,
        p.$queryRaw<{ id: string }[]>`SELECT id FROM "VideoWork" WHERE "canvasProjectId" = ${pid}::text`,
      ]);
      return { media: media.length, work: work.length };
    };
    // detach 前：行集可见
    expect(await collectLive(prisma)).toEqual({ media: 3, work: 1 });
    // 模拟 worker detach（C4-c 介质动作——canvasProjectId 置 NULL+Media.projectId 置 NULL）
    await prisma.videoWork.updateMany({ where: { canvasProjectId: pid }, data: { canvasProjectId: null } });
    await prisma.media.updateMany({ where: { projectId: pid }, data: { projectId: null } });
    try {
      // 错误序：detach 后再采集=零行=Redis/对象清单空转（红⑧a 字面）
      expect(await collectLive(prisma)).toEqual({ media: 0, work: 0 });
    } finally {
      // 复原（下一用例走正确序）
      await prisma.videoWork.updateMany({ where: { id: `${pid}-w0` }, data: { canvasProjectId: pid } });
      await prisma.media.updateMany({ where: { id: { in: mediaIds } }, data: { projectId: pid } });
    }
  });

  it('正确序绿证：manifest 先行（含全行+派生 Redis 键）→ detach 后 manifest 驱动清理仍零残留全覆盖', async () => {
    // ①采集（manifest 先行——同 poller 谓词）
    const mediaRows = await prisma.$queryRaw<ErasureManifestInputs['mediaRows']>`
      SELECT id, bucket, key, "thumbnailKey", "objectKey", size FROM "Media" WHERE "projectId" = ${pid}::text ORDER BY id`;
    const workRows = await prisma.$queryRaw<ErasureManifestInputs['workRows']>`
      SELECT id, "canvasProjectId", "videoKey", "coverKey" FROM "VideoWork" WHERE "canvasProjectId" = ${pid}::text ORDER BY id`;
    expect(mediaRows).toHaveLength(3);
    expect(workRows).toHaveLength(1);
    const { manifestPath } = await writeErasureManifest({
      erasureId: 'c4b-red8a-manual', scopeType: 'project', scopeId: pid, projectIds: [pid],
      requestedAt: new Date(), mediaRows, workRows, spoolSegs: await collectSpoolSegments(join(process.cwd(), '.data', 'collab-spool'), [pid]),
    });
    // ②模拟 detach
    await prisma.videoWork.updateMany({ where: { canvasProjectId: pid }, data: { canvasProjectId: null } });
    await prisma.media.updateMany({ where: { projectId: pid }, data: { projectId: null } });
    // ③manifest 驱动清理（detach 后）：全集在册——零残留清理不空转（对象/Redis 键面全覆盖）
    const manifest = await readErasureManifest(manifestPath);
    expect(manifest.media.map((m) => m.id).sort()).toEqual([...mediaIds].sort());
    expect(manifest.work.map((w) => w.id)).toEqual([`${pid}-w0`]);
    expect(manifest.media[0]!.size).toBe(1024n);   // BigInt 十进制字符串行→读回 bigint（纪律锚）
    const redis = deriveRedisKeys({ mediaRows, workRows });
    expect(redis.urlKeys).toContain(`videoWork:url:${pid}/work-video.mp4`);
    expect(redis.urlKeys).toContain(`videoWork:url:${pid}/thumb-0`);
    expect(redis.workIds).toEqual([`${pid}-w0`]);
    expect(manifest.footer.rows).toEqual({ media: 3, work: 1, spool: manifest.footer.rows.spool, shard: 1 });   // 4 数据行=1 片（尾片同发 shard 行）
    // 复原（端到端用例重用行集）
    await prisma.videoWork.updateMany({ where: { id: `${pid}-w0` }, data: { canvasProjectId: pid } });
    await prisma.media.updateMany({ where: { id: { in: mediaIds } }, data: { projectId: pid } });
  });

  it('端到端：tombstone+run → poller.tick → DRAINING（排干+fence 豁免）→ manifest 落盘+DB 索引 → PURGING_DB 前置位即停', async () => {
    // tombstone（openProjectErasure 等价最小形：置 DELETING+run 行）
    await prisma.$transaction(async (tx) => {
      await lockProject(tx as never, pid);
      await tx.canvasProject.update({ where: { id: pid }, data: { lifecycleState: 'DELETING' } });
      await tx.projectErasureRun.create({
        data: { erasureId: `c4b-run-${Date.now()}`, scopeType: 'project', scopeId: pid, requestedBy: owner, state: 'PENDING' },
      });
    });
    await poller.tick();
    const run = await prisma.projectErasureRun.findFirst({ where: { scopeId: pid }, orderBy: { requestedAt: 'desc' } });
    expect(run!.state).toBe('PURGING_DB');   // 状态机串到 PURGING_DB 即停（介质 saga 归 C4-c）
    expect(run!.manifestPath).toBeTruthy();
    expect(run!.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    const manifest = await readErasureManifest(run!.manifestPath!);
    expect(manifest.header.erasureId).toBe(run!.erasureId);
    expect(manifest.header.projectIds).toEqual([pid]);
    expect(manifest.media.map((m) => m.id).sort()).toEqual([...mediaIds].sort());
    expect(manifest.footer.sha256).toBe(run!.manifestSha256);   // DB 索引=footer 全量 SHA（restore 校验锚）
    // 二 tick 幂等：PURGING_DB∧manifestPath 在=前置位 skip（零重复落盘）
    await poller.tick();
    const run2 = await prisma.projectErasureRun.findFirst({ where: { scopeId: pid }, orderBy: { requestedAt: 'desc' } });
    expect(run2!.state).toBe('PURGING_DB');
    expect(run2!.manifestPath).toBe(run!.manifestPath);
  });

  it('fence 豁免分档：DELETING 行 ErasureContext 内 fenceProject 放行（worker=唯一合法写者）；app ctx 同读被拒', async () => {
    // C4-c1：上一用例第二 tick 已进 PURGING_DB 执行体（project 行已删——列级断言前置位语义）；
    // 本用例锚 fence 三态本体：重建 DELETING 行（team 在档——upsert 形态）再断言豁免分档。
    await prisma.canvasProject.upsert({
      where: { id: pid },
      update: { lifecycleState: 'DELETING' },
      create: { id: pid, name: pid, teamId, userId: owner, lifecycleState: 'DELETING' },
    });
    await expect(prismaService.$transaction(async (tx) => {
      await fenceProject(tx as never, pid);   // app ctx（无 withErasure 包裹）——DELETING 拒
    })).rejects.toBeInstanceOf(ProjectErasingError);
    await new ErasureContextService().withErasure('c4b-run-x', () =>
      prismaService.$transaction(async (tx) => {
        await fenceProject(tx as never, pid);   // ErasureContext 内豁免（红⑨c 前置面）
      }),
    );
  });
});
