import { describe, it, expect } from 'vitest';
import { GROUP_NODE_DATA_KEYS } from './group';

describe('GROUP_NODE_DATA_KEYS', () => {
  it('恰为 6 键（R0a clone 表契约——manuallyResized 随 O0b-5 摘键、savedSize 随 O0c-3 全链删，cells 随 T18 顺修② 摘键〔Z17 cells→slot 派生：CLONE_WHITELIST no-op 死键——克隆输入经键集表已剥〕）', () => {
    expect(GROUP_NODE_DATA_KEYS).toHaveLength(6);
    expect([...GROUP_NODE_DATA_KEYS].sort()).toEqual(
      ['collapsed', 'color', 'groupType', 'name', 'nameCustom', 'storyboard'].sort(),
    );
  });
});
