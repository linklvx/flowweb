import { describe, it, expect } from 'vitest';
import { normalizeIntentParams } from './normalize-intent-params';

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

  it('erase kind：实读无稳定意图参数（外呼仅 presigned URL）——任意参数同 hash', () => {
    const a = { fileId: 'f1', maskFileId: 'm1', sv: 1 };
    const b = { fileId: 'f2', maskFileId: 'm2', sv: 9 };
    expect(normalizeIntentParams('erase', a)).toBe(normalizeIntentParams('erase', b));
  });

  it('未知 kind 抛错（fail-closed——静默回退全键会让 sv/nonce 进哈希，重试按钮永久 409）', () => {
    expect(() => normalizeIntentParams('upscale', { prompt: 'x' })).toThrow(/unknown kind/);
  });
});
