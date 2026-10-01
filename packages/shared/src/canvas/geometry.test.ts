// packages/shared/src/canvas/geometry.test.ts
import { describe, it, expect } from 'vitest';
import {
  refitGroupGeometry, shouldAutoRefit, COLLAPSED_SIZE, DEFAULT_CHILD_SIZE,
  GROUP_PADDING, GROUP_PADDING_TOP, clampChildIntoGroup, clampPositionToPadding,
} from './geometry';

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
