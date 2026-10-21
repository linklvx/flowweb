// apps/api/src/modules/collab/collab-media.controller.ts —— Y1a+Y1b T11（spec Z11''③/Z18''）：
// replaceMedia/clearMedia 显式命令——用户写 fileId 必经本命令（PG NodeArtifact.rev CAS 权威；
// 0 行=superseded → 409 ARTIFACT_REV_CONFLICT；服务端特权写收敛为 deliverArtifact/replaceMedia/
// clearMedia 三 op）。成功=NodeArtifact CAS（rev+1、source='replace'）+新 ArtifactProjection pending
// （[artifactId,artifactRev]）+旧非终态投影 superseded+（replace）MediaBinding current-state upsert；
// 随后 doc 过渡期直写（T15 投影 poller 未建前用 T10 同款 writeBatch 保交付；投影行照插——poller
// 上线后内容等值 fast path 收敛）。
// 端点面：GET /api/projects/:id/collab/nodes/:nodeId/media=槽位状态 {targetField,rev,mediaId}
// （客户端初始 expectedRev 来源——doc 不携带 rev，权威在 PG〔v14 裁决① fileIdRev 删除〕）；
// POST 同路径=命令 {action:'replace',mediaId,expectedRev} | {action:'clear',expectedRev}。
// 鉴权：POST=assertEditorWithTeam（编辑权+teamId 固化）；GET=项目成员门（resolve→null 403）。
// 409 载体=BusinessException errorCode（HttpExceptionFilter 线形态 {code:-1,...,errorCode}——
// 客户端判 errorCode=ARTIFACT_REV_CONFLICT 复读槽位重试一轮完成）。
import { Body, Controller, ForbiddenException, Get, HttpStatus, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { DocWriteOp } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ProjectPermissionService } from '../team/project-permission.service';
import { NodeArtifactService } from '../artifact-core/node-artifact.service';
import { MediaRegistrationService } from '../artifact-core/media-registration.service';
import { CollabDocWriterService } from './collab-doc-writer.service';

/** POST body 判别联合（进门自持窄化——wire 形态文档）：replace 携用户上传的新 mediaId；clear 只携期望 rev。 */
export type MediaCommandBody =
  | { action: 'replace'; mediaId: string; expectedRev: number }
  | { action: 'clear'; expectedRev: number };

export interface MediaSlotState {
  targetField: 'fileId';
  rev: number;
  mediaId: string | null;
}

export interface MediaCommandResult {
  action: 'replace' | 'clear';
  /** 胜者新 rev（=expectedRev+1）——客户端下次命令的 expectedRev 来源（免 GET 往返）。 */
  rev: number;
  mediaId: string | null;
}

@Controller('api/projects/:projectId/collab/nodes/:nodeId/media')
export class CollabMediaController {
  constructor(
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NodeArtifactService) private readonly nodeArtifacts: NodeArtifactService,
    @Inject(MediaRegistrationService) private readonly registration: MediaRegistrationService,
    @Inject(CollabDocWriterService) private readonly docWriter: CollabDocWriterService,
  ) {}

  /** 槽位状态（primary/fileId 槽单源——四客户端写路径全为 imageGen fileId 面）。 */
  @Get()
  async getSlot(
    @Param('projectId') projectId: string,
    @Param('nodeId') nodeId: string,
    @Req() req: Request,
  ): Promise<MediaSlotState> {
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    const role = await this.perm.resolve(projectId, userId as string);
    if (!role) throw new ForbiddenException('无项目访问权限');
    const row = await this.prisma.nodeArtifact.findUnique({
      where: {
        projectId_nodeId_role_targetField_targetItemId: {
          projectId, nodeId, role: 'primary', targetField: 'fileId', targetItemId: '',
        },
      },
      select: { rev: true, mediaId: true },
    });
    return { targetField: 'fileId', rev: row?.rev ?? 0, mediaId: row?.mediaId ?? null };
  }

  /** replaceMedia/clearMedia 命令（spec Z11''③：用户写 fileId/result 必经命令——禁客户端 doc 直写）。
   *  body 判别联合进门自持（collab-write.controller 惯例——全仓无全局 ValidationPipe，棘轮基线登记）。 */
  @Post()
  async command(
    @Param('projectId') projectId: string,
    @Param('nodeId') nodeId: string,
    @Body() body: { action?: unknown; mediaId?: unknown; expectedRev?: unknown },
    @Req() req: Request,
  ): Promise<MediaCommandResult> {
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    const { teamId } = await this.perm.assertEditorWithTeam(projectId, userId as string);

    const expectedRev = body?.expectedRev;
    const isReplace = body?.action === 'replace';
    if (
      body === null || typeof body !== 'object'
      || typeof expectedRev !== 'number' || !Number.isInteger(expectedRev) || expectedRev < 0
      || (isReplace ? typeof body.mediaId !== 'string' || body.mediaId === '' : body.action !== 'clear')
    ) {
      throw new BusinessException('MEDIA_COMMAND_BAD_BODY', 'body 须为 {action:"replace",mediaId:string,expectedRev:int≥0} 或 {action:"clear",expectedRev:int≥0}');
    }
    const mediaId = isReplace ? (body.mediaId as string) : null;

    if (isReplace) {
      // 读侧 ACL 团队级（Z7''-v14）的写面同构：跨队 mediaId 引用拒（恶意客户端绑定他队资产）
      const media = await this.prisma.media.findUnique({
        where: { id: mediaId as string },
        select: { teamId: true },
      });
      if (!media) throw new NotFoundException('媒体不存在');
      if (media.teamId !== teamId) throw new ForbiddenException('跨团队媒体引用被拒');
    }

    // ── PG 单事务：CAS（0 行=superseded→409）+旧非终态投影 superseded+新 pending 投影+binding upsert ──
    const cas = await this.prisma.$transaction(async (tx) => {
      const cas = await this.nodeArtifacts.casUpsert(tx, {
        projectId, nodeId, teamId, targetField: 'fileId',
        expectedRev,
        source: 'replace',
        state: isReplace ? 'stored' : 'none',
        mediaId,
      });
      if (!cas.won) {
        // 生成在飞/并发命令已换代——不更新不覆盖用户值；客户端复读槽位（GET rev）重试一轮完成
        throw new BusinessException(
          'ARTIFACT_REV_CONFLICT',
          `槽位已换代（期望 rev=${expectedRev}，当前 rev=${cas.rev}）——请刷新后重试`,
          HttpStatus.CONFLICT,
        );
      }
      await tx.artifactProjection.updateMany({
        where: { artifactId: cas.artifactId, state: { in: ['pending', 'projecting'] } },
        data: { state: 'superseded' },
      });
      await tx.artifactProjection.createMany({
        data: [{
          artifactId: cas.artifactId, artifactRev: cas.rev, projectId, nodeId,
          targetField: 'fileId', targetItemId: '', mediaId, resultText: null, state: 'pending',
        }],
        skipDuplicates: true,   // [artifactId,artifactRev] 唯一
      });
      if (isReplace) {
        await this.registration.bindInTx(tx, {
          mediaId: mediaId as string, projectId, nodeId, teamId,
          role: 'primary', targetField: 'fileId', targetItemId: '',
        });
      }
      return cas;
    });

    // ── doc 过渡期直写（T15 投影 poller 未建前保交付——writeBatch throw=基础设施级：PG 已权威提交，
    //    pending 投影行在案由 poller/重试收敛，本命令不回滚 PG（CAS 权威面不因投影基础设施回退））。──
    const ops: DocWriteOp[] = isReplace
      ? [{ op: 'writeNodeData', nodeId, patch: { fileId: mediaId } }]
      : [{ op: 'deleteNodeDataKeys', nodeId, keys: ['fileId'] }];
    await this.docWriter.writeBatch(projectId, ops);

    return { action: isReplace ? 'replace' : 'clear', rev: cas.rev, mediaId };
  }
}
