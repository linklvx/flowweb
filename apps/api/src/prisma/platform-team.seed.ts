import type { PrismaClient } from '@prisma/client';

/** 平台资产团队域 seed（spec 2026-09-18-video-work-admin-upload §4.1，B 形态：专用系统用户）。
 *  seed.ts 与 platform-team.seed.spec 共用（第九轮"自带前置"：CI 无 prisma db seed 也能跑
 *  ——spec 内联执行本函数即等价前置）；幂等 upsert，固定 id。
 *  成品视频归属：配额代码零改动、两道闸照跑（1TB）；管理员个人配额零污染；Media.user 级联风险消失。
 *  update 分支显式写关键字段——空 update 命中同 id 不改值：isActive 被误点上架/isDefault 被改 true/
 *  订阅被改过期后，重跑即自愈（第一道防线）；"勿上架"命名是第二道（先例：非空 update seed.ts:169）。
 *  fail-fast：admin 缺失即抛（调用方负责 admin 存在——seed.ts 前段已建；spec 自造 fixture admin）。 */
export async function seedPlatformTeam(
  prisma: PrismaClient,
  adminEmail: string = process.env.ADMIN_EMAIL || 'admin@flowweb.local',
): Promise<void> {
  await prisma.user.upsert({
    where: { id: 'platform-owner' },
    update: {},
    create: { id: 'platform-owner', name: 'Platform Owner', email: 'platform-owner@flowweb.local', emailVerified: true },
  });
  await prisma.teamPlan.upsert({
    where: { id: 'platform-storage' },
    // isActive:false 承重：GET /api/team/plans 用户端 where isActive:true——true 会把 1TB/0 元档泄漏为可购买套餐
    //（getLimits 只读 storageLimitBytes 不读 isActive，false 零副作用；subscribe 也挡 !isActive）
    update: { isActive: false, storageLimitBytes: 1099511627776n },
    create: { id: 'platform-storage', name: '（内部）平台存储·勿上架', monthlyCredits: 0, storageLimitBytes: 1099511627776n, seatLimit: 1, priceMonthly: 0, isActive: false, sort: 99 },
  });
  await prisma.team.upsert({
    where: { id: 'platform-team' },
    update: { isDefault: false }, // 承重：true 会使 getLimits 走"默认团队回退个人订阅"分支、1TB 被忽略
    create: { id: 'platform-team', name: '平台资产团队', ownerId: 'platform-owner', status: 'ACTIVE', isDefault: false },
  });
  // TeamMember 必须在管理员创建之后（admin id 由 BetterAuth 生成，按 email 查回——ADMIN_EMAIL 可被环境变量覆盖）
  const platformAdmin = await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } });
  if (!platformAdmin) {
    throw new Error(`前置缺失：admin 用户 ${adminEmail} 不存在（seedPlatformTeam 需先建 admin——seed.ts 前段负责；spec 用 fixture admin）`);
  }
  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: 'platform-team', userId: platformAdmin.id } }, // 复合键先例 seed.ts:187-191
    update: { role: 'OWNER' },
    create: { teamId: 'platform-team', userId: platformAdmin.id, role: 'OWNER' },
  });
  await prisma.teamSubscription.upsert({
    // 无自然键——固定 id。必须 upsert：partial unique index team_subscription_one_active（migration 20260829201000:105）
    // 下裸 create 二次 seed 必冲突。改此固定 id 前先清旧 active 行，否则同撞该索引。
    // 例外（Task 6 审查）：若 platform-team 被误购真实套餐（回调会关旧行新建 active），重跑 seed 会撞该索引
    // fail-loud——索引防静默作废已购订阅是对的；先删误购 active 行再 seed 即自愈。
    where: { id: 'platform-subscription' },
    update: { status: 'active', currentPeriodEnd: new Date('2099-01-01') },
    create: { id: 'platform-subscription', teamId: 'platform-team', planId: 'platform-storage', status: 'active', paidAmount: 0, currentPeriodStart: new Date(), currentPeriodEnd: new Date('2099-01-01') },
  });
}
