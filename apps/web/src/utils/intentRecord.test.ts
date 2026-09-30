import { describe, it, expect, beforeEach } from 'vitest';
import { newIntentId, currentIntentId, intentRotateMessage } from './intentRecord';

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

  /** 批0.5-8c：rotate 值得错误码判定的唯一真相源——改参重试撞旧 intentId（CONTEXT_MISMATCH）
   *  与额度尽（EXHAUSTED）都须 rotate，否则 failed 态持续复用旧 id 死循环。 */
  describe('intentRotateMessage（rotate 值得错误码 → 提示文案）', () => {
    it('INTENT_EXHAUSTED → 额度尽文案（非 undefined 即 rotate）', () => {
      expect(intentRotateMessage('INTENT_EXHAUSTED')).toBe('重试次数已用尽，请重新发起生成');
    });

    it('INTENT_CONTEXT_MISMATCH → 改参重置文案（非 undefined 即 rotate）', () => {
      expect(intentRotateMessage('INTENT_CONTEXT_MISMATCH')).toBe('参数已变更，已重置生成会话，请重新发起');
    });

    it('其他错误码 / undefined → undefined（普通失败不 rotate，复用同 id 重试不双扣）', () => {
      expect(intentRotateMessage(undefined)).toBeUndefined();
      expect(intentRotateMessage('SOME_OTHER_CODE')).toBeUndefined();
    });
  });
});
