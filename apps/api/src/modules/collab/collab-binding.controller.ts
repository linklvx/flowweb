// apps/api/src/modules/collab/collab-binding.controller.ts —— Y1c T25b 四读径③ → C3a-7 命令面
// （plan v3 Task C3a-7）→ Y2 D2t（spec v2.13 §3 D5 ④——跨团队粘贴受理层重写）：
//   - POST /api/projects/:projectId/collab/bindings，body=shared BindMediaCommand（判别联合进门自持
//     窄化）；**CloneBinding 命令已删**（第五轮 P1）；expectedRev 已随 B4 CAS 段删除退役（D1t 五字段）；
//   - 权限三查（spec D5 第②条）：调用者是目标项目编辑（assertEditorWithTeam）+源 Media 所属团队
//     成员（assertTeamMember——防凭 id 拿别队媒体）+能读源项目（resolveWithTeam role!=null）；
//   - 源域两腿改查**源项目**（现行两腿都查目标项目——跨项目源必 miss）：pairArtifact 腿
//     （NodeArtifact 行〔sourceProjectId,nodeId,mediaId 三维——M-4〕）+doc 源节点兜底（窄端口
//     MediaRefsReadPort——读源项目活 doc，扫 mediaId）；源 Media ACTIVE 未软删+size 非空非零拒；
//   - 幂等查 (teamId,bindCommandId)（spec D5 ④——幂等范围=源媒体→目标节点）：completed→返回已有
//     id 不拷贝；pending→沿用行上新键续走；源/团队/项目任一不同→409 BIND_COMMAND_MISMATCH
//     （应用层比对——唯一约束多 NULL 挡不住换源；锚=bindSourceMediaId/bindTargetProjectId/teamId）；
//   - 事务内占坑：assertCanUploadInTx（Team 行锁串行化+三段和）+pending Media 行（新键/三幂等列/
//     pendingExpiresAt=24h/bucket=源行/不复制 projectId/nodeId/taskId/clientUploadId/
//     sourceRegistrationKey）+StorageReservation(ACTIVE,upperBoundBytes=源.size) 同事务；
//     **唯一约束冲突 catch 在 $transaction 外**（prepareUpload 先例——事务内 catch=aborted 后重读
//     25P02 仍 500）→事务外重读走幂等档（响应非 500）；
//   - 同桶 CopyObject 按源键去重（minio.copyObject 显式源桶=源行 bucket 列）：key/非空 thumbnailKey/
//     非空 objectKey 同对象共用同一把新键、不建 ObjectManifest 行；CopyObject 失败=删本轮已拷新键
//     （404 容忍）+deletePending（删行+预留 RELEASED 同事务）不写槽；
//   - **本 commit 槽写未就位**——CopyObject 成功后不写槽（D3t 落地槽条件写后闭环；pending 行由
//     现有 TTL 清扫兜底 24h）；CAS 段已随 B4 删除禁加回（命令面零 NodeArtifact/Projection 写）。
import { Body, Controller, ForbiddenException, HttpStatus, Inject, NotFoundException, Param, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ProjectPermissionService } from '../team/project-permission.service';
import { assertTeamMember } from '../team/team.util';
import { StorageQuotaService } from '../team/storage-quota.service';
import { MinioService } from '../minio/minio.service';
import { MediaRegistrationService } from '../artifact-core/media-registration.service';
import { MEDIA_REFS_READ_PORT, type MediaRefsReadPort } from './media-refs-read.port';

export type BindingCommandResult = { type: 'BindMedia'; rev: number; mediaId: string };

@Controller('api/projects/:projectId/collab/bindings')
export class CollabBindingController {
  constructor(
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MEDIA_REFS_READ_PORT) private readonly mediaRefs: MediaRefsReadPort,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(StorageQuotaService) private readonly quota: StorageQuotaService,
    @Inject(MediaRegistrationService) private readonly registration: MediaRegistrationService,
  ) {}

  @Post()
  async command(
    @Param('projectId') projectId: string,
    @Body() body: { type?: unknown; sourceProjectId?: unknown; sourceNodeId?: unknown; mediaId?: unknown; targetNodeId?: unknown; commandId?: unknown },
    @Req() req: Request,
  ): Promise<BindingCommandResult> {
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    const { teamId } = await this.perm.assertEditorWithTeam(projectId, userId as string);

    const isStringId = (v: unknown): v is string => typeof v === 'string' && v !== '';
    if (body === null || typeof body !== 'object' || !isStringId(body.sourceNodeId) || !isStringId(body.targetNodeId)) {
      throw new BusinessException('BINDING_COMMAND_BAD_BODY', 'body 须为 {type:"BindMedia",sourceProjectId,sourceNodeId,mediaId,targetNodeId,commandId}');
    }
    if (body.type !== 'BindMedia') {
      throw new BusinessException('BINDING_COMMAND_BAD_BODY', 'type 须为 "BindMedia"（CloneBinding 已删——C3a-7 命令面收口）');
    }
    if (!isStringId(body.sourceProjectId) || !isStringId(body.mediaId) || !isStringId(body.commandId)) {
      throw new BusinessException('BINDING_COMMAND_BAD_BODY', 'BindMedia 须携非空 sourceProjectId/mediaId/commandId（D1t 五字段——expectedRev 已随 CAS 删除）');
    }
    return this.bindMedia({
      projectId, teamId, userId: userId as string,
      sourceProjectId: body.sourceProjectId,
      sourceNodeId: body.sourceNodeId,
      mediaId: body.mediaId,
      targetNodeId: body.targetNodeId,
      commandId: body.commandId,
    });
  }

  /** BindMedia 受理层（D2t——spec v2.13 §3 D5 ④）：权限三查+两腿查源项目+幂等查+事务内占坑+
   *  CopyObject 去重拷贝+失败清理档。字节拷贝顺序钉死（spec §8）：幂等查→占坑（唯一冲突→事务外
   *  catch 重读幂等档）→CopyObject→（槽条件写归 D3t，本 commit 不写槽）。 */
  private async bindMedia(p: {
    projectId: string; teamId: string; userId: string;
    sourceProjectId: string; sourceNodeId: string; mediaId: string; targetNodeId: string; commandId: string;
  }): Promise<BindingCommandResult> {
    // ── 权限三查+源域 ──
    // ACL+存在性（软删=读侧不存在口径；C3b-4「命令面拒新绑定」：DELETING 同拒——deletionState 门单独拦）
    const media = await this.prisma.media.findFirst({
      where: { id: p.mediaId, deletedAt: null, deletionState: 'ACTIVE' },
      select: {
        id: true, teamId: true, bucket: true, key: true, thumbnailKey: true, objectKey: true,
        mimeType: true, size: true, originalName: true, type: true,
        naturalWidth: true, naturalHeight: true, sniffedMimeType: true, objectSha256: true,
      },
    });
    if (!media) throw new NotFoundException('媒体不存在');
    // 三查②：源团队成员权（防凭 id 拿别队媒体——team.util 403 同款）
    await assertTeamMember(this.prisma, media.teamId, p.userId);
    // 三查③：源项目读权（role!=null 即可——resolveWithTeam 先例）
    const { role: sourceRole } = await this.perm.resolveWithTeam(p.sourceProjectId, p.userId);
    if (sourceRole == null) throw new ForbiddenException('无源项目读取权限');
    // 源 size 非空非零拒（spec D5 ②：空值不得当 0 字节过配额门——直接拒绝不落 pending 行）
    if (media.size == null || media.size <= 0n) {
      throw new BusinessException('BIND_SOURCE_SIZE_INVALID', `源媒体 ${p.mediaId} 缺有效尺寸（size 非空非零）——拒受理`);
    }

    // ── 源配对两腿改查源项目（spec §2 表锚——现行两腿都查目标项目，跨项目源必 miss）──
    // 事务外读——只读校验面无并发危害（幂等/占坑事务仍是权威门），doc 兜底端口是外部 IO 禁入 PG 事务。
    const pairArtifact = await this.prisma.nodeArtifact.findFirst({
      where: { projectId: p.sourceProjectId, nodeId: p.sourceNodeId, mediaId: p.mediaId },
      select: { id: true },
    });
    if (pairArtifact == null) {
      // doc 源节点兜底（窄端口——读源项目活 doc；分档映射写死，spec §3.2-4/第七轮 P1-3）
      let refs: Awaited<ReturnType<MediaRefsReadPort['readNodeRefs']>>;
      try {
        refs = await this.mediaRefs.readNodeRefs(p.sourceProjectId, p.sourceNodeId);
      } catch (e) {
        if (e instanceof ServiceUnavailableException) {
          throw new BusinessException('SOURCE_DOC_UNREADABLE', `源节点 doc 读不可用（lease 失守/维护窗）：${(e as Error).message}`, HttpStatus.SERVICE_UNAVAILABLE);
        }
        throw e;
      }
      if (refs == null) {
        throw new BusinessException('SOURCE_NODE_MISSING', `源节点 ${p.sourceNodeId} 不在 doc（不存在或不可读）`);
      }
      if (!refs.some((r) => r.mediaId === p.mediaId)) {
        throw new BusinessException('SOURCE_MEDIA_MISMATCH', `mediaId=${p.mediaId} 非源节点 ${p.sourceNodeId} 的在位引用（命令参数与绑定关系不符）`);
      }
    }

    // ── 幂等查 (teamId,bindCommandId)（spec D5 ④表——无行→占坑；pending 分档；completed 返原 id）──
    const existing = await this.prisma.media.findUnique({
      where: { teamId_bindCommandId: { teamId: p.teamId, bindCommandId: p.commandId } },
    });
    if (existing) {
      // 应用层比对（唯一约束多 NULL 挡不住换源——锚=三幂等列；teamId 由查询面恒等不另比）
      if (existing.bindSourceMediaId !== p.mediaId || existing.bindTargetProjectId !== p.projectId) {
        throw new BusinessException('BIND_COMMAND_MISMATCH', `同一 commandId 已绑定其他源/项目（bindSourceMediaId/bindTargetProjectId 比对失败）`, HttpStatus.CONFLICT);
      }
      if (existing.status === 'completed') {
        return { type: 'BindMedia', rev: 0, mediaId: existing.id };   // 不拷贝不删对象
      }
      // pending→沿用行上新键续走（不走第二次占坑事务——命令重试/在途命中形态）
      const pendingMedia = existing;
      await this.copySourceObjects(media, pendingMedia.key, pendingMedia.thumbnailKey, pendingMedia.objectKey);
      return { type: 'BindMedia', rev: 0, mediaId: pendingMedia.id };
    }

    // ── 事务内占坑（新键 buildKey+三幂等列+预留 ACTIVE 同事务）──
    const ext = (media.key.split('.').pop() ?? 'bin');
    const newKey = this.minio.buildKey('uploaded', p.userId, { ext });
    const newThumbKey = media.thumbnailKey != null && media.thumbnailKey !== media.key
      ? this.minio.buildKey('uploaded', p.userId, { ext: 'png' })
      : null;
    // objectKey 同对象（=源 key）共用主键同把新键；异对象（非空且≠源 key）独立新键
    const newObjectKey = media.objectKey != null && media.objectKey !== media.key
      ? this.minio.buildKey('uploaded', p.userId, { ext })
      : newKey;

    let pendingRow: { id: string; key: string; thumbnailKey: string | null; objectKey: string | null };
    try {
      pendingRow = await this.prisma.$transaction(async (tx) => {
        await this.quota.assertCanUploadInTx(tx, p.teamId, Number(media.size));
        const row = await tx.media.create({
          data: {
            userId: p.userId,
            teamId: p.teamId,
            bucket: media.bucket,   // 桶=源行 bucket 列
            key: newKey,
            thumbnailKey: newThumbKey,
            objectKey: newObjectKey,
            originalName: media.originalName,
            mimeType: media.mimeType,
            size: media.size,   // BigInt 列保持
            status: 'pending',
            type: media.type,
            naturalWidth: media.naturalWidth,
            naturalHeight: media.naturalHeight,
            sniffedMimeType: media.sniffedMimeType,
            objectSha256: media.objectSha256,
            probeState: 'pending',   // 粘贴留复制值、探针重算（D3t 完成事务不覆写）
            bindCommandId: p.commandId,
            bindSourceMediaId: p.mediaId,
            bindTargetProjectId: p.projectId,
            pendingExpiresAt: new Date(Date.now() + 24 * 3600_000),   // TTL 清扫兜底（24h）
            // 不复制关联列：projectId/nodeId/taskId/clientUploadId/sourceRegistrationKey（spec D5 ⑤）
          },
        });
        await tx.storageReservation.create({
          data: { teamId: p.teamId, mediaId: row.id, upperBoundBytes: media.size, state: 'ACTIVE' },
        });
        return row;
      });
    } catch (e) {
      // 唯一约束冲突 catch 在 $transaction 之外（prepareUpload 先例 media-registration :78-85——事务内
      // catch=aborted 后重读 25P02 仍 500）→事务外重读走幂等档（响应非 500）
      if ((e as { code?: string }).code === 'P2002') {
        const winner = await this.prisma.media.findUnique({
          where: { teamId_bindCommandId: { teamId: p.teamId, bindCommandId: p.commandId } },
        });
        if (winner) {
          if (winner.bindSourceMediaId !== p.mediaId || winner.bindTargetProjectId !== p.projectId) {
            throw new BusinessException('BIND_COMMAND_MISMATCH', '同一 commandId 已绑定其他源/项目', HttpStatus.CONFLICT);
          }
          if (winner.status === 'completed') {
            return { type: 'BindMedia', rev: 0, mediaId: winner.id };
          }
          await this.copySourceObjects(media, winner.key, winner.thumbnailKey, winner.objectKey);
          return { type: 'BindMedia', rev: 0, mediaId: winner.id };
        }
      }
      throw e;
    }

    // ── 同桶 CopyObject 按源键去重（spec §8 顺序：占坑提交后拷贝——失败清理不伤配额门）──
    try {
      await this.copySourceObjects(media, pendingRow.key, pendingRow.thumbnailKey, pendingRow.objectKey);
    } catch (e) {
      // 失败清理档：删本轮已拷新键（404 容忍）+deletePending（删行+预留 RELEASED 同事务）不写槽
      const copiedKeys = [pendingRow.key, pendingRow.thumbnailKey, pendingRow.objectKey]
        .filter((k): k is string => k != null);
      for (const k of copiedKeys) {
        try {
          await this.minio.delete(k);
        } catch {
          // 404 容忍——对象不存在（前步已删/未拷成）继续清余键
        }
      }
      await this.registration.deletePending(pendingRow.id);
      throw e;
    }

    // 本 commit 槽写未就位：不写槽（D3t 落地槽条件写后闭环；pending 行交 TTL 清扫兜底——B4 后
    // 命令面零 NodeArtifact/Projection 写维持）
    return { type: 'BindMedia', rev: 0, mediaId: pendingRow.id };
  }

  /** 同桶 CopyObject 按源键去重：源三键（key/thumbnailKey/objectKey）同对象共用同一把新键——
   *  CopySource=源键；destKey=行上新键。不建 ObjectManifest 行（orphan 清扫只扫 manifest 行域，
   *  新键清理锚=pending 行三键引用）。失败抛错交调用方失败清理档。 */
  private async copySourceObjects(
    source: { bucket: string; key: string; thumbnailKey: string | null; objectKey: string | null },
    newKey: string, newThumbKey: string | null, newObjectKey: string | null,
  ): Promise<void> {
    // 主键恒拷
    await this.minio.copyObject(source.bucket, source.key, newKey);
    // thumbnailKey：非空且≠源 key（异对象）才独立拷贝；objectKey：非空才拷（同对象共用主键新键时
    // destKey=newKey——CopyObject 同键覆写幂等）
    if (source.thumbnailKey != null && source.thumbnailKey !== source.key && newThumbKey != null) {
      await this.minio.copyObject(source.bucket, source.thumbnailKey, newThumbKey);
    }
    if (source.objectKey != null && source.objectKey !== source.key && newObjectKey != null) {
      await this.minio.copyObject(source.bucket, source.objectKey, newObjectKey);
    }
  }
}
