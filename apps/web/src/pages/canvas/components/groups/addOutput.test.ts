// apps/web/src/pages/canvas/components/groups/addOutput.test.ts
// B6-2（Spec B 需求 6 / 撞车② B 案）纯函数面：+号显隐单源 resolveAddOutputTarget /
// 锚框 addOutputFrameFlow（rect 读 cs——v3.16 终裁 57②）/ 源集展开 addOutputSourceIds /
// 命中区流坐标换算 addOutputHitZoneFlow / 松手落点 resolveBatchDropTarget。
import { describe, it, expect } from 'vitest';
import {
  resolveAddOutputTarget, addOutputFrameFlow, addOutputSourceIds,
  addOutputHitZoneFlow, resolveBatchDropTarget, decideBatchGestureEnd,
} from './addOutput';
import { ADD_OUTPUT_HANDLE } from './selectionTokens';

type N = any;
const node = (o: Partial<N>): N => ({ data: {}, position: { x: 0, y: 0 }, ...o });

const EDIT = { marqueeSelecting: false, canEdit: true } as const;

describe('resolveAddOutputTarget（显隐单源——组件渲染与 handle 菜单 ignore 区共用）', () => {
  const g = (over: Partial<N> = {}) => node({ id: 'g', type: 'group', selected: true, width: 300, height: 200, ...over });

  it('多选 ≥2 → selection（ids=可见选中集，hidden 排除）', () => {
    const nodes = [
      node({ id: 'a', type: 'imageGen', selected: true }),
      node({ id: 'b', type: 'imageGen', selected: true }),
      node({ id: 'h', type: 'imageGen', selected: true, hidden: true }),
      node({ id: 'c', type: 'imageGen' }),
    ];
    expect(resolveAddOutputTarget(nodes, EDIT)).toEqual({ kind: 'selection', ids: ['a', 'b'] });
  });

  it('选中数 <2 且无组 → null；未选 → null', () => {
    expect(resolveAddOutputTarget([node({ id: 'a', type: 'imageGen', selected: true })], EDIT)).toBeNull();
    expect(resolveAddOutputTarget([node({ id: 'a', type: 'imageGen' })], EDIT)).toBeNull();
  });

  it('普通组单选未折叠 → group', () => {
    expect(resolveAddOutputTarget([g()], EDIT)).toEqual({ kind: 'group', id: 'g' });
  });

  it('折叠组（data.collapsed）→ null；localCollapsed override 两档（true 盖 data.false / undefined 回落 data）', () => {
    expect(resolveAddOutputTarget([g({ data: { collapsed: true } })], EDIT)).toBeNull();
    const open = g({ data: { collapsed: false } });
    expect(resolveAddOutputTarget([open], { ...EDIT, localCollapsed: { g: true } })).toBeNull();
    expect(resolveAddOutputTarget([open], { ...EDIT, localCollapsed: { g: undefined } })).toEqual({ kind: 'group', id: 'g' });
  });

  it('分镜组 → null（GroupNode:43 前提——分镜分支无 +号）', () => {
    expect(resolveAddOutputTarget([g({ data: { groupType: 'storyboard' } })], EDIT)).toBeNull();
  });

  it('marquee 进行中 → null（框选拖拽期隐藏——SelectionBoxOverlay 同机制）', () => {
    const nodes = [node({ id: 'a', type: 'imageGen', selected: true }), node({ id: 'b', type: 'imageGen', selected: true })];
    expect(resolveAddOutputTarget(nodes, { marqueeSelecting: true, canEdit: true })).toBeNull();
  });

  it('!canEdit → null（口径 26——viewer 下渲染必被 dispatch 静默拦）', () => {
    const nodes = [node({ id: 'a', type: 'imageGen', selected: true }), node({ id: 'b', type: 'imageGen', selected: true })];
    expect(resolveAddOutputTarget(nodes, { marqueeSelecting: false, canEdit: false })).toBeNull();
    expect(resolveAddOutputTarget([g()], { marqueeSelecting: false, canEdit: false })).toBeNull();
  });
});

describe('addOutputFrameFlow（锚框——流坐标；组帧三字段读 cs，组恒顶层⇒rel≡abs）', () => {
  it('group 档：帧=cs position/width/height（不读 measured）', () => {
    const g = node({ id: 'g', type: 'group', position: { x: 100, y: 50 }, width: 300, height: 200, measured: { width: 999, height: 999 } });
    expect(addOutputFrameFlow([g], { kind: 'group', id: 'g' })).toEqual({ x: 100, y: 50, w: 300, h: 200 });
  });

  it('group 档：组不存在或帧三字段缺失 → null', () => {
    expect(addOutputFrameFlow([], { kind: 'group', id: 'g' })).toBeNull();
    expect(addOutputFrameFlow([node({ id: 'g', type: 'group', position: { x: 0, y: 0 } })], { kind: 'group', id: 'g' })).toBeNull();
  });

  it('selection 档：bbox 含组帧（选中组以整帧参与）；子节点 rel 沿父累加', () => {
    const nodes = [
      node({ id: 'g', type: 'group', selected: true, position: { x: 100, y: 100 }, width: 300, height: 200 }),
      node({ id: 'c1', type: 'imageGen', selected: true, parentId: 'g', position: { x: 50, y: 50 }, width: 100, height: 80 }),
      node({ id: 'c2', type: 'imageGen', selected: true, position: { x: 400, y: 300 }, width: 100, height: 100 }),
    ];
    // c1 abs=(150,150,100,80)；g 帧=(100,100,300,200)；c2=(400,300,100,100)
    // bbox: x=100..500, y=100..400 → {100,100,400,300}
    expect(addOutputFrameFlow(nodes, { kind: 'selection', ids: ['g', 'c1', 'c2'] })).toEqual({ x: 100, y: 100, w: 400, h: 300 });
  });
});

describe('addOutputSourceIds（源集展开——组→子节点；hidden 排除；非组直入）', () => {
  it('group 档：组内全部子节点（未折叠前提由 target 把关；hidden 不参与）', () => {
    const nodes = [
      node({ id: 'g', type: 'group' }),
      node({ id: 'c1', type: 'imageGen', parentId: 'g' }),
      node({ id: 'c2', type: 'imageGen', parentId: 'g', hidden: true }),
      node({ id: 'x', type: 'imageGen' }),
    ];
    expect(addOutputSourceIds(nodes, { kind: 'group', id: 'g' })).toEqual(['c1']);
  });

  it('selection 档：选中组展开为子节点 ∪ 非组选中（v2.2 §3.6 源集合定义）', () => {
    const nodes = [
      node({ id: 'g', type: 'group', selected: true }),
      node({ id: 'c1', type: 'imageGen', parentId: 'g' }),
      node({ id: 'c2', type: 'imageGen', parentId: 'g', hidden: true }),
      node({ id: 'leaf', type: 'imageGen', selected: true }),
    ];
    expect(addOutputSourceIds(nodes, { kind: 'selection', ids: ['g', 'leaf'] })).toEqual(['c1', 'leaf']);
  });
});

describe('addOutputHitZoneFlow（撞车①c——+号命中区流坐标；屏幕常量 / zoom 换算）', () => {
  const frame = { x: 100, y: 100, w: 300, h: 200 };
  it('zoom=1：框右缘外展 hitWidth×hitHeight，垂直居中', () => {
    expect(addOutputHitZoneFlow(frame, 1)).toEqual({
      x: 400, y: 200 - ADD_OUTPUT_HANDLE.hitHeight / 2,
      w: ADD_OUTPUT_HANDLE.hitWidth, h: ADD_OUTPUT_HANDLE.hitHeight,
    });
  });
  it('zoom=0.5 / 2：流坐标尺寸=屏幕常量/zoom（屏幕面恒定）', () => {
    expect(addOutputHitZoneFlow(frame, 0.5)).toEqual({ x: 400, y: 200 - 56, w: 80, h: 112 });
    expect(addOutputHitZoneFlow(frame, 2)).toEqual({ x: 400, y: 200 - 14, w: 20, h: 28 });
  });
});

describe('resolveBatchDropTarget（松手落点——absoluteRectsOf 同口径：组/hidden 排除+源排除）', () => {
  const nodes = [
    node({ id: 'src', type: 'imageGen', position: { x: 0, y: 0 }, width: 100, height: 100 }),
    node({ id: 'tgt', type: 'imageGen', position: { x: 500, y: 0 }, width: 100, height: 100 }),
    node({ id: 'hid', type: 'imageGen', position: { x: 200, y: 0 }, width: 50, height: 50 }, ),
    node({ id: 'g', type: 'group', position: { x: 300, y: 300 }, width: 400, height: 300 }),
  ];
  const withHidden = [...nodes.slice(0, 2), node({ id: 'hid', type: 'imageGen', hidden: true, position: { x: 200, y: 0 }, width: 50, height: 50 }), nodes[3]];

  it('落点在目标节点矩形内 → 该节点 id', () => {
    expect(resolveBatchDropTarget(withHidden, { x: 550, y: 50 }, ['src'])).toBe('tgt');
  });
  it('落点在源自身矩形内 → null（排除源自身——F9）', () => {
    expect(resolveBatchDropTarget(withHidden, { x: 50, y: 50 }, ['src'])).toBeNull();
  });
  it('落点在 hidden 节点矩形内 → null（hidden 目标会建出永远看不见的边）；组区域 → null', () => {
    expect(resolveBatchDropTarget(withHidden, { x: 220, y: 20 }, ['src'])).toBeNull();
    expect(resolveBatchDropTarget(withHidden, { x: 500, y: 400 }, ['src'])).toBeNull();
  });
  it('落空 → null', () => {
    expect(resolveBatchDropTarget(withHidden, { x: 1000, y: 1000 }, ['src'])).toBeNull();
  });
});

// ── B6-3（Spec B 需求 7）：+号手势终态决策——命中=batchConnect / 点击·落空=建点+连线菜单（拍板②）──

describe('decideBatchGestureEnd', () => {
  const toFlow = (p: { x: number; y: number }) => ({ x: p.x - 10, y: p.y - 20 });

  it('drop 命中节点 → connect（源集原样直通）', () => {
    expect(decideBatchGestureEnd(
      { kind: 'drop', sourceIds: ['a', 'b'], clientPoint: { x: 550, y: 150 }, flowPoint: { x: 550, y: 150 }, hitNodeId: 'tgt' },
      toFlow,
    )).toEqual({ kind: 'connect', sourceIds: ['a', 'b'], targetId: 'tgt' });
  });

  it('drop 落空（含 hidden——resolveBatchDropTarget 排除=落空同语义）→ menu：clientPoint 定位+flowPoint 建点', () => {
    expect(decideBatchGestureEnd(
      { kind: 'drop', sourceIds: ['a'], clientPoint: { x: 900, y: 800 }, flowPoint: { x: 1200, y: 1000 }, hitNodeId: null },
      toFlow,
    )).toEqual({ kind: 'menu', sourceIds: ['a'], client: { x: 900, y: 800 }, flow: { x: 1200, y: 1000 } });
  });

  it('click → menu：anchorClient 定位+toFlow(anchorClient) 换算建点落位（点击建点=落空退化情形）', () => {
    expect(decideBatchGestureEnd(
      { kind: 'click', sourceIds: ['a', 'b'], anchorClient: { x: 412, y: 250 } },
      toFlow,
    )).toEqual({ kind: 'menu', sourceIds: ['a', 'b'], client: { x: 412, y: 250 }, flow: { x: 402, y: 230 } });
  });
});
