import { Injectable, HttpStatus, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveIdemKey, normalizeRegenToken, deadlineMsForKind } from './intent-key.util';
import { intentClaimResultTotal } from './exec.metrics';

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
  /** Y0b-2（Z109）：客户端手势 token（"重新生成"幂等锚）——只收客户端原始入参（deriveIdemKey 的 token 位
   *  消费；服务端铸造值禁入此位）。无 token 的普通执行=undefined ⇒ idemKey 末段常量 'run'（内容键）。
   *  原 intentId 复合键判据随 T1 退役（IntentContextMismatchError 同删——idemKey 含上下文，异上下文=异键=新行新扣费）。 */
  gestureToken?: string;
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
  private readonly logger = new Logger(GenerationIntentService.name);
  // @Inject 显式标注——vitest/esbuild 不发射 decorator metadata，类型注解不构成 DI 令牌（仓内惯例）
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** claim 完整状态机（F13→Y0b-2 T1 Z82 idemKey 化→T6 Z94/Z79 ⓪②③ 完整语义）：
   *  ⓪ RUNNING 闸（Z94 前置独立索引查）：同 nodeId 存在 RUNNING 行且非「本 job 重入」（Z104 合取固化：
   *    row.jobId != null && row.jobId === input.jobId——null 永不等于 null，禁 ?? null 归一化）⇒ NodeBusy
   *    （零新行零回放——partial unique 至多一行，一次索引查）。为什么在②之前：②只查 SUCCEEDED 且回放
   *    不 INSERT——partial unique 对它无力（在飞时回放旧产物=doc 闪旧版）。
   *  ① 有 token：findUnique(idemKey 手势键) → 同键状态机（RUNNING 同 jobId 续跑〔⓪ 已拦异 jobId〕；
   *    SUCCEEDED→created:false 重放；FAILED/VOIDED 同键 rearm——error 后同 token=免费 rearm，
   *    attempts 1→2→3 后 EXHAUSTED）；无行 → create（手势键新行=重新生成新扣费）。
   *  ② 无 token：findFirst({projectId,nodeId,kind,paramsHash,status:'SUCCEEDED'}, orderBy createdAt desc)
   *    → 重放最新一次（T6 修复：regenerate（手势键行）成功后普通点击回放内容键第一版的倒退）。
   *  ③ 否则内容键（无 token ⇒ idemKey 末段 'run'）状态机/new（RUNNING 同 jobId 续跑/FAILED-VOIDED rearm；
   *    无行 create——RUNNING partial unique 挡并发⇒NodeBusy）。
   *  异上下文=异 idemKey=走新行（Z109：改参重试=新意图新扣费——旧「上下文不匹配 409」语义退役）
   *  Y0b-1：全部分支包交互式事务——首句 FOR SHARE 准入谓词（Z26）；createMany skipDuplicates（Z33 四轮①：
   *  ON CONFLICT DO NOTHING 不抛错，count 判胜后健康事务内分义）。定价快照五字段无条件固化（E1）——
   *  rearm 分支不重写快照（plan 固化于首次 claim，重试沿用）。
   *  Y0b-2 T6（Z103）：normalizeRegenToken 转严格——非法形态 throw 400 IDEMPOTENCY_TOKEN_INVALID（事务外）。 */
  async claim(input: ClaimInput): Promise<{ intent: any; created: boolean }> {
    let result: 'replay' | 'rearm' | 'new' | undefined;
    try {
      const r = await this.claimTx(input);
      result = r.result;
      return { intent: r.intent, created: r.created };
    } catch (err) {
      // Y0b-2 T6：claim 出口全覆盖——互斥族（NodeBusy/EXHAUSTED/TEAM_CLOSED 之外的业务 4xx）计 busy
      if (err instanceof NodeBusyError || err instanceof IntentExhaustedError) {
        intentClaimResultTotal.inc({ result: 'busy' });
      }
      throw err;
    } finally {
      if (result) intentClaimResultTotal.inc({ result });
    }
  }

  private async claimTx(input: ClaimInput): Promise<{ intent: any; created: boolean; result: 'replay' | 'rearm' | 'new' }> {
    const gestureToken = normalizeRegenToken(input.gestureToken);
    const idemKey = deriveIdemKey({
      projectId: input.projectId, nodeId: input.nodeId, kind: input.kind,
      paramsHash: input.paramsHash, regenToken: gestureToken,
    });
    const where = { idemKey };
    return this.prisma.$transaction(async (tx) => {
      // Z26（三轮 P0-4）：准入谓词与后续 create 同事务——FOR SHARE 与 disbandTeam 事务内 team.update 的行排他锁互斥
      const teamRow = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Team" WHERE id = ${input.teamId} FOR SHARE`;
      if (teamRow.length !== 1 || teamRow[0].status !== 'ACTIVE') {
        throw new BusinessException('TEAM_CLOSED', `团队不存在或已关闭（teamId=${input.teamId}）`, HttpStatus.CONFLICT);
      }

      // ── ⓪ RUNNING 闸（Z94）：一次索引查 partial unique 至多的在飞行——非本 job ⇒ NodeBusy 零新行零回放；
      //    同 jobId（BullMQ stalled 重排）⇒ **直接 rearm 续跑**（S3 e2e 实证修复）：行身份已由 jobId+
      //    partial unique 唯一确定，重排段不得再走 ①/③ 的 idemKey 查找——首段外呼前 doc 补丁（model 落
      //    面板经 collab 去抖窗）可能未持久，重启重放后 paramsHash 漂移 ⇒ 键查找 miss ⇒ create 撞 partial
      //    unique ⇒ NodeBusy ⇒ 在飞意图无人收敛（悬挂至 deadline 批）。⓪ 命中即续跑=Z104"同 jobId 可重入"
      //    的完整语义（T6 重构曾把续跑臂留在 ① 键状态机内——hash 漂移即失效）。 ──
      const running = await tx.generationIntent.findFirst({
        where: { projectId: input.projectId, nodeId: input.nodeId, status: 'RUNNING' },
      });
      if (running) {
        if (!(running.jobId != null && running.jobId === input.jobId)) {
          // Z104 合取：null 永不等于 null——running.jobId=null（同步路径）对 input.jobId=null 的普通点击也拦
          const staleMin = (Date.now() - running.heartbeatAt.getTime()) / 60_000;
          throw new NodeBusyError(staleMin > 10 ? '系统回收中（约 15 分钟），请稍后重试' : undefined);
        }
        // 同 jobId 重排续跑：重锚=新执行段（heartbeat/deadline 刷新防 reaper 误收；startedAt 归 executor
        // reanchorDeadline）。resultRef 清空保留 providerTaskId（Z83 重试 query-first）。
        const rearmed = await tx.generationIntent.updateMany({
          where: { id: running.id, status: 'RUNNING', jobId: input.jobId },
          data: { resultRef: null, heartbeatAt: new Date(), deadlineAt: new Date(Date.now() + deadlineMsForKind(input.kind)) },
        });
        if (rearmed.count === 1) {
          return { intent: await tx.generationIntent.findUniqueOrThrow({ where: { id: running.id } }), created: true, result: 'rearm' };
        }
        throw new NodeBusyError(); // 重锚被并发抢走（行已终态）
      }

      // ── ② 无 token：同参数最新 SUCCEEDED 回放（在⓪之后——在飞时禁回放旧产物） ──
      if (!gestureToken) {
        const latest = await tx.generationIntent.findFirst({
          where: { projectId: input.projectId, nodeId: input.nodeId, kind: input.kind, paramsHash: input.paramsHash, status: 'SUCCEEDED' },
          orderBy: { createdAt: 'desc' },
        });
        if (latest) return { intent: latest, created: false, result: 'replay' };
      }

      // ── ①/③ 同键状态机（①=手势键〔有 token〕；③=内容键〔无 token 且②未命中〕） ──
      const existing = await tx.generationIntent.findUnique({ where });
      if (existing) {
        if (existing.status === 'SUCCEEDED') return { intent: existing, created: false, result: 'replay' };
        if (existing.status === 'RUNNING') {
          // ⓪ 已拦异 jobId——此处仅剩同 jobId 重入（BullMQ stalled 重排同 jobId 重进 claim 不得自锁）
          // ——Y0b-2 T4 重锚=新执行段：重入瞬间刷新 heartbeat/deadline（不刷则旧 deadline 已近/超期
          // ⇒ reaper deadline 批误收重排任务）；startedAt 留给 executor 的 reanchorDeadline（外呼真正起点）。
          // Y0b-2 T5（Z83/Z95）：resultRef 清空**保留 providerTaskId**——重试 query-first 复用 provider 任务
          const rearmed = await tx.generationIntent.updateMany({
            where: { id: existing.id, status: 'RUNNING', jobId: input.jobId },
            data: {
              resultRef: null,
              heartbeatAt: new Date(),
              deadlineAt: new Date(Date.now() + deadlineMsForKind(input.kind)),
            },
          });
          if (rearmed.count === 1) {
            return { intent: await tx.generationIntent.findUniqueOrThrow({ where: { id: existing.id } }), created: true, result: 'rearm' };
          }
          throw new NodeBusyError(); // 重锚被并发抢走（行已终态/换 job）
        }
        // FAILED/VOIDED → 原子再激活（守卫式 updateMany：并发双请求恰一个 count===1）
        // attempts 正交于幂等：SUCCEEDED 重放永不看 attempts，只有失败重试消耗免费额度
        // Y0b-2 T5（Z83/Z95）：resultRef 清空**保留 providerTaskId**——重试 query-first 复用 provider 任务
        if (existing.attempts >= 3) throw new IntentExhaustedError();
        const rearmed = await tx.generationIntent.updateMany({
          where: { id: existing.id, status: { in: [...REARMABLE] } },
          data: {
            status: 'RUNNING',
            error: null,
            resultRef: null,
            jobId: input.jobId ?? null,
            completedAt: null,
            attempts: { increment: 1 },
            heartbeatAt: new Date(), // Z68：rearm 重置生命线（deadline/heartbeat reaper 判据——不刷则 rearm 即刻超龄）
            deadlineAt: new Date(Date.now() + deadlineMsForKind(input.kind)),
          },
        });
        if (rearmed.count === 1) {
          const intent = await tx.generationIntent.findUnique({ where: { id: existing.id } });
          return { intent: intent!, created: true, result: 'rearm' };
        }
        throw new NodeBusyError(); // 再激活被并发抢走
      }
      // 新行（Z33 四轮①）：createMany skipDuplicates ⇒ INSERT ... ON CONFLICT DO NOTHING
      // （覆盖 idemKey 唯一+active partial unique——不抛错，胜者 count===1；纪律：禁在 $transaction 内
      // catch 驱动错误后再查——事务一报错即 aborted，任何后续查询都 25P02）
      // Y0b-2（Z109）：intentId=行身份（服务端 randomUUID 铸造——exec 投影对齐消费，Z88 保留复合唯一）；
      // gestureKey=审计列（客户端原始 token 落库）；三列写入=heartbeatAt/deadlineAt/idemKey（Z68/Z82）
      const { pricing, teamId, gestureToken: _token, ...rest } = input; // 解构剔除：...input 直接展开会把 pricing/gestureToken 带进 Prisma data=unknown field 报错（gestureToken 已铸入 idemKey/gestureKey）
      const ins = await tx.generationIntent.createMany({
        data: [{
          ...rest, intentId: randomUUID(), gestureKey: gestureToken ?? null,
          jobId: input.jobId ?? null, status: 'RUNNING', teamId, idemKey,
          heartbeatAt: new Date(),
          deadlineAt: new Date(Date.now() + deadlineMsForKind(input.kind)),
          pricingRuleId: pricing.pricingRuleId, modelId: pricing.modelId,
          resolutionId: pricing.resolutionId, durationId: pricing.durationId,
          creditCost: pricing.creditCost, // 无条件固化——creditCost:0 也不例外（E1/A2）
        }],
        skipDuplicates: true,
      });
      if (ins.count === 1) {
        return { intent: await tx.generationIntent.findUniqueOrThrow({ where }), created: true, result: 'new' };
      }
      // count===0 ⇒ 撞唯一（idemKey 唯一或 active partial unique）——健康事务内分义：
      const again = await tx.generationIntent.findUnique({ where });
      if (again && input.jobId && again.jobId === input.jobId && again.status === 'RUNNING') {
        return { intent: again, created: true, result: 'rearm' }; // create 与同 job 重入并发——按可重入处理（同 idemKey=同内容）
      }
      // 无行 ⇒ 撞活跃 partial unique（同节点异 idemKey 在飞）；有行 ⇒ 同 idemKey 异 jobId 在飞——均 NodeBusy
      throw new NodeBusyError();
    }, { timeout: 10_000, maxWait: 5_000 }); // 四轮 C4：显式超时（默认 5s 对含 FOR SHARE 等锁的五分支偏紧）
  }

  /** Y0b-2 T4：外呼心跳续命（best-effort——RUNNING 守卫，终态行零动作）。onTick 每 tick 调用
   *  （轮询活着 ⇒ deadline 批不收：heartbeatAt>=deadlineAt）。与 reserve gate CAS 的行锁竞争有界
   *  （reserve 事务 ≤15s 封顶——本 update 单行无事务，锁等待自然消解）。 */
  async touchHeartbeat(id: string): Promise<void> {
    await this.prisma.generationIntent.updateMany({
      where: { id, status: { in: [...ACTIVE] } },
      data: { heartbeatAt: new Date() },
    });
  }

  /** Y0b-2 T4：外呼前重锚——终锚（deadlineAt=now+kind 档）+外呼起点（startedAt——Z83 phase 判据：
   *  startedAt 非空=call 期/空=queue 期）+心跳刷新，三职一次写。claim 时锚是排队档上限，
   *  executor 外呼前调本方法重锚为真正执行段。
   *  Y0b-2 T5（A-2）：返回受影响行数——count===0=行已终态（Z84 宽限后被 VOID 的迟归 job），
   *  调用方据此早退不再 submit（迟归 job 白烧一次外呼的根修）。 */
  async reanchorDeadline(id: string, kind: string): Promise<number> {
    const now = new Date();
    const r = await this.prisma.generationIntent.updateMany({
      where: { id, status: { in: [...ACTIVE] } },
      data: { startedAt: now, deadlineAt: new Date(now.getTime() + deadlineMsForKind(kind)), heartbeatAt: now },
    });
    return r.count;
  }

  /** complete 幂等迁移——返回受影响行数（F13 产物门序）：count===1 调用方才写 doc/exec；
   *  count===0 = 行已被 reconcile VOIDED+退款——调用方跳过产物写入（"看到产物 ⇒ 意图仍有效"）。
   *  Y0b-2 T4：终态补 heartbeatAt=终态时刻（判读辅助——终态行不进 reaper 批，纯审计戳）。 */
  async complete(id: string, resultRef: string): Promise<number> {
    const r = await this.prisma.generationIntent.updateMany({
      where: { id, status: { in: [...ACTIVE] } },
      data: { status: 'SUCCEEDED', resultRef, completedAt: new Date(), heartbeatAt: new Date() },
    });
    return r.count;
  }

  /** fail 同构幂等迁移：where ACTIVE 守卫——终态行再 fail 零匹配零变更；error 截断 500 防长栈撑库。
   *  Y0b-1（Z27）：可选 jobId 限定——worker failed 钩子迟到+同节点已 rearm 换新 job 的极限窗口下，
   *  迟到钩子只 fail 本 job 自己的在飞意图（新活意图归属不同 job，零误杀）。 */
  async fail(id: string, error: string, jobId?: string): Promise<void> {
    await this.prisma.generationIntent.updateMany({
      where: { id, status: { in: [...ACTIVE] }, ...(jobId ? { jobId } : {}) },
      data: { status: 'FAILED', error: error.slice(0, 500), completedAt: new Date(), heartbeatAt: new Date() }, // Y0b-2 T4：终态时刻审计戳
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
      data: { status: 'VOIDED', error: error.slice(0, 500), completedAt: new Date(), heartbeatAt: new Date() }, // Y0b-2 T4：终态时刻审计戳
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
        attempts: true, // Y0b-2 T5（Z99/Z111）：投影代次判据——web ExecStatusEntry.attempts 对齐
      },
    });
  }
}
