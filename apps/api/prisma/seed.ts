import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { auth } from '../src/auth/auth';
import { CreditLedgerService } from '../src/modules/team/credit-ledger.service';
import { seedPlatformTeam } from '../src/prisma/platform-team.seed';

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as any);

async function main() {
  // Seed announcement
  await prisma.announcement.upsert({
    where: { id: 'seed-announce-1' },
    update: {},
    create: {
      id: 'seed-announce-1',
      message: '🎉 新用户注册即送100积分，限时优惠中！',
      linkUrl: null,
      active: true,
    },
  });

  // ====== Phase 3: Model Configuration Seed ======

  // Create node types
  const textNode = await prisma.nodeType.upsert({
    where: { key: 'text' },
    update: {},
    create: { name: '文本生成', key: 'text', description: '文本Prompt输入与优化' },
  });

  const imageNode = await prisma.nodeType.upsert({
    where: { key: 'image' },
    update: {},
    create: { name: '图片生成', key: 'image', description: '文生图、图生图' },
  });

  const imageExtNode = await prisma.nodeType.upsert({
    where: { key: 'imageExt' },
    update: {},
    create: { name: '图片扩展', key: 'imageExt', description: '图片扩展节点' },
  });

  const videoNode = await prisma.nodeType.upsert({
    where: { key: 'video' },
    update: {},
    create: { name: '视频生成', key: 'video', description: '文生视频、图生视频' },
  });

  // Create image models
  const sdXL = await prisma.aIModel.upsert({
    where: { id: 'seed-model-sdxl' },
    update: {},
    create: { id: 'seed-model-sdxl', nodeTypeId: imageNode.id, name: 'Stable Diffusion XL', provider: 'Stability AI', apiUrl: 'https://api.stability.ai/v1/generation', sortOrder: 1, recommended: true },
  });

  const dalle = await prisma.aIModel.upsert({
    where: { id: 'seed-model-dalle' },
    update: {},
    create: { id: 'seed-model-dalle', nodeTypeId: imageNode.id, name: 'DALL-E 3', provider: 'OpenAI', apiUrl: 'https://api.openai.com/v1/images/generations', sortOrder: 2 },
  });

  const hyImage = await prisma.aIModel.upsert({
    where: { id: 'seed-model-hy-image' },
    update: { apiKey: process.env.HY_IMAGE_API_KEY }, // Y0b-1：迁移先建行（apiKey NULL），seed 补写 env 密钥——否则 upsert 空更新致 apiKey 永缺失
    create: { id: 'seed-model-hy-image', nodeTypeId: imageNode.id, name: 'HY-Image-V3.0', provider: '腾讯混元', apiUrl: 'https://tokenhub.tencentmaas.com/v1/api/image', apiKey: process.env.HY_IMAGE_API_KEY, sortOrder: 0, recommended: true },
  });

  // Image resolutions
  const res1024 = await prisma.modelResolution.upsert({ where: { id: 'seed-res-sdxl-1024' }, update: {}, create: { id: 'seed-res-sdxl-1024', modelId: sdXL.id, label: '1024×1024', width: 1024, height: 1024 } });
  const res2048 = await prisma.modelResolution.upsert({ where: { id: 'seed-res-sdxl-2048' }, update: {}, create: { id: 'seed-res-sdxl-2048', modelId: sdXL.id, label: '2048×2048', width: 2048, height: 2048 } });
  await prisma.modelResolution.upsert({ where: { id: 'seed-res-dalle-1024' }, update: {}, create: { id: 'seed-res-dalle-1024', modelId: dalle.id, label: '1024×1024', width: 1024, height: 1024 } });
  await prisma.modelResolution.upsert({ where: { id: 'seed-res-dalle-512' }, update: {}, create: { id: 'seed-res-dalle-512', modelId: dalle.id, label: '512×512', width: 512, height: 512 } });

  // HY-Image resolutions
  const hyRes1024 = await prisma.modelResolution.upsert({ where: { id: 'seed-res-hy-1024' }, update: {}, create: { id: 'seed-res-hy-1024', modelId: hyImage.id, label: '1024×1024', width: 1024, height: 1024 } });
  const hyRes2048 = await prisma.modelResolution.upsert({ where: { id: 'seed-res-hy-2048' }, update: {}, create: { id: 'seed-res-hy-2048', modelId: hyImage.id, label: '2048×2048', width: 2048, height: 2048 } });
  const hyRes512  = await prisma.modelResolution.upsert({ where: { id: 'seed-res-hy-512'  }, update: {}, create: { id: 'seed-res-hy-512',  modelId: hyImage.id, label: '512×512',   width: 512,  height: 512 } });

  // ===== 定价真源=迁移（20261009040355_y0b1_funds_columns）——以下 image/text/video 定价段幂等共存：
  // 迁移以固定 id+自然键先行建行，本段 findFirst(自然键)→update 同值命中迁移行，不产生双行。 =====
  // Image pricing rules
  const imageRules = [
    { nodeTypeId: imageNode.id, modelId: sdXL.id, resolutionId: res1024.id, creditCost: 3 },
    { nodeTypeId: imageNode.id, modelId: sdXL.id, resolutionId: res2048.id, creditCost: 6 },
    { nodeTypeId: imageNode.id, modelId: dalle.id, resolutionId: 'seed-res-dalle-1024', creditCost: 5 },
    { nodeTypeId: imageNode.id, modelId: dalle.id, resolutionId: 'seed-res-dalle-512', creditCost: 2 },
    { nodeTypeId: imageNode.id, modelId: hyImage.id, resolutionId: hyRes512.id,  creditCost: 3 },
    { nodeTypeId: imageNode.id, modelId: hyImage.id, resolutionId: hyRes1024.id, creditCost: 5 },
    { nodeTypeId: imageNode.id, modelId: hyImage.id, resolutionId: hyRes2048.id, creditCost: 10 },
  ];

  for (const rule of imageRules) {
    const existing = await prisma.pricingRule.findFirst({
      where: { nodeTypeId: rule.nodeTypeId, modelId: rule.modelId, resolutionId: rule.resolutionId, durationId: null },
    });
    if (existing) {
      await prisma.pricingRule.update({ where: { id: existing.id }, data: { creditCost: rule.creditCost } });
    } else {
      await prisma.pricingRule.create({ data: rule as any });
    }
  }

  // Text models
  const gpt4 = await prisma.aIModel.upsert({
    where: { id: 'seed-model-gpt4' },
    update: {},
    create: { id: 'seed-model-gpt4', nodeTypeId: textNode.id, name: 'GPT-4o', provider: 'OpenAI', apiUrl: 'https://api.openai.com/v1/chat/completions', sortOrder: 1, recommended: true },
  });

  const kimi = await prisma.aIModel.upsert({
    where: { id: 'seed-model-kimi' },
    update: {},
    create: { id: 'seed-model-kimi', nodeTypeId: textNode.id, name: 'Kimi K2.6', provider: 'Moonshot AI', apiUrl: 'https://api.moonshot.cn/v1', sortOrder: 2, recommended: true },
  });

  const textExisting = await prisma.pricingRule.findFirst({
    where: { nodeTypeId: textNode.id, modelId: gpt4.id, resolutionId: null, durationId: null },
  });
  if (textExisting) {
    await prisma.pricingRule.update({ where: { id: textExisting.id }, data: { creditCost: 2 } });
  } else {
    await prisma.pricingRule.create({ data: { nodeTypeId: textNode.id, modelId: gpt4.id, creditCost: 2 } as any });
  }

  const kimiExisting = await prisma.pricingRule.findFirst({
    where: { nodeTypeId: textNode.id, modelId: kimi.id, resolutionId: null, durationId: null },
  });
  if (kimiExisting) {
    await prisma.pricingRule.update({ where: { id: kimiExisting.id }, data: { creditCost: 2 } });
  } else {
    await prisma.pricingRule.create({ data: { nodeTypeId: textNode.id, modelId: kimi.id, creditCost: 2 } as any });
  }

  // HY-Video model
  const hyVideo = await prisma.aIModel.upsert({
    where: { id: 'seed-model-hy-video' },
    update: {},
    create: {
      id: 'seed-model-hy-video', nodeTypeId: videoNode.id,
      name: 'HY-Video 1.5', provider: 'Tencent Maas',
      apiUrl: 'https://tokenhub.tencentmaas.com/v1/api/video',
      sortOrder: 1, recommended: true,
    },
  });

  const dur5 = await prisma.modelDuration.upsert({
    where: { id: 'seed-dur-5' },
    update: {},
    create: { id: 'seed-dur-5', modelId: hyVideo.id, label: '5秒', seconds: 5 },
  });
  const dur10 = await prisma.modelDuration.upsert({
    where: { id: 'seed-dur-10' },
    update: {},
    create: { id: 'seed-dur-10', modelId: hyVideo.id, label: '10秒', seconds: 10 },
  });
  const dur15 = await prisma.modelDuration.upsert({
    where: { id: 'seed-dur-15' },
    update: {},
    create: { id: 'seed-dur-15', modelId: hyVideo.id, label: '15秒', seconds: 15 },
  });

  const videoPricingRules = [
    { nodeTypeId: videoNode.id, modelId: hyVideo.id, durationId: dur5.id, creditCost: 10 },
    { nodeTypeId: videoNode.id, modelId: hyVideo.id, durationId: dur10.id, creditCost: 18 },
    { nodeTypeId: videoNode.id, modelId: hyVideo.id, durationId: dur15.id, creditCost: 25 },
  ];

  for (const rule of videoPricingRules) {
    const existing = await prisma.pricingRule.findFirst({
      where: { nodeTypeId: rule.nodeTypeId, modelId: rule.modelId, durationId: rule.durationId, resolutionId: null },
    });
    if (existing) {
      await prisma.pricingRule.update({ where: { id: existing.id }, data: { creditCost: rule.creditCost } });
    } else {
      await prisma.pricingRule.create({ data: rule as any });
    }
  }

  // ====== Phase 4: Default User + 默认团队账本（UserBalance 已删，账本唯一 TeamBalance）======
  await prisma.user.upsert({
    where: { id: 'default-user' },
    update: {},
    create: { id: 'default-user', name: 'Default User', email: 'default@flowweb.local', emailVerified: true },
  });

  const defaultTeam = await prisma.team.upsert({
    where: { id: 'default-team' },
    update: {},
    create: { id: 'default-team', name: 'Default User的团队', ownerId: 'default-user', status: 'ACTIVE', isDefault: true },
  });
  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: 'default-team', userId: 'default-user' } },
    update: { role: 'OWNER' },
    create: { teamId: 'default-team', userId: 'default-user', role: 'OWNER' },
  });
  // Y0b-1（三轮 M4/G2 自破前提修复）：注册赠送经台账（ensureBalance+mutate register_grant）——
  // 裸 teamBalance.create credits:100 无流水=不变量①巡检首日起永久 WARN（训练样本）；
  // 幂等：register:default-team 流水已存在则跳过（防 seed 重跑重复入账）
  const granted = await prisma.teamCreditTransaction.count({
    where: { teamId: defaultTeam.id, type: 'register_grant', referenceId: 'register:default-team' },
  });
  if (granted === 0) {
    await ledger.runInTx(async (tx) => {
      await ledger.ensureBalance(tx, defaultTeam.id);
      await ledger.mutate(tx, {
        teamId: defaultTeam.id, operatorUserId: 'default-user', type: 'register_grant',
        creditType: 'regular', balanceDelta: 100, frozenDelta: 0, referenceId: 'register:default-team',
      });
    });
  }

  // Seed subscription banner singleton
  await prisma.subscriptionBanner.upsert({
    where: { id: 'subscription-banner-singleton' },
    create: { id: 'subscription-banner-singleton', title: '', subtitle: '', isActive: false },
    update: {},
  });

  // Seed team plans (monthly)
  const GIB = 1024 ** 3;
  const teamPlans = [
    { key: 'team-basic', name: '团队基础版', monthlyCredits: 1000, storageLimitBytes: BigInt(20 * GIB), seatLimit: 30, priceMonthly: 9900, sort: 1 },
    { key: 'team-pro', name: '团队专业版', monthlyCredits: 3000, storageLimitBytes: BigInt(50 * GIB), seatLimit: 50, priceMonthly: 19900, sort: 2 },
  ];
  for (const p of teamPlans) {
    const existing = await prisma.teamPlan.findFirst({ where: { name: p.name } });
    if (!existing) {
      await prisma.teamPlan.create({ data: { name: p.name, monthlyCredits: p.monthlyCredits, storageLimitBytes: p.storageLimitBytes, seatLimit: p.seatLimit, priceMonthly: p.priceMonthly, sort: p.sort } });
    }
  }

  // 管理员账号：不存在则经 BetterAuth signUpEmail（正确哈希），存在则确保 ADMIN
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@flowweb.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin12345'; // better-auth minPasswordLength=8
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await auth.api.signUpEmail({ body: { email: adminEmail, password: adminPassword, name: 'Admin' } });
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'ADMIN' } });
    console.log(`Admin created: ${adminEmail}`);
  } else if (existingAdmin.role !== 'ADMIN') {
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'ADMIN' } });
    console.log(`Admin promoted: ${adminEmail}`);
  }

  // ===== 平台资产团队（spec 2026-09-18-video-work-admin-upload §4.1，B 形态：专用系统用户） =====
  // 第九轮抽取：实 体 迁 platform-team.seed.ts（seed 与 platform-team.seed.spec 共用——spec 自带前置）；
  // admin 缺失语义变化：原 if(platformAdmin) 静默跳过 → 抽函数后 fail-fast 抛（本调用点 admin 必在前段建成，不可达分支）。
  await seedPlatformTeam(prisma, ledger, adminEmail);

  // ====== 风格库初始分类（spec §5，固定 id 幂等 upsert） ======
  const STYLE_CATEGORIES: Array<{ id: string; name: string; sortOrder: number }> = [
    { id: 'seed-style-cat-1', name: '摄影写真', sortOrder: 1 },
    { id: 'seed-style-cat-2', name: '电商营销', sortOrder: 2 },
    { id: 'seed-style-cat-3', name: '动漫游戏', sortOrder: 3 },
    { id: 'seed-style-cat-4', name: '风格插画', sortOrder: 4 },
    { id: 'seed-style-cat-5', name: '平面设计', sortOrder: 5 },
    { id: 'seed-style-cat-6', name: '建筑及室内设计', sortOrder: 6 },
    { id: 'seed-style-cat-7', name: '创意玩法', sortOrder: 7 },
    { id: 'seed-style-cat-8', name: '文创周边', sortOrder: 8 },
    { id: 'seed-style-cat-9', name: '小说推文', sortOrder: 9 },
  ];
  for (const c of STYLE_CATEGORIES) {
    await prisma.styleCategory.upsert({ where: { id: c.id }, update: {}, create: c });
  }

  console.log('Seed complete: Phase 3 models + Phase 4 user balance + Phase 5 video models');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0); // auth.ts 顶层 ioredis 连接会让进程挂起，必须显式退出
  });
