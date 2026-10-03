import { describe, it, expect } from 'vitest';
import { GROUP_NODE_DATA_KEYS } from './group';

describe('GROUP_NODE_DATA_KEYS', () => {
  it('恰为 7 键（R0a clone 表契约——manuallyResized 随 O0b-5 摘键、savedSize 随 O0c-3 全链删，终裁 50/82）', () => {
    expect(GROUP_NODE_DATA_KEYS).toHaveLength(7);
    expect([...GROUP_NODE_DATA_KEYS].sort()).toEqual(
      ['cells', 'collapsed', 'color', 'groupType', 'name', 'nameCustom', 'storyboard'].sort(),
    );
  });
});
