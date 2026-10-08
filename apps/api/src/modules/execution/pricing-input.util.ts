// apps/api/src/modules/execution/pricing-input.util.ts —— Y0b-1（Z21+三轮 Z28+四轮 Z36/Z37）：节点→定价输入单源
// ①模型键位 census（is-executable-node 白名单）：
//   textInput/imageGen/videoGen/audioGen → data.model；imageExtGen → data.extConfig.model（后端此前从不读——v1 盲区）；
//   multiImageGen → 无模型键 → null（四轮 Z37 并入 Z31：KIND_LEVEL_KEYS 移除 ⇒ MODEL_NOT_SELECTED 显式 4xx）
// ②pricingKey 映射（三轮 Z28：node.type 与 NodeType.key 是两个命名空间——seed 实测 text/image/imageExt/video；
//   映射表与 EXECUTABLE_TYPES 同处定义，pricing-resolver.int.spec 断言白名单 ⊆ dom(map)）
// ③normalizeDimensions（四轮 Z36 声明参与制）：维度是否参与定价由**模型声明**（有无该维度类行）决定——未声明 ⇒
//   不参与（返回 null 不抛错：video 的 '1080p' 预设/image 的 duration 被忽略）；已声明而键无法解析 ⇒
//   PRICING_DIMENSION_MISSING fail-closed 禁回退。行 id/label/秒数统一归一到行 id——validation/execution/
//   报价端点/覆盖度门禁四处同源消费。UI 侧配套（Z36②a）：面板从 model.resolutions/durations 渲染并**存行 id**。
import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';

export const NODE_TYPE_KEY_MAP: Record<string, string> = {
  textInput: 'text', imageGen: 'image', imageExtGen: 'imageExt', videoGen: 'video',
  audioGen: 'audio',   // 库内无此 NodeType（Z31 登记 Y0b-2）——映射预留，运行期 PROVIDER_UNKNOWN/PRICING_RULE_MISSING 显式 4xx
  multiImageGen: 'multiImageGen', outpaint: 'outpaint', erase: 'erase', redraw: 'redraw', lighting: 'lighting',
};
/** kind 级键（modelId IS NULL 规则的合法载体）——主链键缺模型时是 MODEL_NOT_SELECTED 而非 kind 回退。
 *  四轮 Z37：multiImageGen 移除（mock 管线禁定价——落入 MODEL_NOT_SELECTED 显式 4xx，Y0b-2 登记多图管线）。 */
export const KIND_LEVEL_KEYS = ['outpaint', 'erase', 'redraw', 'lighting'];

export function pricingInputOf(node: { type: string; data?: Record<string, unknown> | null }): { modelId: string | null; pricingKey: string | null } {
  const d = (node.data ?? {}) as any;
  const modelId = node.type === 'imageExtGen' ? (d?.extConfig?.model ?? null) : (d?.model ?? null);
  return { modelId, pricingKey: NODE_TYPE_KEY_MAP[node.type] ?? null };
}

/** 维度归一化（Z28+四轮 Z36）：声明参与制——每维度类恰一次查询（取声明全集后本地匹配 id/label/秒数）。 */
export async function normalizeDimensions(
  prisma: { modelResolution: { findMany: (a: any) => Promise<any[]> }; modelDuration: { findMany: (a: any) => Promise<any[]> } },
  modelId: string, resolution?: unknown, duration?: unknown,
): Promise<{ resolutionId: string | null; durationId: string | null }> {
  let resolutionId: string | null = null;
  if (resolution != null && resolution !== '') {
    const rows = await prisma.modelResolution.findMany({ where: { modelId }, select: { id: true, label: true } });
    const hit = rows.find((r) => r.id === resolution || r.label === String(resolution));
    if (hit) resolutionId = hit.id;
    else if (rows.length > 0) throw new BusinessException('PRICING_DIMENSION_MISSING', `分辨率键无法解析: ${String(resolution)}（model=${modelId}，已声明 ${rows.length} 档——UI 应存行 id，Z36）`, HttpStatus.BAD_REQUEST);
    // rows 空=模型未声明分辨率维度 ⇒ 不参与（video 的 '1080p' 预设被忽略）
  }
  let durationId: string | null = null;
  if (duration != null && duration !== '') {
    const rows = await prisma.modelDuration.findMany({ where: { modelId }, select: { id: true, label: true, seconds: true } });
    const idStr = String(duration);
    const secs = Number(duration);   // Number('5s')=NaN——isFinite 守卫（四轮 B4：NaN 入 Prisma Int 查询=invalid syntax 500）
    const hit = rows.find((r) => r.id === idStr || r.label === idStr || (Number.isFinite(secs) && r.seconds === secs));
    if (hit) durationId = hit.id;
    else if (rows.length > 0) throw new BusinessException('PRICING_DIMENSION_MISSING', `时长键无法解析: ${String(duration)}（model=${modelId}，已声明 ${rows.length} 档）`, HttpStatus.BAD_REQUEST);
  }
  return { resolutionId, durationId };
}

/** 全四键单源解析（Z28）——validation/execution 三链/报价端点的唯一入口（两形状分叉的根修） */
export async function resolvePricingKey(
  prisma: any, node: { type: string; data?: Record<string, unknown> | null },
): Promise<{ modelId: string | null; resolutionId: string | null; durationId: string | null; pricingKey: string | null }> {
  const { modelId, pricingKey } = pricingInputOf(node);
  if (!modelId) {
    if (!pricingKey || !KIND_LEVEL_KEYS.includes(pricingKey)) {
      throw new BusinessException('MODEL_NOT_SELECTED', `节点 ${node.type} 未选择模型（主链类型禁 kind 回退）`, HttpStatus.BAD_REQUEST);
    }
    return { modelId: null, resolutionId: null, durationId: null, pricingKey };
  }
  const d = (node.data ?? {}) as any;
  const { resolutionId, durationId } = await normalizeDimensions(prisma, modelId, d?.resolution, d?.duration);
  return { modelId, resolutionId, durationId, pricingKey };
}
