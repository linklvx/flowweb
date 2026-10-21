import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmitPort } from '../gateway/emit.port';
import { ApiCallerService } from '../execution/api-caller.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CollabWritePort } from '../collab/collab-write.port';
import { GenerationIntentService } from '../execution/generation-intent.service';
import { intentDuplicateAttemptTotal } from '../execution/intent-reconcile.metrics';
import { artifactDiscardedTotal, countExecProjectionFailure } from '../execution/exec.metrics';
import { AI_IMAGE_EDIT_QUEUE_NAME } from './ai-image-edit.constants';
import { LightingConsumer, type LightingJobData } from './lighting/lighting.consumer';
import { SafeRemoteFetchService } from '../media/safe-remote-fetch.service';
import { ArtifactCommitService } from '../artifact-core/artifact-commit.service';
import type { ExecutionTicket } from '../execution/execution.types';

export interface AiImageEditJobData {
  taskType: 'outpaint' | 'erase' | 'redraw' | 'lighting';
  userId: string;
  projectId: string;
  nodeId: string;
  fileId: string;
  maskFileId?: string;
  rect?: { x: number; y: number; width: number; height: number };
  imageWidth?: number;
  imageHeight?: number;
  prompt?: string;
  strength?: number;
  /** 批0.5-8：意图行 id——controller claim 后随 job.data 下传（consume guard/complete 门序/failed 钩子）。
   *  Y1a T9：ticket=完整执行代际票 {intentRowId,execSeq,jobId}（execSeq wire=string）——reserve/onTick/
   *  complete/fail 全链代际 CAS；旧 job 在新代后重投=零副作用（reserve 旧票 mayCall:false+onTick abort+
   *  catch 旧代静默退役）。 */
  intentRowId?: string;
  ticket?: ExecutionTicket;
}

/** Y0b-2 T1（Z110 终裁）：maxStalledCount 保持 1——安全链=stall→BullMQ 同 jobId 重排→claim② 可重入→
 *  reserve 门 alreadyReserved→mayCall:false（Z35 结构门）→静默退出零外呼——重复 submit 结构性不可能；
 *  =1 的代价=真死 worker 悬挂由 deadline reaper 收敛（T2）；
 *  改 0 的代价=lock 过期≠进程死：活 worker 被置 FAILED⇒complete CAS=0⇒平台已付费产物丢弃。
 *  lockDuration:60s——长外呼（扩图/重绘/打光）锁续期窗口，过短会误判 stalled（execution.processor 同款）。 */
@Processor(AI_IMAGE_EDIT_QUEUE_NAME, { maxStalledCount: 1, lockDuration: 60_000 })
export class AiImageEditProcessor extends WorkerHost {
  private readonly logger = new Logger(AiImageEditProcessor.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(EmitPort) private readonly emitPort: EmitPort,   // Y0c T24（Z101）：emitNodeStatus 3 调用点改道 emit 端口（api=Direct/worker=降级 no-op）
    @Inject(ApiCallerService) private readonly apiCaller: ApiCallerService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
    @Inject(CollabWritePort) private readonly collabDoc: CollabWritePort,
    @Inject(LightingConsumer) private readonly lightingConsumer: LightingConsumer,
    @Inject(GenerationIntentService) private readonly intentService: GenerationIntentService,
    // T6：结果下载经 SafeRemoteFetch（SSRF 四门+流式限长）——axios/axios-retry 直连退役
    @Inject(SafeRemoteFetchService) private readonly safeFetch: SafeRemoteFetchService,
    // T10：产物落地改道 ArtifactCommit 同步链（stage durable→下载→sha/sniff→上传→finalize 单事务）
    // ——下载经 safeFetch 由 commitImage 内部消费（本 processor 直用面退役）；minio 保留源图 presign 面
    @Inject(ArtifactCommitService) private readonly artifactCommit: ArtifactCommitService,
  ) {
    super();
  }

  private async getMediaKey(fileId: string, userId: string, projectId: string): Promise<string> {
    const media = await this.prisma.media.findUnique({ where: { id: fileId } });
    if (!media || (media.userId !== userId && media.projectId !== projectId)) {
      throw new Error(`Media not found: ${fileId}`); // 404 语义——不泄露存在性
    }
    return media.key;
  }

  async process(job: Job<AiImageEditJobData>): Promise<{ status: string; fileId?: string; reason?: string }> {
    const { taskType, userId, projectId, nodeId, fileId, maskFileId, rect, imageWidth, imageHeight, prompt, strength, intentRowId, ticket } = job.data;
    // T9：ticket.execSeq wire=string——解析一次贯穿（reserve/onTick/complete/fail/void_ 代际 CAS 共用）
    const execSeq = ticket ? BigInt(ticket.execSeq) : undefined;
    const intentLogId = intentRowId ?? 'unknown';
    this.logger.log(`Processing ${taskType} for node ${nodeId}`);

    try {
      // 1. Resolve project team（Media 归属与积分同源）；缺失即 failed 不回落个人团队
      //    批0.5-9 前移至 reserve/外呼之前（reserve 需归属团队；缺失零外呼零孤儿 MinIO 对象）
      const projectTeamId = (await this.prisma.canvasProject.findUnique({
        where: { id: projectId },
        select: { teamId: true },
      }))?.teamId;
      if (!projectTeamId) {
        Sentry.captureException(new Error(`ai-image-edit: project team missing for node ${nodeId}`));
        return { status: 'failed', reason: 'PROJECT_TEAM_MISSING' };
      }

      // 2. 批0.5-9 reserve 外呼之前（余额不足即拒=零外呼）。guard 缺失=接线断裂——
      //    拒绝付费外呼（无幂等锚的扣费=重试双扣/白嫖二义）；T9 起 ticket=必带代际票
      if (!intentRowId || !execSeq) {
        this.logger.warn(`Edit intent guard/ticket missing for node ${nodeId}——拒绝付费外呼（T9 起 enqueue 恒带代际票）`);
        return { status: 'failed', reason: 'INTENT_GUARD_MISSING' };
      }
      // A-1 根修（Y0b-2 T5）：reserve 收敛 processor 一处（队列入口结构位——全 taskType 统一含
      // lighting）；consumer 不再二次 reserve（旧双 reserve：第二次必 mayCall:false→skipped 永不外呼
      // →deadline 批 backfillSucceeded→settleStranded 补 settle=1 credit 白扣）。
      // Y0b-1（Z10）：金额单源 intent 行（claim 固化 plan 快照）——worker 不再解析定价
      const reserveResult = await this.teamCredit.reserve(userId, { intentRowId, execSeq });
      if (reserveResult.mayCall === false) {
        // Z35：alreadyReserved=他人在飞（stall 重排）/T9 EXEC_SEQ_STALE=行已换代（旧 job 在新代后重投）
        // ——静默退出零副作用（不 void_/不 fail/不写 exec/不 emit）
        intentDuplicateAttemptTotal.inc();
        this.logger.warn(`[reserve] 意图 ${intentLogId} 重复外呼企图（${reserveResult.reason ?? 'alreadyReserved'}）——静默退出（悬挂收敛归 reconcile/接管新代）`);
        return { status: 'skipped', reason: 'INTENT_DUPLICATE_ATTEMPT' };
      }
      if (!reserveResult.success) {
        const reason = reserveResult.reason ?? 'RESERVE_FAILED';
        this.logger.warn(`Edit credit-reserve failed for node ${nodeId}: ${reason}`);
        await this.intentService.void_(intentRowId, `扣费失败：${reason}`, execSeq); // 零扣费终态——重试照常扣费
        this.emitPort.emitNodeStatus(projectId, {
          nodeId,
          status: 'edit-failed',
          error: `扣费失败：${reason}`,
        });
        return { status: 'failed', reason };
      }

      // 3. Y0b-2 T4：外呼前重锚（startedAt=外呼起点〔Z83 phase 判据〕+deadline 终锚+心跳——
      //    编辑链意图行在 controller claim 时锚=排队档，processor reserve 后外呼将开始才重锚）。
      //    lighting 同链（taskType 即 kind 档表键）——外呼虽转发至 consumer，链起点在此。
      //    A-2（T4 M-1）：count===0=行已终态**或已换代**（T9）——早退不再 submit。
      const reanchored = await this.intentService.reanchorDeadline(intentRowId, taskType, execSeq);
      if (reanchored === 0) {
        this.logger.warn(`[reanchor] 意图 ${intentLogId} 行已终态/换代（迟归 job）——早退零外呼`);
        return { status: 'skipped', reason: 'INTENT_TERMINAL_EARLY' };
      }
      // T9 provider 锚：write-ahead requestId（submit 前落库）+resumeTaskId（query-first 复用——
      //    kill after submit→重跑按任务直查零重复外呼）；onTick 双职（Z69+代际）经 tickFence 单源。
      const idempotencyKey = await this.intentService.ensureProviderRequestId(intentRowId, execSeq);
      const anchorRow = await this.prisma.generationIntent.findUnique({
        where: { id: intentRowId }, select: { providerTaskId: true },
      });
      const providerOpts = {
        onTick: async (): Promise<'abort' | void> => this.intentService.tickFence(intentRowId, execSeq),
        resumeTaskId: anchorRow?.providerTaskId ?? null,
        idempotencyKey,
        onProviderTaskId: (taskId: string) => this.intentService.recordProviderTaskId(intentRowId, execSeq, taskId),
      };

      // 4. lighting 转发 consumer（A-1：冻结已在手——consumer 只跑外呼/产物/settle/complete；T9 票随行）
      if (taskType === 'lighting') {
        return this.lightingConsumer.handleLightingJob(job as unknown as Job<LightingJobData>, providerOpts);
      }

      // 5. Get presigned URLs for source image and optional mask（编辑三类——lighting job 无 fileId 键，
      //    旧序此处对 lighting 必炸 PrismaClientValidationError：A-1 随队列入口收敛一并根修）
      const sourceKey = await this.getMediaKey(fileId, userId, projectId);
      const imageUrl = await this.minio.generatePresignedGetUrl(sourceKey, 3600);
      let maskUrl: string | undefined;
      if (maskFileId) {
        const maskKey = await this.getMediaKey(maskFileId, userId, projectId);
        maskUrl = await this.minio.generatePresignedGetUrl(maskKey, 3600);
      }

      // 6. Call the appropriate API method（T9：providerOpts 全量下传——resume/幂等键/taskId 落库）
      let result: { url: string };
      switch (taskType) {
        case 'outpaint':
          result = await this.apiCaller.callOutpainting(
            imageUrl,
            rect!,
            imageWidth!,
            imageHeight!,
            undefined,
            providerOpts,
          );
          break;
        case 'erase':
          result = await this.apiCaller.callErase(imageUrl, maskUrl!, providerOpts);
          break;
        case 'redraw':
          result = await this.apiCaller.callRedraw(imageUrl, maskUrl!, prompt!, strength!, providerOpts);
          break;
        default:
          throw new Error(`Unknown taskType: ${taskType}`);
      }

      // 7-9.5 T10 产物落地+资金核销改道 ArtifactCommit 同步链（与 image 生成腿同构）：stage durable→
      //     SafeRemoteFetch 下载→sha/sniff→MinIO content-addressed 上传→finalize 单事务
      //     （NodeArtifact CAS〔claimCapture expectedRev〕+intent CAS+settleInTx+Media 提升/binding/投影）。
      //     资金独立判在 finalize 内裁决：superseded=照常 settle 产物入素材库（doc 不覆盖用户值）；
      //     intent-stale=不 settle+void 旧冻结（旧链 gated!==1 面的 finalize 内聚形态）。
      const committed = await this.artifactCommit.commitImage({
        projectId, nodeId, teamId: projectTeamId, userId,
        intentRowId, execSeq, expectedRev: ticket!.expectedRev,
        sourceUrl: result.url,
        originalNameBase: `ai-edited-${nodeId}`,   // 质评收口 Minor#7：扩展名 sniff 终判分档
      });
      if (committed.outcome === 'intent-stale') {
        this.logger.warn(`[artifact-commit] 意图 ${intentLogId} finalize intent-stale（行终态/换代）——跳过产物写入（外呼产物留作证）`);
        return { status: 'completed' };
      }
      const mediaId = committed.mediaId!;

      // 10. Write fileId to server doc；socket 仅进度通知。
      // O0b-2（终裁 59⑤）：AI data.{width,height} 键整删——AI 只写 fileId（改写 envelope 会让 api
      // 成信封第 4 写者撞冻结表"信封写者=3"）；尺寸由 web 内容事件路径决定（load/换图 contain-fit）。
      // T10：superseded=用户在飞替换——不写 doc（投影行已记 superseded，用户值保留）。
      // Z44 nodeAlive 守卫：written:false=节点已删——产物丢弃计数（账已结清，无退款腿——交付判据归 finalize intent CAS）
      if (committed.outcome !== 'superseded') {
        const deliver = await this.collabDoc.writeNodeData(projectId, nodeId, { fileId: mediaId });
        if (!deliver.written) {
          artifactDiscardedTotal.inc({ cause: 'node-deleted' });
          this.logger.warn(`[ai-image-edit] 节点 ${nodeId} 已删——产物 ${mediaId} 丢弃（nodeAlive 守卫）`);
          return { status: 'completed', fileId: mediaId };
        }
      }
      this.emitPort.emitNodeStatus(projectId, {
        nodeId,
        status: 'edit-result',
        fileId: mediaId,
      });

      this.logger.log(`Edit complete: ${mediaId}`);
      return { status: 'completed', fileId: mediaId };
    } catch (error: any) {
      this.logger.error(`Edit failed: ${error.message}`, error.stack);

      // T9 旧代 fence：行已换代（takeover/rearm nextval 新代接管）——旧 job 失败静默退役：
      // 零终态零退款零投影零 emit（旧代 void_/fail 代际 CAS 亦 0 命中；error 投影会覆盖新代 loading）。
      if (intentRowId && execSeq) {
        const row = await this.prisma.generationIntent.findUnique({
          where: { id: intentRowId }, select: { status: true, execSeq: true },
        }).catch(() => null);
        if (row && row.status === 'RUNNING' && row.execSeq !== execSeq) {
          this.logger.warn(`[execSeq-fence] 意图 ${intentLogId} 旧代 job 失败让位（行已换代）——零副作用退役`);
          return { status: 'skipped', reason: 'EXEC_SEQ_STALE' };
        }
      }
      // 批0.5-9：失败先 void_ 解冻（约束②——冻结退还），批0.5-8 终态必达——外呼抛错置 FAILED
      // （SIGKILL 场景本 catch 不执行，由 failed 钩子兜底；冻结滞留由 reconcile 超龄三查②解冻）
      if (intentRowId) {
        await this.teamCredit.void_({ intentRowId, execSeq })
          .catch((e) => this.logger.warn(`[reserve-settle] 意图 ${intentLogId} void_ 解冻失败（reconcile 兜底）: ${e}`));
        await this.intentService.fail(intentRowId, String(error?.message ?? error), undefined, execSeq);
      }
      if (projectId) {
        // Z111：投影携 attempts（行已 fail 亦可读——attempts 不随终态变化；读失败按 0 代不挡原始错误上抛）
        let attempts = 0;
        if (intentRowId) {
          try {
            attempts = (await this.prisma.generationIntent.findUnique({ where: { id: intentRowId }, select: { attempts: true } }))?.attempts ?? 0;
          } catch { /* attempts 读失败按 0 代——投影 best-effort */ }
        }
        await this.collabDoc.writeExecStatus(projectId, nodeId, {
          status: 'error', error: String(error?.message ?? error).slice(0, 200), attempts,
        }).catch(countExecProjectionFailure); // best-effort——doc 写失败不吞原始错误（Y0c T0：吞错加观测）
      }

      // Push failure via WebSocket — do NOT deduct credit on failure
      this.emitPort.emitNodeStatus(projectId, {
        nodeId,
        status: 'edit-failed',
        error: error.message,
      });

      // Re-throw to trigger BullMQ retry
      throw error;
    }
  }

  /** 批0.5-8 F13 终态兜底（execution.processor 同款）：SIGKILL 场景 process 的 catch 不执行——
   *  意图终态只能靠 worker 钩子。形态按 bullmq Worker 'failed' 实际签名 (job, error, prev) 位置参数；
   *  job 可为 undefined（移除中）。lighting job 同队列共用本钩子。
   *  Y0b-1（§1.3/N4/Z27）：intentRowId 从不入队（死代码）——改凭 partial unique 反查在飞行，
   *  jobId 限定防迟到钩子误杀 rearm 换 job 的新活意图。
   *  Y0c T28（Z41）拆两半：worker 只做 PG 半（intentService.fail 意图终态化——GenerationIntentService
   *  只依赖 Prisma+Redis=worker 可安全持有）；exec 投影半移交 api 既有最终一致链——用户重连
   *  alignExecFromIntents 拉取 GET intents 对齐+reconcile 装载自检（零新增 Redis 连接、零跨进程事件丢失面）。
   *  Z 终裁（P14）：整函数兜底绝不外抛。 */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<AiImageEditJobData> | undefined, err: Error) {
    try {
      if (!job) return;
      const { projectId, nodeId, ticket } = job.data ?? {};
      if (!projectId || !nodeId) return;
      const reason = String(err?.message ?? err);
      const running = await this.intentService.findByActiveNode(projectId, nodeId, job.id);
      if (running) {
        // T9：迟到的旧 job 失败钩子 vs 行已换代——ticket 代际票与行不符即让位（不误杀接管新代；
        // 无票 job=接线断裂形态，jobId 守卫兜底维持旧语义）
        if (ticket && running.execSeq !== BigInt(ticket.execSeq)) return;
        await this.intentService.fail(running.id, reason, job.id, running.execSeq); // ACTIVE 守卫幂等——与 process catch 双写不冲突
      }
    } catch (e) {
      this.logger.warn(`[onFailed] 兜底失败 job=${job?.id}（意图交由 reconcile 收尾）: ${e}`);
    }
  }
}
