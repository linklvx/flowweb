// apps/api/src/modules/execution/funds-four-way.int.spec.ts —— Y0b-1（G-1/Z18/Z20）：四处相等
// ①定价同源：validation.totalCost ≡ Σ resolver(node)（含 text 腿+video duration 维）
// ②扣费自洽：Σ settle 流水 ≡ Σ intent.creditCost（首跑限定——重放分支 if(!created) continue 不计费）
// 本 Task 只断言①的 text 腿；T4 补②；T7 混合组收口。
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ValidationService } from './validation.service';
import { PricingResolverService } from './pricing-resolver.service';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();

(hasDb ? describe : describe.skip)('Y0b-1 G-1（拆两条断言）', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('①定价同源：validation.totalCost 含 text 节点（红相=旧实现 continue 跳过恒少算——T2 已修，此处为守护）', async () => {
    const resolver = new PricingResolverService(prisma as unknown as PrismaService);
    const svc = new ValidationService(prisma as unknown as PrismaService, resolver);
    // 按库内真实规则行反推节点参数（规则形状固定断言会随 seed 漂移——text=null∧null / image 带分辨率行 id）
    const textRule = await prisma.pricingRule.findFirst({
      where: { active: true, nodeType: { key: 'text' }, modelId: { not: null }, creditCost: { gt: 0 } },
    });
    const imgRule = await prisma.pricingRule.findFirst({
      where: { active: true, nodeType: { key: 'image' }, modelId: { not: null }, resolutionId: { not: null }, creditCost: { gt: 0 } },
    });
    if (!textRule) return; // 覆盖度门禁另测——本用例只守护 text 腿入账
    const nodes = [
      { id: 'n-text', type: 'textInput', data: { model: textRule.modelId } },
      ...(imgRule ? [{ id: 'n-img', type: 'imageGen', data: { model: imgRule.modelId, resolution: imgRule.resolutionId } }] : []),
    ];
    const r = await svc.validateAll(nodes, 'team-x', 'user-x');
    // 'team-x' 无余额——唯一允许的 errors 是余额不足档（解析错误=键形状破坏，fail-loud）
    expect(r.errors.every((e: string) => e.startsWith('余额不足'))).toBe(true);
    expect(r.totalCost).toBeGreaterThan(0);
    expect(r.plans).toHaveLength(nodes.length); // 余额不足档 plans 照常累计（三轮 M2——构成可见性）
    const textPlan = r.plans.find((p) => p.nodeId === 'n-text');
    expect(textPlan?.creditCost).toBe(textRule.creditCost); // text 节点计入 totalCost 的直接证据
  });
});
