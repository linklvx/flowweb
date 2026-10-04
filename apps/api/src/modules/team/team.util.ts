import { BadRequestException, ForbiddenException } from '@nestjs/common'
import type { TeamStatus } from '@prisma/client'

// 只读解析个人团队 id（判据 ownerId+isDefault，与成员身份无关）；
// 补建路径走 ensureDefaultTeam/bootstrapPersonalTeam，本函数不建任何行。

export async function getOwnerTeamId(
  db: { team: { findFirst: (args: {
    where: { ownerId: string; isDefault: boolean };
    select: { id: true };
  }) => Promise<{ id: string } | null> } },
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
  db: { teamMember: { findFirst: (args: {
    where: { teamId: string; userId: string; team: { status: TeamStatus } };
    select: { role: true };
  }) => Promise<{ role: string } | null> } },
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

/** 双池可用积分口径（与 teamCredit 扣减核心一致——"禁拿单值猜池"）：credits + subscriptionCredits */
export function availableCredits(b: { credits: number; subscriptionCredits: number }): number {
  return b.credits + b.subscriptionCredits;
}

/** 平台资产归属（spec 2026-09-18-video-work-admin-upload §4.1）——api 侧共用（presignVideo/createWork F2/api spec）。
 *  seed 侧是独立字面量（seed.ts 不在 tsc 范围，不 import src——跨 rootDir 别扭）：
 *  **改 id 时必须连同 seed.ts（两个 id 共 6 次字面量）与 seed spec（2 次）全部同步**——
 *  F2 漏改 = 每次建作品 400"视频文件不存在"且无编译期提示（本设计唯一"改一处坏远处不报错"耦合）。 */
export const PLATFORM_TEAM_ID = 'platform-team';
export const PLATFORM_OWNER_ID = 'platform-owner';
