// packages/shared/src/canvas/order-key.test.ts
// T17（plan v11.2 S5 片·spec Z12''/§2.2）：单一有界 order 键域——自实现分数索引（禁第三方库，
// 方案 A 已裁）的键生成/读侧严格校验/四曲线长度/soft-24·hard-128/等值邻居 needs-layer-repair 单测。
import { describe, it, expect } from 'vitest';
import {
  FIRST_ORDER_KEY, ORDER_KEY_SOFT_LIMIT, ORDER_KEY_HARD_LIMIT, ORDER_KEY_MAX_INT,
  isValidOrderKey, compareOrderKeys, orderKeyAfter, orderKeyBefore, orderKeyBetween,
  equalValueNeighbors, hasDuplicateOrderKeys,
} from './order-key';

describe('order-key 键域合法性（读写两侧严格）', () => {
  it('合法键：正整数（无前导零）+ 可选规范小数尾（无尾零）', () => {
    expect(isValidOrderKey('1')).toBe(true);
    expect(isValidOrderKey('42')).toBe(true);
    expect(isValidOrderKey(String(ORDER_KEY_MAX_INT))).toBe(true);
    expect(isValidOrderKey('5.5')).toBe(true);
    expect(isValidOrderKey('5.505')).toBe(true);
  });
  it('非法键：空/前导零/尾零小数/非数字/越界整数/超 hard 上限', () => {
    expect(isValidOrderKey('')).toBe(false);
    expect(isValidOrderKey('01')).toBe(false);
    expect(isValidOrderKey('0')).toBe(false);           // 键域从 1 起（有界下沿）
    expect(isValidOrderKey('5.')).toBe(false);           // 空小数尾
    expect(isValidOrderKey('5.50')).toBe(false);         // 尾零=非规范形（等值消除）
    expect(isValidOrderKey('5.0')).toBe(false);
    expect(isValidOrderKey('abc')).toBe(false);
    expect(isValidOrderKey('5.5.5')).toBe(false);
    expect(isValidOrderKey('9007199254740993')).toBe(false); // 2^53+1（字面量——String(2**53+1) 浮点舍入不可用）
    expect(isValidOrderKey('1'.padEnd(ORDER_KEY_HARD_LIMIT + 1, '1'))).toBe(false); // 超 hard 128
  });
});

describe('compareOrderKeys 与字符串序解耦（数值序单源）', () => {
  it('整数跨长度序：9 < 10（裸字符串序会得反序——本域判据红线）', () => {
    expect(compareOrderKeys('9', '10')).toBeLessThan(0);
    expect('9' < '10').toBe(false); // 反证裸字符串序不可用（锚定设计动机）
  });
  it('小数尾：5 < 5.5 < 5.55 < 5.6 < 6', () => {
    const seq = ['5', '5.5', '5.55', '5.6', '6'];
    for (let i = 0; i < seq.length - 1; i++) {
      expect(compareOrderKeys(seq[i], seq[i + 1])).toBeLessThan(0);
    }
  });
  it('等值键比较为 0（重复键容忍判定底座）', () => {
    expect(compareOrderKeys('5', '5')).toBe(0);
    expect(compareOrderKeys('5.5', '5.5')).toBe(0);
  });
});

describe('四曲线：分配键恒严格落位（禁越界/禁碰撞）', () => {
  const assertStrictBetween = (a: string | null, m: string, b: string | null) => {
    expect(isValidOrderKey(m)).toBe(true);
    if (a != null) expect(compareOrderKeys(a, m)).toBeLessThan(0);
    if (b != null) expect(compareOrderKeys(m, b)).toBeLessThan(0);
  };

  it('曲线①尾插：after 链 1000 步全严格递增且长度有界（对数增长——非逐次 +1 字符）', () => {
    let k: string | null = FIRST_ORDER_KEY;
    const seen = new Set<string>([k!]);
    for (let i = 0; i < 1000; i++) {
      const next = orderKeyAfter(k!);
      expect(next).not.toBeNull();
      expect(isValidOrderKey(next!)).toBe(true);
      expect(compareOrderKeys(k!, next!)).toBeLessThan(0);
      expect(seen.has(next!)).toBe(false);
      seen.add(next!);
      k = next;
    }
    expect(k!.length).toBeLessThanOrEqual(ORDER_KEY_SOFT_LIMIT); // 1000 次尾插 ≤4 字符
  });

  it('曲线②头插：before 链在软限内全严格递减（floor 返 null）', () => {
    let k = '5000';
    for (let i = 0; i < 24; i++) {
      const prev = orderKeyBefore(k);
      expect(prev).not.toBeNull();
      assertStrictBetween(prev, k, null);
      expect(prev!.length).toBeLessThanOrEqual(ORDER_KEY_SOFT_LIMIT);
      k = prev!;
    }
    // 键域下沿：1 无更小键
    expect(orderKeyBefore('1')).toBeNull();
  });

  it('曲线③④中插：邻键 200 步（左插+右插交替=逐层二分）全严格落位；长度=信息论下界（每步 ~log10(2) 位）', () => {
    let lo: string | null = '1000';
    let hi: string | null = '2000';
    for (let i = 0; i < 200; i++) {
      const m = orderKeyBetween(lo, hi);
      expect(m).not.toBeNull();
      assertStrictBetween(lo, m!, hi);
      if (i % 2 === 0) lo = m!; else hi = m!;
    }
    // 200 次二分需 ~log10(2^200)≈61 位精度——+松弛 ≤80（每步 +1 字符的"病态增长"=200+ 位不复现）
    expect(lo!.length).toBeLessThanOrEqual(80);
    expect(hi!.length).toBeLessThanOrEqual(ORDER_KEY_HARD_LIMIT);
  });

  it('曲线③④（真实形态）：500 次随机点插长度有界（soft 24 内——真实插入形态非纯二分）', () => {
    let seed = 987654321;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const keys: string[] = [FIRST_ORDER_KEY, '999999'];
    for (let i = 0; i < 500; i++) {
      const idx = Math.floor(rand() * (keys.length - 1));
      const m = orderKeyBetween(keys[idx], keys[idx + 1]);
      expect(m).not.toBeNull();
      assertStrictBetween(keys[idx], m!, keys[idx + 1]);
      keys.splice(idx + 1, 0, m!);
    }
    expect(Math.max(...keys.map((k) => k.length))).toBeLessThanOrEqual(ORDER_KEY_SOFT_LIMIT);
  });

  it('between 邻接整数：5 与 6 之间得 5.5；5.5 与 6 之间严格落位', () => {
    expect(orderKeyBetween('5', '6')).toBe('5.5');
    const m = orderKeyBetween('5.5', '6');
    expect(m).not.toBeNull();
    expect(compareOrderKeys('5.5', m!)).toBeLessThan(0);
    expect(compareOrderKeys(m!, '6')).toBeLessThan(0);
  });

  it('between 邻接小数：5.1 与 5.2 之间严格落位（等值邻居唯一例外——同键返 null）', () => {
    const m = orderKeyBetween('5.1', '5.2');
    expect(m).not.toBeNull();
    assertStrictBetween('5.1', m!, '5.2');
    expect(orderKeyBetween('5.5', '5.5')).toBeNull(); // 等值邻居：不可表达——needs-layer-repair 域
  });

  it('between 非法入参（a≥b / 非法键）返 null（fail-closed 非抛）', () => {
    expect(orderKeyBetween('6', '5')).toBeNull();
    expect(orderKeyBetween('bad', '5')).toBeNull();
    expect(orderKeyBetween('5', 'bad')).toBeNull();
    expect(orderKeyAfter('bad')).toBeNull();
    expect(orderKeyBefore('bad')).toBeNull();
  });

  it('after 上沿越界（=MAX_INT）返 null', () => {
    expect(orderKeyAfter(String(ORDER_KEY_MAX_INT))).toBeNull();
  });
});

describe('病理计数底座（soft/hard/等值邻居）', () => {
  it('等值邻居检测：相邻等值对计数（needs-layer-repair 判据）', () => {
    expect(equalValueNeighbors(['1', '2', '2', '3'])).toBe(1);
    expect(equalValueNeighbors(['1', '1', '1'])).toBe(2);
    expect(equalValueNeighbors(['1', '2', '3'])).toBe(0);
    // 非法键行不参与等值判定（读侧全函数）
    expect(equalValueNeighbors(['bad', 'bad', '2'])).toBe(0);
  });
  it('hasDuplicateOrderKeys：重复键容忍标志（(order,id) tie-break 兜底依据）', () => {
    expect(hasDuplicateOrderKeys(['1', '2', '2'])).toBe(true);
    expect(hasDuplicateOrderKeys(['1', '2', '3'])).toBe(false);
    expect(hasDuplicateOrderKeys([])).toBe(false);
  });
});
