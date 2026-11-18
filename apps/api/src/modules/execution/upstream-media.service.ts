import { Injectable, Inject, Logger } from '@nestjs/common';
import { extractFlowaiObjectKey, resolvePrimaryMediaId, resolveUpstreamMediaUrl } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';

/** 上游外呼 presign 有效期（秒）——上游图外呼消费先例口径（ai-image-edit.processor :136 同款 3600）。 */
const UPSTREAM_PRESIGN_TTL_SEC = 3600;

/** Y1a T8：上游媒体解析服务（S2）——上游注入读源改 NodeArtifact PG 权威后的三职责：
 *  ①readUpstreamMediaId（Y2 B4：槽查询 SQL 消失——改 resolvePrimaryMediaId 单源）：
 *    NodeArtifact 槽位 [projectId,nodeId,role='primary',targetField='mediaId',targetItemId=''] 的
 *    mediaId（非终态行视为无产物）作产物腿，配 doc 读模型作者键腿（调用方注入 node 形态——
 *    拓扑注入路径有全量 nodes）由 shared 解析函数裁决；miss〔无行/state 非 stored/mediaId 空
 *    且作者键空〕warn 可观测——禁零信号静默降级 T8 质评 Important）；
 *  ②canonicalizeMediaRef：doc 手工 URL → 身份形态（/flowai/ URL → key → Media (bucket,key) 反查；
 *    外网 URL 原样——用户不变则身份不变）——callArgs 构造（哈希输入）用；
 *  ③resolveCallUrl：身份 → 外呼可达 URL（Media.sourceUrl 未过期直传 provider → 过期/缺失降级
 *    presigned GET——nginx /flowai 域名公网形态）——外呼腿（哈希稳定身份、外呼时解析 URL）。 */
@Injectable()
export class UpstreamMediaService {
  private readonly logger = new Logger(UpstreamMediaService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  /** downstreamNodeId（下游目标节点）：仅 miss warn 定位上下文（T8 质评 Important——
   *  miss 静默不注入=下游按无图模式扣费执行 img2img 降级 t2i 零信号；可选参——
   *  拓扑注入路径恒传，直调〔spec〕可省）。
   *  Y2 B4：写死 targetField:'fileId' 的槽查询 SQL 删除（spec §4.2 禁留第二份判定）——
   *  解析单源=resolvePrimaryMediaId：作者键（node.data.mediaId）→产物腿（本方法读
   *  targetField='mediaId' 槽——域随 B4 换名）→multiImageGen 图库回落。node 形态由
   *  调用方传入（拓扑注入路径持全量读模型节点；缺省={无作者键} 只走产物腿——旧行为）。 */
  async readUpstreamMediaId(
    projectId: string,
    nodeId: string,
    downstreamNodeId?: string,
    node?: { type: string; data: Record<string, unknown> },
  ): Promise<string | null> {
    const artifact = await this.prisma.nodeArtifact.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId, nodeId, role: 'primary', targetField: 'mediaId', targetItemId: '' } },
      select: { mediaId: true, state: true },
    });
    const artifactMediaId = artifact?.state === 'stored' && artifact.mediaId ? artifact.mediaId : null;
    const resolved = resolvePrimaryMediaId(node ?? { type: '', data: {} }, artifactMediaId);
    if (resolved !== '') return resolved;
    const miss = !artifact ? 'no-row' : artifact.state !== 'stored' ? `state-non-stored:${artifact.state}` : 'mediaId-empty';
    this.logger.warn(`UPSTREAM_ARTIFACT_MISS: projectId=${projectId} downstreamNodeId=${downstreamNodeId ?? 'unknown'} upstreamNodeId=${nodeId} miss=${miss}（不注入——下游按无图模式执行）`);
    return null;
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
