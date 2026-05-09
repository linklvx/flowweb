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

  console.log('Seed complete: 1 announcement, 8 content cards');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
