import { Injectable, Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { getOwnerTeamId } from '../../team/team.util';
import { MinioService } from '../../minio/minio.service';
import { EmitPort } from '../../gateway/emit.port';
import { ApiCallerService, type EditCallOpts } from '../../execution/api-caller.service';
import { TeamCreditService } from '../../team/team-credit.service';
import { CollabWritePort } from '../../collab/collab-write.port';
import { GenerationIntentService } from '../../execution/generation-intent.service';
import { artifactDiscardedTotal, deliverStrandedTotal } from '../../execution/exec.metrics';
import { SafeRemoteFetchService } from '../../media/safe-remote-fetch.service';
import { ArtifactCommitService } from '../../artifact-core/artifact-commit.service';
import type { ExecutionTicket } from '../../execution/execution.types';

const LightingTaskStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILED: 'failed',
} as const;

export interface LightingParams {
  position: { x: number; y: number; z: number };
  brightness: number;
  colorTemperature: number;
  rimLight: boolean;
  customPrompt?: string;
}

export interface LightingJobData {
  taskType: 'lighting';
  userId: string;
  nodeId: string;
  projectId?: string;
  taskId: string;
  originalImageId: string;
  params: LightingParams;
  /** 批0.5-8：意图行 id——controller claim 后随 job.data 下传（consume guard/complete 门序）。
   *  Y1a T9：ticket=完整执行代际票 {intentRowId,execSeq,jobId}（execSeq wire=string）——reserve 在
   *  processor 队列入口已携票完成，本 consumer 消费票做 settle/complete/fail/onTick 代际 CAS。 */
  intentRowId?: string;
  ticket?: ExecutionTicket;
}

/** 纯派生稳定串（controller 侧 paramsHash 与 consumer 侧外呼 prompt 共用同一函数——
 *  两处各自实现会产生两键=双扣，spec 幂等组⑬）。批0.5-8 起 export 供 controller 提 hash 输入。 */
export function paramsToPrompt(params: LightingParams, customPrompt?: string): string {
  const directionMap: Record<string, string> = {
    '-1,0': '左侧',
    '0,1': '上方',
    '1,0': '右侧',
    '0,-1': '下方',
  };

  const xDir = params.position.x < -1 ? '左侧' : params.position.x > 1 ? '右侧' : '';
  const yDir = params.position.y > 1 ? '上方' : params.position.y < -1 ? '下方' : '';
  const zDir = params.position.z > 5 ? '正前方' : params.position.z < 3 ? '正后方' : '';
  const direction = [xDir, yDir, zDir].filter(Boolean).join('') || '正前方';

  const brightnessDesc =
    params.brightness > 70 ? '强烈' : params.brightness > 30 ? '适中' : '柔和';
  const rimLightDesc = params.rimLight ? '开启轮廓光' : '';

  return [
    `主光源从${direction}照射`,
    `亮度${brightnessDesc}`,
    `色温${params.colorTemperature}K`,
    rimLightDesc,
    customPrompt,
  ]
    .filter(Boolean)
    .join('，');
}

@Injectable()
export class LightingConsumer {
  private readonly logger = new Logger(LightingConsumer.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(EmitPort) private readonly emitPort: EmitPort,   // Y0c T24（Z101）：emitNodeStatus 2 调用点改道 emit 端口（api=Direct/worker=降级 no-op）
    @Inject(ApiCallerService) private readonly apiCaller: ApiCallerService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
    @Inject(CollabWritePort) private readonly collabDoc: CollabWritePort,
    @Inject(GenerationIntentService) private readonly intentService: GenerationIntentService,
    // T6：结果下载经 SafeRemoteFetch（SSRF 四门+流式限长）——axios 直连退役
    @Inject(SafeRemoteFetchService) private readonly safeFetch: SafeRemoteFetchService,
    // T10：产物落地+资金核销改道 ArtifactCommit 同步链（与 image 生成腿/编辑三 kind 同构）
    @Inject(ArtifactCommitService) private readonly artifactCommit: ArtifactCommitService,
  ) {}

  /** processor 队列入口（A-1 根修位）已完成 reserve/重锚/provider 锚——providerOpts 自 processor 透传
   *  （T9：onTick 代际 fence+resumeTaskId query-first+幂等键+taskId 落库回调——与编辑三 kind 同链）。 */
  async handleLightingJob(job: Job<LightingJobData>, providerOpts: EditCallOpts): Promise<{ status: string; fileId?: string; reason?: string }> {
    const { userId, nodeId, projectId, taskId, originalImageId, params, intentRowId, ticket } = job.data;
    const execSeq = ticket ? BigInt(ticket.execSeq) : undefined;
    const intentLogId = intentRowId ?? 'unknown';

    this.logger.log(`Processing lighting for task ${taskId}, node ${nodeId}`);

    // 1. Update task status to processing
    await this.prisma.lightingTask.update({
      where: { id: taskId },
      data: { status: LightingTaskStatus.PROCESSING },
    });

    try {
      // 1.5 解析归属团队（先于付费 AI 调用/上传：project 缺失属永久性错误，提前失败零孤儿零浪费）
      //     project 上下文优先（缺失即失败，不回落个人团队）；无 projectId 的个人任务回落个人团队
      let teamId: string;
      let projectTeamId: string | undefined;
      if (projectId) {
        projectTeamId = (await this.prisma.canvasProject.findUnique({
          where: { id: projectId },
          select: { teamId: true },
        }))?.teamId;
        if (!projectTeamId) {
          Sentry.captureException(new Error(`lighting: project team missing for task ${taskId}`));
          throw new Error('PROJECT_TEAM_MISSING');
        }
        teamId = projectTeamId;
      } else {
        teamId = await getOwnerTeamId(this.prisma, userId);
      }

      // 2. 归属校验 + 自签 presigned（批0c B1 根修：mediaId 引用替代 URL 直传，堵任意 media 越权读）
      const sourceMedia = await this.prisma.media.findUnique({ where: { id: originalImageId } });
      if (!sourceMedia || (sourceMedia.userId !== userId && sourceMedia.projectId !== projectId)) {
        throw new Error(`Media not found: ${originalImageId}`); // 404 语义——不泄露存在性
      }
      const presignedUrl = await this.minio.generatePresignedGetUrl(sourceMedia.key, 3600);

      // 3. A-1 根修（Y0b-2 T5）：reserve 收敛 processor 一处（队列入口结构位——全 taskType 统一；
      //    本 consumer 不再 reserve。冻结凭据=processor 已 reserve；T9 起票=必带代际）。
      if (projectTeamId && (!intentRowId || !execSeq)) {
        throw new Error('INTENT_GUARD_MISSING'); // 恒 claim 后入队（0.5-8）+T9 恒带票——缺即接线断裂
      }

      // 4. Build prompt from params
      const promptText = paramsToPrompt(params, params.customPrompt);
      this.logger.log(`Lighting prompt: ${promptText}`);

      // 5. Call AI gateway for relighting——Y0b-2 T4→Y1a T9：providerOpts 自 processor 透传
      //    （onTick 双职=心跳+终态/代际 abort；resumeTaskId query-first+幂等键+taskId 落库）。
      const result = await this.apiCaller.callRelighting?.(presignedUrl, promptText, providerOpts);

      if (!result?.url) {
        throw new Error('AI relighting returned no result URL');
      }

      // 6-8.5 T10 产物落地+资金核销改道 ArtifactCommit 同步链（与 image 生成腿/编辑三 kind 同构）：
      //     stage durable→SafeRemoteFetch 下载→sha/sniff→MinIO content-addressed 上传→finalize 单事务
      //     （NodeArtifact CAS〔claimCapture expectedRev〕+intent CAS+settleInTx+Media 提升/binding/投影）。
      //     资金独立判在 finalize 内裁决：superseded=照常 settle 产物入素材库（doc 不覆盖用户值）；
      //     intent-stale=不 settle+void 旧冻结（旧链 gated!==1 面的 finalize 内聚形态）。
      // 票守卫（资金链恒有票：LightingController.createTask claim 在 controller+projectId 必填门
      // ——直达形态（无 projectId 个人任务死径）缺票即 fail-fast，防 ticket!.expectedRev TypeError 静默面。
      if (!intentRowId || !execSeq || !ticket) throw new Error('INTENT_GUARD_MISSING');
      // projectId 非空不变量：LightingController.createTask 的 assertEditorWithTeam(body.projectId)
      // 必填门（claim 在 controller——资金链恒有项目锚）；类型位可选是历史形态，此处断言收口。
      const committed = await this.artifactCommit.commitImage({
        projectId: projectId!, nodeId, teamId, userId,
        intentRowId: intentRowId!, execSeq: execSeq!, expectedRev: ticket!.expectedRev,
        sourceUrl: result.url, taskId,
        originalNameBase: `lighting-${nodeId}`,   // 质评收口 Minor#7：扩展名 sniff 终判分档
      });
      if (committed.outcome === 'intent-stale') {
        this.logger.warn(`[artifact-commit] 意图 ${intentLogId} finalize intent-stale（行终态/换代）——跳过产物写入（外呼产物留作物证）`);
        return { status: 'completed' };
      }
      const mediaId = committed.mediaId!;
      const committedKey = committed.key!;

      // 9. Update LightingTask（T10：结果 URL 经 content-addressed key presign——committedKey）
      const presignedResultUrl = await this.minio.generatePresignedGetUrl(committedKey, 3600);
      await this.prisma.lightingTask.update({
        where: { id: taskId },
        data: {
          status: LightingTaskStatus.SUCCESS,
          resultImageUrl: presignedResultUrl,
          resultMediaId: mediaId,
          completedAt: new Date(),
        },
      });

      // 10. Write fileId to server doc；socket 仅进度通知
      //     Z44 nodeAlive 守卫：business 档 written:false=节点已删——产物丢弃计数（账已结清，无退款腿）
      // T10：superseded=用户在飞替换——不写 doc（投影行已记 superseded，用户值保留）
      // T13 typed outcome：transient/permanent=交付未知档——悬留计数（收敛归 R3/T15 投影链）+
      //     scope=claim 票铸造点（write-batch 端点收窄面）。
      if (projectId && committed.outcome !== 'superseded') {
        const deliver = await this.collabDoc.writeNodeData(projectId, nodeId, { fileId: mediaId }, intentRowId && execSeq ? { intentRowId, execSeq: execSeq.toString() } : undefined);
        if (deliver.kind === 'business' && !deliver.written) {
          artifactDiscardedTotal.inc({ cause: 'node-deleted' });
          this.logger.warn(`[lighting] 节点 ${nodeId} 已删——产物 ${mediaId} 丢弃（nodeAlive 守卫）`);
          return { status: 'completed', fileId: mediaId };
        }
        if (deliver.kind !== 'business') {
          deliverStrandedTotal.inc({ cause: deliver.kind });
          this.logger.warn(`[lighting] 节点 ${nodeId} 交付写${deliver.kind === 'transient' ? '瞬态耗尽' : '通道永久失败'}——悬留（产物 ${mediaId} 在 PG——收敛归 R3/T15 投影链）`);
          return { status: 'completed', fileId: mediaId };
        }
      }
      this.emitPort.emitNodeStatus(projectId || '', {
        nodeId,
        status: 'lighting-result',
        fileId: mediaId,
        resultUrl: presignedResultUrl,
      } as any);

      this.logger.log(`Lighting complete: task ${taskId}, media ${mediaId}`);
      return { status: 'completed', fileId: mediaId };
    } catch (error: any) {
      this.logger.error(`Lighting failed: ${error.message}`, error.stack);

      // T9 旧代 fence：行已换代（takeover/rearm 新代接管）——旧 job 失败静默退役：零退款零任务置败
      // 零投影零 emit（旧代 void_/fail 代际 CAS 亦 0 命中；LightingTask 状态归新代链路收敛）。
      if (intentRowId && execSeq) {
        const row = await this.prisma.generationIntent.findUnique({
          where: { id: intentRowId }, select: { status: true, execSeq: true },
        }).catch(() => null);
        if (row && row.status === 'RUNNING' && row.execSeq !== execSeq) {
          this.logger.warn(`[execSeq-fence] 意图 ${intentLogId} 旧代 job 失败让位（行已换代）——零副作用退役`);
          return { status: 'skipped', reason: 'EXEC_SEQ_STALE' };
        }
      }
      // 批0.5-9：失败先 void_ 解冻（约束②——冻结退还；无冻结/已结算幂等零动作）。
      // SIGKILL 场景本 catch 不执行——冻结滞留由 reconcile 超龄三查②解冻兜底。
      if (intentRowId && execSeq) {
        await this.teamCredit.void_({ intentRowId, execSeq })
          .catch((e) => this.logger.warn(`[reserve-settle] 意图 ${intentLogId} void_ 解冻失败（reconcile 兜底）: ${e}`));
      }

      // Update task to failed——清产物字段：step9 可能已写 SUCCESS+产物 URL，FAILED 覆写须同笔清空，
      // 否则 FAILED 行残留 resultImageUrl/resultMediaId（getTask 可取），状态与产物矛盾
      await this.prisma.lightingTask.update({
        where: { id: taskId },
        data: {
          status: LightingTaskStatus.FAILED,
          errorMessage: error.message,
          completedAt: new Date(),
          resultImageUrl: null,
          resultMediaId: null,
        },
      });

      // Push failure via WebSocket
      this.emitPort.emitNodeStatus(projectId || '', {
        nodeId,
        status: 'lighting-failed',
        error: error.message,
      } as any);

      // Re-throw to trigger BullMQ retry
      throw error;
    }
  }
}
