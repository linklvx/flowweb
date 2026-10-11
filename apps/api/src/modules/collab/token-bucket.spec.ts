// apps/api/src/modules/collab/token-bucket.spec.ts
// Y0b-4 T6：consume(key,cost) 按量扣减+delete(key)（spec 扩两用例——红门⑧ 前置件）。
// 红相：改前 consume 无 cost 参数（第二参被忽略——按量扣减断言必红）+无 delete 方法（TypeError）。
import { describe, it, expect } from 'vitest';
import { TokenBucket } from './token-bucket';

describe('Y0b-4 T6 TokenBucket consume(cost) 按量扣减+delete', () => {
  it('cost 按量扣减：容量 600 桶 consume 350×2 → 第二次 false（600-350=250<350）', () => {
    const b = new TokenBucket({ capacity: 600, refillPerMin: 0 });
    expect(b.consume('k', 350)).toBe(true);    // 600→250
    expect(b.consume('k', 350)).toBe(false);   // 250<350——按量判（cost=1 形态下第二次恒 true，红相锚）
  });

  it('失败保留积分（cost 同构）：350 失败后 tokens 仍 ~250——consume 250 成功（非 250-350=-100 深负）', () => {
    const b = new TokenBucket({ capacity: 600, refillPerMin: 0 });
    b.consume('k', 350);
    expect(b.consume('k', 350)).toBe(false);   // 失败尝试——积分保留
    expect(b.consume('k', 250)).toBe(true);    // 250≥250——若失败也扣 cost 则此处 false（深负桶红相）
  });

  it('delete(key)：清理后满桶重生（重连重置语义——断连循环刷桶的 DoS 兜底）', () => {
    const b = new TokenBucket({ capacity: 10, refillPerMin: 0 });
    expect(b.consume('k', 10)).toBe(true);     // 排空
    expect(b.consume('k', 1)).toBe(false);
    b.delete('k');
    expect(b.consume('k', 10)).toBe(true);     // 新键首试=capacity（满桶重生）
  });

  it('cost>capacity 结构性恒 false（报告1 P0-2 防复发：Math.min(capacity) 封顶 ⇒ tokens≤capacity<cost）', () => {
    const b = new TokenBucket({ capacity: 1000, refillPerMin: 1e9 });   // 极速补充也救不了——结构性
    expect(b.consume('k', 1001)).toBe(false);
    expect(b.consume('k', 1001)).toBe(false);   // 重试同 false（失败保留积分下 tokens 恒 ≤capacity）
  });

  it('默认 cost=1：既有两调用（upgrade 桶/upstream）零改动兼容', () => {
    const b = new TokenBucket({ capacity: 2, refillPerMin: 0 });
    expect(b.consume('k')).toBe(true);
    expect(b.consume('k')).toBe(true);
    expect(b.consume('k')).toBe(false);
  });
});
