// apps/api/src/modules/collab/collab-binding.controller.ts —— Y1c T25b 四读径③ → C3a-7 命令面读写两改
// （plan v3 Task C3a-7——spec 2026-11-11-foundation-batch-design.md §3.2-4 单写者+命令面两改）：
//   - POST /api/projects/:projectId/collab/bindings，body=shared BindMediaCommand（判别联合进门自持
//     窄化——collab-media.controller 惯例）；**CloneBinding 命令已删**（第五轮 P1——web 生产零调用
//     实证〔仅 collabApi.ts 导出+其 test〕、生产 copy/paste 走 BindMedia〔canvasStore paste 路径〕；
//     copy/paste=客户端 doc 帧自足，绑定经投影收敛；若产品确需服务端克隆→Y2 doc 命令执行器立项）；
//   - BindMedia（C3a-7 语义）=**校验+NodeArtifact/Projection 写——零 MediaBinding 读写**（绑定经
//     appendBatch 帧级投影出现，客户端 doc 帧自足）：
//     ①ACL：assertEditorWithTeam+media 存在/软删（404）+跨队 403；
//     ②源配对（命令参数必须反映真实绑定关系——禁任意 mediaId 冒配源 nodeId）：pairArtifact 唯一腿
//       （NodeArtifact 行〔projectId,nodeId,mediaId 三维——M-4〕）+doc 源节点兜底（窄端口
//       MediaRefsReadPort 读活 doc refs——命令面即时校验非投影链，活 doc 读允许）；分档映射写死：
//       源节点不存在→400 SOURCE_NODE_MISSING；源 media 不在源节点→400 SOURCE_MEDIA_MISMATCH；
//       doc 不可读/lease 失守→503 SOURCE_DOC_UNREADABLE；
//     ③目标槽 NodeArtifact CAS（expectedRev——F2 同门）+ArtifactProjection pending（feed 经投影
//     poller deliverArtifact 链——与 replaceMedia 同 PG 权威面零第二套写径）。
import { Body, Controller, ForbiddenException, HttpStatus, Inject, NotFoundException, Param, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ProjectPermissionService } from '../team/project-permission.service';
import { NodeArtifactService } from '../artifact-core/node-artifact.service';
import { MEDIA_REFS_READ_PORT, type MediaRefsReadPort } from './media-refs-read.port';
import { MAX_EXPECTED_REV } from './collab-media.controller';

export type BindingCommandResult = { type: 'BindMedia'; rev: number; mediaId: string };

@Controller('api/projects/:projectId/collab/bindings')
export class CollabBindingController {
  constructor(
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NodeArtifactService) private readonly nodeArtifacts: NodeArtifactService,
    @Inject(MEDIA_REFS_READ_PORT) private readonly mediaRefs: MediaRefsReadPort,
  ) {}

  @Post()
  async command(
    @Param('projectId') projectId: string,
    @Body() body: { type?: unknown; sourceNodeId?: unknown; mediaId?: unknown; targetNodeId?: unknown; expectedRev?: unknown },
    @Req() req: Request,
  ): Promise<BindingCommandResult> {
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    const { teamId } = await this.perm.assertEditorWithTeam(projectId, userId as string);

    const isStringId = (v: unknown): v is string => typeof v === 'string' && v !== '';
    if (body === null || typeof body !== 'object' || !isStringId(body.sourceNodeId) || !isStringId(body.targetNodeId)) {
      throw new BusinessException('BINDING_COMMAND_BAD_BODY', 'body 须为 {type:"BindMedia",sourceNodeId,mediaId,targetNodeId,expectedRev}');
    }
    if (body.type !== 'BindMedia') {
      throw new BusinessException('BINDING_COMMAND_BAD_BODY', 'type 须为 "BindMedia"（CloneBinding 已删——C3a-7 命令面收口）');
    }
    const expectedRev = body.expectedRev;
    if (!isStringId(body.mediaId)
      || typeof expectedRev !== 'number' || !Number.isInteger(expectedRev) || expectedRev < 0 || expectedRev > MAX_EXPECTED_REV) {
      throw new BusinessException('BINDING_COMMAND_BAD_BODY', `BindMedia 须携非空 mediaId 与 expectedRev:int 0..${MAX_EXPECTED_REV}`);
    }
    return this.bindMedia({
      projectId, teamId,
      sourceNodeId: body.sourceNodeId,
      mediaId: body.mediaId,
      targetNodeId: body.targetNodeId,
      expectedRev,
    });
  }

  /** BindMedia：校验（ACL+源配对）+NodeArtifact CAS/投影 pending——零 MediaBinding 读写（C3a-7）。 */
  private async bindMedia(p: { projectId: string; teamId: string; sourceNodeId: string; mediaId: string; targetNodeId: string; expectedRev: number }): Promise<BindingCommandResult> {
    // ACL+存在性（软删=读侧不存在口径——质评 Important#1 同款：绑定软删 media=渲染永久 404；
    // C3b-4 spec §3.4-5「命令面拒新绑定」：DELETING 同拒——erasure 复核窗内行 deletedAt=null，
    // deletionState 门单独拦）
    const media = await this.prisma.media.findFirst({
      where: { id: p.mediaId, deletedAt: null, deletionState: 'ACTIVE' },
      select: { teamId: true },
    });
    if (!media) throw new NotFoundException('媒体不存在');
    if (media.teamId !== p.teamId) throw new ForbiddenException('跨团队媒体引用被拒');

    // 源配对：pairArtifact 唯一腿（三维对齐 M-4——跨项目同 nodeId 不同步误配对面）。事务外读——
    // 只读校验面无并发危害（校验通过后 CAS 仍是权威门），doc 兜底端口是外部 IO 禁入 PG 事务。
    const pairArtifact = await this.prisma.nodeArtifact.findFirst({
      where: { projectId: p.projectId, nodeId: p.sourceNodeId, mediaId: p.mediaId },
      select: { id: true },
    });
    if (pairArtifact == null) {
      // doc 源节点兜底（窄端口——分档映射写死，spec §3.2-4/第七轮 P1-3）
      let refs: Awaited<ReturnType<MediaRefsReadPort['readNodeRefs']>>;
      try {
        refs = await this.mediaRefs.readNodeRefs(p.projectId, p.sourceNodeId);
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

    // ── PG 单事务：目标槽 CAS（0 行=superseded→409）+旧非终态投影 superseded+新 pending 投影 ──
    //    （零 MediaBinding 读写——目标槽 binding 由客户端 doc 帧→appendBatch 投影出现）
    const cas = await this.prisma.$transaction(async (tx) => {
      const cas = await this.nodeArtifacts.casUpsert(tx, {
        projectId: p.projectId, nodeId: p.targetNodeId, teamId: p.teamId, targetField: 'fileId',
        expectedRev: p.expectedRev,
        source: 'replace',
        state: 'stored',
        mediaId: p.mediaId,
      });
      if (!cas.won) {
        throw new BusinessException(
          'ARTIFACT_REV_CONFLICT',
          `槽位已换代（期望 rev=${p.expectedRev}，当前 rev=${cas.rev}）——请刷新后重试`,
          HttpStatus.CONFLICT,
        );
      }
      await tx.artifactProjection.updateMany({
        where: { artifactId: cas.artifactId, state: { in: ['pending', 'projecting'] } },
        data: { state: 'superseded' },
      });
      await tx.artifactProjection.createMany({
        data: [{
          artifactId: cas.artifactId, artifactRev: cas.rev, projectId: p.projectId, nodeId: p.targetNodeId,
          targetField: 'fileId', targetItemId: '', mediaId: p.mediaId, resultText: null, state: 'pending',
        }],
        skipDuplicates: true,
      });
      return cas;
    });
    return { type: 'BindMedia', rev: cas.rev, mediaId: p.mediaId };
  }
}
