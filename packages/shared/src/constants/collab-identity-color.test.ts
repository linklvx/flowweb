import { describe, it, expect } from 'vitest';
import { COLLAB_USER_COLORS, userColorOfUserId } from './collab-identity-color';

describe('userColorOfUserId（Y0b-3 T7 P-L：collab identity 配色单源）', () => {
  it('同 id 稳定、异 id string（原 awareness.ts 用例随迁）', () => {
    expect(userColorOfUserId('u1')).toBe(userColorOfUserId('u1'));
    expect(typeof userColorOfUserId('u2')).toBe('string');
  });

  it('对缺 id 的畸形 awareness 状态不抛错（原 awareness.ts 用例随迁——远端可发任意字段）', () => {
    expect(typeof userColorOfUserId(undefined)).toBe('string');
    expect(userColorOfUserId()).toBe(COLLAB_USER_COLORS[0]);
  });

  it('迁移等价性 pin：hash*31 算法字面锚（原 web 端 awareness.ts:26-30 同源挪入——算法漂移哨）', () => {
    expect(COLLAB_USER_COLORS).toEqual(['#5DDCFF', '#FF7A9E', '#9EFF8A', '#FFC56D', '#C39EFF', '#7AD7FF']);
    expect(userColorOfUserId('u1')).toBe('#C39EFF');   // hash=117*31+49=3676，3676%6=4
    expect(userColorOfUserId('u2')).toBe('#7AD7FF');   // hash=3677，3677%6=5
    expect(userColorOfUserId('')).toBe('#5DDCFF');     // 空 hash=0 → COLORS[0]
  });
});
