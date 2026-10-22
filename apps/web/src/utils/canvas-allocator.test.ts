// apps/web/src/utils/canvas-allocator.test.ts
// T17 红测（G54/:505 G46/:512 G54）：allocator 唯一入口——copy/paste 重新分配 placement/order
// （副本同层同 order 重复键+位置重叠复现=红线）；建点/整理分配；fitOrderBlock 块内 squeeze。
import { describe, it, expect } from 'vitest';
import {
  allocateOrderAfter, createCopyOrderAllocator, nudgeCopiesUntilFree, fitOrderBlock, maxOrderKey,
} from './canvas-allocator';
import { isValidOrderKey, compareOrderKeys } from '@flowweb/shared';
import { buildCopyPlan } from '@flowweb/shared';

const N = (id: string, order: string | null, pos = { x: 0, y: 0 }): any => ({
  id, parentId: null, position: pos, width: 100, height: 80,
  data: order == null ? {} : { order },
});

describe('allocateOrderAfter（建点层尾分配）', () => {
  it('空层首键=FIRST_ORDER_KEY；层尾 after 链恒严格递增零碰撞', () => {
    expect(allocateOrderAfter([], null)).toBe('5000');
    const a = allocateOrderAfter([N('a', '5000')], null);
    expect(compareOrderKeys('5000', a)).toBeLessThan(0);
    const b = allocateOrderAfter([N('a', '5000'), N('b', a)], null);
    expect(compareOrderKeys(a, b)).toBeLessThan(0);
    // 非法/缺 order 键成员不参与层尾判定（全缺层=空层首键）
    expect(allocateOrderAfter([N('x', null), N('bad', 'zz' as any)], null)).toBe('5000');
  });
  it('层域隔离：同 order 键在不同层互不干扰（D5 层内生效）', () => {
    const nodes = [N('root1', '5000'), { ...N('child1', '5000'), parentId: 'g' }];
    expect(maxOrderKey(nodes, null)).toBe('5000');
    expect(maxOrderKey(nodes, 'g')).toBe('5000');
  });
});

describe('createCopyOrderAllocator + buildCopyPlan（G54 副本重复键红线）', () => {
  it('red→green：副本不继承源 order 键——根层副本对既有层尾 after（同层零碰撞）', () => {
    const records = [N('n1', '5000', { x: 0, y: 0 }), N('n2', '5001', { x: 200, y: 0 })];
    const existing = [N('n1', '5000'), N('n2', '5001')];
    const plan = buildCopyPlan(
      records, ['n1', 'n2'], { offset: { x: 40, y: 0 } }, () => 'copy',
      [], createCopyOrderAllocator(existing),
    );
    const copyOrders = plan.copies.map((c) => (c.data as any).order as string);
    // 副本键合法且严格递增（副本间零碰撞）
    for (const k of copyOrders) expect(isValidOrderKey(k)).toBe(true);
    expect(compareOrderKeys(copyOrders[0], copyOrders[1])).toBeLessThan(0);
    // 与既有层键零等值（副本同层同 order 重复键红线——全部 > 层尾 5001）
    for (const k of copyOrders) expect(compareOrderKeys(k, '5001')).toBeGreaterThan(0);
    // 源键不被携带（5000/5001 不出现在副本键中）
    expect(copyOrders).not.toContain('5000');
    expect(copyOrders).not.toContain('5001');
  });
  it('未传 allocator（缺省）：副本无 order 键（order 删——分配责任归 allocator 唯一入口）', () => {
    const records = [N('n1', '5000')];
    const plan = buildCopyPlan(records, ['n1'], { offset: { x: 40, y: 0 } }, () => 'c');
    expect((plan.copies[0].data as any).order).toBeUndefined();
  });
});

describe('nudgeCopiesUntilFree（粘贴位置重叠红线）', () => {
  const rect = (x: number, y: number) => ({ position: { x, y }, width: 100, height: 80 });
  it('粘贴落点与既有节点重叠 ⇒ 整体步进平移到零相交；无重叠原样', () => {
    const copies = [rect(0, 0), rect(120, 0)];
    const out = nudgeCopiesUntilFree(copies, [rect(20, 10)]);
    expect(out[0].position.x).toBeGreaterThan(0);
    // 副本内部相对布局保真（整体平移）
    expect(out[1].position.x - out[0].position.x).toBe(120);
    const free = nudgeCopiesUntilFree(copies, [rect(1000, 1000)]);
    expect(free[0].position).toEqual({ x: 0, y: 0 });
  });
});

describe('fitOrderBlock（arrange 后层序回写——「拖序不持久」红线的 order 面）', () => {
  it('按 laid 序重排：块内键严格递增、首键继承原块最小键、非参与 ceiling 不越', () => {
    // 层：a(5000) b(5001) c(5002) + 非参与 z(6000)。arrange 新序 c,b,a
    const layer = [N('a', '5000'), N('b', '5001'), N('c', '5002'), N('z', '6000')];
    const m = fitOrderBlock(layer, ['c', 'b', 'a']);
    const [kc, kb, ka] = [m.get('c')!, m.get('b')!, m.get('a')!];
    expect(kc).toBe('5000');                                  // 首键继承
    expect(compareOrderKeys(kc, kb)).toBeLessThan(0);
    expect(compareOrderCodesSafe(kb, ka)).toBeLessThan(0);
    for (const k of [kc, kb, ka]) {
      expect(isValidOrderKey(k)).toBe(true);
      expect(compareOrderKeys(k, '6000')).toBeLessThan(0);    // 不越非参与上邻
    }
  });
  it('无上邻（ceiling=null）：块内 after 链递进', () => {
    const layer = [N('a', '5000'), N('b', '5001')];
    const m = fitOrderBlock(layer, ['b', 'a']);
    expect(compareOrderKeys(m.get('b')!, m.get('a')!)).toBeLessThan(0);
  });
  it('块内键饱和（ceiling 邻接）squeeze：between 折半可用则不撞 ceiling', () => {
    // 块 [5000,5001] 重排为逆序，上邻 5002：b=5000、a 需落 (5000, 5002)
    const layer = [N('a', '5000'), N('b', '5001'), N('z', '5002')];
    const m = fitOrderBlock(layer, ['b', 'a']);
    expect(m.get('b')).toBe('5000');
    expect(compareOrderKeys('5000', m.get('a')!)).toBeLessThan(0);
    expect(compareOrderKeys(m.get('a')!, '5002')).toBeLessThan(0);
  });
});

const compareOrderCodesSafe = compareOrderKeys;
