// packages/shared/src/canvas/renderCanvas.test.ts
// O0c-2（Spec B）：第 4 渲染面 deriveRenderCanvas——records(作者态 abs)→RenderNode(rel+hidden+派生帧)。
// 锚族：①组帧≡deriveGroupFrame 四模式逐位（主画布唯一写者 reconcile 同源调用——快照≡主画布几何逐位）
// ②rel=abs−frameOrigin（单遍：帧集合先产出）③分镜子/collapsed 子代不产独立节点+cellNodes 载荷
// ④边集无悬空 ⑤父先子后+环守卫 ⑥初始 bounds 不含 (0,0) 邻域（分镜子 {0,0} 不进 RF 数组）。
import { describe, it, expect } from 'vitest';
import { deriveRenderCanvas } from './renderCanvas';
import { deriveGroupFrame, calcGroupBounds, calcStoryboardSize, COLLAPSED_SIZE, DEFAULT_CHILD_SIZE, GROUP_PADDING, GROUP_PADDING_TOP } from './geometry';
import { groupHidesChildren } from './arrangeSelection';
import type { DocNodeRecord } from './docShape';

// ── 夹具：manual/collapsed(manual∧auto 两档)/storyboard 三形态 + 分镜 2×2 两子 + 从未 resize 图片节点 ──
// 坐标全部远离 (0,0)（锚⑥前提）；abs 空间（doc=abs——O0b-0 起）。
const records: DocNodeRecord[] = [
  { id: 'n1', type: 'textInput', position: { x: 300, y: 400 }, data: { content: 'x' } },
  { id: 'img1', type: 'imageGen', position: { x: 300, y: 0 }, width: 548, height: 309, data: { prompt: 'cat' } }, // 已固化 wh（O0b-2 尺寸固化链）
  { id: 'img2', type: 'imageGen', position: { x: 1000, y: 500 }, data: { prompt: 'dog' } },                        // 从未 resize——wh 无键
  { id: 'gM', type: 'group', position: { x: 600, y: 40 }, width: 300, height: 200, parentId: undefined, data: { groupType: 'normal', cells: ['c1'] } }, // manual（三键密封）
  { id: 'c1', type: 'textInput', parentId: 'gM', position: { x: 660, y: 120 }, width: 100, height: 60, data: { content: 'in' } },
  // collapsed∧auto：0 帧键——origin=bbox 派生、尺寸=COLLAPSED_SIZE
  { id: 'gCA', type: 'group', data: { groupType: 'normal', collapsed: true, cells: ['c2', 'c3'] } },
  { id: 'c2', type: 'textInput', parentId: 'gCA', position: { x: 1500, y: 200 }, width: 120, height: 80, data: {} },
  { id: 'c3', type: 'textInput', parentId: 'gCA', position: { x: 1560, y: 260 }, width: 120, height: 80, data: {} },
  // collapsed∧manual：三键密封——origin=密封 origin（帧键保持展开态值不动，终裁 82）
  { id: 'gCM', type: 'group', position: { x: 1800, y: 40 }, width: 400, height: 300, data: { groupType: 'normal', collapsed: true, cells: ['c4'] } },
  { id: 'c4', type: 'textInput', parentId: 'gCM', position: { x: 1850, y: 100 }, data: {} },
  // expanded∧auto（质评补档——最常见真实形态）：0 帧键——origin+尺寸均由 childrenAbs 驱动；
  // c5 无 wh ⇒ childrenAbs 走 DEFAULT_CHILD_SIZE 档（该兜底链在此用例生效）
  { id: 'gA', type: 'group', data: { groupType: 'normal', cells: ['c5'] } },
  { id: 'c5', type: 'textInput', parentId: 'gA', position: { x: 2600, y: 300 }, data: {} },
  // storyboard 2×2：尺寸=config 权威（calcStoryboardSize，无 padding）；分镜子无 position（键集表）
  {
    id: 'gSB', type: 'group', position: { x: 2200, y: 60 },
    data: {
      groupType: 'storyboard', cells: ['s1', 's2', null, null],
      storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' },
    },
  },
  { id: 's1', type: 'imageGen', parentId: 'gSB', data: { thumbnailUrl: '/th/s1' } },
  { id: 's2', type: 'videoGen', parentId: 'gSB', data: { thumbnailUrl: '/th/s2' } },
];

const edges = [
  { id: 'e1', source: 'n1', target: 'img1' },   // 两端保留
  { id: 'e2', source: 'img1', target: 'c2' },   // c2 被剔除（collapsed 子代）→ 悬空过滤
  { id: 'e3', source: 'ghostX', target: 'img2' }, // 未知端点 → 过滤
  { id: 'e4', source: 'c1', target: 'img2' },   // 两端保留
  { id: 'e5', source: 'c1', target: 's1' },     // s1 被剔除（分镜子）→ 过滤
];

const out = deriveRenderCanvas({ records, edges });
const node = (id: string) => out.nodes.find((n) => n.id === id)!;
const outIds = out.nodes.map((n) => n.id);

// 主画布同构对照（reconcile 写域① 同参喂 deriveGroupFrame——本组帧期望值的独立第二来源）
const byId = new Map(records.map((r) => [r.id, r]));
const childrenAbsOf = (gid: string) =>
  records.filter((r) => r.parentId === gid && r.position != null).map((r) => ({
    x: r.position!.x, y: r.position!.y,
    width: r.width ?? DEFAULT_CHILD_SIZE.width, height: r.height ?? DEFAULT_CHILD_SIZE.height,
  }));
const frameDirect = (gid: string) => {
  const g = byId.get(gid)!;
  return deriveGroupFrame({
    data: g.data,
    storedFrame: { position: g.position, width: g.width, height: g.height },
    childrenAbs: childrenAbsOf(gid),
    fallbackOrigin: g.position,
  });
};

describe('deriveRenderCanvas（O0c-2 第 4 渲染面——快照≡主画布）', () => {
  it('组帧≡deriveGroupFrame 四模式逐位（manual/collapsed∧auto/collapsed∧manual/storyboard——reconcile 写域① 同源）', () => {
    // manual：三键密封直出
    expect(node('gM')).toMatchObject({ position: { x: 600, y: 40 }, width: 300, height: 200 });
    // collapsed∧auto：origin=bbox 派生（calcGroupBounds+padding）、尺寸=COLLAPSED_SIZE
    expect(node('gCA')).toMatchObject({ position: { x: 1480, y: 150 }, width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height });
    // collapsed∧manual：origin=密封 origin、尺寸=COLLAPSED_SIZE（帧键保持展开态值不动）
    expect(node('gCM')).toMatchObject({ position: { x: 1800, y: 40 }, width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height });
    // expanded∧auto：origin+尺寸均=bbox 派生——c5 无 wh ⇒ DEFAULT_CHILD_SIZE 兜底档在此生效
    expect(frameDirect('gA')).toEqual(calcGroupBounds(childrenAbsOf('gA')));
    expect(node('gA').position).toEqual({ x: 2600 - GROUP_PADDING, y: 300 - GROUP_PADDING_TOP });
    // storyboard：尺寸=calcStoryboardSize(config)（2×2 16:9 → 642×362）、origin=帧 position 键
    const sbSize = calcStoryboardSize(2, 2, '16:9');
    expect(node('gSB')).toMatchObject({ position: { x: 2200, y: 60 }, width: sbSize.width, height: sbSize.height });
    // 逐位≡直接调 deriveGroupFrame（主画布唯一写者同参同源——几何逐位锚）
    for (const gid of ['gM', 'gCA', 'gCM', 'gA', 'gSB']) {
      const f = frameDirect(gid);
      expect(node(gid).position).toEqual({ x: f.x, y: f.y });
      expect(node(gid).width).toBe(f.width);
      expect(node(gid).height).toBe(f.height);
    }
    // collapsed∧auto 的 bbox 对照显式钉 calcGroupBounds（padding 内嵌单源）
    expect(frameDirect('gCA')).toEqual({ ...calcGroupBounds(childrenAbsOf('gCA')), width: 220, height: 160 });
  });

  it('rel=abs−frameOrigin（子 RenderNode rel；顶层=abs 原样）——单遍：帧集合先产出后才写子 rel', () => {
    expect(node('c1').position).toEqual({ x: 60, y: 80 }); // abs(660,120) − gM 帧原点(600,40)
    expect(node('c1').parentId).toBe('gM');
    expect(node('c5').position).toEqual({ x: GROUP_PADDING, y: GROUP_PADDING_TOP }); // abs(2600,300) − gA bbox 原点(2600−PAD,300−PAD_TOP)
    expect(node('n1').position).toEqual({ x: 300, y: 400 }); // 顶层 abs 直拷
    expect(node('img2').position).toEqual({ x: 1000, y: 500 });
  });

  it('RF 数组剔除 hidden 节点：分镜子+collapsed 子代不产独立节点（可见集合≡主画布 deriveHidden 同构）', () => {
    // 主画布 hidden=deriveHiddenMap（直接子代 of groupHidesChildren 组）——渲染 null=不可见；第 4 面同集合整剔除
    const hidesChildrenIds = new Set(
      records.filter((r) => r.type === 'group' && groupHidesChildren(r.data)).map((r) => r.id),
    );
    const expectedInvisible = new Set(
      records.filter((r) => r.parentId != null && hidesChildrenIds.has(r.parentId)).map((r) => r.id),
    );
    expect([...expectedInvisible].sort()).toEqual(['c2', 'c3', 'c4', 's1', 's2']);
    expect(outIds).toEqual(['n1', 'img1', 'img2', 'gM', 'c1', 'gCA', 'gCM', 'gA', 'c5', 'gSB']);
    // 锚（v3.12 评审三 P1-1）：payload 无 parentId=分镜组独立节点
    expect(out.nodes.filter((n) => n.parentId === 'gSB')).toEqual([]);
    // 输出零 hidden 节点（剔除式——hidden 键不出现即非 true）
    expect(out.nodes.every((n) => n.hidden !== true)).toBe(true);
  });

  it('分镜子 data 保留：cellNodes 进组 data 双通道载荷（公开页通道 thumbnailUrl）', () => {
    expect(node('gSB').data.cellNodes).toEqual([
      { id: 's1', thumbnailUrl: '/th/s1' },
      { id: 's2', thumbnailUrl: '/th/s2' },
    ]);
  });

  it('从未 resize 图片节点：wh 无键原样透传（undefined=未测量——尺寸固化链外的真实形态，兜底归渲染层）', () => {
    expect(node('img2').width).toBeUndefined();
    expect(node('img2').height).toBeUndefined();
    expect(node('img1')).toMatchObject({ width: 548, height: 309 }); // 已固化 wh 逐位透传
  });

  it('边集无悬空：剔除节点/未知 id 端点的边整条过滤', () => {
    expect(out.edges).toEqual([
      { id: 'e1', source: 'n1', target: 'img1' },
      { id: 'e4', source: 'c1', target: 'img2' },
    ]);
  });

  it('输出父先子后（RF v12 要求）+环守卫（parentId 环不爆栈）', () => {
    for (const n of out.nodes) {
      if (n.parentId == null) continue;
      const pi = outIds.indexOf(n.parentId);
      expect(pi).toBeGreaterThanOrEqual(0);            // 保留节点的父必在输出（剔除按祖先链——父子同命运）
      expect(pi).toBeLessThan(outIds.indexOf(n.id));   // 父先子后
    }
    // 环夹具 A↔B：两节点都产出、不挂死
    const cyclic = deriveRenderCanvas({
      records: [
        { id: 'A', type: 'textInput', parentId: 'B', position: { x: 10, y: 10 }, data: {} },
        { id: 'B', type: 'textInput', parentId: 'A', position: { x: 20, y: 20 }, data: {} },
      ],
      edges: [],
    });
    expect(cyclic.nodes.map((n) => n.id).sort()).toEqual(['A', 'B']);
    // 组环 gX↔gY（互为成员）：帧派生递归不挂死、输出有限值
    const groupCycle = deriveRenderCanvas({
      records: [
        { id: 'gX', type: 'group', parentId: 'gY', data: { groupType: 'normal' } },
        { id: 'gY', type: 'group', parentId: 'gX', data: { groupType: 'normal' } },
      ],
      edges: [],
    });
    expect(groupCycle.nodes).toHaveLength(2);
    for (const n of groupCycle.nodes) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
  });

  it('初始 bounds 不含 (0,0) 邻域：分镜子 {0,0} 不进 RF 数组（4 格不叠原点——fitView/MiniMap 不被拉向原点）', () => {
    // 夹具全部合法节点 abs 远离原点（≥300）；分镜 2×2 若产出 4 个 {0,0} 子节点，min 距离立即塌 0
    const framesAbs = new Map(out.nodes.filter((n) => n.type === 'group').map((n) => {
      const abs = n.parentId != null ? undefined : n.position; // 顶层组 rel≡abs（本夹具组全顶层）
      return [n.id, abs];
    }));
    for (const n of out.nodes) {
      const abs = n.parentId != null
        ? { x: n.position.x + framesAbs.get(n.parentId)!.x, y: n.position.y + framesAbs.get(n.parentId)!.y }
        : n.position;
      expect(Math.hypot(abs.x, abs.y)).toBeGreaterThan(100);
    }
    expect(out.nodes.filter((n) => n.position.x === 0 && n.position.y === 0)).toEqual([]);
  });

  it('悬空 parentId（父不在 records）：安全跳过按顶层产出（不 NaN、不双加）', () => {
    const r = deriveRenderCanvas({
      records: [{ id: 'nD', type: 'textInput', parentId: 'ghostP', position: { x: 50, y: 50 }, data: {} }],
      edges: [],
    });
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0]).toMatchObject({ id: 'nD', position: { x: 50, y: 50 } });
    expect(r.nodes[0].parentId).toBeUndefined(); // 无 origin 可减——按顶层产出（禁双加）
  });
});
