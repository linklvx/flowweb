import { createHash } from 'node:crypto';

/** F1：服务端白名单规范化——只取稳定意图参数；剔 sv/时间戳/nonce/请求 id；键排序后稳定 JSON 的 sha256。
 *  五扣费点（execution text/video/image + ai-image-edit/lighting）共用同一函数——
 *  两点各自实现会产生两键=双扣（spec 幂等组⑬）。
 *  白名单 = 各扣费点实读外呼参数（presigned URL 非稳定一律不进；erase 实读无稳定参数）；
 *  lighting 实读 callRelighting(presignedUrl, promptText) 无 strength——prompt 为 paramsToPrompt 派生稳定串。 */
const WHITELIST: Record<string, string[]> = {
  text: ['model', 'prompt'],
  video: ['model', 'mode', 'prompt', 'imageUrl', 'startImageUrl', 'endImageUrl', 'imageUrls', 'ratio', 'quality', 'duration', 'audio'],
  image: ['model', 'prompt', 'extraPrompt', 'style', 'resolution', 'imageUrl'],
  outpaint: ['rect', 'imageWidth', 'imageHeight'],
  erase: [],
  redraw: ['prompt', 'strength'],
  lighting: ['prompt'],
};

export function normalizeIntentParams(kind: string, params: Record<string, unknown>): string {
  const whitelist = WHITELIST[kind];
  if (!whitelist) throw new Error(`normalizeIntentParams: unknown kind '${kind}'——新扣费点必须登记白名单（fail-closed：静默回退全键会让 sv/nonce 进哈希，失败重试必然 409、"重试"按钮永久坏死）`);
  const keys = whitelist.slice().sort();
  const picked: Record<string, unknown> = {};
  for (const k of keys) picked[k] = params[k] === undefined ? null : params[k];
  return createHash('sha256').update(JSON.stringify(picked)).digest('hex');
}
