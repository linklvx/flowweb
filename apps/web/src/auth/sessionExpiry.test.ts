import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionExpiry } from './sessionExpiry';

describe('sessionExpiry httpExpired 电平（批3-3：401 横幅延后——本批只留模块+电平）', () => {
  beforeEach(() => {
    useSessionExpiry.getState().reset();
  });

  it('默认 false；setHttpExpired 置位后保持（电平语义：不自动回落）', () => {
    expect(useSessionExpiry.getState().httpExpired).toBe(false);
    useSessionExpiry.getState().setHttpExpired();
    expect(useSessionExpiry.getState().httpExpired).toBe(true);
    useSessionExpiry.getState().setHttpExpired();   // 重复置位幂等
    expect(useSessionExpiry.getState().httpExpired).toBe(true);
  });

  it('reset → 回落 false（登录成功/显式恢复的清理出口）', () => {
    useSessionExpiry.getState().setHttpExpired();
    useSessionExpiry.getState().reset();
    expect(useSessionExpiry.getState().httpExpired).toBe(false);
  });

  it('订阅面：置位通知到达（消费方横幅挂点——批 2 接线）', () => {
    const seen: boolean[] = [];
    const unsub = useSessionExpiry.subscribe((s) => seen.push(s.httpExpired));
    useSessionExpiry.getState().setHttpExpired();
    useSessionExpiry.getState().reset();
    unsub();
    expect(seen).toContain(true);
    expect(seen[seen.length - 1]).toBe(false);
  });
});
