import { Injectable, Inject, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { assertTeamMember } from '../team/team.util';

// Y1a+Y1b T5：读侧重构——getMediaUrl（GET /api/media/:id/url 的 presign+Redis 缓存）整端删除
// （读侧 presign 旁路：绕过 MIME 嗅探面与团队级单门）；读路径唯一=GET /:fileId/content
// （media-content.controller——assertMediaReadable 单门+两态）。by-key 维持（公开素材 uploads/system/
// 唯一合法域——无 Media 行/无团队归属，单门不适用；消费面=VipSubscribeModal banner）。
@Injectable()
export class MediaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  /** 读 ACL 团队级单门（spec v11：assertTeamMember(Media.teamId)——同 team 跨项目 200/跨 team 403）。
   *  唯一兜底：已发布作品引用（videoMediaId 锚）——平台作品公开页对全员可读（userId null 同样适用；
   *  HTTP 面经 AuthGuard 必有身份，null 形态留给服务层调用方）。 */
  async assertMediaReadable(media: { id: string; teamId: string }, userId: string | null | undefined): Promise<void> {
    if (userId) {
      try {
        await assertTeamMember(this.prisma, media.teamId, userId);
        return;
      } catch {
        /* 落兜底判一次作品引用（成员门失败≠终判——平台作品对非成员开放） */
      }
    }
    const published = await this.prisma.videoWork.findFirst({
      where: { videoMediaId: media.id, status: 'PUBLISHED' },
      select: { id: true },
    });
    if (published) return;
    throw new ForbiddenException('非团队成员');
  }

  /** content 路由行装载：缺失/软删 → null（controller 404）；在库 → 单门（拒=403 透传）后整行返回 */
  async findReadable(fileId: string, userId: string | undefined) {
    const media = await this.prisma.media.findUnique({ where: { id: fileId } });
    if (!media || media.deletedAt) return null;
    await this.assertMediaReadable(media, userId);
    return media;
  }

  /** 公开 by-key 兑换（唯一合法域：运营公开素材 uploads/system/）。
   *  仅 trim 规范化（禁止二次解码——Express 已解码一次，再解 %2F..%2F 会绕过前缀），
   *  校验与签名必须用同一个 normalized 值。其余 key 一律 403（正路是 GET /api/media/:fileId/content）。 */
  async getPresignedUrlByKey(rawKey: string): Promise<string> {
    const key = (rawKey ?? '').trim();
    if (!key) throw new BadRequestException('key is required');
    if (!key.startsWith('uploads/system/')) throw new ForbiddenException();
    return this.minio.generatePresignedGetUrl(key, 900);
  }
}
