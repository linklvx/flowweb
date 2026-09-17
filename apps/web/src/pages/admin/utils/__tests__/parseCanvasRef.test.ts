import { describe, it, expect } from 'vitest';
import { parseCanvasRef } from '../parseCanvasRef';

describe('parseCanvasRef（表驱动——onFinish 现算，防 C-1 注册陷阱）', () => {
  it.each([
    ['cpx1abc', 'cpx1abc'],                                              // 裸 ID
    ['  cpx1abc  ', 'cpx1abc'],                                          // 首尾空白
    ['"cpx1abc"', 'cpx1abc'],                                            // 控制台粘贴带引号
    ['http://localhost:5173/canvas?projectId=cpx1abc', 'cpx1abc'],       // 绝对 URL
    ['/canvas?projectId=cpx1abc', 'cpx1abc'],                            // 相对 URL（new URL(v, origin)）
    ['https://app.example.com/canvas?projectId=p&x=1', 'p'],             // 多参数
    ['/canvas', '/canvas'],                                              // URL 无 projectId → 整串当裸 ID
    ['', null],                                                          // 空
  ])('%s → %s', (input, expected) => {
    expect(parseCanvasRef(input)).toBe(expected);
  });
});
