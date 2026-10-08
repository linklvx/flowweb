import type { Prisma } from '@prisma/client';
import type { CreditLedgerService, LedgerTx } from '../../team/credit-ledger.service';

export type PersonalTeamClearType = 'expire_clear' | 'upgrade_clear' | 'admin_clear';

/**
 * 个人订阅 → 默认团队（ownerId+isDefault）账本统一写入模式。
 * 铁律：凡 subscriptionCredits 设值前旧池 before > 0，必先写清零流水再写发放流水
 * （余额每笔变动都有流水可审计，禁止无声覆盖）；周期覆盖不滚存（清旧池后直接设值）。
 * Y0b-1（Z9 前置③/Z12）：clear/grant 分键（:clear/:grant 后缀——money_in_once 幂等各自成键）；
 * 写路径全经 ledger.mutate（唯一写入口）；懒创建收敛 ensureBalance（三轮 Z23）。
 */
async function findPersonalTeamOrThrow(tx: Prisma.TransactionClient, userId: string) {
  const team = await tx.team.findFirst({ where: { ownerId: userId, isDefault: true } });
  if (!team) throw new Error(`personal team missing for ${userId}`);
  return team;
}

/** 锁默认团队 TeamBalance 行 → 实时读 → 兜底补建经 ensureBalance（bootstrap 失败被吞掉的用户，防裸 update P2025） */
async function lockAndRead(ledger: CreditLedgerService, tx: LedgerTx, teamId: string) {
  await ledger.ensureBalance(tx, teamId);
  await ledger.lockBalance(tx, teamId);
  return tx.teamBalance.findUniqueOrThrow({ where: { teamId } });
}

async function writeClearTransaction(
  ledger: CreditLedgerService,
  tx: LedgerTx,
  teamId: string,
  userId: string,
  clearType: PersonalTeamClearType,
  referenceId: string,
  before: number,
) {
  await ledger.mutate(tx, {
    teamId,
    operatorUserId: userId,
    type: clearType,
    creditType: 'subscription',
    balanceDelta: -before,
    frozenDelta: 0,
    referenceId: `${referenceId}:clear`,
  });
}

/** 清零段 only（到期/作废场景）：无发放，无剩余则不写流水 */
export async function clearPersonalTeamSubscription(
  ledger: CreditLedgerService,
  tx: Prisma.TransactionClient,
  userId: string,
  clearType: PersonalTeamClearType,
  referenceId: string,
): Promise<void> {
  const team = await findPersonalTeamOrThrow(tx, userId);
  const ltx = ledger.tx(tx);
  const bal = await lockAndRead(ledger, ltx, team.id);
  const before = bal.subscriptionCredits ?? 0;
  if (before > 0) {
    await writeClearTransaction(ledger, ltx, team.id, userId, clearType, referenceId, before);
  }
}

/** 发放段：旧池有剩余必先清零+流水，再发放+流水（清零后池恒 0——mutate 增量语义与原设值语义等价） */
export async function grantToPersonalTeam(
  ledger: CreditLedgerService,
  tx: Prisma.TransactionClient,
  userId: string,
  grantAmount: number,
  clearType: PersonalTeamClearType,
  referenceId: string,
): Promise<void> {
  const team = await findPersonalTeamOrThrow(tx, userId);
  const ltx = ledger.tx(tx);
  const bal = await lockAndRead(ledger, ltx, team.id);
  const before = bal.subscriptionCredits ?? 0;
  if (before > 0) {
    await writeClearTransaction(ledger, ltx, team.id, userId, clearType, referenceId, before);
  }
  await ledger.mutate(ltx, {
    teamId: team.id,
    operatorUserId: userId,
    type: 'subscription_grant',
    creditType: 'subscription',
    balanceDelta: grantAmount,
    frozenDelta: 0,
    referenceId: `${referenceId}:grant`,
  });
}
