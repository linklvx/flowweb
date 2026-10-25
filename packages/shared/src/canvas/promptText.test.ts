// packages/shared/src/canvas/promptText.test.ts
// Y1c T2（bug② 后半）：resolvePromptText 单测——string / {text} / 空 三形态参数化
// + content 回落腿（无 prompt 的 textInput 裸正文）。
// Y1c T15（同卡再改）：读模型形态收敛——audioGen/multiImageGen.prompt=Y.Text→string 腿、
// textInput.prompt=Y.Map{text:Y.Text}→{text} 腿、imageGen/videoGen PromptValue={text,html} 同 .text 腿。
import { describe, expect, it } from 'vitest';
import { resolvePromptText } from './promptText';

describe('resolvePromptText（Y1c T2/T15：节点 data prompt 解析单源——执行读点唯一入口）', () => {
  it.each([
    ['string 形态（audioGen/multiImageGen prompt=Y.Text 读模型——T15 迁移后）——直读', { prompt: '音频词' }, '音频词'],
    ['{text} 形态（textInput prompt=Y.Map{text:Y.Text} 读模型——T15 迁移后）——取 .text', { prompt: { text: '面板提示词' } }, '面板提示词'],
    ['PromptValue 形态（imageGen/videoGen prompt:{text,html}——T16 前 JSON 载体）——取 .text', { prompt: { text: '面板词', html: '<p>面板词</p>' } }, '面板词'],
    ['空形态（无 prompt 无 content）——空串', {}, ''],
    ['null/undefined data——空串（防御档）', null, ''],
    ['{text} 空串（面板清空——D28）——空串不回落 content', { prompt: { text: '' }, content: '正文' }, ''],
    ['string 优先于 content（并存时 prompt 胜，正文不串位）', { prompt: '面板词', content: '正文' }, '面板词'],
    ['content 回落（无 prompt 的 textInput 裸正文——content 即生成输入旧语义）', { content: '裸正文' }, '裸正文'],
  ])('%s', (_name: string, data: unknown, expected: string) => {
    expect(resolvePromptText(data as any)).toBe(expected);
  });
});
