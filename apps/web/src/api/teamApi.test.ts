import { describe, it, expect } from 'vitest';
import { teamDisplayName } from './teamApi';

describe('teamDisplayName', () => {
  it('默认团队显示「个人项目」', () => {
    expect(teamDisplayName({ isDefault: true, name: 'Alice的团队' })).toBe('个人项目');
  });
  it('普通团队显示原名', () => {
    expect(teamDisplayName({ isDefault: false, name: '梦幻团队' })).toBe('梦幻团队');
  });
});
