import { createHash } from 'node:crypto';

/** F1：服务端白名单规范化——只取稳定意图参数；剔 sv/时间戳/nonce/请求 id；键排序后稳定 JSON 的 sha256。
 *  五扣费点（execution text/video/image + ai-image-edit/lighting）共用同一函数——
 *  两点各自实现会产生两键=双扣（spec 幂等组⑬）。
 *  白名单 = 各扣费点的稳定操作身份（presigned URL 非稳定一律不进）；
 *  lighting 实读 callRelighting(presignedUrl, promptText) 无 strength——prompt 为 paramsToPrompt 派生稳定串。
 *  Y0b-2 T6（R3-P0-1）身份字段补全：白名单语义=「稳定操作身份（输入集）」——身份字段的价值=
 *  「参数变 ⇒ idemKey 变」（error 保留 token+终态前重试复用场景下 mask/源图变更必须换键；
 *  防回放已由编辑链恒 token 结构性保证，非本表职责）。erase 空集根修：双输入 fileId/maskFileId 进表
 *  （改前 sha256('{}') 全局常量=任意两次 erase 同键——不同 mask 互播旧产物）。
 *  **Y1a T8 翻转 v10.1「主链禁补 fileId」旧裁决**（旧理由=fileId 由 ai-download 异步回写、claim 时刻
 *  无 fileId——已不成立）：上游注入读源改 NodeArtifact（PG 行 finalize 即建、claim 时刻必可读），
 *  上游身份进哈希用 mediaId 形态——URL 形态（presign 续签/URL 重解析）不进哈希（URL 变即新键=
 *  同一操作重试重复扣费缺口根修）。身份字段值域=mediaId | 原样 URL（doc 手工外网 URL 不能解析为
 *  已知 Media 时维持原值——用户不变则身份不变；转换在 callArgs 构造处，upstream-media.service）。
 *  身份字段映射表（原 URL 字段名机械映射）：imageUrl→imageMediaId、startImageUrl→startImageMediaId、
 *  endImageUrl→endImageMediaId、imageUrls→imageMediaIds。doc 侧数据键不改（URL 形态由 T11/T15 迁移）。 */
export const WHITELIST: Record<string, string[]> = {
  text: ['model', 'prompt'],
  video: ['model', 'mode', 'prompt', 'imageMediaId', 'startImageMediaId', 'endImageMediaId', 'imageMediaIds', 'ratio', 'quality', 'duration', 'audio'],
  image: ['model', 'prompt', 'extraPrompt', 'style', 'resolution', 'imageMediaId'],
  outpaint: ['fileId', 'rect', 'imageWidth', 'imageHeight'],
  erase: ['fileId', 'maskFileId'],
  redraw: ['fileId', 'maskFileId', 'prompt', 'strength'],
  lighting: ['originalImageId', 'prompt'],
};

/** 各 kind 的身份字段（操作身份的必答集——表驱动身份完整性测试的对照真源；新增 kind/字段自动受检）。 */
export const IDENTITY_FIELDS: Record<string, string[]> = {
  video: ['imageMediaId', 'startImageMediaId', 'endImageMediaId', 'imageMediaIds'],
  image: ['imageMediaId'],
  outpaint: ['fileId'],
  erase: ['fileId', 'maskFileId'],
  redraw: ['fileId', 'maskFileId'],
  lighting: ['originalImageId'],
};

export function normalizeIntentParams(kind: string, params: Record<string, unknown>): string {
  const whitelist = WHITELIST[kind];
  if (!whitelist) throw new Error(`normalizeIntentParams: unknown kind '${kind}'——新扣费点必须登记白名单（fail-closed：静默回退全键会让 sv/nonce 进哈希，失败重试必然 409、"重试"按钮永久坏死）`);
  const keys = whitelist.slice().sort();
  const picked: Record<string, unknown> = {};
  for (const k of keys) picked[k] = params[k] === undefined ? null : params[k];
  return createHash('sha256').update(JSON.stringify(picked)).digest('hex');
}
