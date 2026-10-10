// apps/api/src/modules/execution/provider-adapters.int.spec.ts —— Y0b-2 T2 断言三件之三（真库）
// ①executable 谓词：fixture 行自建带/不带 apiKey 两形态——CI 零密钥下 executable 不受影响（Z101）；
// ②ready 断言：fixture 行带 apiKey；③迁移真行：gpt4（active=false）executable=false——
// ④selectable 预检闭环：引用 gpt4 的节点 → validation MODEL_NOT_AVAILABLE（claim 前零冻结零意图行）。
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { executable, ready } from './provider-adapters';
import { ValidationService } from './validation.service';
import { PricingResolverService } from './pricing-resolver.service';

const hasDb = !!process.env.DATABASE_URL;
const prisma = new PrismaClient();
const createdIds: string[] = [];

async function modelFixture(over: Partial<{ provider: string; apiModelName: string; apiKey: string | null; active: boolean }>) {
  const nt = await prisma.nodeType.findUnique({ where: { key: 'text' } });
  if (!nt) throw new Error('int 库缺 node-type-text（迁移未跑？）');
  const id = `it-adapter-${Date.now()}-${createdIds.length + 1}`;
  await prisma.aIModel.create({
    data: {
      id, nodeTypeId: nt.id, name: 'it-adapter', provider: over.provider ?? 'moonshot',
      apiUrl: 'https://x.example', apiModelName: over.apiModelName ?? 'some-model',
      apiKey: over.apiKey ?? null, active: over.active ?? true,
    },
  });
  createdIds.push(id);
  return prisma.aIModel.findUniqueOrThrow({ where: { id } });
}

(hasDb ? describe : describe.skip)('Y0b-2 T2：executable/ready 谓词真库形态', () => {
  afterAll(async () => {
    await prisma.aIModel.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  });

  it('fixture 带 apiKey：executable 与 ready 双真（行级密钥在位=运维就绪）', async () => {
    const row = await modelFixture({ apiKey: 'sk-fixture' });
    expect(executable(row)).toBe(true);
    expect(ready(row)).toBe(true);
  });

  it('fixture 不带 apiKey：executable 仍真（CI 零密钥下可售——Z101 谓词无密钥维度）、ready 假', async () => {
    const row = await modelFixture({ apiKey: null });
    expect(executable(row)).toBe(true);
    expect(ready(row)).toBe(false);
  });

  it('fixture 无 adapter slug：executable 假（active∧无外呼实现=不可售）', async () => {
    const row = await modelFixture({ provider: 'stability' });
    expect(executable(row)).toBe(false);
    expect(ready(row)).toBe(false);
  });

  it('迁移真行：gpt4/sdxl/dalle 双钉行 executable=false；kimi/hy-image/hy-video executable=true', async () => {
    for (const id of ['seed-model-gpt4', 'seed-model-sdxl', 'seed-model-dalle']) {
      const row = await prisma.aIModel.findUnique({ where: { id } });
      expect(row, `${id} 迁移行缺`).toBeTruthy();
      expect(executable(row!), `${id} 应不可售`).toBe(false);
    }
    for (const id of ['seed-model-kimi', 'seed-model-hy-image', 'seed-model-hy-video']) {
      const row = await prisma.aIModel.findUnique({ where: { id } });
      expect(executable(row!), `${id} 应可售（零密钥不拦 executable）`).toBe(true);
    }
  });

  it('selectable 预检：引用停用模型（gpt4）→ MODEL_NOT_AVAILABLE，且不触达 resolver（claim 前零冻结零 attempts）', async () => {
    const resolver = new PricingResolverService(prisma as unknown as PrismaService);
    const svc = new ValidationService(prisma as unknown as PrismaService, resolver);
    const r = await svc.validateAll(
      [{ id: 'n-gpt4', type: 'textInput', data: { model: 'seed-model-gpt4', content: 'x' } }],
      'team-not-exist', 'user-x',
    );
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('MODEL_NOT_AVAILABLE');
    expect(r.errors[0]).toContain('n-gpt4');
    expect(r.plans).toHaveLength(0); // 该节点无 plan——execute 侧不会为其 claim/reserve
  });
});
