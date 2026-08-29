import { DEFAULT_FOLDER_NAMES } from '../material-library/constants/material-library.constants';

type Db = {
  team: { findFirst: Function };
  $transaction: Function;
};

/**
 * 统一个人团队（默认团队）Bootstrap——邮箱/手机/微信注册与 ensureDefaultTeam 的唯一入口。
 * 判据固定 ownerId+isDefault（与用户是否加入其他团队无关）；
 * 并发创建由 team_owner_default_unique 兜底，冲突时重查返回既有行。
 */
export async function bootstrapPersonalTeam(db: Db, userId: string, userName: string) {
  const existing = await db.team.findFirst({ where: { ownerId: userId, isDefault: true } });
  if (existing) return existing;

  const name = userName?.trim() || '用户';
  try {
    return await db.$transaction(async (tx: any) => {
      const team = await tx.team.create({
        data: { name: `${name}的团队`, ownerId: userId, status: 'ACTIVE', isDefault: true },
      });
      await tx.teamMember.create({ data: { teamId: team.id, userId, role: 'OWNER' } });
      await tx.teamBalance.create({ data: { teamId: team.id, credits: 100 } });
      await tx.teamCreditTransaction.create({
        data: {
          teamId: team.id, operatorUserId: userId, amount: 100,
          type: 'register_grant', creditType: 'regular', balanceAfter: 100,
        },
      });
      await tx.materialFolder.createMany({
        data: DEFAULT_FOLDER_NAMES.map((folderName, i) => ({
          name: folderName, teamId: team.id, userId, isDefault: true, sortOrder: i,
        })),
      });
      return team;
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      const existingAfterConflict = await db.team.findFirst({ where: { ownerId: userId, isDefault: true } });
      if (existingAfterConflict) return existingAfterConflict;
    }
    throw err;
  }
}
