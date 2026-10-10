// apps/web/src/utils/regen-token.spec.ts —— Y0b-2 T6（Z79/Z95/Z118）：手势 token 生命周期
// held 一律上送（error 后两请求体同 token）→ done 轮换（第三击新 token）→ EXHAUSTED（投影
// rearmable:false）后刷新再点⇒新 token（不自锁）+ 失败→刷新→再点⇒同 token（B-1' web 侧）。
import { describe, it, expect, beforeEach } from 'vitest';
import { gestureToken, storedToken, rotateToken } from './regen-token';

describe('Y0b-2 T6：regen-token 手势 token 生命周期（intentRecord 族退役）', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('gestureToken 惰性铸造并持有：storedToken 读回同值（uuid 形态——服务端 ^[0-9a-zA-Z_-]{8,64}$ 天然合法）', () => {
    expect(storedToken('p1', 'n1')).toBeNull(); // 无持有
    const t = gestureToken('p1', 'n1');
    expect(t).toMatch(/^[0-9a-f-]{36}$/);
    expect(storedToken('p1', 'n1')).toBe(t); // 持有
  });

  it('Z118 核修（held 一律上送）：失败→刷新（新组件实例）→再点 ⇒ storedToken 仍同 token（组件 ref 形态改前红=新 id 新扣费）', () => {
    const t = gestureToken('p1', 'n1');
    // "刷新"=同标签页 sessionStorage 存活（跨组件实例/跨 React root 重建）
    expect(storedToken('p1', 'n1')).toBe(t);
  });

  it('rotateToken 轮换：done 后下一击新 token（新"重新生成"照常扣费）', () => {
    const t1 = gestureToken('p1', 'n1');
    rotateToken('p1', 'n1');
    expect(storedToken('p1', 'n1')).toBeNull();
    const t2 = gestureToken('p1', 'n1');
    expect(t2).not.toBe(t1);
  });

  it('EXHAUSTED（投影 rearmable:false）后轮换再点 ⇒ 新 token（同 token rearm 会 409 不自锁）', () => {
    const t1 = gestureToken('p1', 'n1');
    rotateToken('p1', 'n1'); // 轮换判据单源=投影（面板 useEffect 调本函数）
    const t2 = gestureToken('p1', 'n1');
    expect(t2).not.toBe(t1);
  });

  it('标签隔离：sessionStorage 键含 pid+nid（双标签/异节点不互撞）', () => {
    gestureToken('p1', 'n1');
    expect(storedToken('p1', 'n2')).toBeNull();
    expect(storedToken('p2', 'n1')).toBeNull();
  });
});
