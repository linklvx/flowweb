import { Injectable, HttpStatus, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamCreditService } from '../team/team-credit.service';
import { deriveIdemKey, normalizeRegenToken, deadlineMsForKind } from './intent-key.util';
import { intentClaimResultTotal } from './exec.metrics';
import { NodeArtifactService, targetFieldOfKind } from '../artifact-core/node-artifact.service';

/** Y1a T9（spec ㉒）：同 job 重入心跳新鲜判据——heartbeatAt 距今 < 锁窗（BullMQ lockDuration 60s）
 *  ⇒ 旧 worker 在飞（轮询 tick 每次刷心跳，poll 默认 10s≪窗）。BullMQ 仅在锁过期后才重投，重投时
 *  心跳仍新鲜=锁续期失败但进程活着（moveToDelayed 让位）；心跳超窗=旧 worker 真/结构死（takeover 接管）。 */
export const EXEC_SAME_JOB_ALIVE_MS = 60_000;


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

/** ACTIVE = claim/complete/fail 的状态机守卫集。PENDING 已删（0.5-1）——claim 直建 RUNNING。
 *  Y1c T23：UNKNOWN（text 链外呼结果不明——超时/5xx）非终态停驻档——不入 ACTIVE（reaper/reconcile
 *  均 RUNNING-only 扫描=UNKNOWN 行不自动收敛，人工对账面 text_unknown_total）；reserve 在 UNKNOWN
 *  期间保留（markUnknown 不动资金），用户显式重试=rearm（同 FAILED/VOIDED 守卫式再激活）。 */
const ACTIVE = ['RUNNING'] as const;
/** 可再激活的终态：FAILED=押金还押着（重试 alreadyCharged 免费续跑）；VOIDED=退款已归零（重试正常扣费）——
 *  creditsConsumed 不动，四格扣费语义由此分叉正确（F13 补强真值表）。
 *  Y1c T23：+UNKNOWN（text 外呼结果不明——rearm=voidInTx 释放残留冻结+新代 reserve：旧代钱已让渡、
 *  新 attempt 正常计费=「取消才 void」分支；供应商重复成本平台吸收）。 */
const REARMABLE = ['FAILED', 'VOIDED', 'UNKNOWN'] as const;

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
  /** Y0b-5 T13：W3C trace-id 审计锚（x-request-id 同源，服务端生成）——新行落列；FAILED/VOIDED 再激活
   *  （新执行段）随 claim 覆写。来源：HTTP 直达=controller 自 ALS 读；enqueue 管道=job.data.traceId
   *  （worker 无 HTTP ALS——ALS 不过 Redis，跨进程经 job.data 显式携带）。 */
  traceId?: string | null;
}

@Injectable()
export class GenerationIntentService {
  private readonly logger = new Logger(GenerationIntentService.name);
  // @Inject 显式标注——vitest/esbuild 不发射 decorator metadata，类型注解不构成 DI 令牌（仓内惯例）
  // T9：TeamCreditService 注入=rearm/takeover 事务内 voidInTx 只释放旧代冻结（同事务原子——零独立事务竞态窗）
  // T10：NodeArtifactService 注入=claim 事务内 claimCapture 读槽位 rev（expectedRev 随 claim 返回——
  // finalize CAS 锚；Z18''-v14：PG 权威非 doc/fileIdRev）
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
    @Inject(NodeArtifactService) private readonly nodeArtifacts: NodeArtifactService,
  ) {}

  /** T9：exec_seq 全局单调取号（claim new/rearm 两处唯一分配点——DB sequence 单源，禁 increment/max+1）。 */
  private async nextExecSeq(tx: Prisma.TransactionClient): Promise<bigint> {
    const rows = await tx.$queryRaw<{ v: bigint }[]>`SELECT nextval('exec_seq') AS v`;
    return rows[0].v;
  }

  /** T9：rearm/takeover 事务内释放旧代冻结——无钱包（TEAM_BALANCE_MISSING）=从无 reserve 可释放，
   *  跳过不阻断再激活（钱包唯一创建口 ensureBalance 团队生命周期必建；缺行夹具/极端窗防御）。 */
  private async voidOldGenFreeze(tx: Prisma.TransactionClient, intentRowId: string, execSeq: bigint): Promise<void> {
    await this.teamCredit.voidInTx(tx, { intentRowId, execSeq }).catch((e) => {
      if (e instanceof BusinessException && e.errorCode === 'TEAM_BALANCE_MISSING') return;
      throw e;
    });
  }

  /** claim 完整状态机（F13→Y0b-2 T1 Z82 idemKey 化→T6 Z94/Z79 ⓪②③ 完整语义→Y1a T9 三态/代际）：
   *  ⓪ RUNNING 闸（Z94 前置独立索引查）：同 nodeId 存在 RUNNING 行且非「本 job 重入」（Z104 合取固化：
   *    row.jobId != null && row.jobId === input.jobId——null 永不等于 null，禁 ?? null 归一化）⇒ NodeBusy
   *    （零新行零回放——partial unique 至多一行，一次索引查）。为什么在②之前：②只查 SUCCEEDED 且回放
   *    不 INSERT——partial unique 对它无力（在飞时回放旧产物=doc 闪旧版）。
   *    T9 同 job 重入三态（spec ㉒——覆盖旧「rearm 续跑同代+reserve mayCall:false 静默 skip」悬挂形态）：
   *    ①心跳新鲜（<EXEC_SAME_JOB_ALIVE_MS）⇒ same-job-alive 零写行让位（调用方 moveToDelayed 不 ack）；
   *    ②心跳过期 ⇒ takeover：nextval 新代+voidInTx 只释放旧代冻结+旧投影 superseded+行换代重锚；
   *    ③行已被并发收敛终态 ⇒ NodeBusy 兜底（CAS count===0）。
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
   *  T9：rearm=nextval 第二处分配点（FAILED/VOIDED 再激活与 takeover 共用「换代+只释放+旧投影 superseded」
   *  语义——重扣费归新段 reserve）；resultRef 清空保留 providerTaskId/providerRequestId（Z83 query-first 链）。
   *  Y0b-2 T6（Z103）：normalizeRegenToken 转严格——非法形态 throw 400 IDEMPOTENCY_TOKEN_INVALID（事务外）。 */
  async claim(input: ClaimInput): Promise<{ intent: any; created: boolean; result: 'replay' | 'rearm' | 'new' | 'same-job-alive'; artifactRev: number }> {
    let result: 'replay' | 'rearm' | 'new' | 'same-job-alive' | undefined;
    try {
      const r = await this.claimTx(input);
      result = r.result;
      return { intent: r.intent, created: r.created, result: r.result, artifactRev: r.artifactRev };
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

  private async claimTx(input: ClaimInput): Promise<{ intent: any; created: boolean; result: 'replay' | 'rearm' | 'new' | 'same-job-alive'; artifactRev: number }> {
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

      // ── T10 claimCapture（Z18''-v14）：claim 事务内读 NodeArtifact 槽位当前 rev 作 expectedRev
      //    （无行=0）。捕获点=claim 时刻 ⇒ claim→finalize 窗口内任何 replace/新代 finalize（rev+1）
      //    必与本代 expectedRev 失配=superseded——「最新意图优先」的 CAS 结构表达。 ──
      const artifactRev = await this.nodeArtifacts.claimCapture(tx, {
        projectId: input.projectId, nodeId: input.nodeId, targetField: targetFieldOfKind(input.kind),
      });

      // ── ⓪ RUNNING 闸（Z94）：一次索引查 partial unique 至多的在飞行——非本 job ⇒ NodeBusy 零新行零回放；
      //    同 jobId（BullMQ stalled 重排）⇒ T9 三态分义（心跳新鲜=旧 worker 在飞让位/过期=takeover 接管）。
      //    行身份已由 jobId+partial unique 唯一确定，重排段不得再走 ①/③ 的 idemKey 查找——首段外呼前 doc
      //    补丁可能未持久，重启重放后 paramsHash 漂移 ⇒ 键查找 miss ⇒ create 撞 partial unique ⇒ NodeBusy
      //    ⇒ 在飞意图无人收敛（悬挂至 deadline 批）——Z104"同 jobId 可重入"语义保持。 ──
      const running = await tx.generationIntent.findFirst({
        where: { projectId: input.projectId, nodeId: input.nodeId, status: 'RUNNING' },
      });
      if (running) {
        if (!(running.jobId != null && running.jobId === input.jobId)) {
          // Z104 合取：null 永不等于 null——running.jobId=null（同步路径）对 input.jobId=null 的普通点击也拦
          const staleMin = (Date.now() - running.heartbeatAt.getTime()) / 60_000;
          throw new NodeBusyError(staleMin > 10 ? '系统回收中（约 15 分钟），请稍后重试' : undefined);
        }
        // ── T9 同 job 重入三态（spec ㉒）──
        if (Date.now() - running.heartbeatAt.getTime() < EXEC_SAME_JOB_ALIVE_MS) {
          // 态① 心跳新鲜：旧 worker 在飞（onTick 持续刷心跳）——本重排 worker 零写行让位（禁重锚/换代/
          // 清 resultRef——行完全归旧 worker）；调用方（processor）moveToDelayed+DelayedError 不 ack
          // ——旧 worker 真死 ⇒ 下轮重排心跳超窗 ⇒ 态② takeover 收敛（「skip 后 return=ack 零交付」根修）。
          return { intent: running, created: false, result: 'same-job-alive', artifactRev };
        }
        // 态② 心跳过期=takeover：nextval 新代 fence 旧代+voidInTx 只释放旧代冻结（v9「release+re-reserve」
        // 废止——re-reserve 后新段 reserve 必 mayCall:false 悬挂）+旧投影 superseded+行换代重锚
        // （attempts 不动——同 job 续跑非用户新意图；resultRef 清空保留 providerTaskId——Z83 query-first 复用）。
        const execSeq = await this.nextExecSeq(tx);
        await this.voidOldGenFreeze(tx, running.id, running.execSeq);
        await this.supersedeProjections(tx, input.projectId, input.nodeId);
        const rearmed = await tx.generationIntent.updateMany({
          where: { id: running.id, status: 'RUNNING', jobId: input.jobId, execSeq: running.execSeq },
          // T13 评审 Important#1：claimCapture 槽位 rev 随 claim 事务持久化（R3 finalizeFromStage 的
          // expectedRev 重建源——崩溃后凭列重建；悬留窗 replace 失配=superseded 不覆盖用户值）
          data: { execSeq, resultRef: null, claimArtifactRev: artifactRev, heartbeatAt: new Date(), deadlineAt: new Date(Date.now() + deadlineMsForKind(input.kind)) },
        });
        if (rearmed.count === 1) {
          return { intent: await tx.generationIntent.findUniqueOrThrow({ where: { id: running.id } }), created: true, result: 'rearm', artifactRev };
        }
        throw new NodeBusyError(); // 行已被并发收敛（takeover 竞态败者/已终态）
      }

      // ── ② 无 token：同参数最新 SUCCEEDED 回放（在⓪之后——在飞时禁回放旧产物） ──
      if (!gestureToken) {
        const latest = await tx.generationIntent.findFirst({
          where: { projectId: input.projectId, nodeId: input.nodeId, kind: input.kind, paramsHash: input.paramsHash, status: 'SUCCEEDED' },
          orderBy: { createdAt: 'desc' },
        });
        if (latest) return { intent: latest, created: false, result: 'replay', artifactRev };
      }

      // ── ①/③ 同键状态机（①=手势键〔有 token〕；③=内容键〔无 token 且②未命中〕） ──
      const existing = await tx.generationIntent.findUnique({ where });
      if (existing) {
        if (existing.status === 'SUCCEEDED') return { intent: existing, created: false, result: 'replay', artifactRev };
        if (existing.status === 'RUNNING') {
          // ⓪ 已拦异 jobId——此处仅剩 running.jobId=null 的同步路径在飞行对同键重入（⓪ 合取 null≠null
          // 已拦，本臂=同键 RUNNING 但节点 partial unique 被 ⓪ 放行的极窄并发残余）——NodeBusy 兜底。
          throw new NodeBusyError();
        }
        // FAILED/VOIDED → 原子再激活（守卫式 updateMany：并发双请求恰一个 count===1）
        // attempts 正交于幂等：SUCCEEDED 重放永不看 attempts，只有失败重试消耗免费额度
        // T9：rearm=nextval 第二处分配点+voidInTx 只释放残留冻结+旧投影 superseded——新执行段新代际
        //（reserve 写 reservedExecSeq=新代；旧代生命线/资金写全 0 命中退役）。
        if (existing.attempts >= 3) throw new IntentExhaustedError();
        const execSeq = await this.nextExecSeq(tx);
        await this.voidOldGenFreeze(tx, existing.id, existing.execSeq);
        await this.supersedeProjections(tx, input.projectId, input.nodeId);
        const rearmed = await tx.generationIntent.updateMany({
          where: { id: existing.id, status: { in: [...REARMABLE] } },
          data: {
            status: 'RUNNING',
            error: null,
            resultRef: null,
            execSeq,
            claimArtifactRev: artifactRev,   // T13 评审 Important#1：claim 捕获 rev 持久化（R3 expectedRev 重建源）
            jobId: input.jobId ?? null,
            completedAt: null,
            attempts: { increment: 1 },
            heartbeatAt: new Date(), // Z68：rearm 重置生命线（deadline/heartbeat reaper 判据——不刷则 rearm 即刻超龄）
            deadlineAt: new Date(Date.now() + deadlineMsForKind(input.kind)),
            ...(input.traceId ? { traceId: input.traceId } : {}), // T13：新执行段新 trace 覆写审计锚（旧 job 无 traceId 保持原值）
          },
        });
        if (rearmed.count === 1) {
          const intent = await tx.generationIntent.findUnique({ where: { id: existing.id } });
          return { intent: intent!, created: true, result: 'rearm', artifactRev };
        }
        throw new NodeBusyError(); // 再激活被并发抢走
      }
      // 新行（Z33 四轮①）：createMany skipDuplicates ⇒ INSERT ... ON CONFLICT DO NOTHING
      // （覆盖 idemKey 唯一+active partial unique——不抛错，胜者 count===1；纪律：禁在 $transaction 内
      // catch 驱动错误后再查——事务一报错即 aborted，任何后续查询都 25P02）
      // Y0b-2（Z109）：intentId=行身份（服务端 randomUUID 铸造——exec 投影对齐消费，Z88 保留复合唯一）；
      // gestureKey=审计列（客户端原始 token 落库）；三列写入=heartbeatAt/deadlineAt/idemKey（Z68/Z82）；
      // T9：execSeq=nextval 第一处分配点（new claim——显式取号，schema 默认已删）。
      const { pricing, teamId, gestureToken: _token, traceId, ...rest } = input; // 解构剔除：...input 直接展开会把 pricing/gestureToken 带进 Prisma data=unknown field 报错（gestureToken 已铸入 idemKey/gestureKey）
      const ins = await tx.generationIntent.createMany({
        data: [{
          ...rest, intentId: randomUUID(), gestureKey: gestureToken ?? null,
          traceId: traceId ?? null, // T13：审计锚落列（新行同值——组执行 N 节点共用一 traceId）
          jobId: input.jobId ?? null, status: 'RUNNING', teamId, idemKey,
          execSeq: await this.nextExecSeq(tx),
          claimArtifactRev: artifactRev,   // T13 评审 Important#1：claim 捕获 rev 随行落列（单真源）
          heartbeatAt: new Date(),
          deadlineAt: new Date(Date.now() + deadlineMsForKind(input.kind)),
          pricingRuleId: pricing.pricingRuleId, modelId: pricing.modelId,
          resolutionId: pricing.resolutionId, durationId: pricing.durationId,
          creditCost: pricing.creditCost, // 无条件固化——creditCost:0 也不例外（E1/A2）
        }],
        skipDuplicates: true,
      });
      if (ins.count === 1) {
        return { intent: await tx.generationIntent.findUniqueOrThrow({ where }), created: true, result: 'new', artifactRev };
      }
      // count===0 ⇒ 撞唯一（idemKey 唯一或 active partial unique）——健康事务内分义：
      const again = await tx.generationIntent.findUnique({ where });
      if (again && input.jobId && again.jobId === input.jobId && again.status === 'RUNNING') {
        return { intent: again, created: true, result: 'rearm', artifactRev }; // create 与同 job 重入并发——按可重入处理（同 idemKey=同内容）
      }
      // 无行 ⇒ 撞活跃 partial unique（同节点异 idemKey 在飞）；有行 ⇒ 同 idemKey 异 jobId 在飞——均 NodeBusy
      throw new NodeBusyError();
    }, { timeout: 10_000, maxWait: 5_000 }); // 四轮 C4：显式超时（默认 5s 对含 FOR SHARE 等锁的五分支偏紧）
  }

  /** T9：rearm/takeover 事务内旧投影 superseded——该节点槽位一切非终态投影（pending/projecting）
   *  均属旧代（新代 finalize 才建新投影行）→ superseded 终态（六终态不可回退；T15 poller 前置接线，
   *  当前写入点唯一=本处——行尚无来源时 no-op）。 */
  private async supersedeProjections(tx: Prisma.TransactionClient, projectId: string, nodeId: string): Promise<void> {
    await tx.artifactProjection.updateMany({
      where: { projectId, nodeId, state: { in: ['pending', 'projecting'] } },
      data: { state: 'superseded' },
    });
  }

  /** T9 tickFence：onTick 双职单源（execution.service/ai-image-edit processor/lighting consumer
   *  三消费面共用）——①touchHeartbeat 续生命线（代际 CAS）②读 {status,execSeq}：终态（reaper 收敛）
   *  或 execSeq 换代（旧代 worker——takeover/rearm 后新代已接管）⇒ 'abort' 停外呼（省 provider 轮询
   *  白烧钱）；行灭失同 abort（数据完整性兜底）。
   *  T9 收尾（评审 Minor）：双职合一 UPDATE...RETURNING 单往返（改前 updateMany+findUnique 每 tick
   *  两次 DB 往返；collab-lease.service 同款 RETURNING 判 rows 形态）。0 命中=行灭失/终态/换代三态
   *  合并 abort——与旧形态逐态判读等价（where 同谓词 RUNNING+execSeq：RUNNING∧同代必被 UPDATE 命中，
   *  不存在「读回 RUNNING 同代而写 0 命中」分叉）；touchHeartbeat 随合并退役（生产消费点唯一=本处）。
   *  heartbeatAt 写值纪律：Prisma DateTime 落 PG naive timestamp=UTC 墙钟——(now() AT TIME ZONE 'utc')
   *  对齐（media-probe.poller 同款；会话 TZ≠UTC 时裸 now() 恒偏移——heartbeat/deadline 判据漂移）。 */
  async tickFence(id: string, execSeq: bigint): Promise<'abort' | void> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "GenerationIntent" SET "heartbeatAt" = (now() AT TIME ZONE 'utc')
      WHERE "id" = ${id} AND "status" = 'RUNNING' AND "execSeq" = ${execSeq}
      RETURNING "id"`;
    if (rows.length === 0) return 'abort';
  }

  /** Y0b-2 T4：外呼前重锚——终锚（deadlineAt=now+kind 档）+外呼起点（startedAt——Z83 phase 判据：
   *  startedAt 非空=call 期/空=queue 期）+心跳刷新，三职一次写。claim 时锚是排队档上限，
   *  executor 外呼前调本方法重锚为真正执行段。
   *  Y0b-2 T5（A-2）：返回受影响行数——count===0=行已终态（Z84 宽限后被 VOID 的迟归 job），
   *  调用方据此早退不再 submit（迟归 job 白烧一次外呼的根修）。
   *  T9：execSeq 必带——旧代重锚 0 命中（count===0=行终态**或已换代**，调用方一律早退）。 */
  async reanchorDeadline(id: string, kind: string, execSeq: bigint): Promise<number> {
    const now = new Date();
    const r = await this.prisma.generationIntent.updateMany({
      where: { id, status: { in: [...ACTIVE] }, execSeq },
      data: { startedAt: now, deadlineAt: new Date(now.getTime() + deadlineMsForKind(kind)), heartbeatAt: now },
    });
    return r.count;
  }

  /** complete 幂等迁移——返回受影响行数（F13 产物门序）：count===1 调用方才写 doc/exec；
   *  count===0 = 行已被 reconcile VOIDED+退款——调用方跳过产物写入（"看到产物 ⇒ 意图仍有效"）。
   *  Y0b-2 T4：终态补 heartbeatAt=终态时刻（判读辅助——终态行不进 reaper 批，纯审计戳）。
   *  T9：execSeq 必带（旧代 complete 0 命中——接管后旧 worker 产物不投递，交付归新代）；
   *  completeInTx=T10 finalize 事务内消费形态（lockBalance→…→completeInTx 同事务）。 */
  async complete(id: string, resultRef: string, execSeq: bigint): Promise<number> {
    return this.completeInTx(this.prisma, id, resultRef, execSeq);
  }

  async completeInTx(tx: Prisma.TransactionClient, id: string, resultRef: string, execSeq: bigint): Promise<number> {
    const r = await tx.generationIntent.updateMany({
      where: { id, status: { in: [...ACTIVE] }, execSeq },
      data: { status: 'SUCCEEDED', resultRef, completedAt: new Date(), heartbeatAt: new Date() },
    });
    return r.count;
  }

  /** fail 同构幂等迁移：where ACTIVE 守卫——终态行再 fail 零匹配零变更；error 截断 500 防长栈撑库。
   *  Y0b-1（Z27）：可选 jobId 限定——worker failed 钩子迟到+同节点已 rearm 换新 job 的极限窗口下，
   *  迟到钩子只 fail 本 job 自己的在飞意图（新活意图归属不同 job，零误杀）。
   *  T9：可选 execSeq 限定——worker 携行代际（claimed/ticket）时必传：旧代 fail 0 命中
   *  （接管后旧 worker 的迟到失败不得杀新代行）；reconcile/admin 终态路径无活代际可传省略。 */
  async fail(id: string, error: string, jobId?: string, execSeq?: bigint): Promise<void> {
    await this.prisma.generationIntent.updateMany({
      where: { id, status: { in: [...ACTIVE] }, ...(jobId ? { jobId } : {}), ...(execSeq !== undefined ? { execSeq } : {}) },
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

  /** Y1c T23（text 链 UNKNOWN 纪律——spec §6.3 偏离 36-④）：外呼结果不明（超时/5xx TEXT_PROVIDER_UNKNOWN）
   *  → RUNNING→UNKNOWN 停驻（execSeq CAS——旧代不明结果不得污染新代行）。资金纪律：**reserve 保留**
   *  （不 void_/不 fail——确认成功才 settle、取消/重试才 void：rearm 走 claim 守卫式再激活释放旧冻结）。
   *  UNKNOWN 不入 ACTIVE ⇒ reaper/reconcile RUNNING-only 扫描不自动收敛（人工对账面——text_unknown_total
   *  计数+runbook）；用户可见文案「可能重复生成、不会重复扣费」由调用方投影。 */
  async markUnknown(id: string, error: string, execSeq: bigint): Promise<number> {
    const r = await this.prisma.generationIntent.updateMany({
      where: { id, status: 'RUNNING', execSeq },
      data: { status: 'UNKNOWN', error: error.slice(0, 500) },
    });
    return r.count;
  }

  /** 批0.5-9 void：reserve 失败（零扣费）终态——与 FAILED 分义不混：FAILED=冻结已退（void_ 解冻后）
   *  外呼失败的终态；VOIDED=从未扣费，rearm 重试照常 reserve。where ACTIVE 守卫同款幂等。
   *  T9：可选 execSeq 限定——worker 路径必传（旧代 VOIDED 0 命中——行已换代归新代全权）。 */
  async void_(id: string, error: string, execSeq?: bigint): Promise<void> {
    await this.prisma.generationIntent.updateMany({
      where: { id, status: { in: [...ACTIVE] }, ...(execSeq !== undefined ? { execSeq } : {}) },
      data: { status: 'VOIDED', error: error.slice(0, 500), completedAt: new Date(), heartbeatAt: new Date() }, // Y0b-2 T4：终态时刻审计戳
    });
  }

  /** T9 write-ahead（spec ㉓）：providerRequestId submit 前落库（Idempotency-Key——消灭 submit→DB
   *  崩溃窗：重跑按幂等键查询 provider 零重复外呼）。已有值幂等返回同值（rearm/takeover 段复用同一锚
   * ——execSeq CAS 只为本代行铸造；非本代行（换代竞态）回读现值交调用方 fence）。 */
  async ensureProviderRequestId(id: string, execSeq: bigint): Promise<string> {
    const row = await this.prisma.generationIntent.findUnique({ where: { id }, select: { providerRequestId: true } });
    if (row?.providerRequestId) return row.providerRequestId;
    const rid = randomUUID();
    const r = await this.prisma.generationIntent.updateMany({
      where: { id, providerRequestId: null, execSeq },
      data: { providerRequestId: rid },
    });
    if (r.count === 1) return rid;
    // 并发败者/换代行——回读现值（幂等语义优先，非本代值由 onTick/reanchor fence 拦截外呼）
    const again = await this.prisma.generationIntent.findUniqueOrThrow({ where: { id }, select: { providerRequestId: true } });
    return again.providerRequestId ?? rid;
  }

  /** T9：providerTaskId submit 后落库（query-first 锚——重跑键序 requestId→taskId 的 taskId 腿：
   *  命中即按任务直查零重复 submit）。execSeq CAS——旧代 worker 不得覆写新代行锚。 */
  async recordProviderTaskId(id: string, execSeq: bigint, taskId: string): Promise<void> {
    await this.prisma.generationIntent.updateMany({
      where: { id, execSeq },
      data: { providerTaskId: taskId },
    });
  }

  /** 扩面模块 controller claim→queue.add 后回写 jobId（F13 补强）：不回写则 reconcile A 路径
   *  （查 BullMQ 真实状态）对 ai-image-edit/lighting 永久失效，且与同步路径（合法无 jobId）
   *  不可区分——长任务会被三查②按"同步路径崩溃"误判 VOIDED。
   *  T9 收尾：status RUNNING 守卫（updateMany）——claim 与 enqueue 间行被并发收敛终态时回写
   *  零命中（改前全仓唯一裸 update——终态行覆写 jobId 污染 reconcile 三查判据）。 */
  async attachJob(id: string, jobId: string): Promise<void> {
    await this.prisma.generationIntent.updateMany({ where: { id, status: 'RUNNING' }, data: { jobId } });
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
