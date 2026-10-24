// packages/shared/src/canvas/promptText.test.ts
// Y1c T2（bug② 后半）：resolvePromptText 单测——string / PromptValue / 空 三形态参数化
// + content 回落两腿（audioGen prompt 住 content；无 prompt 的 textInput 裸正文）。
// T15 终形 prompt=Y.Map{text:Y.Text} 迁移时本文件随实现同步改（执行读点永不再改）。
import { describe, expect, it } from 'vitest';
import { resolvePromptText } from './promptText';

describe('resolvePromptText（Y1c T2：节点 data prompt 解析单源——执行读点唯一入口）', () => {
  it.each([
    ['string 形态（textInput TextConfigPanel:211 每键击 data.prompt:string）——直读', { prompt: '面板提示词' }, '面板提示词'],
    ['PromptValue 形态（imageGen/videoGen prompt:{text}）——取 .text', { prompt: { text: '面板词' } }, '面板词'],
    ['空形态（无 prompt 无 content）——空串', {}, ''],
    ['null/undefined data——空串（防御档）', null, ''],
    ['PromptValue.text 空串（面板清空——D28）——空串不回落 content', { prompt: { text: '' }, content: '正文' }, ''],
    ['string 优先于 content（textInput 正文与面板词并存——面板词胜，正文不串位）', { prompt: '面板词', content: '正文' }, '面板词'],
    ['content 回落（audioGen——prompt 住 content:string，T15 迁移前现状）', { content: '音频词' }, '音频词'],
    ['content 回落（无 prompt 的 textInput 裸正文——content 即生成输入旧语义）', { content: '裸正文' }, '裸正文'],
  ])('%s', (_name: string, data: unknown, expected: string) => {
    expect(resolvePromptText(data as any)).toBe(expected);
  });
});
