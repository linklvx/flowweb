// Y1b T4（v11 裁决③）→Y1a T10 迁入 artifact-core（shared module 双 role：API+worker 均可装配）：
// MediaRegistrationService=唯一 Media 写入点——四形态：prepareUploadInTx/confirmInTx/bindInTx
// （upload/confirm 两形态共用 sniff/MIME/probeState 初始化）+registerInTx/completeRegisteredInTx
// （生成产物形态——T10：stage durable Media(processing)+finalize 状态提升；资金路径 media.create
// 禁第二处，一律经本服务）。
// 纪律：InTx 方法族只写 DB——事务内禁外部 IO（v10.1-②：外部 IO 在 orchestrator 层、事务之前）；
// registerInTx 禁调 assertOnConfirm（v12 裁决④：storage-quota 超限删对象+删行——事务内副作用不可
// 回滚；资金 quota=软限，finalize 不因 quota 回滚）。
import {
  Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit, ConflictException,
} from '@nestjs/common';
import { Prisma, Media, ProbeState, MediaBinding } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';

/** pending 上传 TTL（spec Z7''-v14：24h——presign 900s×重试窗后仍未 confirm 即弃；现状永不过期可占满 MinIO） */
export const PENDING_UPLOAD_TTL_MS = 24 * 3600_000;
/** pending 清理轮询周期——R28 纪律：原生 setInterval+unref（@Cron 全仓未导入是死代码，参照 intent-reconcile）。
 *  取值依据：TTL 24h 量级下 1h 轮询=过期行至多滞留 1h；每轮 ≤SWEEP_PAGE 100 行限单轮开销；积压>100 按轮消化（有意设计）。 */
export const PENDING_UPLOAD_SWEEP_INTERVAL_MS = 3600_000;
const SWEEP_PAGE = 100;

// T6④：sniffMimeType/isAllowedUploadMime 提取至 ./sniff（file-type 单一 import 点）——消费点改经 sniff 模块。

/** confirm 按 sniffed 重算 probeState（spec Z7'' :311——probe claim 只吃 image/video 非 SVG；
 *  audio 无 natural 可算=skipped。伪报 audio 的图片字节→pending，probe 路由以 sniffed 为准）。 */
export function probeStateForMime(mime: string): ProbeState {
  return mime.startsWith('image/') || mime.startsWith('video/') ? 'pending' : 'skipped';
}

export interface PrepareUploadParams {
  userId: string;
  teamId: string;
  /** orchestrator 预分配对象键（幂等命中时忽略——复用行内 key） */
  key: string;
  projectId?: string | null;
  clientUploadId?: string | null;
  fileName: string;
  mimeType: string;
  size: number | bigint;
  type: 'uploaded' | 'temp'; // 对齐 PresignUploadDto（generated 形态归 T10 register，不走 presign）
}

export interface ConfirmUploadParams {
  mediaId: string;
  actualSize: number | bigint;
  sniffedMimeType: string;
}

@Injectable()
export class MediaRegistrationService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MediaRegistrationService.name);
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  /** T4-①：presign 幂等入口——同 teamId+clientUploadId 复用既有行与 key（网络重试恰一行）。
   *  崩溃窗=行在 presign 无 → 重试同 uploadId 复用行重新 presign。 */
  async prepareUpload(params: PrepareUploadParams): Promise<Media> {
    if (params.clientUploadId) {
      const existing = await this.findByUploadId(params.teamId, params.clientUploadId);
      if (existing) return this.reuseOrReject(existing);
    }
    try {
      return await this.prisma.$transaction((tx) => this.prepareUploadInTx(tx, params));
    } catch (e) {
      // 并发同键：胜者行已落（@@unique([teamId,clientUploadId])）——P2002 时事务已中止，须在事务外重读
      if ((e as { code?: string }).code === 'P2002' && params.clientUploadId) {
        const existing = await this.findByUploadId(params.teamId, params.clientUploadId);
        if (existing) return this.reuseOrReject(existing);
      }
      throw e;
    }
  }

  /** 非 pending 行禁复用禁重签：completed 后重放 presign=同 key 覆写已完成对象（绕过 size/sniff 终判） */
  private reuseOrReject(existing: Media): Media {
    if (existing.status !== 'pending') {
      throw new ConflictException('该上传已确认，clientUploadId 不可复用');
    }
    return existing;
  }

  private findByUploadId(teamId: string, clientUploadId: string): Promise<Media | null> {
    return this.prisma.media.findUnique({
      where: { teamId_clientUploadId: { teamId, clientUploadId } },
    });
  }

  /** 事务内落 pending 行（幂等锚先于 presign）。pendingExpiresAt=TTL；type=temp 维持 7d expiresAt 语义。 */
  async prepareUploadInTx(tx: Prisma.TransactionClient, params: PrepareUploadParams): Promise<Media> {
    return tx.media.create({
      data: {
        userId: params.userId,
        teamId: params.teamId,
        projectId: params.projectId ?? undefined,
        bucket: 'flowai',
        key: params.key,
        originalName: params.fileName,
        mimeType: params.mimeType,
        size: params.size,
        status: 'pending',
        type: params.type,
        clientUploadId: params.clientUploadId ?? undefined,
        pendingExpiresAt: new Date(Date.now() + PENDING_UPLOAD_TTL_MS),
        expiresAt: params.type === 'temp' ? new Date(Date.now() + 7 * 24 * 3600_000) : null,
      },
    });
  }

  /** T4-②：confirm 终判（status='pending' CAS——并发双 confirm 恰一 completed；
   *  count===0=他方已 confirm/行已清理/TTL 已扫 → 409） */
  async confirmUpload(params: ConfirmUploadParams): Promise<void> {
    await this.prisma.$transaction((tx) => this.confirmInTx(tx, params));
  }

  async confirmInTx(tx: Prisma.TransactionClient, params: ConfirmUploadParams): Promise<void> {
    const { count } = await tx.media.updateMany({
      where: { id: params.mediaId, status: 'pending' }, // CAS 守卫（现状 storage:69-99 无守卫根修）
      data: {
        status: 'completed',
        size: params.actualSize,
        sniffedMimeType: params.sniffedMimeType,
        probeState: probeStateForMime(params.sniffedMimeType),
        pendingExpiresAt: null, // 离开 pending 态——TTL 扫描不再命中
        factVersion: { increment: 1 }, // status+sniff 变更（schema :311 单调事实版本）
      },
    });
    if (count !== 1) throw new ConflictException('上传已在确认中或已完成');
  }

  /** mismatch/白名单拒共享清理分支：守卫只删 pending 行（并发 confirm 已完成时零副作用） */
  async deletePending(mediaId: string): Promise<number> {
    const { count } = await this.prisma.media.deleteMany({ where: { id: mediaId, status: 'pending' } });
    return count;
  }

  /** MediaBinding 槽位 current-state upsert（v14.2 裁决㉜/Z18''：同槽位换 media 即改行——
   *  create-only 已废止：永不删行则当前槽位是哪个 media 只能靠 createdAt 猜、GC 被历史行拖住。
   *  键 [projectId,nodeId,role,targetField,targetItemId]；模型 createdAt only 故 update 仅 mediaId。） */
  async bindInTx(
    tx: Prisma.TransactionClient,
    params: {
      mediaId: string; projectId: string; nodeId: string; teamId: string;
      role?: string; targetField?: string; targetItemId?: string;
    },
  ): Promise<MediaBinding> {
    const data = {
      mediaId: params.mediaId,
      projectId: params.projectId,
      nodeId: params.nodeId,
      teamId: params.teamId,
      role: params.role ?? 'primary',
      targetField: params.targetField ?? 'fileId',
      targetItemId: params.targetItemId ?? '', // 非空 sentinel（PG NULL 不去重根修）
    };
    return tx.mediaBinding.upsert({
      where: {
        projectId_nodeId_role_targetField_targetItemId: {
          projectId: data.projectId, nodeId: data.nodeId, role: data.role,
          targetField: data.targetField, targetItemId: data.targetItemId,
        },
      },
      create: data,
      update: { mediaId: data.mediaId }, // current-state：同槽位换 media 改行（v14.2 废止 create-only）
    });
  }

  // ── T10：生成产物形态（register=stage durable；completeRegistered=finalize 状态提升） ──

  /** T10 registerInTx：生成产物 stage 行（Media(processing)=统一 stage 句柄——v13b 裁决③ durable 化）。
   *  幂等锚=@@unique(bucket,key)（provisional key 按 [teamId,intentRowId,execSeq,artifactIndex] 确定性
   *  预分配——同 intent+execSeq 重跑/崩溃复驱恰一行）；ON CONFLICT DO NOTHING+回读（禁事务内 catch
   *  P2002 再查——事务一报错即 aborted）。同事务插 processing fact（UI「处理中」推送来源——Z1''）。
   *  全 kind 的 stage 行落 sourceUrl（image 系 provider URL 崩溃后 R3 凭行重下——v14 骨架补强）。 */
  async registerInTx(tx: Prisma.TransactionClient, params: {
    userId: string; teamId: string; projectId?: string | null; nodeId?: string | null; taskId?: string | null;
    key: string; sourceUrl: string; sourceUrlExpiresAt: Date;
    mimeType: string; originalName: string;
    sourceIntentRowId?: string | null; sourceExecSeq?: bigint | null; artifactIndex?: number;
  }): Promise<Media> {
    // 资金锚优先复用：同 intent+execSeq+index 的 stage/finalize 复驱（R3/幂等重跑）恒复用同一行——
    // finalize 提升会把 key 改写为 content-addressed 形态，base-key 的 ON CONFLICT 对复驱失效，
    // 锚查在先即「零新行」；（bucket,key）唯一仍兜底并发双插（确定性 base key 同键冲突）。
    if (params.sourceIntentRowId) {
      const anchored = await tx.media.findFirst({
        where: {
          sourceIntentRowId: params.sourceIntentRowId,
          ...(params.sourceExecSeq !== undefined && params.sourceExecSeq !== null ? { sourceExecSeq: params.sourceExecSeq } : {}),
          artifactIndex: params.artifactIndex ?? 0,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (anchored) return anchored;
    }
    await tx.$executeRaw`
      INSERT INTO "Media" (
        "id", "userId", "teamId", "projectId", "nodeId", "taskId",
        "bucket", "key", "originalName", "mimeType", "size", "type", "status",
        "sourceUrl", "sourceUrlExpiresAt", "sourceIntentRowId", "sourceExecSeq", "artifactIndex", "objectKey", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${params.userId}, ${params.teamId}, ${params.projectId ?? null}, ${params.nodeId ?? null}, ${params.taskId ?? null},
        'flowai', ${params.key}, ${params.originalName}, ${params.mimeType}, 0, 'generated', 'processing'::"MediaStatus",
        ${params.sourceUrl}, ${params.sourceUrlExpiresAt}, ${params.sourceIntentRowId ?? null}, ${params.sourceExecSeq ?? null}, ${params.artifactIndex ?? 0}, ${params.key},
        (now() AT TIME ZONE 'utc')
      )
      ON CONFLICT ("bucket", "key") DO NOTHING`;
    const media = await tx.media.findUniqueOrThrow({ where: { bucket_key: { bucket: 'flowai', key: params.key } } });
    if (params.projectId) {
      await tx.mediaFactOutbox.createMany({
        data: [{
          mediaId: media.id, projectId: params.projectId, factVersion: media.factVersion,
          factType: 'state', payload: { status: 'processing' },
        }],
        skipDuplicates: true,   // [mediaId,projectId,factType,factVersion] 唯一
      });
    }
    return media;
  }

  /** T10 completeRegisteredInTx：finalize 事务内状态提升（processing→completed 补 key/sha/size/sniff）。
   *  status CAS 守卫——已 completed（幂等重入）零动作；probeState=skipped（T7：probe 仅上传路径——
   *  生成产物不入 probe 池，natural 归 materialize/后续）；completed state fact 同事务（factVersion+1）。 */
  async completeRegisteredInTx(tx: Prisma.TransactionClient, params: {
    mediaId: string; projectId: string; key: string; sha256: string;
    mimeType: string; sniffedMimeType: string | null; size: number | bigint;
  }): Promise<void> {
    const { count } = await tx.media.updateMany({
      where: { id: params.mediaId, status: 'processing' },
      data: {
        status: 'completed',
        key: params.key,
        objectSha256: params.sha256,
        size: params.size,
        mimeType: params.mimeType,
        ...(params.sniffedMimeType ? { sniffedMimeType: params.sniffedMimeType } : {}),
        probeState: 'skipped',
        factVersion: { increment: 1 },
      },
    });
    if (count !== 1) return;   // 幂等重入（已完成/R3 复驱）——零动作
    await tx.mediaFactOutbox.createMany({
      data: [{
        mediaId: params.mediaId, projectId: params.projectId,
        factVersion: (await tx.media.findUniqueOrThrow({ where: { id: params.mediaId }, select: { factVersion: true } })).factVersion,
        factType: 'state', payload: { status: 'completed' },
      }],
      skipDuplicates: true,
    });
  }

  // ── T4-③：pending TTL 清理（24h 过期行+对象；R28 原生 setInterval+unref） ──

  onModuleInit() {
    const t = setInterval(() => {
      void this.sweepExpiredPending().catch((e) => this.logger.warn(`pendingUploadSweep: ${e}`));
    }, PENDING_UPLOAD_SWEEP_INTERVAL_MS);
    t.unref?.();
    this.sweepTimer = t;
  }

  onApplicationShutdown() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  /** 过期 pending 行清理：先删对象（404 容忍；其他错误保留下轮重试）再守卫删行——
   *  崩溃窗自愈：对象已删行未删 → 下轮重扫（幂等）；只扫 pendingExpiresAt 非空行
   *  （生成 processing 行无此列值，materialize 生命周期不进本扫）。 */
  async sweepExpiredPending(): Promise<number> {
    if (this.sweeping) return 0; // 上轮未竟跳轮（幂等由行级 status 守卫保证，跳轮无损）
    this.sweeping = true;
    try {
      const expired = await this.prisma.media.findMany({
        where: { status: 'pending', pendingExpiresAt: { lt: new Date() } },
        select: { id: true, key: true },
        take: SWEEP_PAGE,
      });
      let removed = 0;
      for (const m of expired) {
        try {
          await this.minio.delete(m.key);
        } catch (e) {
          const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
            ?? (e as { name?: string }).name;
          if (status !== 404 && status !== 'NoSuchKey') {
            this.logger.warn(`pendingUploadSweep 对象删除失败（行保留待下轮）key=${m.key}: ${e}`);
            continue;
          }
        }
        removed += await this.deletePending(m.id); // 守卫删 pending 行（与 mismatch/白名单拒清理同一语义）
      }
      return removed;
    } finally {
      this.sweeping = false;
    }
  }
}
