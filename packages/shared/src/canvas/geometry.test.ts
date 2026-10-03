// packages/shared/src/canvas/geometry.test.ts
import { describe, it, expect } from 'vitest';
import {
  refitGroupGeometry, shouldAutoRefit, COLLAPSED_SIZE, DEFAULT_CHILD_SIZE,
  GROUP_PADDING, GROUP_PADDING_TOP, clampChildIntoGroup, clampPositionToPadding,
  deriveGroupFrame, calcGroupBounds, calcStoryboardSize,
} from './geometry';
import { resolveStoryboardConfig } from './storyboardConfig';

const rect = (x: number, y: number, width = 100, height = 60) => ({ x, y, width, height });

describe('refitGroupGeometry（契约 2 v11 绝对 rect——守恒，无 clamp）', () => {
  it('bbox(子)+padding == frame（双侧非对称 padding：上 50/余 20）；rel = abs − frame.origin；子绝对坐标守恒', () => {
    const children = [rect(120, 150), rect(300, 260, 80, 90), rect(150, 170, 40, 30)];
    const { frame, rels } = refitGroupGeometry(children);
    expect(frame).toEqual({ x: 120 - GROUP_PADDING, y: 150 - GROUP_PADDING_TOP,
      width: 300 + 80 + GROUP_PADDING - (120 - GROUP_PADDING), height: 260 + 90 + GROUP_PADDING - (150 - GROUP_PADDING_TOP) });
    children.forEach((c, i) => {
      expect(rels[i].x + frame.x).toBe(c.x);
      expect(rels[i].y + frame.y).toBe(c.y);
    });
  });

  it('min(rel) ≠ padding 的分布（F33 缺陷形态）守恒仍成立', () => {
    const children = [rect(0, 0), rect(200, 200)];
    const { frame, rels } = refitGroupGeometry(children);
    children.forEach((c, i) => {
      expect(rels[i].x + frame.x).toBe(c.x);
      expect(rels[i].y + frame.y).toBe(c.y);
    });
  });

  it('幂等 + N5 构造保证：rel.y ≥ GROUP_PADDING_TOP、rel.x ≥ GROUP_PADDING 恒成立（clamp 推翻后的行为锚。注：同输入两次调用是确定性断言——真复合幂等 f(f(x))=f(x) 的证明在 Task 18 applyGroupFrame 二次 no-op 用例（store 层），此处是回归锚）', () => {
    const children = [rect(50, 80), rect(260, 190, 120, 70)];
    const once = refitGroupGeometry(children);
    const twice = refitGroupGeometry(children);
    expect(twice.frame).toEqual(once.frame);
    expect(twice.rels).toEqual(once.rels);
    expect(once.rels.every((r) => r.y >= GROUP_PADDING_TOP && r.x >= GROUP_PADDING)).toBe(true);
  });

  it('小数坐标守恒（v3 补——RF 拖拽产小数，浮点还原是乒乓风险面）', () => {
    const children = [rect(100.3, 200.7), rect(250.1, 310.9, 99.6, 59.4)];
    const { frame, rels } = refitGroupGeometry(children);
    children.forEach((c, i) => {
      expect(Math.abs(rels[i].x + frame.x - c.x)).toBeLessThan(1e-9);
      expect(Math.abs(rels[i].y + frame.y - c.y)).toBeLessThan(1e-9);
    });
  });
});

describe('shouldAutoRefit（契约 2 scope 门禁）', () => {
  it('normal 展开 → true；storyboard/collapsed/manuallyResized/非组 → false', () => {
    expect(shouldAutoRefit({ type: 'group', data: { groupType: 'normal' } })).toBe(true);
    expect(shouldAutoRefit({ type: 'group', data: { groupType: 'storyboard' } })).toBe(false);
    expect(shouldAutoRefit({ type: 'group', data: { groupType: 'normal', collapsed: true } })).toBe(false);
    expect(shouldAutoRefit({ type: 'group', data: { groupType: 'normal', manuallyResized: true } })).toBe(false);
    expect(shouldAutoRefit({ type: 'imageGen', data: {} })).toBe(false);
  });
});

describe('clampChildIntoGroup（v6——Task 14 拖拽期/Task 18 placement 共享守卫）', () => {
  const child = { width: 100, height: 50 };

  it('组宽/高任一 null → 原 rel 原样返回（同引用，不夹）', () => {
    const rel = { x: 7, y: 9 };
    expect(clampChildIntoGroup(rel, child, { width: null, height: 300 })).toBe(rel);
    expect(clampChildIntoGroup(rel, child, { width: 400, height: null })).toBe(rel);
  });

  it('组比 padding+子还小（xMax < GROUP_PADDING）→ 原 rel 原样（防负坐标钉死）', () => {
    const rel = { x: 7, y: 9 };
    // 界：groupSize.width == GROUP_PADDING*2 + child.width 时 xMax == GROUP_PADDING；再小 1 退化
    const groupSize = { width: GROUP_PADDING * 2 + child.width - 1, height: 300 };
    expect(clampChildIntoGroup(rel, child, groupSize)).toBe(rel);
  });

  it('yMax < GROUP_PADDING_TOP 退化 → 原 rel 原样', () => {
    const rel = { x: 7, y: 9 };
    const groupSize = { width: 400, height: GROUP_PADDING_TOP + GROUP_PADDING + child.height - 1 };
    expect(clampChildIntoGroup(rel, child, groupSize)).toBe(rel);
  });

  it('恰等于界（xMax==GROUP_PADDING / yMax==GROUP_PADDING_TOP）→ 夹到界', () => {
    const groupSize = {
      width: GROUP_PADDING * 2 + child.width,
      height: GROUP_PADDING_TOP + GROUP_PADDING + child.height,
    };
    expect(clampChildIntoGroup({ x: -5, y: -5 }, child, groupSize))
      .toEqual({ x: GROUP_PADDING, y: GROUP_PADDING_TOP });
  });

  it('正常情形 → 与 clampPositionToPadding 同构', () => {
    const groupSize = { width: 400, height: 300 };
    const rel = { x: 500, y: 400 };
    expect(clampChildIntoGroup(rel, child, groupSize))
      .toEqual(clampPositionToPadding(rel, child, groupSize));
  });
});

describe('单源常量锚（新建——现状散布内联的契约面）', () => {
  it('DEFAULT_CHILD_SIZE = 280×120（六处内联 ?? 280/?? 120 的单源）', () => {
    expect(DEFAULT_CHILD_SIZE).toEqual({ width: 280, height: 120 });
  });
  it('COLLAPSED_SIZE = 220×160（R2d-2 改值；原 canvasStore:1264 与 NormalGroupRenderer:44 两处内联 200×64 的单源）', () => {
    expect(COLLAPSED_SIZE).toEqual({ width: 220, height: 160 });
  });
});

// ════════ O0b-1（Spec B）：deriveGroupFrame 写域①四模式单源 ════════
// 帧装配算术实现点=1（calcGroupBounds——禁本函数自写 padding 公式成第二实现）；
// mode oracle=frameMode(doc storedFrame)——禁 cs 派生帧当 storedFrame（终裁 44，auto 防死锁）；
// collapsed（非 storyboard）⇒COLLAPSED_SIZE 档、优先级最高（终裁 82——doc 三键保持展开态值不动）。
describe('deriveGroupFrame（O0b-1 写域①四模式单源——reconcile 与后续消费共用）', () => {
  it('storyboard 档：尺寸=calcStoryboardSize（resolveStoryboardConfig 单源，无 padding）；origin=帧 position 键', () => {
    const cfg = resolveStoryboardConfig({ storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2 } });
    const size = calcStoryboardSize(cfg.gridRows, cfg.gridCols, cfg.aspectRatio);
    const frame = deriveGroupFrame({
      data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2 } },
      childrenAbs: [],
      storedFrame: { position: { x: 30, y: 40 } },
    });
    expect(frame).toEqual({ x: 30, y: 40, width: size.width, height: size.height });
  });

  it('collapsed（非 storyboard）优先级最高：manual 密封 origin+COLLAPSED_SIZE 覆写——storedFrame wh 不被消费（终裁 82）', () => {
    const frame = deriveGroupFrame({
      data: { groupType: 'normal', collapsed: true },
      childrenAbs: [{ x: 120, y: 80, width: 100, height: 60 }],
      storedFrame: { position: { x: 100, y: 50 }, width: 400, height: 300 },
    });
    expect(frame).toEqual({ x: 100, y: 50, width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height });
  });

  it('collapsed auto（doc 0 帧键）：origin 照旧 bbox 派生（calcGroupBounds）+COLLAPSED_SIZE 覆写', () => {
    const b = calcGroupBounds([{ x: 500, y: 300, width: 200, height: 100 }]);
    const frame = deriveGroupFrame({
      data: { groupType: 'normal', collapsed: true },
      childrenAbs: [{ x: 500, y: 300, width: 200, height: 100 }],
      storedFrame: {},
    });
    expect(frame).toEqual({ x: b.x, y: b.y, width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height });
  });

  it('manual 档：storedFrame 三键密封输出；liveFrame（cs 活值——source:\'cs\' 命令中间态）优先', () => {
    const docFrame = deriveGroupFrame({
      data: { groupType: 'normal' },
      childrenAbs: [],
      storedFrame: { position: { x: 100, y: 50 }, width: 400, height: 300 },
    });
    expect(docFrame).toEqual({ x: 100, y: 50, width: 400, height: 300 });
    const liveFrame = deriveGroupFrame({
      data: { groupType: 'normal' },
      childrenAbs: [],
      storedFrame: { position: { x: 100, y: 50 }, width: 400, height: 300 },
      liveFrame: { position: { x: 7, y: 8 }, width: 91, height: 82 },
    });
    expect(liveFrame).toEqual({ x: 7, y: 8, width: 91, height: 82 });
  });

  it('auto 档：帧=calcGroupBounds(childrenAbs)；liveFrame 不参与 auto（恒派生——liveFrame 只被 manual/storyboard 值面消费）', () => {
    const b = calcGroupBounds([
      { x: 300, y: 100, width: 200, height: 100 },
      { x: 550, y: 100, width: 150, height: 80 },
    ]);
    const frame = deriveGroupFrame({
      data: { groupType: 'normal' },
      childrenAbs: [
        { x: 300, y: 100, width: 200, height: 100 },
        { x: 550, y: 100, width: 150, height: 80 },
      ],
      storedFrame: {},
      liveFrame: { position: { x: 999, y: 999 }, width: 1, height: 1 },
    });
    expect(frame).toEqual({ x: b.x, y: b.y, width: b.width, height: b.height });
  });

  it('空 auto 组→COLLAPSED_SIZE@fallbackOrigin（assertEmptyAutoGroupCollapsedSize 同口径）', () => {
    const frame = deriveGroupFrame({
      data: { groupType: 'normal' },
      childrenAbs: [],
      storedFrame: {},
      fallbackOrigin: { x: 12, y: 34 },
    });
    expect(frame).toEqual({ x: 12, y: 34, width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height });
  });
});
