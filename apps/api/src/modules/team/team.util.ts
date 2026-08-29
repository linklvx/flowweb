import { BadRequestException, ForbiddenException } from '@nestjs/common'

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

// 外部传入 teamId 的入口用：非成员一律 403（不区分团队是否存在，不暴露存在性）。
// 嵌套 team.status='ACTIVE' 过滤：TeamGuard 只拦 URL-:id 路由，body/query teamId 路径
// 经此函数自证成员资格，解散团队（DISBANDED）不得再收新资源。
export async function assertTeamMember(
  db: { teamMember: { findFirst: Function } },
  teamId: string,
  userId: string,
): Promise<void> {
  // 防 Prisma 静默省略 where 中的 undefined 字段（where.userId 缺失 → 匹配团队任意成员 → 鉴权穿透）
  if (!teamId || !userId) throw new ForbiddenException('非团队成员')
  const member = await db.teamMember.findFirst({
    where: { teamId, userId, team: { status: 'ACTIVE' } },
    select: { role: true },
  })
  if (!member) throw new ForbiddenException('非团队成员')
}
