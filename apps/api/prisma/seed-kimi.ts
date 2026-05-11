import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find node types
  const textNode = await prisma.nodeType.findUnique({ where: { key: 'text' } });
  const imageNode = await prisma.nodeType.findUnique({ where: { key: 'image' } });

  if (!textNode || !imageNode) {
    console.error('Node types not found — run seed.ts first');
    process.exit(1);
  }

  // Add Kimi K2.6
  await prisma.aIModel.upsert({
    where: { id: 'seed-model-kimi' },
    update: {},
    create: {
      id: 'seed-model-kimi',
      nodeTypeId: textNode.id,
      name: 'Kimi K2.6',
      provider: 'Moonshot AI',
      apiUrl: 'https://api.moonshot.cn/v1',
      sortOrder: 2,
      recommended: true,
    },
  });
  console.log('✓ Kimi K2.6 added');

  // Add HY-Image V3.0
  await prisma.aIModel.upsert({
    where: { id: 'seed-model-hy-image' },
    update: {},
    create: {
      id: 'seed-model-hy-image',
      nodeTypeId: imageNode.id,
      name: 'HY-Image V3.0',
      provider: 'Tencent Maas',
      apiUrl: 'https://tokenhub.tencentmaas.com/v1/api/image',
      sortOrder: 3,
    },
  });
  console.log('✓ HY-Image V3.0 added');

  // Pricing rules
  const kimiRule = await prisma.pricingRule.findFirst({
    where: { nodeTypeId: textNode.id, modelId: 'seed-model-kimi', resolutionId: null, durationId: null },
  });
  if (kimiRule) {
    await prisma.pricingRule.update({ where: { id: kimiRule.id }, data: { creditCost: 2 } });
  } else {
    await prisma.pricingRule.create({ data: { nodeTypeId: textNode.id, modelId: 'seed-model-kimi', creditCost: 2 } } as any);
  }
  console.log('✓ Kimi pricing: 2 credits');

  const hyRule = await prisma.pricingRule.findFirst({
    where: { nodeTypeId: imageNode.id, modelId: 'seed-model-hy-image', resolutionId: null, durationId: null },
  });
  if (hyRule) {
    await prisma.pricingRule.update({ where: { id: hyRule.id }, data: { creditCost: 5 } });
  } else {
    await prisma.pricingRule.create({ data: { nodeTypeId: imageNode.id, modelId: 'seed-model-hy-image', creditCost: 5 } } as any);
  }
  console.log('✓ HY-Image pricing: 5 credits');
  console.log('\nSeed complete!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
