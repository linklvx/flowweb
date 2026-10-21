import { describe, it, expect } from 'vitest';
import { normalizeIntentParams, WHITELIST, IDENTITY_FIELDS } from './normalize-intent-params';

// F1：服务端白名单规范化——幂等命中比对谓词。
// 白名单 = 五扣费点实读外呼参数中的稳定意图参数：
//   execution text（callTextGen: prompt/model）、video（callVideoGen 11 参）、image（callImageGen 6 参）
//   ai-image-edit outpaint（rect/imageWidth/imageHeight）、erase（外呼仅 presigned URL——无稳定参数）、redraw（prompt/strength）
//   lighting（callRelighting(presignedUrl, promptText)——实读无 strength，prompt 为 paramsToPrompt 派生稳定串）
describe('normalizeIntentParams（F1 白名单规范化哈希）', () => {
  it('同 payload 两次调用产生同 hash', () => {
    const payload = { model: 'kimi-x', prompt: '画一只猫', sv: 12, nonce: 'a' };
    expect(normalizeIntentParams('text', payload)).toBe(normalizeIntentParams('text', payload));
  });

  it('同 payload 键序打乱产生同 hash', () => {
    const a = { model: 'kimi-x', prompt: '画一只猫', sv: 12 };
    const b = { sv: 12, prompt: '画一只猫', model: 'kimi-x' };
    expect(normalizeIntentParams('text', a)).toBe(normalizeIntentParams('text', b));
  });

  it('sv/nonce/ts/requestId 环境字段差异不改变 hash（失败重试可命中同意图）', () => {
    const a = { model: 'kimi-x', prompt: '画一只猫', sv: 12, nonce: 'n1', ts: 1700000000000, requestId: 'req-1' };
    const b = { model: 'kimi-x', prompt: '画一只猫', sv: 99, nonce: 'n2', ts: 1799999999999, requestId: 'req-2' };
    expect(normalizeIntentParams('text', a)).toBe(normalizeIntentParams('text', b));
  });

  it('白名单内参数（model）差异产生不同 hash（防客户端改参复用 intentId）', () => {
    const a = { model: 'kimi-x', prompt: '画一只猫' };
    const b = { model: 'kimi-pro', prompt: '画一只猫' };
    expect(normalizeIntentParams('text', a)).not.toBe(normalizeIntentParams('text', b));
  });

  it('image kind（同步路径）：同逻辑意图（prompt+resolution 等白名单集相同、环境噪声不同）hash 一致', () => {
    // execution.service.ts callImageGen 实参：prompt/extraPrompt/style/model/resolution/imageUrl
    const a = { model: 'img-v2', prompt: '星空', extraPrompt: '赛博', style: 'anime', resolution: '2048x2048', imageUrl: 'http://s/img.png', sv: 3, requestId: 'r1' };
    const b = { requestId: 'r2', sv: 40, imageUrl: 'http://s/img.png', resolution: '2048x2048', style: 'anime', extraPrompt: '赛博', prompt: '星空', model: 'img-v2' };
    expect(normalizeIntentParams('image', a)).toBe(normalizeIntentParams('image', b));
  });

  it('redraw kind（异步路径）：同逻辑意图（prompt+strength 集相同、噪声不同）hash 一致', () => {
    // ai-image-edit.processor.ts callRedraw 实参（imageUrl/maskUrl 为 presigned 非稳定，不进白名单）
    const a = { prompt: '把天空改成黄昏', strength: 0.6, fileId: 'f1', maskFileId: 'm1', sv: 1, nonce: 'x' };
    const b = { strength: 0.6, prompt: '把天空改成黄昏', fileId: 'f1', maskFileId: 'm1', sv: 2, nonce: 'y' };
    expect(normalizeIntentParams('redraw', a)).toBe(normalizeIntentParams('redraw', b));
  });

  it('redraw kind：白名单内参数（strength）差异产生不同 hash', () => {
    const a = { prompt: '把天空改成黄昏', strength: 0.6 };
    const b = { prompt: '把天空改成黄昏', strength: 0.9 };
    expect(normalizeIntentParams('redraw', a)).not.toBe(normalizeIntentParams('redraw', b));
  });

  it('lighting kind：同 prompt 派生串 hash 一致（实读 callRelighting 无 strength）', () => {
    // lighting.consumer.ts：外呼 (presignedUrl, promptText)——taskId/sv 为环境噪声
    const a = { prompt: '主光源从左侧照射，亮度适中，色温5000K', taskId: 't1', sv: 1 };
    const b = { prompt: '主光源从左侧照射，亮度适中，色温5000K', taskId: 't2', sv: 7 };
    expect(normalizeIntentParams('lighting', a)).toBe(normalizeIntentParams('lighting', b));
  });

  it('Y0b-2 T6（R3-P0-1）erase 空集根修：不同 maskFileId → 不同 hash（改前空 whitelist=同键回放旧产物）', () => {
    const a = { fileId: 'f1', maskFileId: 'm1', sv: 1 };
    const b = { fileId: 'f1', maskFileId: 'm2', sv: 1 };
    expect(normalizeIntentParams('erase', a)).not.toBe(normalizeIntentParams('erase', b));
  });

  it('Y0b-2 T6：erase 同 mask 重试（环境噪声不同）→ 同 hash（幂等命中不双扣）', () => {
    const a = { fileId: 'f1', maskFileId: 'm1', sv: 1 };
    const b = { fileId: 'f1', maskFileId: 'm1', sv: 9 };
    expect(normalizeIntentParams('erase', a)).toBe(normalizeIntentParams('erase', b));
  });

  it('Y0b-2 T6：outpaint/redraw 换源图（fileId 变）→ 不同 hash（identity 字段进键）', () => {
    expect(normalizeIntentParams('outpaint', { fileId: 'f1', rect: { x: 1, y: 1, width: 2, height: 2 }, imageWidth: 100, imageHeight: 100 }))
      .not.toBe(normalizeIntentParams('outpaint', { fileId: 'f2', rect: { x: 1, y: 1, width: 2, height: 2 }, imageWidth: 100, imageHeight: 100 }));
    expect(normalizeIntentParams('redraw', { fileId: 'f1', maskFileId: 'm1', prompt: 'p', strength: 0.6 }))
      .not.toBe(normalizeIntentParams('redraw', { fileId: 'f2', maskFileId: 'm1', prompt: 'p', strength: 0.6 }));
  });

  it('Y0b-2 T6：lighting 换源图（originalImageId 变）→ 不同 hash', () => {
    const a = { originalImageId: 'img-1', prompt: '黄昏光' };
    const b = { originalImageId: 'img-2', prompt: '黄昏光' };
    expect(normalizeIntentParams('lighting', a)).not.toBe(normalizeIntentParams('lighting', b));
  });

  it('Y0b-2 T6 身份完整性表驱动：每 kind 的 IDENTITY_FIELDS ⊆ WHITELIST[kind]（新增 kind/字段自动受检——缺身份字段=同操作异键/异操作同键的资损面）', () => {
    for (const [kind, fields] of Object.entries(IDENTITY_FIELDS)) {
      const whitelist = WHITELIST[kind];
      expect(whitelist, `kind '${kind}' 未登记 WHITELIST（fail-closed：claim 会 throw）`).toBeDefined();
      for (const f of fields) {
        expect(whitelist, `kind '${kind}' 身份字段 '${f}' 缺席 WHITELIST——参数变而 idemKey 不变`).toContain(f);
      }
    }
  });

  it('未知 kind 抛错（fail-closed——静默回退全键会让 sv/nonce 进哈希，重试按钮永久 409）', () => {
    expect(() => normalizeIntentParams('upscale', { prompt: 'x' })).toThrow(/unknown kind/);
  });

  // ── Y1a T8：上游身份字段化（imageUrl→imageMediaId 族——URL 变即新键的重复扣费缺口根修） ──

  it('Y1a T8 白名单翻转：image 含 imageMediaId 不含 imageUrl（URL 形态退役——presign 续签/重解析不再进哈希）', () => {
    expect(WHITELIST.image).toContain('imageMediaId');
    expect(WHITELIST.image).not.toContain('imageUrl');
  });

  it('Y1a T8 白名单翻转：video 四身份字段（原 URL 字段机械映射）', () => {
    expect(WHITELIST.video).toContain('imageMediaId');
    expect(WHITELIST.video).toContain('startImageMediaId');
    expect(WHITELIST.video).toContain('endImageMediaId');
    expect(WHITELIST.video).toContain('imageMediaIds');
    expect(WHITELIST.video).not.toContain('imageUrl');
    expect(WHITELIST.video).not.toContain('startImageUrl');
    expect(WHITELIST.video).not.toContain('endImageUrl');
    expect(WHITELIST.video).not.toContain('imageUrls');
  });

  it('Y1a T8 红测 2（URL 变即新键根修）：同一 Media 两次 claim（上游注入身份同值）→ 同 hash——重试命中同意图不开新键重复扣费', () => {
    // 第一次 claim：上游注入=mediaId（NodeArtifact 读源）；重试（presign 续签后）身份不变
    const a = { model: 'img-v2', prompt: '星空', resolution: '2048x2048', imageMediaId: 'media-111' };
    const b = { model: 'img-v2', prompt: '星空', resolution: '2048x2048', imageMediaId: 'media-111', sv: 7, requestId: 'r2' };
    expect(normalizeIntentParams('image', a)).toBe(normalizeIntentParams('image', b));
  });

  it('Y1a T8 身份语义：URL 噪声字段（imageUrl 遗留键）差异不改变 hash（不在白名单=被剔除）', () => {
    const a = { model: 'img-v2', prompt: 'p', imageMediaId: 'media-111', imageUrl: 'https://x/flowai/k?sig=A' };
    const b = { model: 'img-v2', prompt: 'p', imageMediaId: 'media-111', imageUrl: 'https://x/flowai/k?sig=B' };
    expect(normalizeIntentParams('image', a)).toBe(normalizeIntentParams('image', b));
  });

  it('Y1a T8 换上游图（imageMediaId 变）→ 不同 hash（不同操作必不同键——身份字段进键）', () => {
    const a = { model: 'img-v2', prompt: 'p', imageMediaId: 'media-111' };
    const b = { model: 'img-v2', prompt: 'p', imageMediaId: 'media-222' };
    expect(normalizeIntentParams('image', a)).not.toBe(normalizeIntentParams('image', b));
  });

  it('Y1a T8 video 身份字段语义：手工 doc URL 转身份失败时原值进哈希（外网 URL 用户不变则身份不变）', () => {
    const a = { model: 'wan-v2', prompt: 'p', mode: 'image-to-video', startImageMediaId: 'https://cdn.example.com/ref.png' };
    const b = { model: 'wan-v2', prompt: 'p', mode: 'image-to-video', startImageMediaId: 'https://cdn.example.com/ref.png' };
    expect(normalizeIntentParams('video', a)).toBe(normalizeIntentParams('video', b));
  });
});
