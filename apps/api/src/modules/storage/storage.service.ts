import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { PresignUploadDto } from './dto/presign.dto';
import { ConfirmUploadDto } from './dto/confirm.dto';
import { getOwnerTeamId, assertTeamMember } from '../team/team.util';
import { StorageQuotaService } from '../team/storage-quota.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { MediaRegistrationService } from '../artifact-core/media-registration.service';
import { sniffMimeType, isAllowedUploadMime } from '../media/sniff';   // T6④：file-type 单一 import 点

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(StorageQuotaService) private readonly quota: StorageQuotaService,
    @Inject(MediaRegistrationService) private readonly registration: MediaRegistrationService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
  ) {}

  async presignUpload(userId: string, dto: PresignUploadDto) {
    // 三级回落：projectId（后端解析+**project editor 门**——T5 写 ACL 独立：写侧要编辑权，
    // viewer presign 403）> teamId（assertMember——素材库上传是成员级）> 默认团队
    let teamId: string;
    let projectId: string | undefined;
    if (dto.projectId) {
      const resolved = await this.perm.assertEditorWithTeam(dto.projectId, userId);   // 项目不存在 404/无编辑权 403（teamId 同链带出）
      teamId = resolved.teamId;
      projectId = dto.projectId;
    } else if (dto.teamId) {
      await this.quota.assertMember(dto.teamId, userId);
      teamId = dto.teamId;
    } else {
      teamId = await getOwnerTeamId(this.prisma, userId);
    }
    // quota estimatedSize 预检（=fileSize 预占；confirm 按 actualSize 终判——Q7 两道，两并发 presign 可同过）
    await this.quota.assertCanUpload(teamId, dto.fileSize);

    const clientUploadId = normalizeClientUploadId(dto.clientUploadId);
    const ext = dto.fileName.split('.').pop() || 'bin';
    const key = this.minio.buildKey(dto.type, userId, { ext });

    // 行先落（幂等锚）再 presign（外部 IO 在事务外）——崩溃窗=行在 presign 无，重试同 uploadId 复用行重新 presign
    const media = await this.registration.prepareUpload({
      userId, teamId, projectId, clientUploadId, key,
      fileName: dto.fileName, mimeType: dto.fileType, size: dto.fileSize, type: dto.type,
    });

    // 幂等命中时复用行内 key/声明（Content-Type 进 fields+policy 精确匹配——T4 红测组⑤）
    const { url, fields } = await this.minio.generatePresignedPost(
      media.key,
      media.mimeType,
      Number(media.size),
    );

    return {
      fileId: media.id,
      uploadUrl: url,
      key: media.key,
      fields,
    };
  }

  async confirmUpload(userId: string, dto: ConfirmUploadDto) {
    const media = await this.prisma.media.findFirst({
      where: { id: dto.fileId },
    });
    if (!media) {
      throw new BadRequestException('文件记录不存在');
    }
    if (media.userId !== userId) {
      await assertTeamMember(this.prisma, media.teamId, userId);
    }

    // D1 服务层收口：一律以 media 行为唯一事实源。dto.key/dto.fileSize 已不读——
    // 请求体 key 曾流入 statSize/minio.delete（mismatch 分支）与 assertOnConfirm（配额分支），
    // 构成任意对象删除面。禁止回退 `media.size ?? dto.fileSize`（会让本性质静默失效）。
    const actualSize = await this.minio.statSize(media.key);

    if (Math.abs(actualSize - Number(media.size)) > 1024) { // Media.size BigInt（T2 质评收口）——比较域转 number 机械适配（T6 收紧：禁全局 BigInt.prototype.toJSON——本响应仅 fileId 无 BigInt 面）
      await this.minio.delete(media.key);
      await this.registration.deletePending(dto.fileId);
      throw new BadRequestException('文件大小不匹配，请重新上传');
    }

    // Z7'' MIME 安全链：嗅探对象头字节（file-type 16.x）→ 白名单外（含不可判型/SVG）拒+删对象+删行
    //（与 mismatch 分支同构）；sniffed 为准落列，probeState 按 sniffed 路由（T4 红测组④）
    const head = await this.minio.getHeadBytes(media.key);
    const sniffed = await sniffMimeType(head);
    if (sniffed === null || !isAllowedUploadMime(sniffed)) {
      this.logger.warn(`confirmUpload MIME 嗅探拒 key=${media.key} sniffed=${sniffed ?? '不可判型'} declared=${media.mimeType}——已删对象+pending 行`);
      await this.minio.delete(media.key);
      await this.registration.deletePending(dto.fileId);
      throw new BadRequestException('文件类型不受支持（内容校验未通过）');
    }

    // 上传路径维持硬限语义（v10.1-②软限裁决只针对资金 register 形态——T10 registerInTx 禁调本方法）
    await this.quota.assertOnConfirm(dto.fileId, actualSize);

    // status='pending' CAS：并发双 confirm 恰一 completed，败方 409（T4 红测组②）
    await this.registration.confirmUpload({
      mediaId: dto.fileId,
      actualSize,
      sniffedMimeType: sniffed,
    });

    return { fileId: dto.fileId };
  }
}

/** clientUploadId 校验（网络重试幂等键——可选）：非空字符串且 ≤128；空串/缺省=不启用幂等 */
function normalizeClientUploadId(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || raw.length > 128) throw new BadRequestException('clientUploadId 非法');
  return raw;
}
