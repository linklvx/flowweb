// Y0b-4 T1：utf8Bytes 单源（TextEncoder）——web/api 两端字节量纲一致（quota 执法/提示同尺）。
import { describe, it, expect } from 'vitest';
import { utf8Bytes } from './utf8-bytes';

describe('Y0b-4 T1 utf8Bytes（TextEncoder 单源——UTF-8 字节数 ≠ string.length）', () => {
  it('中文 3× 量纲修正：utf8Bytes("中")===3 而 "中".length===1', () => {
    expect(utf8Bytes('中')).toBe(3); expect('中'.length).toBe(1);
  });
  it('星面 emoji 4 字节/2 码元：utf8Bytes("😀")===4 而 "😀".length===2（星面字符=真实画布内容——2 码元/4 字节是 .length 量纲分歧核心场景）', () => {
    expect(utf8Bytes('😀')).toBe(4); expect('😀'.length).toBe(2);
  });
});
