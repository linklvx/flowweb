// apps/api/src/modules/execution/pricing-resolver.int.spec.ts —— Y0b-1（E48/E49/Z5/Z20/Z21）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PricingResolverService } from './pricing-resolver.service';

const prisma = new PrismaClient();
const svc = new PricingResolverService(prisma as any);

describe('Y0b-1 pricing-resolver 单源（fail-closed，精确匹配无阶梯）', () => {
  const S = { team: '', nt: '', model: '', kindKey: '' };
  beforeAll(async () => {
    const ts = Date.now();
    const user = await prisma.user.create({ data: { id: `it-res-u-${ts}`, name: 'it', email: `it-res-${ts}@x.invalid`, emailVerified: false } });
    S.team = `it-res-${ts}`;
    await prisma.team.create({ data: { id: S.team, name: 'it', ownerId: user.id } });
    S.nt = (await prisma.nodeType.create({ data: { id: `it-nt-${ts}`, name: 'it-image', key: `it-image-${ts}` } })).id;
    S.model = (await prisma.aIModel.create({ data: { id: `it-m-${ts}`, nodeTypeId: S.nt, name: 'it-m', provider: 'it', apiUrl: 'http://x', active: true } })).id;
    await prisma.pricingRule.create({ data: { id: `it-pr-${ts}`, nodeTypeId: S.nt, modelId: S.model, creditCost: 3, active: true } });
    S.kindKey = `it-kind-${ts}`;
    const kindNt = await prisma.nodeType.create({ data: { id: `it-nt-kind-${ts}`, name: 'it-kind', key: S.kindKey } });
    await prisma.pricingRule.create({ data: { id: `it-pr-kind-${ts}`, nodeTypeId: kindNt.id, modelId: null, creditCost: 1, active: true } });
  });
  afterAll(async () => {
    await prisma.pricingRule.deleteMany({ where: { id: { startsWith: 'it-pr-' } } });
    await prisma.aIModel.deleteMany({ where: { id: { startsWith: 'it-m-' } } });
    await prisma.nodeType.deleteMany({ where: { id: { startsWith: 'it-nt-' } } });
    const t = await prisma.team.findUnique({ where: { id: S.team } });
    if (t) { await prisma.team.delete({ where: { id: S.team } }); await prisma.user.deleteMany({ where: { id: { startsWith: 'it-res-u-' } } }); }
    await prisma.$disconnect();
  });

  it('主链命中：modelId 派生 nodeTypeId，全四键精确匹配返回快照', async () => {
    const r = await svc.resolve({ modelId: S.model });
    expect(r).toMatchObject({ pricingRuleId: expect.stringContaining('it-pr-'), modelId: S.model, creditCost: 3 });
  });

  it('三分支①：规则行不存在 ⇒ PRICING_RULE_MISSING 业务错误（红相=现实现 ?? 0 外呼照发）', async () => {
    const m2 = await prisma.aIModel.create({ data: { id: `it-m-nr-${Date.now()}`, nodeTypeId: S.nt, name: 'it-m-nr', provider: 'it', apiUrl: 'http://x', active: true } });
    await expect(svc.resolve({ modelId: m2.id })).rejects.toMatchObject({ errorCode: 'PRICING_RULE_MISSING' });
    await prisma.aIModel.delete({ where: { id: m2.id } });
  });

  it('三分支②：active=false 规则 ⇒ 同 PRICING_RULE_MISSING', async () => {
    const rule = await prisma.pricingRule.findFirstOrThrow({ where: { modelId: S.model } });
    await prisma.pricingRule.update({ where: { id: rule.id }, data: { active: false } });
    await expect(svc.resolve({ modelId: S.model })).rejects.toMatchObject({ errorCode: 'PRICING_RULE_MISSING' });
    await prisma.pricingRule.update({ where: { id: rule.id }, data: { active: true } });
  });

  it('三分支③：model 缺失/停用 ⇒ PROVIDER_UNKNOWN_MODEL（模型身份单源 AIModel）', async () => {
    await expect(svc.resolve({ modelId: 'no-such-model' })).rejects.toMatchObject({ errorCode: 'PROVIDER_UNKNOWN_MODEL' });
  });

  it('Z21：modelId undefined/null ⇒ 4xx 业务错误（禁 PrismaClientValidationError 500）', async () => {
    await expect(svc.resolve({ modelId: undefined as any })).rejects.toMatchObject({ errorCode: 'PROVIDER_UNKNOWN_MODEL' });
    await expect(svc.resolve({ modelId: '' })).rejects.toMatchObject({ errorCode: 'PROVIDER_UNKNOWN_MODEL' });
  });

  it('creditCost:0 行=唯一合法免费（resolve 成功返回 0——?? 0 禁令正面形态）', async () => {
    const rule = await prisma.pricingRule.findFirstOrThrow({ where: { modelId: S.model } });
    await prisma.pricingRule.update({ where: { id: rule.id }, data: { creditCost: 0 } });
    expect((await svc.resolve({ modelId: S.model })).creditCost).toBe(0);
    await prisma.pricingRule.update({ where: { id: rule.id }, data: { creditCost: 3 } });
  });

  it('Z5 kind 级路径：modelId IS NULL 规则精确命中（无阶梯无唯一模型断言）', async () => {
    const r = await svc.resolveByNodeTypeKey(S.kindKey);
    expect(r).toMatchObject({ modelId: null, creditCost: 1 });
  });

  it('Z5：kind 级 NodeType 无规则 ⇒ PRICING_RULE_MISSING（非裸 Error 500）', async () => {
    const nt = await prisma.nodeType.create({ data: { id: `it-nt-nr-${Date.now()}`, name: 'x', key: `it-nr-${Date.now()}` } });
    await expect(svc.resolveByNodeTypeKey(nt.key)).rejects.toMatchObject({ errorCode: 'PRICING_RULE_MISSING' });
    await prisma.nodeType.delete({ where: { id: nt.id } });
  });

  it('Z28：EXECUTABLE_TYPES ⊆ dom(NODE_TYPE_KEY_MAP)（命名空间映射全覆盖）', async () => {
    const { NODE_TYPE_KEY_MAP, resolvePricingKey, KIND_LEVEL_KEYS } = await import('./pricing-input.util');
    const { EXECUTABLE_TYPES } = await import('./is-executable-node');
    for (const t of EXECUTABLE_TYPES) expect(NODE_TYPE_KEY_MAP[t], `节点类型 ${t} 缺 pricingKey 映射`).toBeDefined();
    // 主链类型缺模型 ⇒ MODEL_NOT_SELECTED（禁 kind 回退——resolvePricingKey 的主链/kind 分界）
    await expect(resolvePricingKey({ modelResolution: {}, modelDuration: {} } as any, { type: 'textInput', data: {} }))
      .rejects.toMatchObject({ errorCode: 'MODEL_NOT_SELECTED' });
    // kind 级类型缺模型 ⇒ 走 pricingKey（不抛 MODEL_NOT_SELECTED）
    const k = await resolvePricingKey({ modelResolution: {}, modelDuration: {} } as any, { type: 'lighting', data: {} });
    expect(k.pricingKey).toBe('lighting');
    // Z37：multiImageGen 缺模型 ⇒ MODEL_NOT_SELECTED 显式 4xx（非 kind 回退）
    await expect(resolvePricingKey({ modelResolution: {}, modelDuration: {} } as any, { type: 'multiImageGen', data: {} }))
      .rejects.toMatchObject({ errorCode: 'MODEL_NOT_SELECTED' });
    void KIND_LEVEL_KEYS;
  });

  it('Z28 前置探针用例：normalizeDimensions label→id 归一化 + 声明参与制（四轮 Z36）', async () => {
    const { normalizeDimensions } = await import('./pricing-input.util');
    const imgModels = await prisma.aIModel.findMany({ where: { active: true, nodeType: { key: 'image' } }, take: 1 });
    if (imgModels.length >= 1) {
      const res = await prisma.modelResolution.findFirstOrThrow({ where: { modelId: imgModels[0].id } });
      const byLabel = await normalizeDimensions(prisma as any, imgModels[0].id, res.label);
      expect(byLabel.resolutionId).toBe(res.id);   // label 归一化到行 id
      await expect(normalizeDimensions(prisma as any, imgModels[0].id, '2K')).rejects.toMatchObject({ errorCode: 'PRICING_DIMENSION_MISSING' });   // 已声明而键不可解析——UI 预设串禁回退
    }
    // 声明参与制：video 模型未声明 resolution ⇒ '1080p' 不参与（null 不抛）+秒数归一
    const vidModels = await prisma.aIModel.findMany({ where: { active: true, nodeType: { key: 'video' } }, take: 1 });
    if (vidModels.length >= 1) {
      const r = await normalizeDimensions(prisma as any, vidModels[0].id, '1080p', 5);
      expect(r.resolutionId).toBeNull();
      expect(r.durationId).not.toBeNull();
    }
  });
});
