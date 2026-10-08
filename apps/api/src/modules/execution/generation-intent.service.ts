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

/** Y0b-1（E1）：定价快照五字段——claim 入参必填（validation 预检产 plans 同源），
 *  create 时无条件固化（creditCost:0 也固化——E1/A2：免费行也是规则行的产物，非"未解析"）。 */
export interface ClaimPricing {
  pricingRuleId: string;
  modelId: string | null;
  resolutionId: string | null;
  durationId: string | null;
  creditCost: number;
}

export interface ClaimInput {
  projectId: string;
  nodeId: string;
  userId: string;
  intentId: string;
  kind: string;
  paramsHash: string;
  /** Y0b-1（E1）：团队锚——FOR SHARE 准入谓词（Z26）+ 固化列（Z4 资金路径直查锚）。必填。 */
  teamId: string;
  /** Y0b-1（E1）：定价快照——必填（编译期保证，运行时无缺省兜底）。 */
  pricing: ClaimPricing;
  jobId?: string;
}

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
   *  异上下文（nodeId/kind/paramsHash 任一不匹配）→ 409 INTENT_CONTEXT_MISMATCH
   *  Y0b-1：全部分支包交互式事务——首句 FOR SHARE 准入谓词（Z26：与 disbandTeam 的 FOR UPDATE 互斥，
   *  谓词与后续写同事务=穿门窗口真正关闭）；分支① create 改 createMany skipDuplicates（Z33 四轮①：
   *  PG 交互式事务一报错即 aborted——既有 catch-P2002-再查形态在事务内必 25P02；ON CONFLICT DO NOTHING
   *  不抛错，count 判胜后健康事务内分义）。定价快照五字段无条件固化（E1）——rearm 分支④不重写快照
   *  （plan 固化于首次 claim，重试沿用）。 */
  async claim(input: ClaimInput): Promise<{ intent: any; created: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      // Z26（三轮 P0-4）：准入谓词与后续 create 同事务——FOR SHARE 与 disbandTeam 的 FOR UPDATE 互斥
      const teamRow = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Team" WHERE id = ${input.teamId} FOR SHARE`;
      if (teamRow.length !== 1 || teamRow[0].status !== 'ACTIVE') {
        throw new BusinessException('TEAM_CLOSED', `团队不存在或已关闭（teamId=${input.teamId}）`, HttpStatus.CONFLICT);
      }
      const where = { projectId_intentId: { projectId: input.projectId, intentId: input.intentId } };
      const sameCtx = (r: { nodeId: string; kind: string; paramsHash: string }) =>
        r.nodeId === input.nodeId && r.kind === input.kind && r.paramsHash === input.paramsHash;

      const existing = await tx.generationIntent.findUnique({ where });
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
        const rearmed = await tx.generationIntent.updateMany({
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
          const intent = await tx.generationIntent.findUnique({ where: { id: existing.id } });
          return { intent: intent!, created: true };
        }
        throw new NodeBusyError(); // 再激活被并发抢走
      }
      // 分支①（Z33 四轮①）：createMany skipDuplicates ⇒ INSERT ... ON CONFLICT DO NOTHING
      // （覆盖复合唯一+active partial unique——不抛错，胜者 count===1；纪律：禁在 $transaction 内
      // catch 驱动错误后再查——事务一报错即 aborted，任何后续查询都 25P02）
      const { pricing, teamId, ...rest } = input; // 解构剔除：...input 直接展开会把 pricing 对象带进 Prisma data=unknown field 报错
      const ins = await tx.generationIntent.createMany({
        data: [{
          ...rest, jobId: input.jobId ?? null, status: 'RUNNING', teamId,
          pricingRuleId: pricing.pricingRuleId, modelId: pricing.modelId,
          resolutionId: pricing.resolutionId, durationId: pricing.durationId,
          creditCost: pricing.creditCost, // 无条件固化——creditCost:0 也不例外（E1/A2）
        }],
        skipDuplicates: true,
      });
      if (ins.count === 1) {
        return { intent: await tx.generationIntent.findUniqueOrThrow({ where }), created: true };
      }
      // count===0 ⇒ 撞唯一（复合唯一或 active partial unique）——健康事务内分义（原三档语义原样迁移）：
      const again = await tx.generationIntent.findUnique({ where });
      if (again && sameCtx(again) && input.jobId && again.jobId === input.jobId && again.status === 'RUNNING') {
        return { intent: again, created: true }; // create 与同 job 重入并发——按可重入处理
      }
      if (!again) throw new NodeBusyError(); // 本 intentId 无行 ⇒ 只可能撞活跃 partial unique（同节点异 intentId 在飞）
      if (sameCtx(again)) throw new NodeBusyError(); // 同上下文异 jobId 撞复合唯一=在飞非错配（mismatch 标签误导用户）
      throw new IntentContextMismatchError();
    }, { timeout: 10_000, maxWait: 5_000 }); // 四轮 C4：显式超时（默认 5s 对含 FOR SHARE 等锁的五分支偏紧）
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

  /** fail 同构幂等迁移：where ACTIVE 守卫——终态行再 fail 零匹配零变更；error 截断 500 防长栈撑库。
   *  Y0b-1（Z27）：可选 jobId 限定——worker failed 钩子迟到+同节点已 rearm 换新 job 的极限窗口下，
   *  迟到钩子只 fail 本 job 自己的在飞意图（新活意图归属不同 job，零误杀）。 */
  async fail(id: string, error: string, jobId?: string): Promise<void> {
    await this.prisma.generationIntent.updateMany({
      where: { id, status: { in: [...ACTIVE] }, ...(jobId ? { jobId } : {}) },
      data: { status: 'FAILED', error: error.slice(0, 500), completedAt: new Date() },
    });
  }

  /** Y0b-1（N4/Z27）：partial unique 反查——worker failed 钩子用（intentRowId 从不入队=死代码）。
   *  凭 generation_intent_active_node_unique 反查在飞行；jobId 限定防迟到钩子误杀新活意图。 */
  async findByActiveNode(projectId: string, nodeId: string, jobId?: string) {
    return this.prisma.generationIntent.findFirst({
      where: { projectId, nodeId, status: 'RUNNING', ...(jobId ? { jobId } : {}) },
    });
  }

  /** 批0.5-9 void：reserve 失败（零扣费）终态——与 FAILED 分义不混：FAILED=冻结已退（void_ 解冻后）
   *  外呼失败的终态；VOIDED=从未扣费，rearm 重试照常 reserve。where ACTIVE 守卫同款幂等。 */
  async void_(id: string, error: string): Promise<void> {
    await this.prisma.generationIntent.updateMany({
      where: { id, status: { in: [...ACTIVE] } },
      data: { status: 'VOIDED', error: error.slice(0, 500), completedAt: new Date() },
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
