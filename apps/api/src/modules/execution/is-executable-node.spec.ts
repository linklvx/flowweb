import { describe, it, expect } from 'vitest';
import { isExecutableNode } from './is-executable-node';

describe('isExecutableNode（类型+产物标记双条件白名单）', () => {
  it('六类生成节点可执行', () => {
    for (const type of ['textInput', 'imageGen', 'imageExtGen', 'videoGen', 'audioGen', 'multiImageGen'])
      expect(isExecutableNode({ id: 'n', type, data: { model: 'm' } })).toBe(true);
  });
  it('videoEdit 类型跳过（防全部执行必挂）', () => {
    expect(isExecutableNode({ id: 'n', type: 'videoEdit', data: {} })).toBe(false);
  });
  it('origin=video-edit 的 videoGen 产物节点跳过（防二次必挂）', () => {
    expect(isExecutableNode({ id: 'n', type: 'videoGen', data: { origin: 'video-edit', status: 'done', fileId: 'f1' } })).toBe(false);
  });
  it('普通 videoGen（有 model）不误伤', () => {
    expect(isExecutableNode({ id: 'n', type: 'videoGen', data: { model: 'm' } })).toBe(true);
  });
});
