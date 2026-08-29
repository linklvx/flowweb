import { BadRequestException } from '@nestjs/common'

// 窗口期最小修复（Task 3 必填化 → Task 5 B2 项目/媒体团队化正式链路）：
// 按属主查默认团队 id；Task 4 的 ensureDefaultTeam 落地后由调用点逐步替换

export async function getOwnerTeamId(
  db: { team: { findFirst: Function }; teamMember: { findFirst: Function } },
  userId?: string | null,
): Promise<string> {
  if (!userId) throw new BadRequestException('用户未登录')
  const team = await db.team.findFirst({ where: { ownerId: userId }, select: { id: true } })
  if (team) return team.id
  // 属主团队 > 最早成员团队（转让后降级用户）——解析链与 ensureDefaultTeam 一致
  const membership = await db.teamMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
    select: { teamId: true },
  })
  if (membership) return membership.teamId
  throw new BadRequestException('用户暂无团队')
}
