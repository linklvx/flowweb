import { Injectable, Inject } from '@nestjs/common';
import { extractFlowaiObjectKey, resolveUpstreamMediaUrl } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';

/** 上游外呼 presign 有效期（秒）——上游图外呼消费先例口径（ai-image-edit.processor :136 同款 3600）。 */
const UPSTREAM_PRESIGN_TTL_SEC = 3600;

/** Y1a T8：上游媒体解析服务（S2）——上游注入读源改 NodeArtifact PG 权威后的三职责：
 *  ①readUpstreamMediaId：NodeArtifact 槽位 [projectId,nodeId,role='primary',targetField='result',
 *    targetItemId=''] → state='stored' 且 mediaId 非空 → mediaId（finalize 即建、claim 时刻必可读——
 *    doc 拓扑投影滞后不再取空/漂移；读侧契约——写侧 T10 ArtifactCommit 落地对齐此槽位）；
 *  ②canonicalizeMediaRef：doc 手工 URL → 身份形态（/flowai/ URL → key → Media (bucket,key) 反查；
 *    外网 URL 原样——用户不变则身份不变）——callArgs 构造（哈希输入）用；
 *  ③resolveCallUrl：身份 → 外呼可达 URL（Media.sourceUrl 未过期直传 provider → 过期/缺失降级
 *    presigned GET——nginx /flowai 域名公网形态）——外呼腿（哈希稳定身份、外呼时解析 URL）。 */
@Injectable()
export class UpstreamMediaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  async readUpstreamMediaId(projectId: string, nodeId: string): Promise<string | null> {
    const artifact = await this.prisma.nodeArtifact.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId, nodeId, role: 'primary', targetField: 'result', targetItemId: '' } },
      select: { mediaId: true, state: true },
    });
    return artifact?.state === 'stored' && artifact.mediaId ? artifact.mediaId : null;
  }

  async canonicalizeMediaRef(value: string | undefined | null): Promise<string | undefined> {
    if (!value) return undefined;
    const key = extractFlowaiObjectKey(value);
    if (key === null) return value;   // 外网 URL/其他形态——原值进哈希
    const media = await this.prisma.media.findUnique({
      where: { bucket_key: { bucket: 'flowai', key } },
      select: { id: true },
    });
    return media ? media.id : value;
  }

  async resolveCallUrl(ref: string | undefined | null): Promise<string | undefined> {
    if (!ref) return undefined;
    if (/^(https?:\/\/|\/)/.test(ref)) return ref;   // URL 形态（外网/同源路径）原样直传
    const media = await this.prisma.media.findUnique({
      where: { id: ref },
      select: { sourceUrl: true, sourceUrlExpiresAt: true, key: true },
    });
    if (!media) {
      throw new Error(`UPSTREAM_MEDIA_MISSING: 媒体身份 ${ref} 无 Media 行（数据损坏——身份进哈希时行存在，外呼时缺失；fail-fast 禁静默省略图外呼）`);
    }
    return resolveUpstreamMediaUrl(media, (key) => this.minio.generatePresignedGetUrl(key, UPSTREAM_PRESIGN_TTL_SEC));
  }
}
