// apps/api/src/modules/collab/project-erasure.objects.c4c2.int.spec.ts
// C4-c2（plan Task C4-3 ★红⑮——生产就绪收尾批·project-erasure）：PURGING_OBJECTS 执行体
// **版本化 capability detect** 实弹面（本地 MinIO gate——版本化桶开启先例：SDK PutBucketVersioning）：
//  - 版本化桶：旧版本全删（同 key 多版本+DeleteMarker 全清——ListObjectVersions 逐版本 DeleteObjects）
//    +multipart 残件清理（CreateMultipartUpload 未 Complete 残件 Abort）；
//  - 非版本化桶：现行对象 DeleteObjects；
//  - **对象删除面=manifest−DB 现存 media 行**（按 id diff——detach 行留册对象保留：VideoWork detach/
//    库资产/他引用 detach 行的 key 不进删除面——红⑫ 三档语义的对象侧对拍）；
//  - capability 披露（replication/object-lock/lifecycle 在位→诚实披露非假绿：指标+结果载荷，不抛）；
//  - verifyObjectsPurged **负例直测**（C4-c2 评审 P1-1：原全库仅 happy path「toEqual([])」——
//    「恒返 []」退化不可检出；对象在位必须 violations 非空，版本化/非版本化双分支各一）。
// MinIO 不可达=skip（CI RustFS 非版本化+能力 detect 分支单测承载——runbook §13 登记；本地 gate 必跑）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  S3Client, CreateBucketCommand, DeleteBucketCommand, PutBucketVersioningCommand,
  CreateMultipartUploadCommand, UploadPartCommand, HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { writeErasureManifest, readErasureManifest } from './project-erasure.manifest';
import { ErasureContextService } from './project-lock';
import {
  executePurgingObjectsStage, deriveObjectDeletionSurface, verifyObjectsPurged,
  type ErasureObjectPort,
} from './project-erasure.objects';

const hasDb = !!process.env.DATABASE_URL;
const endpoint = process.env.MINIO_ENDPOINT ?? 'http://127.0.0.1:9000';
const accessKey = process.env.MINIO_ACCESS_KEY ?? 'minioadmin';
const secretKey = process.env.MINIO_SECRET_KEY ?? 'minioadmin';
/** 本地 MinIO 可达探测（health live——不可达=红⑮ 版本化实弹归 gate/服务器窗，skip 不假绿。
 *  模块顶层 await（vitest ESM）：skip 判定须在 it 注册期生效〔beforeAll 晚于收集〕）。 */
async function probeMinio(): Promise<boolean> {
  try {
    const u = new URL(endpoint);
    const res = await fetch(`${u.protocol}//${u.host}/minio/health/live`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch { return false; }
}
let minioUp = false;   // beforeAll 探测（it 运行期 ctx.skip 门——禁 top-level await：spec tsconfig module 档）

const maybeDb = hasDb ? describe : describe.skip;

maybeDb('C4-c2 ★红⑮ PURGING_OBJECTS 版本化 capability detect（真 MinIO）', () => {
  const prisma = new PrismaClient();
  const prismaService = new PrismaService();
  const stamp = Date.now().toString(36);
  const owner = `c4c2o-owner-${stamp}`;
  const teamId = `c4c2o-team-${stamp}`;
  let seq = 0;
  let manifestDir: string;
  const projects: string[] = [];
  const buckets: string[] = [];

  const seedProject = async (): Promise<string> => {
    const pid = `c4c2o-p-${stamp}-${seq++}`;
    await prisma.canvasProject.create({ data: { id: pid, name: pid, teamId, userId: owner } });
    projects.push(pid);
    return pid;
  };

  /** 直连 S3 client（temp bucket 生命周期管理——MinioService 绑定单 bucket）。 */
  const adminClient = () => new S3Client({
    region: 'us-east-1', endpoint, forcePathStyle: true,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  /** temp bucket（versioned 可选）+ 绑定该 bucket 的 MinioService。 */
  const makeBucket = async (versioned: boolean): Promise<{ name: string; svc: MinioService }> => {
    const name = `c4c2-t-${stamp}-${seq++}`;
    const c = adminClient();
    await c.send(new CreateBucketCommand({ Bucket: name }));
    if (versioned) {
      await c.send(new PutBucketVersioningCommand({ Bucket: name, VersioningConfiguration: { Status: 'Enabled' } }));
    }
    await c.destroy();
    buckets.push(name);
    const svc = new MinioService({ endpoint, accessKey, secretKey, bucket: name, useSsl: false });
    return { name, svc };
  };

  /** manifest 直建（mediaRows 载荷——对象面测试主驱动）。 */
  const writeManifest = async (pid: string, mediaRows: { id: string; key: string; thumbnailKey?: string | null; objectKey?: string | null }[]) => {
    return writeErasureManifest({
      erasureId: `c4c2o-${pid}`, scopeType: 'project', scopeId: pid, projectIds: [pid],
      requestedAt: new Date(),
      mediaRows: mediaRows.map((m) => ({ id: m.id, bucket: 'flowai', key: m.key, thumbnailKey: m.thumbnailKey ?? null, objectKey: m.objectKey ?? null, size: 1n })),
      workRows: [], spoolSegs: [],
    }, manifestDir);
  };

  const runRow = async (pid: string, manifestPath: string) => prisma.projectErasureRun.create({
    data: { erasureId: `c4c2o-${pid}`, scopeType: 'project', scopeId: pid, requestedBy: owner, state: 'PURGING_OBJECTS', stage: 'PURGING_DB', manifestPath, manifestSha256: (await readErasureManifest(manifestPath)).footer.sha256 },
  });

  beforeAll(async () => {
    manifestDir = mkdtempSync(join(tmpdir(), 'c4c2o-manifest-'));
    process.env.ERASURE_MANIFEST_DIR = manifestDir;
    minioUp = await probeMinio();
    await prisma.user.upsert({ where: { id: owner }, update: {}, create: { id: owner, name: owner, email: `${owner}@local.test`, emailVerified: true } });
    await prisma.team.create({ data: { id: teamId, name: 'c4c2o-team', ownerId: owner } });
    await prisma.teamMember.create({ data: { teamId, userId: owner, role: 'OWNER' } });
  });

  afterAll(async () => {
    const pids = [...projects];
    for (const b of buckets) {
      // 排空残件（版本化桶：对象+版本全删）后删桶——测试面自回收
      try {
        const { ListObjectVersionsCommand, DeleteObjectsCommand, ListMultipartUploadsCommand, AbortMultipartUploadCommand } = await import('@aws-sdk/client-s3');
        const c = adminClient();
        for (;;) {
          const lv = await c.send(new ListObjectVersionsCommand({ Bucket: b, MaxKeys: 1000 }));
          const objs = [...(lv.Versions ?? []), ...(lv.DeleteMarkers ?? [])].map((v) => ({ Key: v.Key!, VersionId: v.VersionId }));
          if (objs.length === 0) break;
          await c.send(new DeleteObjectsCommand({ Bucket: b, Delete: { Objects: objs } }));
        }
        const mu = await c.send(new ListMultipartUploadsCommand({ Bucket: b }));
        for (const u of mu.Uploads ?? []) await c.send(new AbortMultipartUploadCommand({ Bucket: b, Key: u.Key!, UploadId: u.UploadId! }));
        await c.send(new DeleteBucketCommand({ Bucket: b }));
        await c.destroy();
      } catch { /* best-effort 桶回收 */ }
    }
    await prisma.auditLog.deleteMany({ where: { targetId: { in: pids } } }).catch(() => undefined);
    await prisma.projectErasureRun.deleteMany({ where: { scopeId: { in: pids } } }).catch(() => undefined);
    await prisma.canvasProject.deleteMany({ where: { id: { in: pids } } }).catch(() => undefined);
    await prisma.teamMember.deleteMany({ where: { teamId } }).catch(() => undefined);
    await prisma.team.deleteMany({ where: { id: teamId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: owner } }).catch(() => undefined);
    rmSync(manifestDir, { recursive: true, force: true });
    await prisma.$disconnect();
    await prismaService.$disconnect().catch(() => undefined);
  }, 60_000);

  it('⑮-① 版本化桶：旧版本+DeleteMarker 全删+multipart 残件 Abort→PURGING_CACHE', async (ctx) => {
    if (!minioUp) return ctx.skip();   // MinIO 不可达=版本化实弹归 gate/服务器窗（runbook §13 披露）——skip 不假绿
    const pid = await seedProject();
    const { svc } = await makeBucket(true);
    const k1 = `${pid}/multi.bin`, k2 = `${pid}/gone.bin`;
    // k1 两版本（v1 被覆写=旧版本在位）+k2 现行+删除标记（delete 置 DeleteMarker——版本化桶 delete 不删数据版本）
    await svc.upload(k1, Buffer.from('v1'), 'application/octet-stream');
    await svc.upload(k1, Buffer.from('v2'), 'application/octet-stream');
    await svc.upload(k2, Buffer.from('live'), 'application/octet-stream');
    await svc.delete(k2);   // 版本化桶=置 DeleteMarker（现行+Marker 两版本在位）
    // multipart 残件：Create+UploadPart 不 Complete（残件 key 进 manifest 面）
    const k3 = `${pid}/partial.bin`;
    const c = adminClient();
    const mp = await c.send(new CreateMultipartUploadCommand({ Bucket: (svc as unknown as { bucket: string }).bucket, Key: k3 }));
    await c.send(new UploadPartCommand({ Bucket: (svc as unknown as { bucket: string }).bucket, Key: k3, UploadId: mp.UploadId, PartNumber: 1, Body: Buffer.alloc(5 * 1024 * 1024) }));
    await c.destroy();
    // manifest：k1/k2/k3 三键（k1 带 thumbnailKey——键族三形态）；DB 现存=空（独占已删形态）
    const m = await writeManifest(pid, [
      { id: `${pid}-m1`, key: k1, thumbnailKey: `${pid}/multi.thumb.jpg` },
      { id: `${pid}-m2`, key: k2 },
      { id: `${pid}-m3`, key: k3 },
    ]);
    await svc.upload(`${pid}/multi.thumb.jpg`, Buffer.from('t'), 'image/jpeg');   // 缩略图对象在位
    const run = await runRow(pid, m.manifestPath);
    const res = await executePurgingObjectsStage({ prisma: prismaService, run, objects: svc });
    expect(res.outcome).toBe('purging-cache');
    if (res.outcome === 'purging-cache') {
      expect(res.deletedObjects).toBeGreaterThanOrEqual(5);   // k1×2 版本+thumb+k2×2（现行+Marker）≥5
      expect(res.abortedUploads).toBe(1);                      // multipart 残件 Abort
    }
    // 全版本清点零残留（含 DeleteMarker——ListObjectVersions 空）
    expect(await verifyObjectsPurged(svc, [k1, `${pid}/multi.thumb.jpg`, k2, k3])).toEqual([]);
    // 残件 Abort 后 ListMultipartUploads 零在位
    expect((await svc.listMultipartUploads()).length).toBe(0);
    // run 行推进 PURGING_CACHE
    expect((await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: run.erasureId } })).state).toBe('PURGING_CACHE');
  }, 60_000);

  it('⑮-② 非版本化桶：现行对象删除+manifest−DB 现存 diff（detach 行对象保留）', async (ctx) => {
    if (!minioUp) return ctx.skip();
    const pid = await seedProject();
    const { svc } = await makeBucket(false);
    const kDel = `${pid}/del.bin`, kKeep = `${pid}/keep.bin`;
    await svc.upload(kDel, Buffer.from('d'), 'application/octet-stream');
    await svc.upload(kKeep, Buffer.from('k'), 'application/octet-stream');
    // DB 现存=keep 行（detach 保留形态——库资产/他引用档对象不删）
    await prisma.media.create({ data: { id: `${pid}-m-keep`, userId: owner, teamId, projectId: pid, bucket: 'flowai', key: kKeep, originalName: 'keep', mimeType: 'application/octet-stream', size: 1n, type: 'uploaded' } });
    const m = await writeManifest(pid, [
      { id: `${pid}-m-del`, key: kDel },
      { id: `${pid}-m-keep`, key: kKeep },
    ]);
    const run = await runRow(pid, m.manifestPath);
    const res = await executePurgingObjectsStage({ prisma: prismaService, run, objects: svc });
    expect(res.outcome).toBe('purging-cache');
    // 删除面=manifest−DB 现存：kDel 删（现行对象 404）、kKeep 保留（detach 行对象在位）
    await expect(svc.statSize(kDel)).rejects.toThrow();
    expect(await svc.statSize(kKeep)).toBe(1);
  }, 60_000);

  it('⑮-④ verifyObjectsPurged 负例：对象在位→violations 非空（版本化=版本清单/非版本化=Head 200）；删净→[]', async (ctx) => {
    if (!minioUp) return ctx.skip();
    // 版本化分支：上传=现行版本在位→violations 非空；版本清单删净→[]
    const v = await makeBucket(true);
    await v.svc.upload('poison-k', Buffer.from('x'), 'application/octet-stream');
    expect(await verifyObjectsPurged(v.svc, ['poison-k'])).toHaveLength(1);
    const refs = await v.svc.listObjectVersionRefs('poison-k');
    await v.svc.deleteObjectVersions(refs.map((r) => ({ Key: r.key, VersionId: r.versionId })));
    expect(await verifyObjectsPurged(v.svc, ['poison-k'])).toEqual([]);
    // 非版本化分支：Head 200→violations 非空
    const nv = await makeBucket(false);
    await nv.svc.upload('poison-k2', Buffer.from('x'), 'application/octet-stream');
    expect(await verifyObjectsPurged(nv.svc, ['poison-k2'])).toHaveLength(1);
  }, 60_000);

  it('⑮-③ kill -9 重跑幂等：已删键重删零错（NoSuchKey 折幂等）+dryRun 零删', async (ctx) => {
    if (!minioUp) return ctx.skip();
    const pid = await seedProject();
    const { svc } = await makeBucket(false);
    const k = `${pid}/idem.bin`;
    await svc.upload(k, Buffer.from('x'), 'application/octet-stream');
    const m = await writeManifest(pid, [{ id: `${pid}-m`, key: k }]);
    const run = await runRow(pid, m.manifestPath);
    // dryRun：surface 计算完整+零删（对象在位）
    await prisma.projectErasureRun.update({ where: { erasureId: run.erasureId }, data: { dryRun: true } });
    const dry = await executePurgingObjectsStage({ prisma: prismaService, run: await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: run.erasureId } }), objects: svc });
    expect(dry.outcome).toBe('dry-run');
    expect(await svc.statSize(k)).toBe(1);   // 零删
    // 真跑两轮（kill -9 各批重跑形态——第二轮全键已删）
    await prisma.projectErasureRun.update({ where: { erasureId: run.erasureId }, data: { dryRun: false } });
    const r1 = await executePurgingObjectsStage({ prisma: prismaService, run: await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: run.erasureId } }), objects: svc });
    expect(r1.outcome).toBe('purging-cache');
    await prisma.projectErasureRun.update({ where: { erasureId: run.erasureId }, data: { state: 'PURGING_OBJECTS' } });
    const r2 = await executePurgingObjectsStage({ prisma: prismaService, run: await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: run.erasureId } }), objects: svc });
    expect(r2.outcome).toBe('purging-cache');   // 重跑收敛零错（幂等）
    expect(await verifyObjectsPurged(svc, [k])).toEqual([]);
  }, 60_000);
});

describe('C4-c2 ★红⑮ capability detect 分支单测（stub——CI RustFS 非版本化承载面）', () => {
  it('非版本化→DeleteObjects 现行对象路径；版本化→ListObjectVersions+逐版本删除路径', async () => {
    const calls: string[] = [];
    const stub = (versioned: boolean): ErasureObjectPort & { _keys?: string[] } => {
      const s = {
        _keys: [] as string[],
        async getBucketVersioningStatus() { calls.push(`status:${versioned}`); return versioned ? ('Enabled' as const) : ('Unversioned' as const); },
        async listObjectVersionRefs(key: string) { calls.push(`list:${key}`); return [{ key, versionId: `${key}#1` }, { key, versionId: `${key}#2` }]; },
        async deleteObjectsByKeys(keys: readonly string[]) { calls.push(`delKeys:${keys.join(',')}`); return keys.length; },
        async deleteObjectVersions(vs: ReadonlyArray<{ Key: string; VersionId: string }>) { calls.push(`delVers:${vs.length}`); return vs.length; },
        async listMultipartUploads() { return []; },
        async abortMultipartUpload() { calls.push('abort'); },
        async getReplicationRuleCount() { return 0; },
        async getObjectLockEnabled() { return false; },
        async getLifecycleRuleCount() { return 0; },
        async statObject() { throw Object.assign(new Error('NotFound'), { name: 'NotFound' }); },
      };
      return s;
    };
    // 非版本化分支：delKeys 路径
    calls.length = 0;
    expect((await executePurgingObjectsStage({
      prisma: null as never,   // surface 由 manifest 直给（prisma 面=DB 现存 diff——上方 int 已覆；此处 mediaIds 空集由 manifest 空承载）
      run: { erasureId: 'stub-nv', scopeId: 'p1', dryRun: false, requestedAt: new Date(), manifestPath: 'stub' } as never,
      objects: stub(false),
      manifestOverride: { media: [{ id: 'm1', bucket: '', key: 'k1', thumbnailKey: null, objectKey: null, size: 0n }], work: [], spool: [], redis: { workIds: [], urlKeys: [] } },
      survivingMediaIdsOverride: new Set<string>(),
    }) as { outcome: string }).outcome).toBe('purging-cache');
    expect(calls).toContain('delKeys:k1');
    expect(calls.join(',')).not.toContain('list:');
    // 版本化分支：list+delVers 路径
    calls.length = 0;
    await executePurgingObjectsStage({
      prisma: null as never,
      run: { erasureId: 'stub-v', scopeId: 'p1', dryRun: false, requestedAt: new Date(), manifestPath: 'stub' } as never,
      objects: stub(true),
      manifestOverride: { media: [{ id: 'm1', bucket: '', key: 'k1', thumbnailKey: null, objectKey: null, size: 0n }], work: [], spool: [], redis: { workIds: [], urlKeys: [] } },
      survivingMediaIdsOverride: new Set<string>(),
    });
    expect(calls.join(',')).toContain('list:k1');
    expect(calls.join(',')).toContain('delVers:2');   // 旧版本+Marker 全版本
    expect(calls.join(',')).not.toContain('delKeys:');
  });

  it('capability 披露：replication 规则在位/object-lock 在位→disclosure 载荷非假绿（不抛）', async () => {
    const stub: ErasureObjectPort = {
      async getBucketVersioningStatus() { return 'Unversioned'; },
      async listObjectVersionRefs() { return []; },
      async deleteObjectsByKeys() { return 0; },
      async deleteObjectVersions() { return 0; },
      async listMultipartUploads() { return []; },
      async abortMultipartUpload() { /* noop */ },
      async getReplicationRuleCount() { return 2; },     // 副本规则在位
      async getObjectLockEnabled() { return true; },      // 对象锁在位
      async getLifecycleRuleCount() { return 0; },
      async statObject() { throw Object.assign(new Error('NotFound'), { name: 'NotFound' }); },
    };
    const res = await executePurgingObjectsStage({
      prisma: null as never,
      run: { erasureId: 'stub-disc', scopeId: 'p1', dryRun: false, requestedAt: new Date(), manifestPath: 'stub' } as never,
      objects: stub,
      manifestOverride: { media: [], work: [], spool: [], redis: { workIds: [], urlKeys: [] } },
      survivingMediaIdsOverride: new Set<string>(),
    });
    expect(res.outcome).toBe('purging-cache');
    if (res.outcome === 'purging-cache') {
      expect(res.disclosure).toEqual(expect.arrayContaining([expect.stringContaining('replication'), expect.stringContaining('object-lock')]));
    }
  });

  it('deriveObjectDeletionSurface 纯函数：manifest−DB 现存 by id；work 键不入面（VideoWork detach 保留）', () => {
    const media = [
      { id: 'm1', bucket: '', key: 'k1', thumbnailKey: 't1', objectKey: null, size: 0n },
      { id: 'm2', bucket: '', key: 'k2', thumbnailKey: null, objectKey: 'o2', size: 0n },
      { id: 'm3', bucket: '', key: 'k3', thumbnailKey: null, objectKey: null, size: 0n },   // detach 保留（DB 现存）
    ];
    const surface = deriveObjectDeletionSurface(media, new Set(['m3']));
    expect([...surface.keys].sort()).toEqual(['k1', 'k2', 'o2', 't1']);   // m1/m2 全键族（key+thumb/object 双形态）+m3 排除
    expect(surface.deletedMediaIds).toEqual(['m1', 'm2']);
  });
});
