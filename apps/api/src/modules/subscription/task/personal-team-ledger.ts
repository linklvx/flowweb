import { Prisma } from '@prisma/client';

export type PersonalTeamClearType = 'expire_clear' | 'upgrade_clear' | 'admin_clear';

/**
 * 个人订阅 → 默认团队（ownerId+isDefault）账本统一写入模式。
 * 铁律：凡 subscriptionCredits 设值前旧池 before > 0，必先写清零流水再写发放流水
 * （余额每笔变动都有流水可审计，禁止无声覆盖）；周期覆盖不滚存（清旧池后直接设值）。
 */
async function findPersonalTeamOrThrow(tx: Prisma.TransactionClient, userId: string) {
  const team = await tx.team.findFirst({ where: { ownerId: userId, isDefault: true } });
  if (!team) throw new Error(`personal team missing for ${userId}`);
  return team;
}

/** 锁默认团队 TeamBalance 行 → 实时读 → 兜底补建（bootstrap 失败被吞掉的用户，防裸 update P2025） */
async function lockAndRead(tx: Prisma.TransactionClient, teamId: string) {
  await tx.$queryRaw`SELECT * FROM "TeamBalance" WHERE "teamId" = ${teamId} FOR UPDATE`;
  let bal = await tx.teamBalance.findUnique({ where: { teamId } });
  if (!bal) {
    bal = await tx.teamBalance.create({ data: { teamId, credits: 0 } });
  }
  return bal;
}

async function writeClearTransaction(
  tx: Prisma.TransactionClient,
  teamId: string,
  userId: string,
  clearType: PersonalTeamClearType,
  referenceId: string,
  before: number,
) {
  await tx.teamBalance.update({ where: { teamId }, data: { subscriptionCredits: 0 } });
  await tx.teamCreditTransaction.create({
    data: {
      teamId,
      operatorUserId: userId,
      amount: -before,
      type: clearType,
      creditType: 'subscription',
      referenceId,
      balanceAfter: 0,
    },
  });
}

/** 清零段 only（到期/作废场景）：无发放，无剩余则不写流水 */
export async function clearPersonalTeamSubscription(
  tx: Prisma.TransactionClient,
  userId: string,
  clearType: PersonalTeamClearType,
  referenceId: string,
): Promise<void> {
  const team = await findPersonalTeamOrThrow(tx, userId);
  const bal = await lockAndRead(tx, team.id);
  const before = bal.subscriptionCredits ?? 0;
  if (before > 0) {
    await writeClearTransaction(tx, team.id, userId, clearType, referenceId, before);
  }
}

/** 发放段：旧池有剩余必先清零+流水，再设值发放+流水（非 increment 推算） */
export async function grantToPersonalTeam(
  tx: Prisma.TransactionClient,
  userId: string,
  grantAmount: number,
  clearType: PersonalTeamClearType,
  referenceId: string,
): Promise<void> {
  const team = await findPersonalTeamOrThrow(tx, userId);
  const bal = await lockAndRead(tx, team.id);
  const before = bal.subscriptionCredits ?? 0;
  if (before > 0) {
    await writeClearTransaction(tx, team.id, userId, clearType, referenceId, before);
  }
  await tx.teamBalance.update({
    where: { teamId: team.id },
    data: { subscriptionCredits: grantAmount }, // 清零后直接设为目标值（非 increment 推算）
  });
  await tx.teamCreditTransaction.create({
    data: {
      teamId: team.id,
      operatorUserId: userId,
      amount: grantAmount,
      type: 'subscription_grant',
      creditType: 'subscription',
      referenceId,
      balanceAfter: grantAmount, // 锁内实时值
    },
  });
}
