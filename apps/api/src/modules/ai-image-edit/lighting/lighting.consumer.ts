import { Injectable, Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { getOwnerTeamId } from '../../team/team.util';
import { MinioService } from '../../minio/minio.service';
import { ExecutionGateway } from '../../gateway/execution.gateway';
import { ApiCallerService } from '../../execution/api-caller.service';
import { TeamCreditService } from '../../team/team-credit.service';
import { CollabDocumentService } from '../../collab/collab-document.service';
import { GenerationIntentService } from '../../execution/generation-intent.service';
import { CREDIT_COST_PER_EDIT } from '../ai-image-edit.constants';
import axios from 'axios';

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
  /** 批0.5-8：意图行 id / 客户端幂等键——controller claim 后随 job.data 下传（consume guard/complete 门序） */
  intentRowId?: string;
  intentId?: string;
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
    @Inject(ExecutionGateway) private readonly gateway: ExecutionGateway,
    @Inject(ApiCallerService) private readonly apiCaller: ApiCallerService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
    @Inject(GenerationIntentService) private readonly intentService: GenerationIntentService,
  ) {}

  async handleLightingJob(job: Job<LightingJobData>): Promise<{ status: string; fileId?: string; reason?: string }> {
    const { userId, nodeId, projectId, taskId, originalImageId, params, intentRowId, intentId } = job.data;

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

      // 3. 批0.5-9 reserve 外呼之前（余额不足即拒=零外呼）。guard 缺失=0.5-8 接线断裂——拒绝付费外呼
      //    （个人任务无 projectTeamId 不扣费——现状维持）
      if (projectTeamId) {
        if (!intentRowId || !intentId) {
          throw new Error('INTENT_GUARD_MISSING'); // 恒 claim 后入队（0.5-8）——缺锚即接线断裂
        }
        const reserveResult = await this.teamCredit.reserve(
          projectTeamId, userId, CREDIT_COST_PER_EDIT, { intentRowId, intentId },
        );
        if (!reserveResult.success) {
          const reason = reserveResult.reason ?? 'RESERVE_FAILED';
          this.logger.warn(`Lighting credit-reserve failed for task ${taskId}: ${reason}`);
          await this.intentService.void_(intentRowId, `扣费失败：${reason}`); // 零扣费终态——重试照常扣费
          await this.prisma.lightingTask.update({
            where: { id: taskId },
            data: {
              status: LightingTaskStatus.FAILED,
              errorMessage: `扣费失败：${reason}`,
              completedAt: new Date(),
            },
          });
          this.gateway.emitNodeStatus(projectId || '', {
            nodeId,
            status: 'lighting-failed',
            error: `扣费失败：${reason}`,
          } as any);
          return { status: 'failed', reason };
        }
      }

      // 4. Build prompt from params
      const promptText = paramsToPrompt(params, params.customPrompt);
      this.logger.log(`Lighting prompt: ${promptText}`);

      // 5. Call AI gateway for relighting
      const result = await this.apiCaller.callRelighting?.(presignedUrl, promptText);

      if (!result?.url) {
        throw new Error('AI relighting returned no result URL');
      }

      // 6. Download result image
      const response = await axios.get(result.url, {
        responseType: 'arraybuffer',
        timeout: 120000,
      });

      const buffer = Buffer.from(response.data);
      const contentType: string = String(response.headers['content-type'] || 'image/png');
      const ext = contentType.split('/')[1] || 'png';

      // 7. Upload to MinIO
      const key = this.minio.buildKey('generated', userId, { projectId, nodeId, ext });
      await this.minio.upload(key, buffer, contentType);

      // 8. Create Media record
      const media = await this.prisma.media.create({
        data: {
          userId,
          teamId,
          key,
          originalName: `lighting-${nodeId}.${ext}`,
          mimeType: contentType,
          size: buffer.length,
          projectId,
          nodeId,
          taskId,
          type: 'generated',
          status: 'completed',
        },
      });

      // 8.4 批0.5-9 settle 核销（外呼成功——冻结转实扣；产物落库后 complete 门序前）
      if (projectTeamId && intentRowId && intentId) {
        const settled = await this.teamCredit.settle({ intentRowId, intentId });
        if (!settled.success) this.logger.warn(`[reserve-settle] 意图 ${intentId} settle 未达（冻结由 reconcile 兜底）`);
      }

      // 8.5 批0.5-8 complete 门序（F13：看到产物 ⇒ 意图仍有效）：count===1 才投递产物——
      //     count===0 = 行已被 reconcile VOIDED+退款，SUCCESS 回填/writeNodeData/emit 零调用（外呼产物留作物证）
      if (intentRowId) {
        const gated = await this.intentService.complete(intentRowId, media.id);
        if (gated !== 1) {
          this.logger.warn(`[intent-reconcile] 意图 ${intentId} 已被 VOIDED——跳过产物写入（外呼产物留作物证）`);
          return { status: 'completed', fileId: media.id };
        }
      }

      // 9. Update LightingTask
      const presignedResultUrl = await this.minio.generatePresignedGetUrl(key, 3600);
      await this.prisma.lightingTask.update({
        where: { id: taskId },
        data: {
          status: LightingTaskStatus.SUCCESS,
          resultImageUrl: presignedResultUrl,
          resultMediaId: media.id,
          completedAt: new Date(),
        },
      });

      // 10. Write fileId to server doc；socket 仅进度通知
      if (projectId) {
        await this.collabDoc.writeNodeData(projectId, nodeId, { fileId: media.id });
      }
      this.gateway.emitNodeStatus(projectId || '', {
        nodeId,
        status: 'lighting-result',
        fileId: media.id,
        resultUrl: presignedResultUrl,
      } as any);

      this.logger.log(`Lighting complete: task ${taskId}, media ${media.id}`);
      return { status: 'completed', fileId: media.id };
    } catch (error: any) {
      this.logger.error(`Lighting failed: ${error.message}`, error.stack);

      // 批0.5-9：失败先 void_ 解冻（约束②——冻结退还；无冻结/已结算幂等零动作）。
      // SIGKILL 场景本 catch 不执行——冻结滞留由 reconcile 超龄三查②解冻兜底。
      if (intentRowId && intentId) {
        await this.teamCredit.void_({ intentRowId, intentId })
          .catch((e) => this.logger.warn(`[reserve-settle] 意图 ${intentId} void_ 解冻失败（reconcile 兜底）: ${e}`));
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
      this.gateway.emitNodeStatus(projectId || '', {
        nodeId,
        status: 'lighting-failed',
        error: error.message,
      } as any);

      // Re-throw to trigger BullMQ retry
      throw error;
    }
  }
}
