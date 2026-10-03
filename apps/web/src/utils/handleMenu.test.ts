import { describe, it, expect } from 'vitest';
import {
  HANDLE_MENU_NODE_TYPES, DRAG_THRESHOLD_PX,
  shouldOpenHandleMenu, decideHandleMenu, absoluteRectsOf,
  isPointOnAnyNode, handleEdgeId, clientPoint,
} from './handleMenu';

const rects = [{ x: 0, y: 0, w: 200, h: 150 }];

const baseArgs = {
  reconnecting: false,
  isValid: null as boolean | null,
  toHandle: null,
  toNode: null,
  nodeType: 'imageGen',
  isLocked: false,
  dragDistancePx: 30,
  flowPoint: { x: 1000, y: 1000 },
  rects,
  plusZones: [] as Array<{ x: number; y: number; w: number; h: number }>,
};

describe('shouldOpenHandleMenu', () => {
  it('① 空白松手+位移达标+imageGen+未锁 → true', () => {
    expect(shouldOpenHandleMenu(baseArgs)).toBe(true);
  });

  it('①′ imageExtGen 同样放行（两类图片节点拍板）', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, nodeType: 'imageExtGen' })).toBe(true);
  });

  it('② isValid===true → false（正常连线已建边）', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, isValid: true })).toBe(false);
  });

  it('③ toHandle 非 null → false（落在 handle 上，含类型不合法组合）', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, isValid: false, toHandle: { id: 'h' } as any })).toBe(false);
  });

  it('③″ toNode 非 null → false', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, toNode: { id: 'n1' } as any })).toBe(false);
  });

  it('③′ flowPoint 落入节点矩形 → false（节点体命中，guard2 承保）', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, flowPoint: { x: 100, y: 100 } })).toBe(false);
  });

  it('④ reconnecting → false（边端点重连手势）', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, reconnecting: true })).toBe(false);
  });

  it('⑤ 位移 < 5px → false（假拖拽）', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, dragDistancePx: 3 })).toBe(false);
  });

  it('⑥ isLocked → false', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, isLocked: true })).toBe(false);
  });

  it('⑦ 非 imageGen/imageExtGen → false', () => {
    expect(shouldOpenHandleMenu({ ...baseArgs, nodeType: 'videoGen' })).toBe(false);
    expect(shouldOpenHandleMenu({ ...baseArgs, nodeType: undefined })).toBe(false);
  });

  // ── B6-2（Spec B 撞车①c）：源 handle 拖≥5px 落+号命中区 ⇒ 零菜单零连线 ──

  it('⑧ flowPoint 落入+号命中区 → false（+号交互不触发 handle 菜单）', () => {
    const plusZones = [{ x: 900, y: 900, w: 40, h: 56 }];
    expect(shouldOpenHandleMenu({ ...baseArgs, plusZones, flowPoint: { x: 920, y: 920 } })).toBe(false);
    // 区外不受影响——菜单照弹（既有行为）
    expect(shouldOpenHandleMenu({ ...baseArgs, plusZones })).toBe(true);
  });
});

describe('absoluteRectsOf', () => {
  it('顶层节点直接取 position；无尺寸节点跳过', () => {
    const nodes = [
      { id: 'n1', type: 'imageGen', position: { x: 10, y: 20 }, measured: { width: 200, height: 150 } },
      { id: 'n2', type: 'textInput', position: { x: 0, y: 0 } },
    ] as any[];
    expect(absoluteRectsOf(nodes)).toEqual([{ x: 10, y: 20, w: 200, h: 150 }]);
  });

  it('组内子节点沿 parentId 累加祖先 position（分镜组 cell 场景）', () => {
    const nodes = [
      { id: 'g1', type: 'group', position: { x: 500, y: 400 }, width: 600, height: 400 },
      { id: 'cell1', type: 'imageGen', parentId: 'g1', position: { x: 100, y: 50 }, measured: { width: 200, height: 150 } },
    ] as any[];
    // group 被过滤；cell 绝对矩形 = (500+100, 400+50)
    expect(absoluteRectsOf(nodes)).toEqual([{ x: 600, y: 450, w: 200, h: 150 }]);
  });

  it('两级嵌套（祖组→子组→cell）逐级累加；parentId 指向缺失节点时停在该级', () => {
    const nodes = [
      { id: 'g0', type: 'group', position: { x: 10, y: 10 }, width: 800, height: 600 },
      { id: 'g1', type: 'group', parentId: 'g0', position: { x: 500, y: 400 }, width: 600, height: 400 },
      { id: 'cell1', type: 'imageGen', parentId: 'g1', position: { x: 100, y: 50 }, measured: { width: 200, height: 150 } },
      { id: 'orphan', type: 'imageGen', parentId: 'gone', position: { x: 5, y: 6 }, measured: { width: 50, height: 50 } },
    ] as any[];
    expect(absoluteRectsOf(nodes)).toEqual([
      { x: 610, y: 460, w: 200, h: 150 }, // 10+500+100, 10+400+50
      { x: 5, y: 6, w: 50, h: 50 },       // 父缺失 → 相对当绝对
    ]);
  });

  it('循环父链（A→B→A）终止不死循环，seen 防环承保', () => {
    const nodes = [
      { id: 'a', type: 'imageGen', parentId: 'b', position: { x: 1, y: 2 }, measured: { width: 50, height: 50 } },
      { id: 'b', type: 'group', parentId: 'a', position: { x: 10, y: 20 }, width: 100, height: 100 },
    ] as any[];
    // 不断链即通过；期望值不构成语义承诺（环属腐坏数据），只锚"终止且产出矩形"
    const out = absoluteRectsOf(nodes);
    expect(out).toHaveLength(1);
  });

  // ── B6-1（Spec B 终裁 57③）：hidden 子代旧 rect 排除（折叠组区域=空白⇒弹菜单——渲染面≡命中面）──

  it('hidden 节点不产出命中矩形（折叠组内子节点旧 rect 排除）', () => {
    const nodes = [
      { id: 'g1', type: 'group', position: { x: 500, y: 400 }, width: 600, height: 400 },
      { id: 'cell1', type: 'imageGen', parentId: 'g1', position: { x: 100, y: 50 }, measured: { width: 200, height: 150 } },
      { id: 'cell2', type: 'imageGen', parentId: 'g1', hidden: true, position: { x: 200, y: 60 }, measured: { width: 200, height: 150 } },
    ] as any[];
    expect(absoluteRectsOf(nodes)).toEqual([{ x: 600, y: 450, w: 200, h: 150 }]);
  });

  it('尺寸 width 优先于 measured（envelope 尺寸真源——measured 一帧滞后）', () => {
    const nodes = [
      { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, width: 100, height: 80, measured: { width: 222, height: 166 } },
    ] as any[];
    expect(absoluteRectsOf(nodes)).toEqual([{ x: 0, y: 0, w: 100, h: 80 }]);
  });
});

describe('isPointOnAnyNode', () => {
  it('点在矩形内 → true；外 → false；空矩形表 → false', () => {
    expect(isPointOnAnyNode({ x: 199, y: 149 }, rects)).toBe(true);
    expect(isPointOnAnyNode({ x: 201, y: 100 }, rects)).toBe(false);
    expect(isPointOnAnyNode({ x: 0, y: 0 }, [])).toBe(false);
  });
});

describe('decideHandleMenu', () => {
  it('守卫通过 → open + 完整 payload（含 flowPoint 直通）', () => {
    const d = decideHandleMenu({ ...baseArgs, nodeId: 'img1', side: 'source', clientX: 300, clientY: 200 });
    expect(d).toEqual({
      kind: 'open',
      payload: { x: 300, y: 200, nodeId: 'img1', side: 'source', flowPoint: { x: 1000, y: 1000 } },
    });
  });

  it('isValid=true → ignore（正常连线不弹）', () => {
    expect(decideHandleMenu({ ...baseArgs, nodeId: 'img1', side: 'source', clientX: 0, clientY: 0, isValid: true }))
      .toEqual({ kind: 'ignore' });
  });
});

describe('handleEdgeId / clientPoint / 常量出口', () => {
  it('确定性 id 前缀 handle:（不走 auto 通道，spec §2.1）', () => {
    expect(handleEdgeId('a', 'b')).toBe('handle:a:b');
  });
  it('clientPoint 兼容 MouseEvent 与 TouchEvent', () => {
    expect(clientPoint({ clientX: 10, clientY: 20 } as MouseEvent)).toEqual({ x: 10, y: 20 });
    expect(clientPoint({ changedTouches: [{ clientX: 5, clientY: 6 }] } as unknown as TouchEvent)).toEqual({ x: 5, y: 6 });
  });

  // ── B6-1（Spec B 终裁 37⑤）：双指期间松第二指以第二指坐标弹菜单 ──
  // changedTouches 末位=最后落下的指；[0] 在多指齐松/次序落点时会取首指坐标致落点错位。
  it('多指 touchend 取末位 changedTouch（第二指坐标）——单指不受影响', () => {
    expect(clientPoint({
      changedTouches: [
        { clientX: 100, clientY: 200 },
        { clientX: 300, clientY: 400 },
      ],
    } as unknown as TouchEvent)).toEqual({ x: 300, y: 400 });
  });
  it('空 changedTouches 兜底 {0,0}（不抛）', () => {
    expect(clientPoint({ changedTouches: [] } as unknown as TouchEvent)).toEqual({ x: 0, y: 0 });
  });

  // ── B6-1（Spec B 终裁 57①）：DRAG_THRESHOLD_PX 补导出且=B6-3 点击/连线唯一阈值 ──
  it('DRAG_THRESHOLD_PX 导出且值为 5（B6-3 点击/连线唯一阈值）', () => {
    expect(DRAG_THRESHOLD_PX).toBe(5);
  });
  it('HANDLE_MENU_NODE_TYPES 导出（imageGen/imageExtGen 两类）', () => {
    expect(HANDLE_MENU_NODE_TYPES.has('imageGen')).toBe(true);
    expect(HANDLE_MENU_NODE_TYPES.has('imageExtGen')).toBe(true);
    expect(HANDLE_MENU_NODE_TYPES.has('videoGen')).toBe(false);
  });
});
