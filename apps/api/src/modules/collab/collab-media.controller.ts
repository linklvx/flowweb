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
// 客户端判 errorCode=ARTIFACT_REV_CONFLICT 类型化上抛交用户裁定后重提交〔F2：静默复读槽位
// 换 rev 重试已退役——旧操作静默胜出=覆盖协作者新版本〕）。
import { Body, Controller, ForbiddenException, Get, HttpStatus, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ProjectPermissionService } from '../team/project-permission.service';
import { NodeArtifactService } from '../artifact-core/node-artifact.service';
import { MediaRegistrationService } from '../artifact-core/media-registration.service';

/** expectedRev 上界（Minor#2）：无槽位行走 INSERT rev=expectedRev+1——上界 2^31-2 使新 rev 恰容
 *  PG int4 max（2^31-1）；超出=确定 400 归 BAD_BODY（防 22003 溢出→500 噪声）。 */
export const MAX_EXPECTED_REV = 2_147_483_646;

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
  /** 胜者新 rev（=expectedRev+1）。注：客户端命令封装（web collabApi.runMediaCommand）expectedRev
   *  缺省才 GET 槽位取 rev（调用方预捕获值直用——覆盖整个处理窗口）；本字段不承诺「免 GET 往返」。 */
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
      || typeof expectedRev !== 'number' || !Number.isInteger(expectedRev) || expectedRev < 0 || expectedRev > MAX_EXPECTED_REV
      || (isReplace ? typeof body.mediaId !== 'string' || body.mediaId === '' : body.action !== 'clear')
    ) {
      throw new BusinessException('MEDIA_COMMAND_BAD_BODY', `body 须为 {action:"replace",mediaId:string,expectedRev:int 0..${MAX_EXPECTED_REV}} 或 {action:"clear",expectedRev:int 0..${MAX_EXPECTED_REV}}`);
    }
    const mediaId = isReplace ? (body.mediaId as string) : null;

    if (isReplace) {
      // 读侧 ACL 团队级（Z7''-v14）的写面同构：跨队 mediaId 引用拒（恶意客户端绑定他队资产）。
      // 软删（deletedAt）在读侧视为不存在（media.service content 404 同口径——质评 Important#1）：
      // 绑定软删 mediaId 会 binding+doc fileId 落地成功而渲染永久 404=「绑定即可读」不变量破。
      const media = await this.prisma.media.findFirst({
        where: { id: mediaId as string, deletedAt: null },
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
        // 生成在飞/并发命令已换代——不更新不覆盖用户值；客户端类型化上抛交用户裁定（F2：静默复读重试已退役）
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

    // ── T15 收口：doc 过渡期直写移除（writeBatch writeNodeData/deleteNodeDataKeys）——交付唯一
    //    owner=ArtifactProjection 投影 poller（pending 行已在上方事务落；内容等值 fast path/异常
    //    语义见 projection-outbox.poller）。客户端已有乐观 UI（命令响应即时回填），doc 收敛异步化
    //    可接受；409/回退语义不变（本命令只管 PG 权威面）。written:false（node 删除）观察点随之
    //    移交 poller apply 存在性守卫（orphaned 终态）——旧 Minor#3 直写 warn 面退役。 ──

    return { action: isReplace ? 'replace' : 'clear', rev: cas.rev, mediaId };
  }
}
