import { Injectable, HttpStatus, Inject } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';

/** 409 意图上下文错配——intentId 复用到不同节点/kind/参数（防客户端改参白嫖已扣费意图，绝不静默跳过）。
 *  形态对齐仓内 BusinessException（HttpException 子类，errorCode 经 getResponse 透出）。 */
export class IntentContextMismatchError extends BusinessException {
  constructor() {
    super('INTENT_CONTEXT_MISMATCH', '意图上下文不匹配（intentId 复用到不同节点/参数）', HttpStatus.CONFLICT);
  }
}

/** 409 节点在飞互斥——F1 partial unique 的应用层镜像（双击/stalled 异 jobId/再激活被抢共用）。 */
export class NodeBusyError extends BusinessException {
  constructor(msg?: string) {
    super('NODE_BUSY', msg ?? '该节点正在生成中', HttpStatus.CONFLICT);
  }
}

/** 409 免费重放上限——rearm 自增 attempts，≥3 拒绝再激活（幂等≠无限白嫖外呼；新意图重新扣费）。 */
export class IntentExhaustedError extends BusinessException {
  constructor() {
    super('INTENT_EXHAUSTED', '重试次数已用尽——请重新发起生成（新意图将正常扣费）', HttpStatus.CONFLICT);
  }
}

/** ACTIVE = claim/complete/fail 的状态机守卫集。PENDING 已删（0.5-1）——claim 直建 RUNNING。 */
const ACTIVE = ['RUNNING'] as const;
/** 可再激活的终态：FAILED=押金还押着（重试 alreadyCharged 免费续跑）；VOIDED=退款已归零（重试正常扣费）——
 *  creditsConsumed 不动，四格扣费语义由此分叉正确（F13 补强真值表）。 */
const REARMABLE = ['FAILED', 'VOIDED'] as const;

/** P2002 分义依据（真库 int 实测，Prisma 5.22 + PG）：meta.target 恒为 null——
 *  partial unique（generation_intent_active_node_unique，migration SQL 唯一真相）与
 *  schema 声明的复合唯一 (projectId,intentId) 撞击皆然，meta 仅含 modelName。
 *  故分义不做 target 形态匹配（禁纸上推演），改用约束排除：见 claim catch 块。 */

@Injectable()
export class GenerationIntentService {
  // @Inject 显式标注——vitest/esbuild 不发射 decorator metadata，类型注解不构成 DI 令牌（仓内惯例）
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** claim 完整状态机（F13）——五个分支：
   *  ① 无行 → create（RUNNING）= 新执行权
   *  ② RUNNING 且同 jobId → 可重入续跑（BullMQ stalled 重排同 jobId 重进 claim 不得自锁）= 执行权
   *  ③ RUNNING 且异 jobId → NodeBusy（双击互斥）
   *  ④ FAILED/VOIDED 且同上下文 → 守卫式原子再激活（updateMany count===1 才拥有执行权，并发抢走 → NodeBusy）
   *  ⑤ SUCCEEDED 且同上下文 → created:false 幂等重放（调用方返回既有产物引用，零外呼零扣费）
   *  异上下文（nodeId/kind/paramsHash 任一不匹配）→ 409 INTENT_CONTEXT_MISMATCH */
  async claim(input: {
    projectId: string;
    nodeId: string;
    userId: string;
    intentId: string;
    kind: string;
    paramsHash: string;
    jobId?: string;
  }): Promise<{ intent: any; created: boolean }> {
    const where = { projectId_intentId: { projectId: input.projectId, intentId: input.intentId } };
    const sameCtx = (r: { nodeId: string; kind: string; paramsHash: string }) =>
      r.nodeId === input.nodeId && r.kind === input.kind && r.paramsHash === input.paramsHash;

    const existing = await this.prisma.generationIntent.findUnique({ where });
    if (existing) {
      if (!sameCtx(existing)) throw new IntentContextMismatchError();
      if (existing.status === 'SUCCEEDED') return { intent: existing, created: false };
      if (existing.status === 'RUNNING') {
        if (input.jobId && existing.jobId === input.jobId) return { intent: existing, created: true }; // 同 job 可重入
        // 同步路径孤儿（updatedAt 龄 >10min，reconcile 尚未回收）与真在飞的 UX 分义——文案提示回收窗口
        const staleMin = (Date.now() - existing.updatedAt.getTime()) / 60_000;
        throw new NodeBusyError(staleMin > 10 ? '系统回收中（约 15 分钟），请稍后重试' : undefined);
      }
      // FAILED/VOIDED → 原子再激活（守卫式 updateMany：并发双请求恰一个 count===1）
      // attempts 正交于幂等：SUCCEEDED 重放永不看 attempts，只有失败重试消耗免费额度
      if (existing.attempts >= 3) throw new IntentExhaustedError();
      const rearmed = await this.prisma.generationIntent.updateMany({
        where: { id: existing.id, status: { in: [...REARMABLE] } },
        data: {
          status: 'RUNNING',
          error: null,
          jobId: input.jobId ?? null,
          completedAt: null,
          attempts: { increment: 1 },
        },
      });
      if (rearmed.count === 1) {
        const intent = await this.prisma.generationIntent.findUnique({ where: { id: existing.id } });
        return { intent: intent!, created: true };
      }
      throw new NodeBusyError(); // 再激活被并发抢走
    }
    try {
      const intent = await this.prisma.generationIntent.create({
        data: { ...input, jobId: input.jobId ?? null, status: 'RUNNING' },
      });
      return { intent, created: true };
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const again = await this.prisma.generationIntent.findUnique({ where });
        if (again && sameCtx(again) && input.jobId && again.jobId === input.jobId && again.status === 'RUNNING') {
          return { intent: again, created: true }; // create 与同 job 重入并发——按可重入处理
        }
        // 约束排除分义（真库实测 meta.target=null，无法按索引名判别；表上唯一约束仅 PK/
        // 复合唯一/活跃 partial unique 三者）：
        if (!again) throw new NodeBusyError(); // 本 intentId 无行 ⇒ 复合唯一未被撞 ⇒ 只可能撞活跃 partial unique（同节点异 intentId 在飞）
        if (sameCtx(again)) throw new NodeBusyError(); // 同上下文异 jobId 撞复合唯一=在飞非错配（mismatch 标签误导用户）
        throw new IntentContextMismatchError();
      }
      throw e;
    }
  }

  /** complete 幂等迁移——返回受影响行数（F13 产物门序）：count===1 调用方才写 doc/exec；
   *  count===0 = 行已被 reconcile VOIDED+退款——调用方跳过产物写入（"看到产物 ⇒ 意图仍有效"）。 */
  async complete(id: string, resultRef: string): Promise<number> {
    const r = await this.prisma.generationIntent.updateMany({
      where: { id, status: { in: [...ACTIVE] } },
      data: { status: 'SUCCEEDED', resultRef, completedAt: new Date() },
    });
    return r.count;
  }

  /** fail 同构幂等迁移：where ACTIVE 守卫——终态行再 fail 零匹配零变更；error 截断 500 防长栈撑库。 */
  async fail(id: string, error: string): Promise<void> {
    await this.prisma.generationIntent.updateMany({
      where: { id, status: { in: [...ACTIVE] } },
      data: { status: 'FAILED', error: error.slice(0, 500), completedAt: new Date() },
    });
  }

  /** 扩面模块 controller claim→queue.add 后回写 jobId（F13 补强）：不回写则 reconcile A 路径
   *  （查 BullMQ 真实状态）对 ai-image-edit/lighting 永久失效，且与同步路径（合法无 jobId）
   *  不可区分——长任务会被三查②按"同步路径崩溃"误判 VOIDED。 */
  async attachJob(id: string, jobId: string): Promise<void> {
    await this.prisma.generationIntent.update({ where: { id }, data: { jobId } });
  }

  async listByNode(projectId: string, nodeId: string) {
    return this.prisma.generationIntent.findMany({
      where: { projectId, nodeId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, intentId: true, kind: true, status: true, resultRef: true,
        error: true, creditsConsumed: true, createdAt: true, completedAt: true,
      },
    });
  }
}
