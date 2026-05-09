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

  // Image resolutions
  const res1024 = await prisma.modelResolution.upsert({ where: { id: 'seed-res-sdxl-1024' }, update: {}, create: { id: 'seed-res-sdxl-1024', modelId: sdXL.id, label: '1024×1024', width: 1024, height: 1024 } });
  const res2048 = await prisma.modelResolution.upsert({ where: { id: 'seed-res-sdxl-2048' }, update: {}, create: { id: 'seed-res-sdxl-2048', modelId: sdXL.id, label: '2048×2048', width: 2048, height: 2048 } });
  await prisma.modelResolution.upsert({ where: { id: 'seed-res-dalle-1024' }, update: {}, create: { id: 'seed-res-dalle-1024', modelId: dalle.id, label: '1024×1024', width: 1024, height: 1024 } });
  await prisma.modelResolution.upsert({ where: { id: 'seed-res-dalle-512' }, update: {}, create: { id: 'seed-res-dalle-512', modelId: dalle.id, label: '512×512', width: 512, height: 512 } });

  // Image pricing rules
  const imageRules = [
    { nodeTypeId: imageNode.id, modelId: sdXL.id, resolutionId: res1024.id, creditCost: 3 },
    { nodeTypeId: imageNode.id, modelId: sdXL.id, resolutionId: res2048.id, creditCost: 6 },
    { nodeTypeId: imageNode.id, modelId: dalle.id, resolutionId: 'seed-res-dalle-1024', creditCost: 5 },
    { nodeTypeId: imageNode.id, modelId: dalle.id, resolutionId: 'seed-res-dalle-512', creditCost: 2 },
  ];

  for (const rule of imageRules) {
    await prisma.pricingRule.upsert({
      where: {
        nodeTypeId_modelId_resolutionId_durationId: {
          nodeTypeId: rule.nodeTypeId,
          modelId: rule.modelId,
          resolutionId: rule.resolutionId,
          durationId: null,
        },
      },
      update: { creditCost: rule.creditCost },
      create: rule as any,
    });
  }

  // Text model
  const gpt4 = await prisma.aIModel.upsert({
    where: { id: 'seed-model-gpt4' },
    update: {},
    create: { id: 'seed-model-gpt4', nodeTypeId: textNode.id, name: 'GPT-4o', provider: 'OpenAI', apiUrl: 'https://api.openai.com/v1/chat/completions', sortOrder: 1, recommended: true },
  });

  await prisma.pricingRule.upsert({
    where: { nodeTypeId_modelId_resolutionId_durationId: { nodeTypeId: textNode.id, modelId: gpt4.id, resolutionId: null, durationId: null } },
    update: { creditCost: 2 },
    create: { nodeTypeId: textNode.id, modelId: gpt4.id, creditCost: 2 },
  });

  console.log('Seed complete: Phase 1 cards + Phase 3 model configuration');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
