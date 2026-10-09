import type { Team } from '@prisma/client';
import type { CreditLedgerService } from './credit-ledger.service';
import { DEFAULT_FOLDER_NAMES } from '../material-library/constants/material-library.constants';

type Db = {
  team: { findFirst: (args: { where: { ownerId: string; isDefault: boolean } }) => Promise<Team | null> };
  $transaction: (fn: (tx: any) => Promise<Team>) => Promise<Team>;
};

/**
 * 统一个人团队（默认团队）Bootstrap——邮箱/手机/微信注册与 ensureDefaultTeam 的唯一入口。
 * 判据固定 ownerId+isDefault（与用户是否加入其他团队无关）；
 * 并发创建由 team_owner_default_unique 兜底，冲突时重查返回既有行。
 * Y0b-1（三轮 Z23）：注册发放经 ensureBalance+lockBalance+mutate——钱包唯一创建口（鸡生蛋根修：
 * 先建钱包再入账）；referenceId=register:<teamId>（按团队一次——userId 是实体 id 违反"事件 id"
 * 契约+个人团队重建会撞全局唯一）。四轮 P1-5：P2002/23505=同团队既往已发放幂等成功（注册链路禁 500）。
 */
export async function bootstrapPersonalTeam(db: Db, ledger: CreditLedgerService, userId: string, userName: string) {
  const existing = await db.team.findFirst({ where: { ownerId: userId, isDefault: true } });
  if (existing) return existing;

  const name = userName?.trim() || '用户';
  try {
    return await db.$transaction(async (tx: any) => {
      const team = await tx.team.create({
        data: { name: `${name}的团队`, ownerId: userId, status: 'ACTIVE', isDefault: true },
      });
      await tx.teamMember.create({ data: { teamId: team.id, userId, role: 'OWNER' } });
      const ltx = await ledger.ledgerTx(tx);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
      await ledger.ensureBalance(ltx, team.id);
      await ledger.lockBalance(ltx, team.id);
      await ledger.mutate(ltx, {
        teamId: team.id, operatorUserId: userId, type: 'register_grant', creditType: 'regular',
        balanceDelta: 100, frozenDelta: 0, referenceId: `register:${team.id}`,
      });
      await tx.materialFolder.createMany({
        data: DEFAULT_FOLDER_NAMES.map((folderName, i) => ({
          name: folderName, teamId: team.id, userId, isDefault: true, sortOrder: i,
        })),
      });
      return team;
    });
  } catch (err: any) {
    if (err?.code === 'P2002' || err?.code === '23505') {
      const existingAfterConflict = await db.team.findFirst({ where: { ownerId: userId, isDefault: true } });
      if (existingAfterConflict) return existingAfterConflict;
    }
    throw err;
  }
}
