import { Injectable, Inject, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PricingResolverService } from '../../execution/pricing-resolver.service';
import { BusinessException } from '../../../common/exceptions/business.exception';

interface CreateRuleDto {
  nodeTypeId: string; modelId: string;
  resolutionId?: string; durationId?: string;
  creditCost: number;
}

interface CalculateDto {
  modelId: string; resolutionId?: string; durationId?: string;
}

@Injectable()
export class PricingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PricingResolverService) private readonly resolver: PricingResolverService,
  ) {}

  async findAll(filters: { nodeTypeId?: string; modelId?: string; active?: boolean }) {
    return this.prisma.pricingRule.findMany({
      where: {
        nodeTypeId: filters.nodeTypeId,
        modelId: filters.modelId,
        active: filters.active,
      },
      include: { model: true, resolution: true, duration: true },
      orderBy: { creditCost: 'asc' },
    });
  }

  async create(dto: CreateRuleDto) {
    return this.prisma.pricingRule.create({ data: dto as any });
  }

  async update(id: string, data: { creditCost?: number; active?: boolean }) {
    // Y0b-1（四轮 Z37 覆盖级）：置 active:false 前守卫——不得使任何"已声明维度组合"失去可解析规则
    if (data.active === false) {
      const rule = await this.prisma.pricingRule.findUnique({ where: { id } });
      if (rule) await this.assertCoverageAfterDeactivate(rule);
    }
    return this.prisma.pricingRule.update({ where: { id }, data });
  }

  async delete(id: string) {
    // Y0b-1（四轮 Z37 覆盖级）：删除=永久失活——同守卫
    const rule = await this.prisma.pricingRule.findUnique({ where: { id } });
    if (rule) await this.assertCoverageAfterDeactivate(rule);
    return this.prisma.pricingRule.delete({ where: { id } });
  }

  /** Y0b-1（四轮 Z37 覆盖级）：禁用/删除不得使任何"已声明维度组合"失去可解析规则——与 check-pricing-coverage
   *  同源判据（表驱动：有 res 行⇒每行 (model,res,null)；有 dur 行⇒每行 (model,null,dur)；皆无⇒(model,null,null)）。 */
  private async assertCoverageAfterDeactivate(rule: { id: string; nodeTypeId: string; modelId: string | null; resolutionId: string | null; durationId: string | null }): Promise<void> {
    if (rule.modelId === null) {
      const n = await this.prisma.pricingRule.count({ where: { nodeTypeId: rule.nodeTypeId, modelId: null, active: true, id: { not: rule.id } } });
      if (n === 0) throw new BusinessException('PRICING_LAST_ACTIVE_RULE', 'kind 级 active 规则不得清零（该类编辑功能将全灭）', HttpStatus.CONFLICT);
      return;
    }
    const actWithoutSelf = (where: any) => this.prisma.pricingRule.count({ where: { ...where, modelId: rule.modelId, active: true, id: { not: rule.id } } });   // 排除本规则=模拟失活后
    const ress = await this.prisma.modelResolution.findMany({ where: { modelId: rule.modelId }, select: { id: true } });
    const durs = await this.prisma.modelDuration.findMany({ where: { modelId: rule.modelId }, select: { id: true } });
    for (const r of ress) {
      if (await actWithoutSelf({ nodeTypeId: rule.nodeTypeId, resolutionId: r.id, durationId: null }) === 0)
        throw new BusinessException('PRICING_LAST_ACTIVE_RULE', `禁用后分辨率档 ${r.id} 无 active 规则（该档位将全灭）`, HttpStatus.CONFLICT);
    }
    for (const d of durs) {
      if (await actWithoutSelf({ nodeTypeId: rule.nodeTypeId, resolutionId: null, durationId: d.id }) === 0)
        throw new BusinessException('PRICING_LAST_ACTIVE_RULE', `禁用后时长档 ${d.id} 无 active 规则（该档位将全灭）`, HttpStatus.CONFLICT);
    }
    if (ress.length === 0 && durs.length === 0 && await actWithoutSelf({ nodeTypeId: rule.nodeTypeId, resolutionId: null, durationId: null }) === 0)
      throw new BusinessException('PRICING_LAST_ACTIVE_RULE', '禁用后该模型无 active 规则（模型将全灭）', HttpStatus.CONFLICT);
  }

  async batchCreate(rules: CreateRuleDto[]) {
    const results = [];
    for (const rule of rules) {
      // Y0b-1（F8）：可空列进复合唯一 where=Prisma 不接受 null ⇒ upsert 恒走 create 持续插行——
      // 同键重复行的生产根源。改 findFirst（全四键含 null 显式比对）→create/update；
      // update 分支 active:true 重激活（管理端重提同键=恢复/改价，非新建影子行）。
      const existing = await this.prisma.pricingRule.findFirst({
        where: {
          nodeTypeId: rule.nodeTypeId, modelId: rule.modelId ?? null,
          resolutionId: rule.resolutionId ?? null, durationId: rule.durationId ?? null,
        },
      });
      const r = existing
        ? await this.prisma.pricingRule.update({ where: { id: existing.id }, data: { creditCost: rule.creditCost, active: true } })
        : await this.prisma.pricingRule.create({
            data: {
              nodeTypeId: rule.nodeTypeId, modelId: rule.modelId ?? null,
              resolutionId: rule.resolutionId ?? null, durationId: rule.durationId ?? null,
              creditCost: rule.creditCost,
            },
          });
      results.push(r);
    }
    return results;
  }

  async calculatePrice(dto: CalculateDto): Promise<number> {
    // Y0b-1（E48/Z20）：定价单源 resolver——无 active 规则抛 PRICING_RULE_MISSING（4xx），
    // 原 `?? 0` 免费旁路消灭（fail-closed）
    const r = await this.resolver.resolve({ modelId: dto.modelId, resolutionId: dto.resolutionId ?? null, durationId: dto.durationId ?? null });
    return r.creditCost;
  }

  /** Y0b-5 T14（Y0b-1 移交收口）：定价覆盖度全量巡检——与 scripts/check-pricing-coverage.mjs 同源判据
   *  （表驱动：①kind 级四键 outpaint/erase/redraw/lighting 各有 active 的 modelId IS NULL 规则；
   *  ②每个 active 模型按声明行断言——有 res 行⇒每行 (model,res,null)；有 dur 行⇒每行 (model,null,dur)；
   *  皆无⇒(model,null,null) 基础行；双维度声明=交叉组合未定义告警）。脚本=deploy preflight 链载体
   *  （独立 node 直跑 raw SQL，不可 import Nest service——判据镜像双轨，改动须两处同步）；本方法执域=
   *  admin 红标端点（浏览器拿不到 prometheus token）——ready 布尔不因 coverage 翻转。 */
  async coverage(): Promise<{ ok: boolean; missing: Array<{ modelId: string | null; name: string; problem: string }> }> {
    const missing: Array<{ modelId: string | null; name: string; problem: string }> = [];
    // ① kind 级四键（NodeType 行缺失同判缺）
    const kindNts = await this.prisma.nodeType.findMany({
      where: { key: { in: ['outpaint', 'erase', 'redraw', 'lighting'] } },
      select: { id: true, key: true },
    });
    for (const k of ['outpaint', 'erase', 'redraw', 'lighting']) {
      const nt = kindNts.find((x) => x.key === k);
      const n = nt
        ? await this.prisma.pricingRule.count({ where: { nodeTypeId: nt.id, modelId: null, active: true } })
        : 0;
      if (n < 1) missing.push({ modelId: null, name: k, problem: `kind 级 "${k}" 缺 active 的 modelId IS NULL 规则（迁移 INSERT 缺失或被删）` });
    }
    // ② 主链（纯表驱动：维度参与=模型声明——与 normalizeDimensions 声明参与制同源）
    const models = await this.prisma.aIModel.findMany({ where: { active: true }, select: { id: true, name: true } });
    for (const m of models) {
      const rules = await this.prisma.pricingRule.findMany({ where: { modelId: m.id }, select: { resolutionId: true, durationId: true, active: true } });
      const act = (pred: (r: { resolutionId: string | null; durationId: string | null; active: boolean }) => boolean) =>
        rules.some((r) => r.active && pred(r));
      const ress = await this.prisma.modelResolution.findMany({ where: { modelId: m.id }, select: { id: true } });
      const durs = await this.prisma.modelDuration.findMany({ where: { modelId: m.id }, select: { id: true } });
      // T2 质量审 I-1：双维度声明模型的交叉组合覆盖未定义（一模型至多一类维度的架构假定显式化）
      if (ress.length > 0 && durs.length > 0)
        missing.push({ modelId: m.id, name: m.name, problem: '同时声明分辨率与时长两类维度——交叉组合 (model,res,dur) 覆盖未定义（一模型至多一类维度），须先扩门禁与规则集' });
      for (const rr of ress) {
        if (!act((r) => r.resolutionId === rr.id && r.durationId === null))
          missing.push({ modelId: m.id, name: m.name, problem: `缺 (model,${rr.id},null) active 规则——该分辨率档全灭（选择器不可达）` });
      }
      for (const d of durs) {
        if (!act((r) => r.durationId === d.id && r.resolutionId === null))
          missing.push({ modelId: m.id, name: m.name, problem: `缺 (model,null,${d.id}) active 规则——该时长档全灭（选择器不可达）` });
      }
      if (ress.length === 0 && durs.length === 0 && !act((r) => r.resolutionId === null && r.durationId === null))
        missing.push({ modelId: m.id, name: m.name, problem: '缺 (model,null,null) active 基础规则——模型全灭' });
    }
    return { ok: missing.length === 0, missing };
  }
}
