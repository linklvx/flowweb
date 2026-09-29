import { describe, it, expect } from 'vitest';
import { normalizeLoadedCanvas } from './normalizeLoadedCanvas';
import { COLLAPSED_SIZE, GROUP_PADDING, GROUP_PADDING_TOP, calcGroupBounds, calcStoryboardSize, calcDefaultGrid, DEFAULT_CHILD_SIZE } from './geometry';

describe('normalizeLoadedCanvas（加载几何兜底——守恒归位，与 refitGroupGeometry 同法律）', () => {
  const childAbs = (out: any[], childId: string, groupId: string) => {
    const c = out.find((n) => n.id === childId);
    const g = out.find((n) => n.id === groupId);
    return { x: c.position.x + g.position.x, y: c.position.y + g.position.y };
  };

  it('normal 组缺宽高 → 守恒归位四法律（组原点非零夹具）', () => {
    const records: any[] = [
      { id: 'g1', type: 'group', position: { x: 100, y: 100 }, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 5, y: 5 }, width: 100, height: 60, data: {} },
    ];
    const childrenAbs = [{ x: 105, y: 105, width: 100, height: 60 }];
    const out = normalizeLoadedCanvas(records);
    const g = out.find((n) => n.id === 'g1');
    // 法律① frame ≡ calcGroupBounds(childrenAbs)——期望值来自纯函数，非手算
    const expectFrame = calcGroupBounds(childrenAbs);
    expect({ x: g.position.x, y: g.position.y, width: g.width, height: g.height }).toEqual(expectFrame);
    // 法律② 守恒：子绝对坐标不变
    expect(childAbs(out, 'c1', 'g1')).toEqual({ x: 105, y: 105 });
    // 法律③ 幂等：f(f(x)) ≡ f(x)（v5 说明：第二跑因 g1 已有几何走早退返回原引用——本断言锁"输出已满足
    // 不变量（再跑不改）"，强证明在法律① 的 calcGroupBounds 期望上，此条是回归锚）
    const twice = normalizeLoadedCanvas(out);
    expect(twice.find((n: any) => n.id === 'g1')).toEqual(g);
    expect(twice.find((n: any) => n.id === 'c1')).toEqual(out.find((n) => n.id === 'c1'));
    // 法律④ 界：rel.x ≥ GROUP_PADDING && rel.y ≥ GROUP_PADDING_TOP（clamp 推翻后的行为锚）
    const c = out.find((n) => n.id === 'c1');
    expect(c.position.x).toBeGreaterThanOrEqual(GROUP_PADDING);
    expect(c.position.y).toBeGreaterThanOrEqual(GROUP_PADDING_TOP);
  });

  it('storyboard 组缺几何 → calcStoryboardSize(resolved cfg)；缺 storyboard 键按 calcDefaultGrid(cells.length) 派生（v5：与建组方 mergeStoryboard/convertGroup 同语义——1×1 回落与 calcDefaultGrid(4)=2×2 会给同一数据两种尺寸）', () => {
    const out = normalizeLoadedCanvas([
      { id: 's1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false, stitchResolution: '2K' }, cells: [] } } as any,
    ]);
    const s = out.find((n: any) => n.id === 's1');
    expect(s.width).toBe(calcStoryboardSize(2, 2, '16:9').width);   // 纯函数期望
    // 无 storyboard 键：4 cells → calcDefaultGrid(4) = 2×2
    const out2 = normalizeLoadedCanvas([
      { id: 's2', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: ['a', 'b', 'c', 'd'] } } as any,
    ]);
    const s2 = out2.find((n: any) => n.id === 's2');
    expect(s2.width).toBe(calcStoryboardSize(calcDefaultGrid(4).rows, calcDefaultGrid(4).cols, '16:9').width);
  });

  it('守卫（v3 补回——现状 useCanvasPersistence:60-77 有，丢失是回归）：manuallyResized+savedSize 用 savedSize；collapsed 用 COLLAPSED_SIZE', () => {
    const out = normalizeLoadedCanvas([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal', manuallyResized: true, savedSize: { width: 480, height: 320 } } },
      { id: 'g2', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal', collapsed: true } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: {} },
    ] as any);
    expect(out.find((n: any) => n.id === 'g1').width).toBe(480);   // savedSize 赢，不 refit
    expect(out.find((n: any) => n.id === 'g2').width).toBe(COLLAPSED_SIZE.width);
  });

  it('非组/有几何组/真无子组零改变；子缺几何用 DEFAULT_CHILD_SIZE 基准（v5：期望改纯函数；补真·无子组夹具——v4 该用例名写"无子组零改变"却无此夹具，children.length===0 分支零覆盖）', () => {
    const records: any[] = [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 10, height: 10, data: { groupType: 'normal' } },
      { id: 'g2', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g2', position: { x: 0, y: 0 }, data: {} },
      { id: 'n1', type: 'textInput', position: { x: 99, y: 99 }, data: {} },
      { id: 'gEmpty', type: 'group', position: { x: 50, y: 50 }, data: { groupType: 'normal' } },   // 真·无子组
    ];
    const out = normalizeLoadedCanvas(records);
    expect(out[0]).toEqual(records[0]);
    const expectFrame = calcGroupBounds([{ x: 0, y: 0, width: DEFAULT_CHILD_SIZE.width, height: DEFAULT_CHILD_SIZE.height }]);
    expect(out.find((n: any) => n.id === 'g2').width).toBe(expectFrame.width);
    expect(out.find((n: any) => n.id === 'g2').height).toBe(expectFrame.height);
    expect(out[3]).toEqual(records[3]);
    expect(out.find((n: any) => n.id === 'gEmpty')).toEqual(records[4]);   // 无子组不动
  });

  it('manuallyResized 但无 savedSize（v5 C3——不可达形态但堵洞）：忽略标志按派生处理', () => {
    const out = normalizeLoadedCanvas([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal', manuallyResized: true } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 5, y: 5 }, width: 100, height: 60, data: {} },
    ] as any);
    const expectFrame = calcGroupBounds([{ x: 5, y: 5, width: 100, height: 60 }]);
    const g = out.find((n: any) => n.id === 'g1');
    expect(g.width).toBe(expectFrame.width);   // 不留"无几何组"形态
  });
});
