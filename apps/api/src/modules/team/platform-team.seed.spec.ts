import { PrismaClient } from '@prisma/client';
import { TeamSubscriptionService } from './team-subscription.service';
import { describe, it, expect, afterAll } from 'vitest';

// 连真库（apps/api/src/auth/auth.role.spec.ts:5 先例：new PrismaClient() 直连）——前提：本地已跑 `prisma db seed`。未 seed 的环境此 spec 红（与先例相同前提）。
// 钉死原因：订阅缺失/过期/非 active 时 getLimits 静默回落 6GiB 不报错——失效极难排查，必须自动化而非手工步骤。
const prisma = new PrismaClient();

afterAll(async () => { await prisma.$disconnect(); });

describe('平台团队 seed 完整性', () => {
  it("getLimits('platform-team').storageLimitBytes === 1TB（getLimits 出口已 Number(BigInt)，number 比较）", async () => {
    const svc = new TeamSubscriptionService(prisma as any, {} as any); // getLimits 只用 prisma，audit 依赖不触及
    expect((await svc.getLimits('platform-team')).storageLimitBytes).toBe(1024 ** 4);
  });

  it('platform-storage 套餐 isActive=false（防泄漏到用户端可购买列表）且管理员是 platform-team 成员', async () => {
    const plan = await prisma.teamPlan.findUnique({ where: { id: 'platform-storage' } });
    expect(plan?.isActive).toBe(false);
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@flowweb.local';
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    expect(admin).toBeTruthy();
    const member = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: 'platform-team', userId: admin!.id } } });
    expect(member?.role).toBe('OWNER');
  });
});
