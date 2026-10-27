// apps/api/src/modules/collab/collab-binding.controller.ts —— Y1c T25b 四读径③（plan :337 登记——
// T22 残留面承接；spec §6.4 ③行/COPY_PASTE_COMMAND_CONTRACT）：复制/粘贴 typed 命令端点。
//   - POST /api/projects/:projectId/collab/bindings，body=shared BindMediaCommand|CloneBindingCommand
//     判别联合（进门自持窄化——collab-media.controller 惯例）；
//   - BindMedia=源节点媒体绑到目标节点（源 nodeId/mediaId 作**命令参数**非 doc 字段）：服务端校验
//     权限（assertEditorWithTeam）/归属（源配对=MediaBinding 或 NodeArtifact 任一面持有该 mediaId）
//     后写 PG binding+NodeArtifact CAS（expectedRev——F2 同门：静默复读槽位换 rev 重试已退役）
//     +ArtifactProjection pending（feed 经投影 poller deliverArtifact 链——「写 PG binding+发 feed」
//     与 replaceMedia 同 PG 权威面零第二套写径）；
//   - CloneBinding=绑定格位克隆（源 MediaBinding 行 role/targetField/targetItemId 槽位随行）：
//     **NodeArtifact 零写**（产物引用清空——COPY_PASTE_COMMAND_CONTRACT.lifecycle「lifecycleSeq
//     新生成、NodeArtifact 不挂旧产物（复制≠产物继承）」）；
//   - 跨团队 media ACL（spec §5 媒体权限团队维度）：源 media 团队≠目标项目团队→403 整体拒
//     （collab-media replace 先例同口径；CloneBinding 任一绑定越队=整命令拒——部分克隆=静默丢面）。
import { Body, Controller, ForbiddenException, HttpStatus, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ProjectPermissionService } from '../team/project-permission.service';
import { NodeArtifactService } from '../artifact-core/node-artifact.service';
import { MediaRegistrationService } from '../artifact-core/media-registration.service';
import { MAX_EXPECTED_REV } from './collab-media.controller';

export type BindingCommandResult =
  | { type: 'BindMedia'; rev: number; mediaId: string }
  | { type: 'CloneBinding'; cloned: number; skippedDeleted: number };

@Controller('api/projects/:projectId/collab/bindings')
export class CollabBindingController {
  constructor(
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NodeArtifactService) private readonly nodeArtifacts: NodeArtifactService,
    @Inject(MediaRegistrationService) private readonly registration: MediaRegistrationService,
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
      throw new BusinessException('BINDING_COMMAND_BAD_BODY', 'body 须为 {type:"BindMedia",sourceNodeId,mediaId,targetNodeId,expectedRev} 或 {type:"CloneBinding",sourceNodeId,targetNodeId}');
    }
    if (body.type === 'BindMedia') {
      const expectedRev = body.expectedRev;
      if (!isStringId(body.mediaId)
        || typeof expectedRev !== 'number' || !Number.isInteger(expectedRev) || expectedRev < 0 || expectedRev > MAX_EXPECTED_REV) {
        throw new BusinessException('BINDING_COMMAND_BAD_BODY', `BindMedia 须携非空 mediaId 与 expectedRev:int 0..${MAX_EXPECTED_REV}`);
      }
      return this.prisma.$transaction((tx) => this.bindMedia(tx, {
        projectId, teamId,
        sourceNodeId: body.sourceNodeId as string,
        mediaId: body.mediaId as string,
        targetNodeId: body.targetNodeId as string,
        expectedRev,
      }));
    }
    if (body.type === 'CloneBinding') {
      return this.prisma.$transaction((tx) => this.cloneBinding(tx, {
        projectId, teamId,
        sourceNodeId: body.sourceNodeId as string,
        targetNodeId: body.targetNodeId as string,
      }));
    }
    throw new BusinessException('BINDING_COMMAND_BAD_BODY', 'type 须为 "BindMedia" 或 "CloneBinding"');
  }

  /** BindMedia：源 media 绑到目标槽位（CAS+投影 pending+binding upsert——replaceMedia 同 PG 权威面）。 */
  private async bindMedia(tx: Prisma.TransactionClient, p: { projectId: string; teamId: string; sourceNodeId: string; mediaId: string; targetNodeId: string; expectedRev: number }): Promise<BindingCommandResult> {
    // ACL+存在性（软删=读侧不存在口径——质评 Important#1 同款：绑定软删 media=渲染永久 404）
    const media = await this.prisma.media.findFirst({
      where: { id: p.mediaId, deletedAt: null },
      select: { teamId: true },
    });
    if (!media) throw new NotFoundException('媒体不存在');
    if (media.teamId !== p.teamId) throw new ForbiddenException('跨团队媒体引用被拒');
    // 归属校验：源配对（MediaBinding 或 NodeArtifact 任一面持有——命令参数必须反映真实绑定关系，
    // 禁任意 mediaId 冒配源 nodeId）
    const pairBinding = await tx.mediaBinding.findFirst({ where: { mediaId: p.mediaId, nodeId: p.sourceNodeId }, select: { id: true } });
    const pairArtifact = pairBinding == null
      ? await tx.nodeArtifact.findFirst({ where: { projectId: p.projectId, nodeId: p.sourceNodeId, mediaId: p.mediaId }, select: { id: true } })
      : null;
    if (pairBinding == null && pairArtifact == null) {
      throw new BusinessException('SOURCE_MEDIA_MISMATCH', `mediaId=${p.mediaId} 非源节点 ${p.sourceNodeId} 的在位绑定（命令参数与绑定关系不符）`);
    }

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
    await this.registration.bindInTx(tx, {
      mediaId: p.mediaId, projectId: p.projectId, nodeId: p.targetNodeId, teamId: p.teamId,
      role: 'primary', targetField: 'fileId', targetItemId: '',
    });
    return { type: 'BindMedia', rev: cas.rev, mediaId: p.mediaId };
  }

  /** CloneBinding：绑定格位克隆（MediaBinding 槽位随行）——NodeArtifact 零写（产物引用清空）。 */
  private async cloneBinding(tx: Prisma.TransactionClient, p: { projectId: string; teamId: string; sourceNodeId: string; targetNodeId: string }): Promise<BindingCommandResult> {
    const rows = await tx.mediaBinding.findMany({
      where: { projectId: p.projectId, nodeId: p.sourceNodeId },
      select: { mediaId: true, role: true, targetField: true, targetItemId: true },
    });
    if (rows.length === 0) return { type: 'CloneBinding', cloned: 0, skippedDeleted: 0 };   // 零绑定源=幂等 no-op
    const mediaIds = [...new Set(rows.map((r) => r.mediaId))];
    const medias = await this.prisma.media.findMany({
      where: { id: { in: mediaIds }, deletedAt: null },
      select: { id: true, teamId: true },
    });
    const byId = new Map(medias.map((m) => [m.id, m]));
    // 跨团队 ACL：任一绑定越队=整命令拒（fail-closed 原子——部分克隆=静默丢绑定面）
    for (const id of mediaIds) {
      const m = byId.get(id);
      if (m && m.teamId !== p.teamId) throw new ForbiddenException('跨团队媒体引用被拒');
    }
    let cloned = 0;
    let skippedDeleted = 0;
    for (const r of rows) {
      if (!byId.has(r.mediaId)) { skippedDeleted += 1; continue; }   // 软删槽位跳过（引用已死——FK 面）
      await this.registration.bindInTx(tx, {
        mediaId: r.mediaId, projectId: p.projectId, nodeId: p.targetNodeId, teamId: p.teamId,
        role: r.role, targetField: r.targetField, targetItemId: r.targetItemId,
      });
      cloned += 1;
    }
    return { type: 'CloneBinding', cloned, skippedDeleted };
  }
}
