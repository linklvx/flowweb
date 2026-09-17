import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { auth } from '../src/auth/auth';

const prisma = new PrismaClient();

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
    update: {},
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
  await prisma.teamBalance.upsert({
    where: { teamId: defaultTeam.id },
    update: {},
    create: { teamId: defaultTeam.id, credits: 100 },
  });

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
  // 成品视频归属：配额代码零改动、两道闸照跑（1TB）；管理员个人配额零污染；Media.user 级联风险消失。
  // update 分支显式写关键字段——空 update 命中同 id 不改值：isActive 被误点上架/isDefault 被改 true/订阅被改
  // 过期后，重跑 seed 即自愈（第一道防线）；"勿上架"命名是第二道（先例：非空 update seed.ts:169）。
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
  if (platformAdmin) {
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: 'platform-team', userId: platformAdmin.id } }, // 复合键先例 seed.ts:187-191
      update: { role: 'OWNER' },
      create: { teamId: 'platform-team', userId: platformAdmin.id, role: 'OWNER' },
    });
  }
  await prisma.teamSubscription.upsert({
    // 无自然键——固定 id。必须 upsert：partial unique index team_subscription_one_active（migration 20260829201000:105）
    // 下裸 create 二次 seed 必冲突。改此固定 id 前先清旧 active 行，否则同撞该索引。
    // 例外（Task 6 审查）：若 platform-team 被误购真实套餐（回调会关旧行新建 active），重跑 seed 会撞该索引
    // fail-loud——索引防静默作废已购订阅是对的；先删误购 active 行再 seed 即自愈。
    where: { id: 'platform-subscription' },
    update: { status: 'active', currentPeriodEnd: new Date('2099-01-01') },
    create: { id: 'platform-subscription', teamId: 'platform-team', planId: 'platform-storage', status: 'active', paidAmount: 0, currentPeriodStart: new Date(), currentPeriodEnd: new Date('2099-01-01') },
  });

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
