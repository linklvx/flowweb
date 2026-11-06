// apps/api/src/modules/collab/project-erasure.objects.ts
// C4-c2（plan Task C4-3 ★红⑮——生产就绪收尾批·project-erasure）：PURGING_OBJECTS **执行体**
// （自 poller 拆出——stages 同族；census ⑰ 闭包纯度=prisma/shared/manifest/minio 族，零 controller/
// Http 面）。
//
// 承接契约（C4-c1 stages 头注钉死——「对象删除面=manifest−DB 现存 media 行〔按 id diff——detach 行
// 留册但对象保留〕」）：
//  ①**对象删除面**：并集 manifest media 行集 − DB 现存 Media id 集 → 该行键族（key/thumbnailKey/
//    objectKey）全删。detach 保留档（库资产/他项目引用/作品 videoMediaId 引用）行在 DB 现存=对象
//    保留；VideoWork.videoKey/coverKey **恒不入面**（作品 detach 保留——产品裁定 2026-11-05：视频/
//    封面/计费/审计保留）；独占档行已随 PURGING_DB 删行=对象全版本删除；
//  ②**版本化 capability detect**：GetBucketVersioning→Enabled/Suspended=ListObjectVersions 逐版本
//    （旧版本+DeleteMarkers 全删——非版本化 delete 只删现行、旧版本静默残留=假绿根修）；
//    Unversioned=DeleteObjects 现行对象（1000/批）。kill -9 各批重跑幂等（S3 对不存在键静默成功
//    ——NoSuchKey 折幂等）；
//  ③**multipart 残件清理**：ListMultipartUploads 全量枚举∩删除面键集→Abort（残件不计入对象清单的
//    单独残留面——计费+存储双残留）；
//  ④**capability 披露（非假绿）**：replication 规则在位/object-lock 在位/lifecycle 规则在位→
//    日志+erasure_capability_disclosure_total 计数+结果载荷 disclosure 数组（副本桶/锁定对象的远端
//    保留期超出本系统权限域——诚实披露非失败，runbook §13 残余披露段登记；不阻断流程不冒充全清）；
//  ⑤完成=state='PURGING_CACHE' 即停（Redis/VERIFYING 归 cache/verifying 执行体）；dryRun=面计算+
//    capability detect 完整、零删零状态写（poller 不消费 dryRun 行——直调测试/admin 预览面）。
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ProjectErasureRun } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ErasureContextService } from './project-lock';
import { readErasureManifest, type ErasureManifest } from './project-erasure.manifest';
import { ERASURE_RUN_LEASE_MS } from './project-erasure';
import { erasureObjectsDeletedTotal, erasureStageDuration, erasureCapabilityDisclosureTotal, erasureRunsTotal } from './erasure.metrics';

/** 对象删除端口（MinioService 新增面+statObject 结构子集——三面可赋〔MinioService/stub〕；测试注入 stub）。 */
export interface ErasureObjectPort {
  getBucketVersioningStatus(): Promise<'Enabled' | 'Suspended' | 'Unversioned'>;
  listObjectVersionRefs(key: string): Promise<Array<{ key: string; versionId: string }>>;
  deleteObjectsByKeys(keys: readonly string[]): Promise<number>;
  deleteObjectVersions(versions: ReadonlyArray<{ Key: string; VersionId: string }>): Promise<number>;
  listMultipartUploads(): Promise<Array<{ key: string; uploadId: string }>>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  getReplicationRuleCount(): Promise<number>;
  getObjectLockEnabled(): Promise<boolean>;
  getLifecycleRuleCount(): Promise<number>;
  /** 现行对象存在性（Head——非版本化零残留复验面）。 */
  statObject(key: string): Promise<unknown>;
}

/** manifest media 行（并集档键族）。 */
export type ManifestMediaRow = ErasureManifest['media'][number];

/** DB 现存 id 批查批量（M6 承接：in 列表超 PG 65535 绑定参数上限=硬错——对象面批化兑现）。 */
const SURVIVING_QUERY_BATCH = 1000;

/**
 * 对象删除面派生（纯函数——红⑮断言面）：manifest media 行集 − DB 现存 id 集 → 键族并集
 * （key/thumbnailKey/objectKey 三形态去重）。work 行键族**恒不入面**（VideoWork detach 保留）。
 */
export function deriveObjectDeletionSurface(
  manifestMedia: readonly ManifestMediaRow[], survivingMediaIds: ReadonlySet<string>,
): { keys: string[]; deletedMediaIds: string[] } {
  const keys = new Set<string>();
  const deletedMediaIds: string[] = [];
  for (const m of manifestMedia) {
    if (survivingMediaIds.has(m.id)) continue;   // detach 保留档（行在 DB=库资产/他引用/作品引用）
    deletedMediaIds.push(m.id);
    for (const k of [m.key, m.thumbnailKey, m.objectKey]) if (typeof k === 'string' && k.length > 0) keys.add(k);
  }
  return { keys: [...keys].sort(), deletedMediaIds };
}

/** DB 现存 media id 集（manifest id 批查——chunk ≤1000 防 65535 绑定上限）。 */
export async function querySurvivingMediaIds(prisma: PrismaService, ids: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += SURVIVING_QUERY_BATCH) {
    const chunk = ids.slice(i, i + SURVIVING_QUERY_BATCH);
    if (chunk.length === 0) continue;
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Media" WHERE id IN (${Prisma.join(chunk)})`;
    for (const r of rows) out.add(r.id);
  }
  return out;
}

/** stage 结果（poller 只记日志——状态推进见 outcome）。 */
export type PurgingObjectsStageResult =
  | { outcome: 'purging-cache'; deletedObjects: number; abortedUploads: number; disclosure: string[] }
  | { outcome: 'dry-run'; surfaceKeys: number; disclosure: string[] };

/** capability 披露（replication/object-lock/lifecycle——在位即披露，计数+文案；非失败）。 */
async function detectCapabilityDisclosure(objects: ErasureObjectPort): Promise<string[]> {
  const disclosure: string[] = [];
  const rules = await objects.getReplicationRuleCount();
  if (rules > 0) {
    disclosure.push(`replication rules=${rules}（副本桶——对象删除不保证副本桶异步清除，保留期语义见 runbook §13 残余披露）`);
    erasureCapabilityDisclosureTotal.inc({ capability: 'replication' });
  }
  if (await objects.getObjectLockEnabled()) {
    disclosure.push('object-lock enabled（合规保留锁——锁定版本在保留期内不可删，超出本系统权限域）');
    erasureCapabilityDisclosureTotal.inc({ capability: 'object-lock' });
  }
  const lifecycle = await objects.getLifecycleRuleCount();
  if (lifecycle > 0) {
    disclosure.push(`lifecycle rules=${lifecycle}（桶策略与擦除交互——核对无对象保留规则后可忽略）`);
    erasureCapabilityDisclosureTotal.inc({ capability: 'lifecycle' });
  }
  return disclosure;
}

export interface PurgingObjectsStageDeps {
  /** null=stub 单测档（capability detect/删除路径分支面——manifest/surviving 覆写必给、状态写跳过）。 */
  prisma: PrismaService | null;
  run: ProjectErasureRun;
  objects: ErasureObjectPort;
  /** manifest 覆写（**测试缝**——stub 单测免 PG/免 header-footer 全形；生产恒缺省走 readErasureManifest(manifestPath)）。 */
  manifestOverride?: Pick<ErasureManifest, 'media' | 'work' | 'spool' | 'redis'>;
  /** DB 现存 id 覆写（**测试缝**——同上）。 */
  survivingMediaIdsOverride?: ReadonlySet<string>;
}

/**
 * PURGING_OBJECTS 执行体（poller processProjectRun 消费——state=PURGING_OBJECTS 前置位起）。
 * 自包裹 ErasureContext（poller 双包裹幂等）。kill -9 各批重跑幂等（并集 manifest 只读+删除幂等）。
 */
export async function executePurgingObjectsStage(deps: PurgingObjectsStageDeps): Promise<PurgingObjectsStageResult> {
  const { prisma, run, objects } = deps;
  const logger = new Logger('ProjectErasureObjects');
  const erasureCtx = new ErasureContextService();
  return erasureCtx.withErasure(run.erasureId, async () => {
    const t0 = Date.now();
    let result: PurgingObjectsStageResult;
    try {
      // ① manifest 读（footer SHA 复算不等=诚实披露抛错——R16）
      const manifest = deps.manifestOverride ?? await readErasureManifest(run.manifestPath!);
      // ② DB 现存 id 集（按 id diff——detach 行留册对象保留；stub 档 prisma=null 必配 override）
      const surviving = deps.survivingMediaIdsOverride ?? await querySurvivingMediaIds(prisma!, manifest.media.map((m) => m.id));
      // ③ 删除面派生（work 键族恒不入面）
      const surface = deriveObjectDeletionSurface(manifest.media, surviving);
      // ④ capability detect+披露（非假绿——在位披露不阻断）
      const disclosure = await detectCapabilityDisclosure(objects);
      // ⑤ dryRun：面计算+detect 完整、零删零状态写
      if (run.dryRun) return { outcome: 'dry-run', surfaceKeys: surface.keys.length, disclosure };
      // ⑥ 版本化分档删除（幂等——S3 对不存在键静默成功）
      const versioning = await objects.getBucketVersioningStatus();
      let deleted = 0;
      if (versioning === 'Enabled' || versioning === 'Suspended') {
        const versions: Array<{ Key: string; VersionId: string }> = [];
        for (const k of surface.keys) {
          for (const v of await objects.listObjectVersionRefs(k)) versions.push({ Key: v.key, VersionId: v.versionId });
        }
        deleted = await objects.deleteObjectVersions(versions);
      } else {
        deleted = await objects.deleteObjectsByKeys(surface.keys);
      }
      // ⑦ multipart 残件清理（全量枚举∩删除面键集→Abort）
      let aborted = 0;
      const surfaceSet = new Set(surface.keys);
      for (const u of await objects.listMultipartUploads()) {
        if (!surfaceSet.has(u.key)) continue;
        await objects.abortMultipartUpload(u.key, u.uploadId);
        aborted += 1;
      }
      erasureObjectsDeletedTotal.inc(deleted + aborted);
      // ⑧ 前置位：PURGING_CACHE 即停（Redis 归 cache 执行体）——stub 档（prisma=null）跳过状态写
      if (prisma) {
        const now = new Date();
        await prisma.projectErasureRun.update({
          where: { erasureId: run.erasureId },
          data: { state: 'PURGING_CACHE', stage: 'PURGING_OBJECTS', heartbeatAt: now, leaseUntil: new Date(now.getTime() + ERASURE_RUN_LEASE_MS) },
        });
      }
      erasureRunsTotal.inc({ state: 'PURGING_CACHE' });
      logger.log(JSON.stringify({ event: 'erasure_purging_objects_done', erasureId: run.erasureId, projectId: run.scopeId, keys: surface.keys.length, deletedObjects: deleted, abortedUploads: aborted, versioning, disclosure: disclosure.length }));
      result = { outcome: 'purging-cache', deletedObjects: deleted, abortedUploads: aborted, disclosure };
      return result;
    } finally {
      erasureStageDuration.observe({ stage: 'PURGING_OBJECTS' }, (Date.now() - t0) / 1000);
    }
  });
}

/**
 * 对象零残留复验（VERIFYING 消费——红⑮ 验证面）：删除面键族逐键核验——非版本化=HeadObject 404；
 * 版本化=ListObjectVersions 空（旧版本+DeleteMarker 全清）。返回 violations（空=零残留）。
 */
export async function verifyObjectsPurged(objects: ErasureObjectPort, keys: readonly string[]): Promise<string[]> {
  const violations: string[] = [];
  const versioning = await objects.getBucketVersioningStatus();
  for (const k of keys) {
    try {
      if (versioning === 'Enabled' || versioning === 'Suspended') {
        const refs = await objects.listObjectVersionRefs(k);
        if (refs.length > 0) violations.push(`对象 ${k} 版本残留 ${refs.length} 个（含 DeleteMarker——版本化桶须全清）`);
      } else {
        await objects.statObject(k);
        violations.push(`对象 ${k} 现行残留（Head 200）`);
      }
    } catch (e) {
      // 404=已删（零残留）；其余错误（网络/权限）上抛=复验失败重试（不折零假绿）
      const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      const name = (e as { name?: string })?.name;
      if (status !== 404 && name !== 'NotFound') throw e;
    }
  }
  return violations;
}
