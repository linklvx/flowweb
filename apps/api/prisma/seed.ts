import { PrismaClient } from '@prisma/client';

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

  // Seed content cards
  const cards = [
    { id: 'seed-card-1', title: '文生图工作流', coverUrl: '/card-covers/text-to-image.jpg', tags: ['推荐', '热门'], desc: '输入Prompt快速生成高质量图片', sortOrder: 1 },
    { id: 'seed-card-2', title: '文生视频工作流', coverUrl: '/card-covers/text-to-video.jpg', tags: ['新上线'], desc: '文本一键转视频', sortOrder: 2 },
    { id: 'seed-card-3', title: '图生图工作流', coverUrl: '/card-covers/image-to-image.jpg', tags: ['推荐'], desc: '风格迁移与图像变换', sortOrder: 3 },
    { id: 'seed-card-4', title: '智能文案助手', coverUrl: '/card-covers/copywriter.jpg', tags: [], desc: 'AI驱动的多平台文案创作', sortOrder: 4 },
    { id: 'seed-card-5', title: 'AI配音工作流', coverUrl: '/card-covers/tts.jpg', tags: ['即将上线'], desc: '文本转语音与多语种配音', sortOrder: 5 },
    { id: 'seed-card-6', title: '视频剪辑工作流', coverUrl: '/card-covers/video-edit.jpg', tags: [], desc: '智能视频裁剪与特效添加', sortOrder: 6 },
    { id: 'seed-card-7', title: '音乐生成工作流', coverUrl: '/card-covers/music.jpg', tags: ['Beta'], desc: 'AI自动作曲与编曲', sortOrder: 7 },
    { id: 'seed-card-8', title: '3D模型生成', coverUrl: '/card-covers/3d.jpg', tags: ['即将上线'], desc: '文字描述生成3D模型', sortOrder: 8 },
  ];

  for (const card of cards) {
    await prisma.contentCard.upsert({
      where: { id: card.id },
      update: {},
      create: card,
    });
  }

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
    create: { id: 'seed-model-hy-image', nodeTypeId: imageNode.id, name: 'HY-Image-V3.0', provider: '腾讯混元', apiUrl: 'https://tokenhub.tencentmaas.com/v1/api/image', apiKey: 'sk-3spY8oRUCrMphKWPwS8I8jKxTGH9LyCaDrxfhucZFpi02y2C', sortOrder: 0, recommended: true },
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

  // ====== Phase 4: Default User Balance ======
  await prisma.userBalance.upsert({
    where: { userId: 'default-user' },
    update: {},
    create: { userId: 'default-user', credits: 100, version: 0 },
  });

  console.log('Seed complete: Phase 1 cards + Phase 3 models + Phase 4 user balance + Phase 5 video models');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
