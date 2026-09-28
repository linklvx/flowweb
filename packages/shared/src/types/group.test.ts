import { describe, it, expect } from 'vitest';
import { GROUP_NODE_DATA_KEYS } from './group';

describe('GROUP_NODE_DATA_KEYS', () => {
  it('恰为 9 键（R0a clone 表契约）', () => {
    expect(GROUP_NODE_DATA_KEYS).toHaveLength(9);
    expect([...GROUP_NODE_DATA_KEYS].sort()).toEqual(
      ['cells', 'collapsed', 'color', 'groupType', 'manuallyResized', 'name', 'nameCustom', 'savedSize', 'storyboard'].sort(),
    );
  });
});
