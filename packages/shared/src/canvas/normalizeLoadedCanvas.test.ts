import { describe, it, expect } from 'vitest';
import { normalizeLoadedCanvas } from './normalizeLoadedCanvas';
import { COLLAPSED_SIZE, GROUP_PADDING, GROUP_PADDING_TOP, calcGroupBounds, calcStoryboardSize, calcDefaultGrid, DEFAULT_CHILD_SIZE } from './geometry';

describe('normalizeLoadedCanvas（加载几何兜底——守恒归位，与 refitGroupGeometry 同法律）', () => {
  // 非空断言统一收口（I1：find 返回 T | undefined 的 13 处 TS2532/TS18048——助手一处断言，风格同 childAbs）
  const byId = (arr: any[], id: string) => arr.find((n) => n.id === id)!;
  const childAbs = (out: any[], childId: string, groupId: string) => {
    const c = byId(out, childId);
    const g = byId(out, groupId);
    return { x: c.position.x + g.position.x, y: c.position.y + g.position.y };
  };

  it('normal 组缺宽高 → 守恒归位四法律（组原点非零夹具）', () => {
    const records: any[] = [
      { id: 'g1', type: 'group', position: { x: 100, y: 100 }, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 5, y: 5 }, width: 100, height: 60, data: {} },
    ];
    const childrenAbs = [{ x: 105, y: 105, width: 100, height: 60 }];
    const out = normalizeLoadedCanvas(records);
    const g = byId(out, 'g1');
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
    const c = byId(out, 'c1');
    expect(c.position.x).toBeGreaterThanOrEqual(GROUP_PADDING);
    expect(c.position.y).toBeGreaterThanOrEqual(GROUP_PADDING_TOP);
  });

  it('storyboard 组缺几何 → calcStoryboardSize(resolved cfg)；缺 storyboard 键按 calcDefaultGrid(cells.length) 派生（v5：与建组方 mergeStoryboard/convertGroup 同语义——1×1 回落与 calcDefaultGrid(4)=2×2 会给同一数据两种尺寸）', () => {
    const out = normalizeLoadedCanvas([
      { id: 's1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false, stitchResolution: '2K' }, cells: [] } } as any,
    ]);
    const s = byId(out, 's1');
    expect(s.width).toBe(calcStoryboardSize(2, 2, '16:9').width);   // 纯函数期望
    // 无 storyboard 键：4 cells → calcDefaultGrid(4) = 2×2
    const out2 = normalizeLoadedCanvas([
      { id: 's2', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: ['a', 'b', 'c', 'd'] } } as any,
    ]);
    const s2 = byId(out2, 's2');
    expect(s2.width).toBe(calcStoryboardSize(calcDefaultGrid(4).rows, calcDefaultGrid(4).cols, '16:9').width);
  });

  it('守卫（v3 补回——现状 useCanvasPersistence:60-77 有，丢失是回归；R2d-1 语义迁移）：展开组 savedSize 用 savedSize（equivalence 档——无 manuallyResized 也读）；collapsed 用 COLLAPSED_SIZE（collapsed 判定恒优先）', () => {
    const out = normalizeLoadedCanvas([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal', manuallyResized: true, savedSize: { width: 480, height: 320 } } },
      { id: 'g2', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal', collapsed: true } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, data: {} },
    ] as any);
    expect(byId(out, 'g1').width).toBe(480);   // savedSize 赢，不 refit
    expect(byId(out, 'g2').width).toBe(COLLAPSED_SIZE.width);
  });

  it('非组/有几何组零改变；子缺几何用 DEFAULT_CHILD_SIZE 基准；空组缺几何 → COLLAPSED_SIZE 堵洞（R2d-1 迁移——旧"无子组不动"给无几何组留洞，v2.2 信封恒等可见盒不造 0×0 也不留无几何形态）', () => {
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
    expect(byId(out, 'g2').width).toBe(expectFrame.width);
    expect(byId(out, 'g2').height).toBe(expectFrame.height);
    expect(out[3]).toEqual(records[3]);
    expect(byId(out, 'gEmpty').width).toBe(COLLAPSED_SIZE.width);    // 空组堵洞档
    expect(byId(out, 'gEmpty').height).toBe(COLLAPSED_SIZE.height);
    expect(byId(out, 'gEmpty').position).toEqual({ x: 50, y: 50 });  // 无 origin——位置不动
  });

  it('R2d-1 collapsed 判定优先：折叠 normal 组带脏 savedSize → 信封恒 COLLAPSED_SIZE（旧序手动分支会把脏 savedSize 反写进折叠组信封——洞）', () => {
    const out = normalizeLoadedCanvas([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal', collapsed: true, manuallyResized: true, savedSize: { width: 480, height: 320 } } },
    ] as any);
    expect(byId(out, 'g1').width).toBe(COLLAPSED_SIZE.width);
    expect(byId(out, 'g1').height).toBe(COLLAPSED_SIZE.height);
  });

  it('R2d-1 savedSize 存在 ⟺ collapsed：展开组带杂散 savedSize（异常路径）→ 加载边界删键（有几何时只删键不动信封）', () => {
    const records: any[] = [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 200, data: { groupType: 'normal', savedSize: { width: 480, height: 320 } } },
    ] as any;
    const out = normalizeLoadedCanvas(records);
    const g = byId(out, 'g1');
    expect('savedSize' in (g.data as Record<string, unknown>)).toBe(false);
    expect(g.width).toBe(300);   // 信封一字不改
    expect(g.height).toBe(200);
  });

  it('R2d-1 分镜组脏数据加载自愈：杂散 collapsed/savedSize（信封已被折成 220×160）→ 剥 collapsed/savedSize 键 + 信封经 resolveExpandedFrame 取配置尺寸——修复分支置于几何早退之前（有几何的脏组必修复）', () => {
    const expectSize = calcStoryboardSize(1, 2, '16:9');
    const out = normalizeLoadedCanvas([
      { id: 's1', type: 'group', position: { x: 500, y: 500 }, width: 220, height: 160,
        data: { groupType: 'storyboard', collapsed: true, savedSize: { width: 220, height: 160 },
                storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: false, stitchResolution: '2K' }, cells: ['c1', 'c2'] } },
    ] as any);
    const s = byId(out, 's1');
    const d = s.data as Record<string, unknown>;
    expect('collapsed' in d).toBe(false);    // 剥键
    expect('savedSize' in d).toBe(false);
    expect(d.groupType).toBe('storyboard');  // 其余键保留
    expect((d.cells as string[]).length).toBe(2);
    expect(s.width).toBe(expectSize.width);  // 信封修复（配置尺寸——storyboard 堵洞档单源）
    expect(s.height).toBe(expectSize.height);
    expect(s.position).toEqual({ x: 500, y: 500 });   // 位置不动
  });

  it('manuallyResized 但无 savedSize（v5 C3——不可达形态但堵洞）：忽略标志按派生处理', () => {
    const out = normalizeLoadedCanvas([
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal', manuallyResized: true } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 5, y: 5 }, width: 100, height: 60, data: {} },
    ] as any);
    const expectFrame = calcGroupBounds([{ x: 5, y: 5, width: 100, height: 60 }]);
    const g = byId(out, 'g1');
    expect(g.width).toBe(expectFrame.width);   // 不留"无几何组"形态
  });
});
