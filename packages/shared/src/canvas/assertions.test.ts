// packages/shared/src/canvas/assertions.test.ts
// C0-2 断言族行为测试（Spec B）：先红后绿——每断言用构造输入证 throw/不 throw。
// 输入形状：DocNodeRecord[]（doc 作者态可选键）+ ② 的 cs 侧三方快照 {docRecords, csNodes, frames}。
// 帧模式判定走被测模块内联实现（frameMode/isCollapsed 是 C0-1 stub——调不得），O0b 接线后换单源。
import { describe, it, expect } from 'vitest';
import type { DocNodeRecord, RenderNode, Rect } from './docShape';
import { toDocRecords } from './docShape';
import type { AbsCoord, RelCoord } from './brands';
import { calcGroupBounds, COLLAPSED_SIZE, DEFAULT_CHILD_SIZE } from './geometry';
import {
  assertNoAutoGroupFrameKeys,
  assertDocAbsMatchesCsRel,
  assertExpandedAutoFrameEqualsBounds,
  assertStoryboardChildNoPosition,
  assertNoCsDerivedKeysInData,
  assertNoDunderKeysInGroupData,
  assertEmptyAutoGroupCollapsedSize,
  assertStoryboardMembership,
  assertAllPositionsFinite,
  GeometryWriteLedger,
  CS_ONLY_DERIVED_DATA_KEYS,
} from './assertions';

// —— 夹具助手：品牌坐标打点（测试构造受信字面量——cast 即打点）——
const abs = (x: number, y: number) => ({ x: x as AbsCoord, y: y as AbsCoord });
const rel = (x: number, y: number) => ({ x: x as RelCoord, y: y as RelCoord });
const rec = (over: Partial<DocNodeRecord> & { id: string }): DocNodeRecord =>
  ({ type: 'imageGen', data: {}, ...over });
const groupRec = (over: Partial<DocNodeRecord> & { id: string }): DocNodeRecord =>
  ({ type: 'group', data: { groupType: 'normal' }, ...over });
const csNode = (over: Partial<RenderNode> & { id: string }): RenderNode =>
  ({ type: 'imageGen', position: rel(0, 0), data: {}, ...over });

describe('assertNoAutoGroupFrameKeys（断言①：auto 组 doc 无帧键）', () => {
  it('auto 组携带任一帧键（position/width/height）→ throw', () => {
    expect(() => assertNoAutoGroupFrameKeys([
      groupRec({ id: 'g1', width: 340, height: 370 }),
    ])).toThrow(/g1/);
    expect(() => assertNoAutoGroupFrameKeys([
      groupRec({ id: 'g1', position: abs(10, 10) }),
    ])).toThrow(/g1/);
  });

  it('auto 组无帧键（含折叠态）→ 不抛', () => {
    expect(() => assertNoAutoGroupFrameKeys([
      groupRec({ id: 'g1' }),
      groupRec({ id: 'g2', data: { groupType: 'normal', collapsed: true, savedSize: { width: 300, height: 200 } } }),
    ])).not.toThrow();
  });

  it('manual 组三键齐且有效（折叠态同）→ 不抛；键残缺/无效 → 按 auto 判 throw', () => {
    expect(() => assertNoAutoGroupFrameKeys([
      groupRec({ id: 'm1', position: abs(10, 20), width: 300, height: 200 }),
    ])).not.toThrow();
    expect(() => assertNoAutoGroupFrameKeys([
      groupRec({ id: 'm2', position: abs(10, 20), width: 300 }), // 缺 height → 非三键齐 → auto 形态
    ])).toThrow(/m2/);
    expect(() => assertNoAutoGroupFrameKeys([
      groupRec({ id: 'm3', position: abs(10, 20), width: 0, height: 100 }), // 宽 0 无效 → auto 形态
    ])).toThrow(/m3/);
  });

  it('storyboard 组携带帧键 → 豁免不抛（分镜组帧走配置型）', () => {
    expect(() => assertNoAutoGroupFrameKeys([
      groupRec({ id: 's1', data: { groupType: 'storyboard' }, position: abs(0, 0), width: 660, height: 200 }),
    ])).not.toThrow();
  });

  it('普通节点有 position → 不抛（本断言只管组）', () => {
    expect(() => assertNoAutoGroupFrameKeys([
      rec({ id: 'n1', position: abs(1, 2) }),
    ])).not.toThrow();
  });
});

describe('assertDocAbsMatchesCsRel（断言②：doc.abs ≡ cs.rel + 组帧原点）', () => {
  const frames = new Map<string, Rect>([['G', { x: 100, y: 100, width: 340, height: 370 }]]);

  it('doc abs == cs rel + 帧原点 → 不抛', () => {
    expect(() => assertDocAbsMatchesCsRel({
      docRecords: [
        groupRec({ id: 'G', position: abs(100, 100) }),
        rec({ id: 'c1', parentId: 'G', position: abs(110, 120) }),
      ],
      csNodes: [csNode({ id: 'c1', parentId: 'G', position: rel(10, 20) })],
      frames,
    })).not.toThrow();
  });

  it('任一轴不等 → throw 并列出节点 id', () => {
    expect(() => assertDocAbsMatchesCsRel({
      docRecords: [rec({ id: 'c1', parentId: 'G', position: abs(111, 120) })],
      csNodes: [csNode({ id: 'c1', parentId: 'G', position: rel(10, 20) })],
      frames,
    })).toThrow(/c1/);
    expect(() => assertDocAbsMatchesCsRel({
      docRecords: [rec({ id: 'c1', parentId: 'G', position: abs(110, 121) })],
      csNodes: [csNode({ id: 'c1', parentId: 'G', position: rel(10, 20) })],
      frames,
    })).toThrow(/c1/);
  });

  it('分镜组子豁免：cs 父 groupType=storyboard 时 abs 不对照', () => {
    expect(() => assertDocAbsMatchesCsRel({
      docRecords: [rec({ id: 'c1', parentId: 'S', position: abs(999, 999) })],
      csNodes: [
        csNode({ id: 'S', type: 'group', data: { groupType: 'storyboard' }, position: rel(0, 0) }),
        csNode({ id: 'c1', parentId: 'S', position: rel(0, 0) }),
      ],
      frames: new Map([['S', { x: 0, y: 0, width: 660, height: 200 }]]),
    })).not.toThrow();
  });

  it('cs 缺子节点 / frames 缺组帧 → 跳过（投影完整性归其他断言）', () => {
    expect(() => assertDocAbsMatchesCsRel({
      docRecords: [rec({ id: 'lonely', parentId: 'G', position: abs(5, 5) })],
      csNodes: [],
      frames,
    })).not.toThrow();
    expect(() => assertDocAbsMatchesCsRel({
      docRecords: [rec({ id: 'c1', parentId: 'G', position: abs(5, 5) })],
      csNodes: [csNode({ id: 'c1', parentId: 'G', position: rel(10, 20) })],
      frames: new Map(),
    })).not.toThrow();
  });

  it('顶层 doc 节点（无 parentId）不属本断言对照面 → 不抛', () => {
    expect(() => assertDocAbsMatchesCsRel({
      docRecords: [rec({ id: 'top', position: abs(1, 2) })],
      csNodes: [csNode({ id: 'top', position: rel(1, 2) })],
      frames,
    })).not.toThrow();
  });
});

describe('assertExpandedAutoFrameEqualsBounds（断言③：展开态 auto 组 frame ≡ bbox+padding）', () => {
  // 成员 abs rect：(0,50,100,100) 与 (200,250,100,100) → calcGroupBounds = (-20,0,340,370)
  const members = (): DocNodeRecord[] => [
    rec({ id: 'm1', parentId: 'G', position: abs(0, 50), width: 100, height: 100 }),
    rec({ id: 'm2', parentId: 'G', position: abs(200, 250), width: 100, height: 100 }),
  ];
  const goodGroup = (): DocNodeRecord =>
    groupRec({ id: 'G', position: abs(-20, 0), width: 340, height: 370 });

  it('frame ≡ calcGroupBounds(成员)+padding → 不抛', () => {
    expect(() => assertExpandedAutoFrameEqualsBounds([goodGroup(), ...members()])).not.toThrow();
  });

  it('任一维度偏离 bbox+padding → throw', () => {
    expect(() => assertExpandedAutoFrameEqualsBounds([
      groupRec({ id: 'G', position: abs(-19, 0), width: 340, height: 370 }), ...members(),
    ])).toThrow(/G/);
    expect(() => assertExpandedAutoFrameEqualsBounds([
      groupRec({ id: 'G', position: abs(-20, 0), width: 341, height: 370 }), ...members(),
    ])).toThrow(/G/);
  });

  it('成员缺尺寸 → DEFAULT_CHILD_SIZE 兜底（与 applyGroupFrame 同源）', () => {
    const bare = rec({ id: 'm1', parentId: 'G', position: abs(0, 0) });
    const frame = calcExpected([bare]);
    expect(() => assertExpandedAutoFrameEqualsBounds([
      groupRec({ id: 'G', position: abs(frame.x, frame.y), width: frame.width, height: frame.height }),
      bare,
    ])).not.toThrow();
    // sanity：期望帧确按 DEFAULT_CHILD_SIZE 计算
    expect(frame.width).toBe(DEFAULT_CHILD_SIZE.width + 40);
  });

  it('折叠 / manual / storyboard / 无帧键 / 空组 → 跳过（空组归 COLLAPSED_SIZE 条）', () => {
    expect(() => assertExpandedAutoFrameEqualsBounds([
      groupRec({ id: 'G', data: { groupType: 'normal', collapsed: true }, position: abs(0, 0), width: 1, height: 1 }),
      rec({ id: 'm1', parentId: 'G', position: abs(0, 0), width: 100, height: 100 }),
    ])).not.toThrow();
    expect(() => assertExpandedAutoFrameEqualsBounds([
      groupRec({ id: 'G', data: { groupType: 'normal', manuallyResized: true }, position: abs(7, 7), width: 1, height: 1 }),
      rec({ id: 'm1', parentId: 'G', position: abs(0, 0), width: 100, height: 100 }),
    ])).not.toThrow();
    expect(() => assertExpandedAutoFrameEqualsBounds([
      groupRec({ id: 'G', data: { groupType: 'storyboard' }, position: abs(7, 7), width: 1, height: 1 }),
      rec({ id: 'm1', parentId: 'G', position: abs(0, 0), width: 100, height: 100 }),
    ])).not.toThrow();
    expect(() => assertExpandedAutoFrameEqualsBounds([
      groupRec({ id: 'G' }),
      rec({ id: 'm1', parentId: 'G', position: abs(0, 0), width: 100, height: 100 }),
    ])).not.toThrow();
    expect(() => assertExpandedAutoFrameEqualsBounds([groupRec({ id: 'G', position: abs(1, 1), width: 1, height: 1 })])).not.toThrow();
  });

  it('成员缺 position → throw（普通组子节点 doc 恒有 position——数据形状违例）', () => {
    expect(() => assertExpandedAutoFrameEqualsBounds([
      goodGroup(),
      rec({ id: 'bad', parentId: 'G', width: 100, height: 100 }),
    ])).toThrow(/bad/);
  });
});

describe('assertStoryboardChildNoPosition（断言④：分镜子 doc 无 position）', () => {
  const sb = groupRec({ id: 'S', data: { groupType: 'storyboard', cells: ['c1'] } });

  it('分镜子携带 position → throw；无 position → 不抛', () => {
    expect(() => assertStoryboardChildNoPosition([
      sb, rec({ id: 'c1', parentId: 'S', position: abs(0, 0) }),
    ])).toThrow(/c1/);
    expect(() => assertStoryboardChildNoPosition([
      sb, rec({ id: 'c1', parentId: 'S' }),
    ])).not.toThrow();
  });

  it('普通组子有 position → 不抛（只拦分镜组）', () => {
    expect(() => assertStoryboardChildNoPosition([
      groupRec({ id: 'G' }),
      rec({ id: 'c1', parentId: 'G', position: abs(5, 5) }),
    ])).not.toThrow();
  });
});

describe('assertNoCsDerivedKeysInData（断言⑤：cs-only 派生字段禁入 data）', () => {
  it('data.hidden / data.selected / data.dragging → throw', () => {
    expect(() => assertNoCsDerivedKeysInData([rec({ id: 'n1', data: { hidden: true } })])).toThrow(/hidden/);
    expect(() => assertNoCsDerivedKeysInData([rec({ id: 'n1', data: { selected: true } })])).toThrow(/selected/);
    expect(() => assertNoCsDerivedKeysInData([rec({ id: 'n1', data: { dragging: true } })])).toThrow(/dragging/);
  });

  it('合法业务键（collapsed/status/fileId）→ 不抛', () => {
    expect(() => assertNoCsDerivedKeysInData([
      groupRec({ id: 'g', data: { groupType: 'normal', collapsed: true } }),
      rec({ id: 'n1', data: { status: 'done', fileId: 'f1' } }),
    ])).not.toThrow();
  });

  it('块名单常量导出（hidden 在册——派生字段域随模型扩）', () => {
    expect(CS_ONLY_DERIVED_DATA_KEYS).toContain('hidden');
  });
});

describe('assertNoDunderKeysInGroupData（断言⑥：`__` 前缀键不进组 data）', () => {
  it('组 data 含 __ 前缀键 → throw；普通节点 data 含 __ 前缀键 → 不抛（只拦组 data）', () => {
    expect(() => assertNoDunderKeysInGroupData([
      groupRec({ id: 'g', data: { groupType: 'normal', __fromMulti: 'm1' } }),
    ])).toThrow(/__fromMulti/);
    expect(() => assertNoDunderKeysInGroupData([
      rec({ id: 'c1', data: { status: 'done', __fromMulti: 'm1' } }),
    ])).not.toThrow();
  });

  it('组 data 合法键（name/cells/storyboard）→ 不抛', () => {
    expect(() => assertNoDunderKeysInGroupData([
      groupRec({ id: 'g', data: { groupType: 'storyboard', name: 'x', cells: [], storyboard: {} } }),
    ])).not.toThrow();
  });
});

describe('assertEmptyAutoGroupCollapsedSize（+：空 auto 组 → COLLAPSED_SIZE）', () => {
  it('空 auto 组已折叠且帧=COLLAPSED_SIZE → 不抛（帧键缺失同放——doc 形态无帧键）', () => {
    expect(() => assertEmptyAutoGroupCollapsedSize([
      groupRec({ id: 'g', data: { groupType: 'normal', collapsed: true }, width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height }),
    ])).not.toThrow();
    expect(() => assertEmptyAutoGroupCollapsedSize([
      groupRec({ id: 'g', data: { groupType: 'normal', collapsed: true } }),
    ])).not.toThrow();
  });

  it('空 auto 组帧偏离 COLLAPSED_SIZE → throw', () => {
    expect(() => assertEmptyAutoGroupCollapsedSize([
      groupRec({ id: 'g', data: { groupType: 'normal', collapsed: true }, width: COLLAPSED_SIZE.width, height: 999 }),
    ])).toThrow(/g/);
  });

  it('空 auto 组未折叠 → throw（空组必须折叠态）', () => {
    expect(() => assertEmptyAutoGroupCollapsedSize([
      groupRec({ id: 'g', data: { groupType: 'normal' }, width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height }),
    ])).toThrow(/g/);
  });

  it('有成员 / manual / storyboard → 跳过', () => {
    expect(() => assertEmptyAutoGroupCollapsedSize([
      groupRec({ id: 'g', data: { groupType: 'normal', collapsed: true }, width: 1, height: 1 }),
      rec({ id: 'm1', parentId: 'g', position: abs(0, 0), width: 10, height: 10 }),
    ])).not.toThrow();
    expect(() => assertEmptyAutoGroupCollapsedSize([
      groupRec({ id: 'm', data: { groupType: 'normal', manuallyResized: true }, width: 1, height: 1 }),
    ])).not.toThrow();
    expect(() => assertEmptyAutoGroupCollapsedSize([
      groupRec({ id: 's', data: { groupType: 'storyboard', cells: [null] } }),
    ])).not.toThrow();
  });
});

describe('assertStoryboardMembership（membership 写侧：分镜子 ⊆ cells）', () => {
  it('子 id 全在 cells → 不抛（null 槽位/悬空 cells 项放行——F38 槽位语义）', () => {
    expect(() => assertStoryboardMembership([
      groupRec({ id: 'S', data: { groupType: 'storyboard', cells: ['c1', null, 'ghost'] } }),
      rec({ id: 'c1', parentId: 'S' }),
    ])).not.toThrow();
  });

  it('子 id 不在 cells → throw 列出越界 id', () => {
    expect(() => assertStoryboardMembership([
      groupRec({ id: 'S', data: { groupType: 'storyboard', cells: ['c1'] } }),
      rec({ id: 'c1', parentId: 'S' }),
      rec({ id: 'c2', parentId: 'S' }),
    ])).toThrow(/c2/);
  });

  it('cells 缺失/非数组而子存在 → throw；普通组不属本断言', () => {
    expect(() => assertStoryboardMembership([
      groupRec({ id: 'S', data: { groupType: 'storyboard' } }),
      rec({ id: 'c1', parentId: 'S' }),
    ])).toThrow(/cells/);
    expect(() => assertStoryboardMembership([
      groupRec({ id: 'G', data: { groupType: 'normal' } }),
      rec({ id: 'c1', parentId: 'G' }),
    ])).not.toThrow();
  });
});

describe('assertAllPositionsFinite（全节点锚：Number.isFinite(position.x/y)）', () => {
  it('NaN/Infinity 坐标 → throw；有限值或缺 position → 不抛', () => {
    expect(() => assertAllPositionsFinite([rec({ id: 'n1', position: abs(Number.NaN, 1) })])).toThrow(/n1/);
    expect(() => assertAllPositionsFinite([rec({ id: 'n1', position: abs(1, Number.POSITIVE_INFINITY) })])).toThrow(/n1/);
    expect(() => assertAllPositionsFinite([rec({ id: 'n1', position: abs(1, 2) })])).not.toThrow();
    expect(() => assertAllPositionsFinite([rec({ id: 'n1' })])).not.toThrow();
  });
});

describe('GeometryWriteLedger（字段级一写者框架：接口+计数器）', () => {
  it('同字段同节点两个写者 → assertExactlyOneWriter throw 列出双方；单写者不抛', () => {
    const ledger = new GeometryWriteLedger();
    ledger.record('reconcile', 'position', 'n1');
    ledger.record('gesture', 'position', 'n1');
    expect(() => ledger.assertExactlyOneWriter('position')).toThrow(/reconcile[\s\S]*gesture|gesture[\s\S]*reconcile/);
    expect(ledger.countFor('position', 'n1')).toBe(2);
    const single = new GeometryWriteLedger();
    single.record('reconcile', 'width', 'n1');
    expect(() => single.assertExactlyOneWriter('width')).not.toThrow();
  });

  it('不同节点不同写者 → 不抛（判据按节点×字段，非全字段单写者）', () => {
    const ledger = new GeometryWriteLedger();
    ledger.record('reconcile', 'position', 'n1');
    ledger.record('gesture', 'position', 'n2');
    expect(() => ledger.assertExactlyOneWriter('position')).not.toThrow();
  });

  it('writersOf / countFor / reset 计数工具', () => {
    const ledger = new GeometryWriteLedger();
    ledger.record('reconcile', 'height', 'n1');
    ledger.record('reconcile', 'height', 'n1');
    expect(ledger.writersOf('height', 'n1')).toEqual(['reconcile']);
    expect(ledger.countFor('height', 'n1')).toBe(2);
    ledger.reset();
    expect(ledger.countFor('height', 'n1')).toBe(0);
    expect(() => ledger.assertExactlyOneWriter('height')).not.toThrow();
  });
});

// —— O0b 挂点（it.todo 先建后清：各分片 unskip 接线，B7-1 归零——it.todo 计数锚）——
// O0b-1（2026-10-03）已转实：见下方『reconcile 尾挂①③先决契约』describe——
// 生产热路径接线（reconcile DEV 尾跑①③）随 O0b-5 折叠分支 envelope 写删解锁（原 it.todo
// 点名的"onNodesChange 尾挂"窗口本身归 O0b-6/B4'-2——本片先钉契约面与解锁条件）。
describe('O0b 接线挂点（C0-2 只落骨架，行为接线归各分片）', () => {
  it.todo('O0b-2 接线：applyDocToStore 尾挂 assertDocAbsMatchesCsRel + assertStoryboardMembership（写侧 membership，prod 转 id 去重 log）');
  it.todo('O0b-3 接线：dispatchProjectionDiff 尾挂 assertStoryboardChildNoPosition + assertNoCsDerivedKeysInData + assertNoDunderKeysInGroupData');
  it.todo('O0b-4 接线：GeometryWriteLedger 内建 reconcile 计数——字段级一写者断言进 transact 边界');
  it.todo('O0b-5 接线：assertAllPositionsFinite 挂 assertInvariant 收口点');
});

// —— O0b-1 转实（Spec B，2026-10-03）：reconcile 尾挂①③的先决契约面 ——
// 现实约束（热路径接线当前不可接的实证）：toggleCollapse 折叠分支对组直写 envelope{COLLAPSED_SIZE
// wh}（updateNodeEnvelope 意图——canvasIntents.spec『toggleCollapse』用例即该形态），auto 组折叠后
// doc 携带 w/h-only 键——①在热路径会于合法折叠流上抛。解锁条件=O0b-5『折叠分支 envelope 写删
// （toggleCollapse 仅 updateNodeData{collapsed}）』落地。本片先钉两端：
// ①③在 reconcile 的 doc oracle 输入契约（toDocRecords 出口——键集表内剥键）上零违例；
// ①对 toggleCollapse 折叠产物形态的鉴别力（O0b-5 落地后热路径接线即零违例的先决）。
describe('O0b-1 接线：reconcile 尾挂①③先决契约（toDocRecords 出口零违例+违例形态鉴别力）', () => {
  it('toDocRecords 出口（reconcile doc oracle 输入）满足①③——manual 密封帧/auto 零键/分镜混合夹具不抛', () => {
    // manual 组帧取 bbox+padding 合法形（③在 manuallyResized 旧标记语义下将无标记三键组按候选校验——
    // 帧≡bbox 的夹具在新旧两代 manual 判定语义下同为合法，锚不随 O0b-5 标记删除漂移）
    const bbox = calcGroupBounds([{ x: 120, y: 80, width: 100, height: 60 }]);
    const csNodes = [
      { id: 'gm', type: 'group', position: { x: bbox.x, y: bbox.y }, width: bbox.width, height: bbox.height, data: { groupType: 'normal', name: 'm' } },
      { id: 'cm', type: 'imageGen', parentId: 'gm', position: { x: 20, y: 50 }, width: 100, height: 60, data: {} },
      { id: 'ga', type: 'group', position: { x: 300, y: 400 }, data: { groupType: 'normal' } },
      { id: 'ca', type: 'imageGen', parentId: 'ga', position: { x: 310, y: 410 }, width: 80, height: 50, data: {} },
      { id: 'sb', type: 'group', position: { x: 0, y: 900 }, data: { groupType: 'storyboard', cells: ['sc'] } },
      { id: 'sc', type: 'imageGen', parentId: 'sb', width: 320, height: 180, data: {} },
    ];
    const out = toDocRecords(csNodes as never, {});
    expect(() => assertNoAutoGroupFrameKeys(out)).not.toThrow();
    expect(() => assertExpandedAutoFrameEqualsBounds(out)).not.toThrow();
  });

  it('①鉴别力：auto 组折叠态带 w/h-only 键（当前 toggleCollapse 折叠分支产物形态）⇒ throw（热路径接线随 O0b-5 解锁）', () => {
    expect(() => assertNoAutoGroupFrameKeys([
      groupRec({ id: 'gc', data: { groupType: 'normal', collapsed: true, savedSize: { width: 530, height: 560 } }, width: 220, height: 160 }),
    ])).toThrow(/gc/);
  });
});

// —— 测试私有：期望帧计算（与实现同源 calcGroupBounds——只用于构造合法夹具）——
function calcExpected(members: DocNodeRecord[]) {
  return calcGroupBounds(members.map((m) => ({
    x: m.position!.x, y: m.position!.y,
    width: m.width ?? DEFAULT_CHILD_SIZE.width, height: m.height ?? DEFAULT_CHILD_SIZE.height,
  })));
}
