// apps/api/src/modules/collab/collab-binding.controller.ts —— Y1c T25b 四读径③ → C3a-7 命令面
// （plan v3 Task C3a-7）→ Y2 D2t（spec v2.13 §3 D5 ④——跨团队粘贴受理层重写）→ Y2 D3t（同 §
// D5 ④后段：槽条件写三档+同团队三档+完成独立小函数+projectBindings 快照直调）：
//   - POST /api/projects/:projectId/collab/bindings，body=shared BindMediaCommand（判别联合进门自持
//     窄化）；**CloneBinding 命令已删**（第五轮 P1）；expectedRev 已随 B4 CAS 段删除退役（D1t 五字段）；
//   - 权限三查（spec D5 第②条）：调用者是目标项目编辑（assertEditorWithTeam）+源 Media 所属团队
//     成员（assertTeamMember——防凭 id 拿别队媒体）+能读源项目（resolveWithTeam role!=null）；
//   - 源域两腿改查**源项目**：pairArtifact 腿（NodeArtifact 行〔sourceProjectId,nodeId,mediaId 三维〕）
//     +doc 源节点兜底（窄端口 MediaRefsReadPort——读源项目活 doc，扫 mediaId）；源 Media ACTIVE 未软删
//     +size 非空非零拒；
//   - 幂等查 (teamId,bindCommandId)：completed→返回已有 id 不拷贝；pending→沿用行上新键续走；
//     源/团队/项目任一不同→409 BIND_COMMAND_MISMATCH（应用层比对——唯一约束多 NULL 挡不住换源；
//     锚=bindSourceMediaId/bindTargetProjectId/teamId）；
//   - 同团队三档（spec D5 ③——判源=**源 media id** 非新行 id，跨团队判源=新行 id，两套比较对象勿混）：
//     槽空→写原 id；槽=源 id→上次崩溃续走（不删对象按全量快照补绑定再完成）；槽=他 id→409
//     SLOT_OCCUPIED **不调 deletePending 不删任何对象**（同团队无新行无新键——纯 409）；
//   - 事务内占坑：assertCanUploadInTx+pending Media 行+StorageReservation(ACTIVE) 同事务——唯一约束
//     冲突 catch 在 $transaction 外（prepareUpload 先例）→事务外重读走幂等档（响应非 500）；
//   - 同桶 CopyObject 按源键去重（minio.copyObject 显式源桶=源行 bucket 列）；失败=删已拷新键（404
//     容忍）+deletePending 不写槽；
//   - 槽条件写三档（spec §8 顺序钉死尾段）：withSession(write) 同步回调〔禁 await——
//     SERVER_TRANSACT_ORIGIN 档〕内读槽（窄端口 COLLAB_SLOT_WRITE_PORT——裁决 10 防 DI 环）——
//     空才写 data.mediaId/本行 id=崩溃续走补绑定+完成/他 id=删已拷新键+deletePending+doc 保持
//     对方值+409；快照=回调内 collectNodeRefsUnion 并集返回值（Y4a T6——节点槽∪timeline clips，
//     与写帧原子——禁写完另开 read 会话）；
//   - 槽写成后=先直调 projectBindings（delta 三态：空数组=零引用全槽清不得省略 nodeId/null=整节点
//     删除/省略=空 delta 零动作；只传单格=差分删同节点其余槽）再完成事务；
//   - 完成独立小函数（同一事务恰四件事）：pending→completed CAS+预留 ACTIVE→SETTLED+factVersion+1
//     +state fact（**不整段调 confirmInTx**——它覆写 size/sniff/probeState；粘贴留复制值、probeState
//     留 pending 让探针重算）；完成 CAS 0 行→重读分诊：已 completed→返回原 id 不删对象/仍 pending→
//     只重试完成不进失败清理；
//   - 全程零 NodeArtifact/Projection 写（B4 后命令面零写维持——spec D5 ⑥：槽位唯一键行=生成 CAS 专属）。
// Y2 D4t（spec v2.13 §3 D5 ⑦ 执法腿收窄核验）：**本文件执法腿三件已随 D3t 同款形态在位**——
//   ①删键/写槽事务 origin=SERVER_TRANSACT_ORIGIN（slot-write.port withSession(write) 最外层 transact
//     注入——residency 服务 Z6/Z119 单点）；②maintenance 档落库（classifyDocUpdateOrigin 归
//     maintenance——doc_update_origin_total{origin='maintenance'}，无 server-direct 档旁路）；
//   ③删后直调 projectBindings（delta=回调内快照——slotWriteAndFinish/bindSameTeam 共用
//     projectNodeSnapshot）。**禁 DirectConnection 维持**（零新增——Z65 直连白名单 census ⑫ 面）；
//   no-op 档天然成立：槽=他 id 档 doc 保持对方值零删键、槽=本行 id 崩溃续走补绑定——键已不在=
//     快照照收投影幂等（delta 三态）。本 commit 零实现动作（保通锚=int 套件既有 21/21 维持）。
import { Body, Controller, ForbiddenException, HttpStatus, Inject, NotFoundException, Param, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ProjectPermissionService } from '../team/project-permission.service';
import { assertTeamMember } from '../team/team.util';
import { StorageQuotaService } from '../team/storage-quota.service';
import { MinioService } from '../minio/minio.service';
import { MediaRegistrationService } from '../artifact-core/media-registration.service';
import { upsertMediaFactInTx } from '../artifact-core/media-fact-write';
import { MEDIA_REFS_READ_PORT, type MediaRefsReadPort } from './media-refs-read.port';
import { COLLAB_SLOT_WRITE_PORT, type CollabSlotWritePort, type SlotWriteOutcome } from './slot-write.port';
import { projectBindings } from './media-binding-projector';
import type { MediaRef } from '@flowweb/shared';

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
    @Inject(COLLAB_SLOT_WRITE_PORT) private readonly slotWrite: CollabSlotWritePort,
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

  /** BindMedia 受理层（D2t+D3t——spec v2.13 §3 D5 ④）：权限三查+两腿查源项目+幂等查+事务内占坑+
   *  CopyObject 去重拷贝+槽条件写三档/同团队三档+快照直调 projectBindings+完成独立小函数。
   *  字节拷贝顺序钉死（spec §8）：幂等查（含 409 两档）→事务内占坑（唯一冲突→事务外 catch 重读幂等档）
   *  →CopyObject→withSession 同步条件写（槽上 id 三档）→projectBindings（delta=回调内快照）→完成
   *  独立小函数／槽=他 id 才删已拷新键+deletePending。S3 不进 PG 事务。 */
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

    // ── 同团队档先判（spec D5 ③——同团队无新行无新键：纯槽条件写链，槽=他 id 409 不删任何对象）──
    if (media.teamId === p.teamId) {
      return this.bindSameTeam(p, media.id);
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
      // pending→沿用行上新键续走（不走第二次占坑事务——命令重试/在途命中形态）→槽条件写+完成
      const pendingMedia = existing;
      await this.copySourceObjects(media, pendingMedia.key, pendingMedia.thumbnailKey, pendingMedia.objectKey);
      return this.slotWriteAndFinish(p, pendingMedia.id);
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
          return this.slotWriteAndFinish(p, winner.id);
        }
      }
      throw e;
    }

    // ── 同桶 CopyObject 按源键去重（spec §8 顺序：占坑提交后拷贝——失败清理不伤配额门）──
    try {
      await this.copySourceObjects(media, pendingRow.key, pendingRow.thumbnailKey, pendingRow.objectKey);
    } catch (e) {
      // 失败清理档：删本轮已拷新键（404 容忍）+deletePending（删行+预留 RELEASED 同事务）不写槽
      await this.deleteCopiedKeys([pendingRow.key, pendingRow.thumbnailKey, pendingRow.objectKey]);
      await this.registration.deletePending(pendingRow.id);
      throw e;
    }

    // ── 槽条件写三档+快照直调+完成事务（spec §8 尾段——本 commit 闭环 D2t 留位）──
    return this.slotWriteAndFinish(p, pendingRow.id);
  }

  /** 同团队三档（spec D5 ③）：判源=**源 media id**（跨团队判源=新行 id——两套比较对象勿混）。
   *  不拷贝不建行返回原 id；槽=他 id 409 纯档（不调 deletePending 不删任何对象——同团队无新行
   *  无新键）；槽写成后=快照直调 projectBindings（绑定经投影出现）——同团队无 pending 行无完成
   *  事务（源行已完成——回执即原 id）。 */
  private async bindSameTeam(p: {
    projectId: string; targetNodeId: string; mediaId: string;
  }, sourceMediaId: string): Promise<BindingCommandResult> {
    // 同团队槽条件写（经同一槽条件写机制——slotId=源 media id）
    const outcome = await this.slotWrite.conditionalWrite(p.projectId, p.targetNodeId, sourceMediaId);
    if (outcome.slot === 'foreign') {
      // 槽=他 id→409 SLOT_OCCUPIED 不删任何对象（doc 保持对方值——条件写零写面）
      throw new BusinessException('SLOT_OCCUPIED', `目标节点 ${p.targetNodeId} 槽位已被其他成员写入（doc 保持对方值）`, HttpStatus.CONFLICT);
    }
    // 槽空/槽=源 id（上次崩溃续走）→按回调内全量快照直调 projectBindings（补绑定）
    await this.projectNodeSnapshot(p.projectId, p.targetNodeId, outcome.snapshot);
    return { type: 'BindMedia', rev: 0, mediaId: sourceMediaId };
  }

  /** 跨团队槽条件写三档+快照直调+完成独立小函数（spec D5 ④——slotId=新行 id）。
   *  槽=他 id→删已拷新键+deletePending（删行+预留 RELEASED 同事务）+doc 保持对方值+409。 */
  private async slotWriteAndFinish(p: {
    projectId: string; teamId: string; mediaId: string; targetNodeId: string;
  }, pendingMediaId: string): Promise<BindingCommandResult> {
    // withSession(write) 同步回调读槽（窄端口——回调内读槽+写槽+快照原子）
    const outcome = await this.slotWrite.conditionalWrite(p.projectId, p.targetNodeId, pendingMediaId);
    if (outcome.slot === 'foreign') {
      // 槽=他 id：删已拷新键+deletePending（doc 保持对方值）+409 SLOT_OCCUPIED（先于完成事务）
      const pending = await this.prisma.media.findUniqueOrThrow({
        where: { id: pendingMediaId },
        select: { key: true, thumbnailKey: true, objectKey: true },
      });
      await this.deleteCopiedKeys([pending.key, pending.thumbnailKey, pending.objectKey]);
      await this.registration.deletePending(pendingMediaId);
      throw new BusinessException('SLOT_OCCUPIED', `目标节点 ${p.targetNodeId} 槽位已被其他成员写入（已拷新键已清理，doc 保持对方值）`, HttpStatus.CONFLICT);
    }
    // 槽空/槽=本行 id：先直调 projectBindings（delta=回调内快照）再完成事务（spec §8 顺序钉死）
    await this.projectNodeSnapshot(p.projectId, p.targetNodeId, outcome.snapshot);
    await this.finishPendingBinding(p.projectId, pendingMediaId);
    return { type: 'BindMedia', rev: 0, mediaId: pendingMediaId };
  }

  /** 快照直调 projectBindings（delta 三态：空数组=零引用全槽清不得省略 nodeId/单格=差分删同节点
   *  其余槽/快照满格=全量快照承载）。绑定经投影出现——本控制器零 MediaBinding 直写
   *  （check-media-binding-writers 白名单外禁写——projector 单写者）。 */
  private async projectNodeSnapshot(projectId: string, targetNodeId: string, snapshot: MediaRef[]): Promise<void> {
    // teamId=投影域常量（CanvasProject 行——projector 槽位键五元组恒投影域）
    const { teamId } = await this.prisma.canvasProject.findUniqueOrThrow({
      where: { id: projectId },
      select: { teamId: true },
    });
    await this.prisma.$transaction((tx) =>
      projectBindings(tx, projectId, teamId, new Map([[targetNodeId, snapshot]])));
  }

  /** 完成独立小函数（spec D5 ④——同一事务恰四件事，**不整段调 confirmInTx**：它覆写
   *  size=actualSize/sniffedMimeType/probeState——粘贴要留复制值、probeState 留 pending 让探针重算）：
   *  ① pending→completed CAS+pendingExpiresAt 清（离 pending 态——TTL 不再命中）+factVersion+1；
   *  ② 预留 ACTIVE→SETTLED（实字节入账 usage——实字节=复制值 size）；
   *  ③ state fact（payload 与 confirm 同款 {status:'completed'}——C2-2 已 increment 路径纪律：读回
   *    真实递增值传入）。
   *  完成 CAS 0 行→重读分诊：已 completed→返回原 id 不删对象；仍 pending→只重试完成不进失败清理。 */
  private async finishPendingBinding(projectId: string, mediaId: string): Promise<{ status: 'completed' | 'pending' }> {
    for (let attempt = 0; ; attempt += 1) {
      const count = await this.prisma.$transaction(async (tx) => {
        const { count: n } = await tx.media.updateMany({
          where: { id: mediaId, status: 'pending' },   // CAS 守卫——并发完成恰一胜者
          data: {
            status: 'completed',
            pendingExpiresAt: null,
            factVersion: { increment: 1 },
            // 不覆写：size/sniffedMimeType 留复制值、probeState 留 pending（探针重算——v2.4 裁定）
          },
        });
        if (n === 0) return 0;   // 完成 CAS 0 行——事务外分诊（不进失败清理）
        // ②预留 ACTIVE→SETTLED 同事务（锚行离开 pending 与预留终态迁移原子）
        await tx.storageReservation.updateMany({
          where: { mediaId, state: 'ACTIVE' },
          data: { state: 'SETTLED' },
        });
        // ③state fact 同事务（C2-2 ①纪律——上方 updateMany 已 increment，读回真实递增值传入）
        const { factVersion } = await tx.media.findUniqueOrThrow({
          where: { id: mediaId }, select: { factVersion: true },
        });
        await upsertMediaFactInTx(tx, {
          mediaId, factType: 'state', factVersion,
          payload: { status: 'completed' }, now: new Date(),
        });
        return n;
      });
      if (count === 1) return { status: 'completed' };
      // 完成 CAS 0 行重读分诊（spec D5 ④表尾）：已 completed→幂等收敛（返回原 id 不删对象——
      // 上层回执不变）；仍 pending→只重试完成（他方事务中止窗——重试不进失败清理）
      const row = await this.prisma.media.findUniqueOrThrow({
        where: { id: mediaId }, select: { status: true },
      });
      if (row.status === 'completed') return { status: 'completed' };
      if (attempt >= 2) {
        // 重试穷尽仍 pending——非幂等异常态（行锁窗口外不收敛）：让上层抛错走 CopyObject 失败
        // 同款清理档（删已拷新键+deletePending）前先抛 409 BIND_COMPLETION_CONFLICT（显式冲突
        // 非幂等破坏）——防御兜底，现实并发窗=行锁下 attempt 1 即收敛
        throw new BusinessException('BIND_COMPLETION_CONFLICT', `粘贴完成事务与并发完成竞争未收敛（mediaId=${mediaId}）`, HttpStatus.CONFLICT);
      }
    }
  }

  /** 删本轮已拷新键（404 容忍——对象不存在〔前步已删/未拷成〕继续清余键）。 */
  private async deleteCopiedKeys(keys: (string | null)[]): Promise<void> {
    for (const k of keys) {
      if (k == null) continue;
      try {
        await this.minio.delete(k);
      } catch {
        // 404 容忍
      }
    }
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
