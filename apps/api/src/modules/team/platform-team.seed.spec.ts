import { PrismaClient } from '@prisma/client';
import { TeamSubscriptionService } from './team-subscription.service';
import { CreditLedgerService } from './credit-ledger.service';
import { seedPlatformTeam } from '../../prisma/platform-team.seed';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// 连真库（apps/api/src/auth/auth.role.spec.ts:5 先例：new PrismaClient() 直连）。
// 第九轮"自带前置"：不再依赖环境已跑 `prisma db seed`——spec 内联执行 seedPlatformTeam
// （与 seed.ts 同一函数，等价前置），CI 无 seed 也能跑；幂等 upsert（固定 id），本地已 seed 环境无副作用。
// 钉死原因：订阅缺失/过期/非 active 时 getLimits 静默回落 6GiB 不报错——失效极难排查，必须自动化而非手工步骤。
const prisma = new PrismaClient();
const FIXTURE_ID = `int-pt-admin-${Date.now()}`;
const FIXTURE_ADMIN = `${FIXTURE_ID}@test.flowweb.local`;

beforeAll(async () => {
  // 前置自造：fixture admin（User.id 无 default 须显式；seedPlatformTeam 的 fail-fast 要求 admin 先在）
  await prisma.user.create({
    data: { id: FIXTURE_ID, name: 'int-pt-admin', email: FIXTURE_ADMIN, emailVerified: false },
  });
  await seedPlatformTeam(prisma, new CreditLedgerService(prisma as any), FIXTURE_ADMIN);
});

afterAll(async () => {
  // 只清 fixture 自有行；platform-* 固定 id 行与 seed 等价，保留（本地与 CI 皆幂等无害）
  await prisma.teamMember.deleteMany({ where: { userId: FIXTURE_ID } });
  await prisma.user.deleteMany({ where: { id: FIXTURE_ID } });
  await prisma.$disconnect();
});

describe('平台团队 seed 完整性', () => {
  it("getLimits('platform-team').storageLimitBytes === 1TB（getLimits 出口已 Number(BigInt)，number 比较）", async () => {
    const svc = new TeamSubscriptionService(prisma as any, {} as any, {} as any); // getLimits 只用 prisma，ledger/audit 依赖不触及
    expect((await svc.getLimits('platform-team')).storageLimitBytes).toBe(1024 ** 4);
  });

  it('platform-storage 套餐 isActive=false（防泄漏到用户端可购买列表）且管理员是 platform-team 成员', async () => {
    const plan = await prisma.teamPlan.findUnique({ where: { id: 'platform-storage' } });
    expect(plan?.isActive).toBe(false);
    const admin = await prisma.user.findUnique({ where: { email: FIXTURE_ADMIN } });
    expect(admin).toBeTruthy();
    const member = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: 'platform-team', userId: admin!.id } } });
    expect(member?.role).toBe('OWNER');
  });
});
