import { describe, it, expect, beforeEach } from 'vitest';
import { newIntentId, currentIntentId } from './intentRecord';

/** 批0.5：客户端意图记录语义锚——rotate（新生成点击换 id ⇒ 照常扣费）
 *  与复用（失败重试用同 id ⇒ 表命中 ⇒ 不双扣）。jsdom 自带 sessionStorage（每文件独立）。 */
describe('intentRecord（B1 同批硬约束）', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('newIntentId rotate', () => {
    it('两次调用生成不同 id（新生成点击 ⇒ 新意图照常扣费）', () => {
      const a = newIntentId('p1', 'n1');
      const b = newIntentId('p1', 'n1');
      expect(a).not.toBe(b);
    });

    it('第二次值留存（rotate 后 currentIntentId 读到的是最新）', () => {
      newIntentId('p1', 'n1');
      const b = newIntentId('p1', 'n1');
      expect(sessionStorage.getItem('flowweb:intent:p1:n1')).toBe(b);
      expect(currentIntentId('p1', 'n1')).toBe(b);
    });

    it('不同节点键隔离（同项目异节点不互相覆盖）', () => {
      const a = newIntentId('p1', 'n1');
      const b = newIntentId('p1', 'n2');
      expect(a).not.toBe(b);
      expect(sessionStorage.getItem('flowweb:intent:p1:n1')).toBe(a);
      expect(sessionStorage.getItem('flowweb:intent:p1:n2')).toBe(b);
    });
  });

  describe('currentIntentId 复用', () => {
    it('无记录时生成并留存（惰性初始化）', () => {
      const a = currentIntentId('p1', 'n1');
      expect(a).toBeTruthy();
      expect(sessionStorage.getItem('flowweb:intent:p1:n1')).toBe(a);
    });

    it('有记录时复用同值（失败重试 ⇒ 同 intentId ⇒ 表命中不双扣）', () => {
      const a = currentIntentId('p1', 'n1');
      const b = currentIntentId('p1', 'n1');
      expect(b).toBe(a);
    });
  });
});
