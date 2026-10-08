// apps/api/src/modules/team/credit-ledger.service.ts —— Y0b-1（§1.4bis/Z6/Z9/Z10/Z11/Z12）：台账唯一写入口
// 冻结契约 4：TeamCreditTransaction 全部写操作（create/update/upsert/delete 及 Many）仅允许出现在本服务；
// delta 单源=调用方声明+本服务按真值表语义拒绝不合法组合（Z11：并持锁读 intent 行复核）。
// 并发纪律=FOR UPDATE 单式（version=单调审计计数器）+ SET LOCAL lock_timeout（Z13：55P03/超时映射可重试）。
import { Inject, Injectable, HttpStatus } from '@nestjs/common';
import type { CreditType, Prisma, TeamCreditTransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';

/** Z12：品牌 tx——防根 PrismaClient 结构兼容直传（锁立刻释放、"同生共死"静默失效）。
 *  唯一获得途径=ledger.runInTx 回调或 ledger.tx() 显式转换（测试绕过须 as any 留痕）。
 *  declare const 品牌键形态（unique symbol 只能由 const 声明）。 */
declare const ledgerBrand: unique symbol;
export type LedgerTx = Prisma.TransactionClient & { readonly [ledgerBrand]: true };

export const INTENT_FUND_TYPES: readonly TeamCreditTransactionType[] = ['reserve', 'settle', 'release', 'refund'];

/** Z9：money_in 域（referenceId 必填+partial unique 承载幂等） */
export const MONEY_IN_TYPES: readonly TeamCreditTransactionType[] = ['recharge', 'subscription_grant', 'expire_clear', 'register_grant'];

export interface LedgerMutateInput {
  teamId: string;
  operatorUserId?: string | null;
  type: TeamCreditTransactionType;
  creditType: CreditType;
  /** 两列真值（§1.4bis 权威表）：reserve(−c,+c) / settle(0,−c) / release(+c,−c) / refund(+c,0) / 账户域(±X,0)。 */
  balanceDelta: number;
  frozenDelta: number;
  referenceId?: string | null;
  reversesId?: string | null;
}

class LedgerRuleError extends Error {
  constructor(readonly code: string, msg: string) { super(`[${code}] ${msg}`); }
}

@Injectable()
export class CreditLedgerService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 唯一事务入口——测试与简单调用方用；复合事务（reserve 等）自行 $transaction 后经 tx() 转换。 */
  async runInTx<T>(fn: (tx: LedgerTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (raw) => {
      await raw.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      return fn(raw as unknown as LedgerTx);
    }, { timeout: 15_000, maxWait: 5_000 });
  }

  tx(raw: Prisma.TransactionClient): LedgerTx { return raw as unknown as LedgerTx; }

  /** 锁序第一环（契约 20）。纯 SELECT FOR UPDATE——缺行=业务错误（解散物理删后行不存在）。
   *  严格性不回退，韧性经 ensureBalance 单点收口（三轮 Z23：现有 dev 库 2/7 团队无钱包行——懒创建承重）。
   *  TEAM_BALANCE_MISSING 转 BusinessException 409；TRUTH_TABLE/REVERSAL_* 保持 LedgerRuleError 500。 */
  async lockBalance(tx: LedgerTx, teamId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ teamId: string }[]>`SELECT "teamId" FROM "TeamBalance" WHERE "teamId" = ${teamId} FOR UPDATE`;
    if (rows.length !== 1) throw new BusinessException('TEAM_BALANCE_MISSING', `TeamBalance 行不存在 teamId=${teamId}（团队未建钱包或已解散）`, HttpStatus.CONFLICT);
  }

  /** 三轮 Z23：钱包唯一创建口（幂等）——register/建团队/四处懒创建收敛于此。
   *  Prisma @default(cuid()) 是客户端生成——raw INSERT 必须自带 id（gen_random_uuid()::text——canvas-doc-update.repository.ts:53 先例）。 */
  async ensureBalance(tx: LedgerTx, teamId: string): Promise<void> {
    await tx.$executeRaw`INSERT INTO "TeamBalance" ("id", "teamId", "credits", "subscriptionCredits", "version", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${teamId}, 0, 0, 0, now(), now()) ON CONFLICT ("teamId") DO NOTHING`;
  }

  /** 唯一写入口——锁 TeamBalance → 读旧态 → 校验 → 写池+流水。
   *  amount=派生显示字段（Z8：DB CHECK 强制同式）。Z11：intent 域持锁复核 intent 行存在+teamId 匹配。
   *  opts.skipIntentCheck=孤儿释放窄口（Z25）专用——只跳过"意图行在场"一条（T5 消费）。
   *  账户域零额 noop 实现化（不写行；rowId=null——空串会被当 reversesId 源消费）。 */
  async mutate(tx: LedgerTx, input: LedgerMutateInput, opts?: { skipIntentCheck?: boolean }): Promise<{ rowId: string | null; balanceAfter: number; noop?: boolean }> {
    if (MONEY_IN_TYPES.includes(input.type) && !input.referenceId) {
      throw new LedgerRuleError('LEDGER_DOMAIN', `money_in type=${input.type} referenceId 必填（Z9：事件 id）`);
    }
    await this.lockBalance(tx, input.teamId);
    if (!opts?.skipIntentCheck && (INTENT_FUND_TYPES as readonly string[]).includes(input.type)) {
      const intentRowId = input.referenceId?.startsWith('intent:') ? input.referenceId.slice(7) : null;
      if (!intentRowId) throw new LedgerRuleError('LEDGER_DOMAIN', `intent 域 type=${input.type} referenceId 必须 intent:<intentRowId>`);
      const intent = await tx.generationIntent.findUnique({ where: { id: intentRowId }, select: { teamId: true } });
      if (!intent || intent.teamId !== input.teamId) throw new LedgerRuleError('LEDGER_DOMAIN', `intent 行不存在或 teamId 不匹配（${intentRowId}）`);
    }
    const balance = await tx.teamBalance.findUniqueOrThrow({ where: { teamId: input.teamId } });
    this.assertTruthTable(input);
    if (input.reversesId) await this.assertReversal(tx, input);

    const pool = input.creditType === 'subscription' ? 'subscriptionCredits' : 'credits';
    if (input.balanceDelta === 0 && input.frozenDelta === 0) {
      return { rowId: null, balanceAfter: balance[pool], noop: true };
    }
    const next = balance[pool] + input.balanceDelta;
    if (next < 0) throw new BusinessException('CREDIT_LEDGER_NEGATIVE', `余额将变负 teamId=${input.teamId} pool=${pool}`, HttpStatus.BAD_REQUEST);
    await tx.teamBalance.update({
      where: { teamId: input.teamId },
      data: { [pool]: next, version: { increment: 1 } },
    });
    const row = await tx.teamCreditTransaction.create({
      data: {
        teamId: input.teamId,
        operatorUserId: input.operatorUserId ?? null,
        amount: input.balanceDelta !== 0 ? input.balanceDelta : input.frozenDelta,
        type: input.type,
        creditType: input.creditType,
        referenceId: input.referenceId ?? null,
        balanceAfter: next,
        balanceDelta: input.balanceDelta,
        frozenDelta: input.frozenDelta,
        reversesId: input.reversesId ?? null,
      },
    });
    return { rowId: row.id, balanceAfter: next };
  }

  /** 两列真值表逐型复核（编译期穷尽+运行时 default 拒绝）。账户域零额=合法 noop。 */
  private assertTruthTable(input: LedgerMutateInput): void {
    const isIntent = (INTENT_FUND_TYPES as readonly string[]).includes(input.type);
    if (!isIntent && input.frozenDelta !== 0) {
      throw new LedgerRuleError('LEDGER_DOMAIN', `账户域 type=${input.type} frozenDelta 必须 0`);
    }
    switch (input.type) {
      case 'reserve':
        if (input.balanceDelta >= 0 || input.frozenDelta !== -input.balanceDelta) throw new LedgerRuleError('TRUTH_TABLE', 'reserve 须 (−c,+c)');
        break;
      case 'settle':
        if (input.balanceDelta !== 0 || input.frozenDelta >= 0 || !input.reversesId) throw new LedgerRuleError('TRUTH_TABLE', 'settle 须 (0,−c) 且 reversesId 指向被核销 reserve 行');
        break;
      case 'release':
        if (!input.reversesId || input.balanceDelta <= 0 || input.frozenDelta !== -input.balanceDelta) throw new LedgerRuleError('TRUTH_TABLE', 'release 须 (+c,−c) 且 reversesId');
        break;
      case 'refund':
        if (!input.reversesId || input.balanceDelta <= 0 || input.frozenDelta !== 0) throw new LedgerRuleError('TRUTH_TABLE', 'refund 须 (+c,0) 且 reversesId 指向 settle 行');
        break;
      default:
        break;   // 账户域（±X,0）
    }
  }

  /** Z6 三配对+记账轴等额：settle↔reserve（比 frozenDelta 轴）/ release↔reserve（比 balanceDelta 轴）/ refund↔settle。 */
  private async assertReversal(tx: LedgerTx, input: LedgerMutateInput): Promise<void> {
    const reversed = await tx.teamCreditTransaction.findUnique({ where: { id: input.reversesId! } });
    if (!reversed) throw new LedgerRuleError('REVERSAL_TARGET', `reversesId=${input.reversesId} 行不存在`);
    const pair: Record<string, string> = { settle: 'reserve', release: 'reserve', refund: 'settle' };
    const expectType = pair[input.type as keyof typeof pair];
    if (!expectType || reversed.type !== expectType) throw new LedgerRuleError('REVERSAL_PAIR', `${input.type} 须冲销 ${expectType ?? '?'} 行（实测 ${reversed.type}）`);
    if (reversed.creditType !== input.creditType) throw new LedgerRuleError('REVERSAL_POOL', '冲销行必须同池');
    const axis = input.type === 'settle' ? Math.abs(input.frozenDelta) : Math.abs(input.balanceDelta);
    if (axis !== Math.abs(reversed.amount)) throw new LedgerRuleError('REVERSAL_AMOUNT', `冲销分量不等额（${axis} ≠ ${Math.abs(reversed.amount)}——记账轴：settle 比 frozenDelta、release/refund 比 balanceDelta）`);
  }
}
