import { BadRequestException } from '@nestjs/common'

// 只读解析个人团队 id（判据 ownerId+isDefault，与成员身份无关）；
// 补建路径走 ensureDefaultTeam/bootstrapPersonalTeam，本函数不建任何行。

export async function getOwnerTeamId(
  db: { team: { findFirst: Function } },
  userId?: string | null,
): Promise<string> {
  if (!userId) throw new BadRequestException('用户未登录')
  const team = await db.team.findFirst({
    where: { ownerId: userId, isDefault: true },
    select: { id: true },
  })
  if (team) return team.id
  throw new BadRequestException('用户暂无个人团队')
}
