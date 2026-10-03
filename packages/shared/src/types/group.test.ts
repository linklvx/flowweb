import { describe, it, expect } from 'vitest';
import { GROUP_NODE_DATA_KEYS } from './group';

describe('GROUP_NODE_DATA_KEYS', () => {
  it('恰为 8 键（R0a clone 表契约——manuallyResized 整链删除随 O0b-5 摘键，终裁 50；savedSize 留至 O0c-3）', () => {
    expect(GROUP_NODE_DATA_KEYS).toHaveLength(8);
    expect([...GROUP_NODE_DATA_KEYS].sort()).toEqual(
      ['cells', 'collapsed', 'color', 'groupType', 'name', 'nameCustom', 'savedSize', 'storyboard'].sort(),
    );
  });
});
