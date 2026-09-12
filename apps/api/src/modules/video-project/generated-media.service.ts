// apps/api/src/modules/video-project/generated-media.service.ts
import { Injectable, Inject, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { StorageQuotaService } from '../team/storage-quota.service'; // 实际在 team/ 模块（TeamModule 已 export）
import { ProjectPermissionService } from '../team/project-permission.service';
import { THUMBNAIL_GENERATOR_QUEUE } from '../material-library/constants/material-library.constants';

@Injectable()
export class GeneratedMediaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(StorageQuotaService) private readonly quota: StorageQuotaService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @InjectQueue(THUMBNAIL_GENERATOR_QUEUE) private readonly thumbnailQueue: Queue,
  ) {}

  /**
   * 登记入口——**编码完成后调用**（前端持有 Blob，actualSize = Blob.size）。
   * 时序关键：generatePresignedPost 的 Conditions 含 content-length-range ±1024——
   * 编码前估算体积过不了该条件，必须用真实字节数（spec v3.6 时序修正）。
   * teamId 服务端从 workflowId 派生（assertCanUpload 无成员校验——客户端传他团 teamId
   * 会打他团配额并把产物记到他团名下；对齐 storage.service.presignUpload 的 projectId 派生先例）。
   */
  async register(input: { userId: string; workflowId: string; videoProjectId: string; resolution: string; durationSec: number; actualSize: number; width?: number; height?: number; clientRequestId?: string }) {
    await this.perm.assertEditor(input.workflowId, input.userId);
    // 幂等重入（P1-D）：同 clientRequestId 的 register 重试返回同一 Media/presigned——插入点在
    // project 查询与 assertCanUpload 之前（插后者重试被二次配额拦截）、assertEditor 之后（不得绕过权限门）；
    // userId 作用域化防枚举他人 clientRequestId 命中他人 pending 行（R18②）
    if (input.clientRequestId) {
      const existing = await this.prisma.media.findFirst({
        where: {
          userId: input.userId,
          metadata: { path: ['clientRequestId'], equals: input.clientRequestId },
          status: 'pending', // completed 同 id 命中即语义错误（复用旧产物=第二次导出静默覆盖首产物 key）
        },
      });
      if (existing) {
        const upload = await this.minio.generatePresignedPost(existing.key, 'video/mp4', existing.size);
        return { mediaId: existing.id, upload };
      }
    }
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: input.workflowId },
      select: { teamId: true },
    });
    if (!project) throw new BadRequestException('项目不存在');
    const teamId = project.teamId;
    await this.quota.assertCanUpload(teamId, input.actualSize); // 配额终判（真实大小）
    const key = this.minio.buildKey('generated', input.userId, { projectId: input.workflowId, ext: 'mp4' });
    const media = await this.prisma.media.create({
      data: {
        userId: input.userId, teamId, projectId: input.workflowId,
        bucket: 'flowai', key, originalName: `export-${input.resolution}.mp4`,
        mimeType: 'video/mp4', size: input.actualSize,
        type: 'generated', status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 3600_000), // 对象未 confirm 前可回收（temp-cleanup 按 expiresAt 扫 generated pending）
        metadata: { origin: 'video-project', videoProjectId: input.videoProjectId, resolution: input.resolution, durationSec: input.durationSec, width: input.width, height: input.height, clientRequestId: input.clientRequestId },
      },
    });
    const upload = await this.minio.generatePresignedPost(key, 'video/mp4', input.actualSize);
    return { mediaId: media.id, upload }; // upload: { url, fields }——前端 FormData 逐字段填 + file 最后追加
  }

  /** 确认：statSize 实际大小落库（无 ±1024 比对——勿误调 storage.confirmUpload）+ 缩略图 seekSec 从 metadata 读 */
  async confirm(userId: string, dto: { mediaId: string }) {
    const media = await this.prisma.media.findUnique({ where: { id: dto.mediaId } });
    if (!media || media.userId !== userId) throw new ForbiddenException('media not found');
    const actualSize = await this.minio.statSize(media.key); // 统一口径（ContentLength ?? 0）——stats.size 不存在，真机必 undefined
    // 配额终判（Q7）：插 statSize 后、thumbnailQueue.add 前——超限时 assertOnConfirm 内部已删对象+删行，
    // 插 add 后缩略图任务指向死行、插 update 后 P2025（R13④）
    await this.quota.assertOnConfirm(media.id, actualSize, media.key, media.bucket);
    const durationSec = Number((media.metadata as any)?.durationSec ?? 0);
    const seekSec = Math.max(1, durationSec * 0.1); // 防前导黑场黑帧；consumer 需支持可选 seekSec（默认 1 保持旧行为）
    await this.thumbnailQueue.add('generate-thumbnail',
      { mediaId: media.id, key: media.key, mimeType: 'video/mp4', seekSec });
    return this.prisma.media.update({
      where: { id: media.id },
      data: { status: 'completed', size: actualSize, expiresAt: null }, // completed 不进 24h 回收
    });
  }
}
