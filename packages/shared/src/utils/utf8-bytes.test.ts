// Y0b-4 T1：utf8Bytes 单源（TextEncoder）——web/api 两端字节量纲一致（quota 执法/提示同尺）。
import { describe, it, expect } from 'vitest';
import { utf8Bytes } from './utf8-bytes';

describe('Y0b-4 T1 utf8Bytes（TextEncoder 单源——UTF-8 字节数 ≠ string.length）', () => {
  it('中文 3× 量纲修正：utf8Bytes("中")===3 而 "中".length===1', () => {
    expect(utf8Bytes('中')).toBe(3); expect('中'.length).toBe(1);
  });
});
