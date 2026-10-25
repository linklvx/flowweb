// apps/web/src/stores/canvasIntents.t17-array-domains.spec.ts
// Y1c T17（plan v1.7 卡：媒体列表 Y.Array 单卡）——web 写/读改道红绿用例。
// 红轴（卡文「先红」逐字）：整串数组替换（并发 add/remove 丢一方反例——两客户端并发一 add 一
// remove，旧载体 LWW 丢一方）=红。
// 域迁移（spec §3.1 基准）：imageGen/imageExtGen/videoGen{allImages=Y.Array<item>}、
// multiImageGen{images=Y.Array<item>}——item=稳定 id 身份（ImageItem{id,...}）；
// 结构操作规则=splice 单一 seam（add/remove/reorder=delete+insert/undo 重建）。
// 容器规则=§3.5（T15 先例）：创建 seam 一次性物化（fillDoc）/缺=拒不懒建/整串覆盖拒
// （updateNodeData 域键永不 data.set）/undo 重建合法（新容器）。
// 读侧收敛（维持）：ns 投影/toReadModel 恒 plain array；media-refs 双形态收敛
// （shared media-refs.test.ts 同批锚）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { dispatchCanvasIntent, _setIntentDocForTest } from './canvasIntents';
import { Origin, attachUndoManager, detachUndoManager, stopCapturing, undoCanvas } from './canvasUndo';
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';
import { toReadModel as sharedToReadModel } from '@flowweb/shared';

/** canEdit 真（hydration ready + 非 readOnly + 无 terminal）——漏斗 dispatch 门放行。 */
function openRwWindow() {
  useCanvasStore.setState({
    nodes: [], edges: [], hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1',
  });
  useNodeStore.setState({ nodes: {} });
}

/** 真创建链种子：addNode intent 经 fillDoc 创建 seam（绿相=物化 Y.Array 容器；红相=plain 值）。 */
function seedNode(doc: Y.Doc, id: string, type: string, data: Record<string, unknown>) {
  _setIntentDocForTest(doc);
  dispatchCanvasIntent({ type: 'addNode', node: { id, type, position: { x: 0, y: 0 }, data } }, Origin.LocalUser);
}

const img = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id, url: `/u/${id}`, name: `${id}.png`, status: 'success', ...extra });

/** doc 侧 allImages 容器（data.allImages）——不假设载体形态（红绿两相同口）。 */
function listContainer(doc: Y.Doc, nodeId: string, key = 'allImages'): unknown {
  const data = (doc.getMap('nodes').get(nodeId) as Y.Map<unknown>).get('data') as Y.Map<unknown>;
  return data.get(key);
}

/** 容器 → item id 序列（Y.Array/双形态/绿后通用；红相=plain array 直用）。 */
function idsOf(container: unknown): string[] {
  const arr: unknown[] = container instanceof Y.Array ? container.toArray()
    : Array.isArray(container) ? container
    : Array.from(container as Iterable<unknown>);
  return arr.map((x) => {
    const id = typeof (x as { get?: (k: string) => unknown })?.get === 'function'
      ? (x as Y.Map<unknown>).get('id') : (x as { id?: unknown })?.id;
    return String(id);
  });
}

afterEach(() => { _setIntentDocForTest(null); detachUndoManager(); });

// ══════════════════════════════════════════════════════════════════════════
// 红①（卡文先红逐字）：整串数组替换——并发 add/remove 丢一方反例（真双 doc 帧交换）
// ══════════════════════════════════════════════════════════════════════════
describe('Y1c T17 红①：并发 add/remove 丢一方反例（旧载体整串 LWW——Y.Array 结构操作合并不丢）', () => {
  it('双端并发一 remove 一 add：双向交换后两效应并存 [X,Y]（现状红：data.set 整串 LWW 必丢一方）', () => {
    const docA = new Y.Doc();
    openRwWindow();
    seedNode(docA, 'n1', 'imageGen', { allImages: [img('X'), img('R')] });
    // 共同基线同步到 B（真双 doc——B 独立 clientID）
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    expect(idsOf(listContainer(docB, 'n1'))).toEqual(['X', 'R']);

    // A 端：移除 R（经生产写路径——dispatch updateNodeData）
    _setIntentDocForTest(docA);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { allImages: [img('X')] } }, Origin.LocalUser);
    // B 端：新增 Y（同生产写路径）
    _setIntentDocForTest(docB);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { allImages: [img('X'), img('R'), img('Y')] } }, Origin.LocalUser);

    // 双向帧交换（真并发合并——双方均未见过对方 update）
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const a = idsOf(listContainer(docA, 'n1'));
    const b = idsOf(listContainer(docB, 'n1'));
    // 两效应并存：R 已移除 ∧ Y 已新增（旧载体：无论 LWW 胜者是谁，结果 ∈ {[X],[X,R,Y]}——丢一方）
    expect(a).toEqual(['X', 'Y']);
    expect(b).toEqual(['X', 'Y']);   // CRDT 收敛（双端一致）
  });

  it('双端并发两 add：双方新增项合并保留（现状红：整串 LWW 丢一方新增）', () => {
    const docA = new Y.Doc();
    openRwWindow();
    seedNode(docA, 'n1', 'imageGen', { allImages: [img('X')] });
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    _setIntentDocForTest(docA);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { allImages: [img('X'), img('P')] } }, Origin.LocalUser);
    _setIntentDocForTest(docB);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { allImages: [img('X'), img('Q')] } }, Origin.LocalUser);

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const a = idsOf(listContainer(docA, 'n1')).sort();
    const b = idsOf(listContainer(docB, 'n1')).sort();
    expect(a).toEqual(['P', 'Q', 'X']);
    expect(b).toEqual(['P', 'Q', 'X']);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 写 seam：域键写=容器内结构操作（add/remove/reorder=delete+insert/replace）——永不 data.set
// ══════════════════════════════════════════════════════════════════════════
describe('Y1c T17 写 seam：结构操作+容器实例保持（现状红：data.set 整串替换容器）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    openRwWindow();
    seedNode(doc, 'n1', 'imageGen', { allImages: [img('X'), img('R')] });
  });

  it('remove 后容器实例=Y.Array 且内容收敛（现状红：plain array 整串值）', () => {
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { allImages: [img('X')] } }, Origin.LocalUser);
    const c = listContainer(doc, 'n1');
    expect(c instanceof Y.Array).toBe(true);
    expect(idsOf(c)).toEqual(['X']);
  });

  it('add：尾部/头部/中段插入均收敛', () => {
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { allImages: [img('X'), img('R'), img('Y')] } }, Origin.LocalUser);
    expect(idsOf(listContainer(doc, 'n1'))).toEqual(['X', 'R', 'Y']);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { allImages: [img('H'), img('X'), img('R'), img('Y')] } }, Origin.LocalUser);
    expect(idsOf(listContainer(doc, 'n1'))).toEqual(['H', 'X', 'R', 'Y']);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { allImages: [img('H'), img('X'), img('M'), img('R'), img('Y')] } }, Origin.LocalUser);
    expect(idsOf(listContainer(doc, 'n1'))).toEqual(['H', 'X', 'M', 'R', 'Y']);
  });

  it('reorder（delete+insert 语义）：arrayMove 形态全量 patch 收敛到新序', () => {
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { allImages: [img('X'), img('R'), img('Y')] } }, Origin.LocalUser);
    // ImageThumbnailBar arrayMove(0→2) 等价全量新序
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { allImages: [img('R'), img('Y'), img('X')] } }, Origin.LocalUser);
    expect(idsOf(listContainer(doc, 'n1'))).toEqual(['R', 'Y', 'X']);
  });

  it('同 id 内容变更（progress/uploading→success）：item 原位替换，身份与位置保持', () => {
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { allImages: [img('X'), img('R', { status: 'uploading', progress: 30 })] } }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { allImages: [img('X'), img('R', { status: 'success', progress: 100 })] } }, Origin.LocalUser);
    const c = listContainer(doc, 'n1') as Y.Array<unknown>;
    expect(idsOf(c)).toEqual(['X', 'R']);
    const rItem = c.get(1) as Record<string, unknown>;
    expect(rItem.status).toBe('success');
    expect(rItem.progress).toBe(100);
  });

  it('同值 no-op：零 doc 更新事件（防膨胀——与 data.set 逐键 diff 守卫同纪律）', () => {
    const before = listContainer(doc, 'n1');
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { allImages: [img('X'), img('R')] } }, Origin.LocalUser);
    expect(updates).toBe(0);
    expect(listContainer(doc, 'n1')).toBe(before);   // 容器引用不变
  });

  it('multiImageGen.images 同域：清空→回填收敛（mainImageIndex 伴随键不受域键改道影响）', () => {
    seedNode(doc, 'm1', 'multiImageGen', { images: [img('I1'), img('I2')], mainImageIndex: 0 });
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'm1', patch: { images: [], mainImageIndex: -1 } }, Origin.LocalUser);
    const c = listContainer(doc, 'm1', 'images');
    expect(c instanceof Y.Array).toBe(true);
    expect(idsOf(c)).toEqual([]);
    const data = (doc.getMap('nodes').get('m1') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    expect(data.get('mainImageIndex')).toBe(-1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 写 seam 拒绝三档（closed enum——T15 同尺）+ 拒键上浮（doc ≡ store）
// ══════════════════════════════════════════════════════════════════════════
describe('Y1c T17 写 seam 拒绝三档：缺容器=拒不懒建/形状错=拒不掩盖/值形态错=拒', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    openRwWindow();
  });

  it('键缺席（容器缺失）：写被拒不懒建——doc 零新增键（现状红：data.set 懒建 plain 值）', () => {
    seedNode(doc, 'n2', 'imageGen', {});   // 红相：创建无容器；绿相：创建 seam 已补齐（本用例改测手剥容器档）
    const data = (doc.getMap('nodes').get('n2') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    if (data.has('allImages')) data.delete('allImages');   // 人为构造结构缺位（对抗面）
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n2', patch: { allImages: [img('X')] } }, Origin.LocalUser);
    expect(data.has('allImages')).toBe(false);
  });

  it('容器形状错（plain array 覆在 Y.Array 位）：写被拒不覆写——结构错误不被掩盖（现状红：整串覆盖成功）', () => {
    seedNode(doc, 'n3', 'imageGen', { allImages: [img('X')] });
    const data = (doc.getMap('nodes').get('n3') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    data.set('allImages', [img('X')]);   // 人为构造 legacy plain 载体（对抗面）
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n3', patch: { allImages: [img('X'), img('R')] } }, Origin.LocalUser);
    expect(Array.isArray(data.get('allImages'))).toBe(true);   // 原样保持（拒写）
    expect(idsOf(data.get('allImages'))).toEqual(['X']);
  });

  it('值形态错：非数组/item 无 id/重复 id——三形全拒，doc 不变', () => {
    seedNode(doc, 'n4', 'imageGen', { allImages: [img('X')] });
    const data = (doc.getMap('nodes').get('n4') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    for (const bad of ['not-array', [{ url: '/u', name: 'x' }], [img('D'), img('D')]]) {
      dispatchCanvasIntent({ type: 'updateNodeData', id: 'n4', patch: { allImages: bad } }, Origin.LocalUser);
    }
    expect(idsOf(listContainer(doc, 'n4'))).toEqual(['X']);
    expect(data.get('allImages') instanceof Y.Array || Array.isArray(data.get('allImages'))).toBe(true);
  });

  it('混 patch 拒键上浮：{allImages 非法, model} ⇒ doc/ns 同拒 allImages 同落 model（doc ≡ store）', () => {
    seedNode(doc, 'n5', 'imageGen', { allImages: [img('X')], model: 'm1' });
    useNodeStore.setState({
      nodes: { n5: { id: 'n5', type: 'imageGen', data: { allImages: [img('X')], model: 'm1' } as any } },
    });
    useNodeStore.getState().applyNodeDataPatch('n5', { allImages: 'junk', model: 'm2' });
    const nsData = useNodeStore.getState().nodes['n5']?.data as unknown as Record<string, unknown>;
    expect(nsData.model).toBe('m2');
    expect((nsData.allImages as unknown[]).map((x) => (x as { id: string }).id)).toEqual(['X']);   // ns 同拒（不显示 doc 未收的值）
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 创建 seam：fillDoc 物化 + ensure 缺省（T15/T16 同族——doc 容器与 ns 投影同源）
// ══════════════════════════════════════════════════════════════════════════
describe('Y1c T17 创建 seam：结构创建一次性建 Y.Array 容器（现状红：plain 值/缺席）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    openRwWindow();
  });

  it('addNode imageGen 携初值：plain array ⇒ Y.Array 容器（值随容器落位；现状红：plain 裸存）', () => {
    seedNode(doc, 'a1', 'imageGen', { allImages: [img('X'), img('R')] });
    const c = listContainer(doc, 'a1');
    expect(c instanceof Y.Array).toBe(true);
    expect(idsOf(c)).toEqual(['X', 'R']);
  });

  it('addNode 缺域键：创建 seam 补齐空容器（imageGen.allImages/videoGen.allImages/multiImageGen.images——现状红：键缺席）', () => {
    seedNode(doc, 'a2', 'imageGen', {});
    seedNode(doc, 'a3', 'videoGen', {});
    seedNode(doc, 'a4', 'multiImageGen', {});
    for (const [id, key] of [['a2', 'allImages'], ['a3', 'allImages'], ['a4', 'images']] as const) {
      const c = listContainer(doc, id, key);
      expect(c instanceof Y.Array, `${id}.${key} 容器缺失`).toBe(true);
      expect(idsOf(c)).toEqual([]);
    }
    // ns 投影同读补齐值（doc ≡ store）
    const nsImages = (useNodeStore.getState().nodes['a2']?.data as unknown as Record<string, unknown>)?.allImages;
    expect(Array.isArray(nsImages)).toBe(true);
    expect(nsImages).toEqual([]);
  });

  it('undo 重建合法（新容器）：删节点→重加同 id ⇒ fillDoc 再物化全新 Y.Array 实例（别名禁入）', () => {
    seedNode(doc, 'a5', 'imageGen', { allImages: [img('v1')] });
    const first = listContainer(doc, 'a5');
    dispatchCanvasIntent({ type: 'deleteNode', id: 'a5' }, Origin.LocalUser);
    expect(doc.getMap('nodes').has('a5')).toBe(false);
    seedNode(doc, 'a5', 'imageGen', { allImages: [img('v2')] });
    const second = listContainer(doc, 'a5');
    expect(second instanceof Y.Array).toBe(true);
    expect(second).not.toBe(first);            // 新容器（undo 重建=新实例）
    expect(idsOf(second)).toEqual(['v2']);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// undo 真链（T15 E 先例——attachUndoManager/undoCanvas 真链）
// ══════════════════════════════════════════════════════════════════════════
describe('Y1c T17 undo 真链：单 UndoManager item 级恢复（结构操作入栈——容器形态保持）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    openRwWindow();
    seedNode(doc, 'u1', 'imageGen', { allImages: [img('X')] });
  });
  afterEach(() => { detachUndoManager(); });

  it('add item → undoCanvas() ⇒ item 移除+容器仍 Y.Array；redo 恢复', async () => {
    attachUndoManager(doc);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'u1', patch: { allImages: [img('X'), img('R')] } }, Origin.LocalUser);
    stopCapturing();
    await undoCanvas();
    let c = listContainer(doc, 'u1');
    expect(c instanceof Y.Array).toBe(true);
    expect(idsOf(c)).toEqual(['X']);
    await (await import('./canvasUndo')).redoCanvas();
    c = listContainer(doc, 'u1');
    expect(idsOf(c)).toEqual(['X', 'R']);
  });

  it('remove item → undoCanvas() ⇒ item 恢复（含内容）', async () => {
    attachUndoManager(doc);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'u1', patch: { allImages: [img('X'), img('R')] } }, Origin.LocalUser);
    stopCapturing();
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'u1', patch: { allImages: [img('X')] } }, Origin.LocalUser);
    await undoCanvas();
    const c = listContainer(doc, 'u1') as Y.Array<unknown>;
    expect(idsOf(c)).toEqual(['X', 'R']);
    expect((c.get(1) as Record<string, unknown>).url).toBe('/u/R');
  });

  it('reorder → undoCanvas() ⇒ 原序恢复', async () => {
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'u1', patch: { allImages: [img('X'), img('R'), img('Y')] } }, Origin.LocalUser);
    attachUndoManager(doc);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'u1', patch: { allImages: [img('R'), img('Y'), img('X')] } }, Origin.LocalUser);
    stopCapturing();
    await undoCanvas();
    expect(idsOf(listContainer(doc, 'u1'))).toEqual(['X', 'R', 'Y']);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// updateConfig C-1 形态（T16 同族）：数组域键不进 updateConfig 载荷（patch 先剔不过 seam）
// ══════════════════════════════════════════════════════════════════════════
describe('Y1c T17 updateConfig C-1：全量摊开载荷先剔数组域键（现状红：stale ns 整串回写覆盖 doc 容器）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    openRwWindow();
    _resetCollabDiagForTest();
  });

  it('updateConfig({model})：doc 容器原样（stale ns 不回写）+ns 域键保留+零 write_reject（现状红）', () => {
    seedNode(doc, 'c1', 'imageGen', { allImages: [img('X'), img('R')], model: 'm1' });
    useCanvasStore.setState((s) => ({
      nodes: [...s.nodes, { id: 'c1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any],
    }));
    // ns 投影 stale（缺 R——reconcile 去抖窗内形态）
    useNodeStore.setState({
      nodes: { c1: { id: 'c1', type: 'imageGen', data: { allImages: [img('X')], model: 'm1' } as any } },
    });
    useNodeStore.getState().updateConfig('c1', { model: 'm2' });
    const c = listContainer(doc, 'c1');
    expect(c instanceof Y.Array).toBe(true);           // 容器未被整串覆盖（现状红：plain array 替换）
    expect(idsOf(c)).toEqual(['X', 'R']);              // doc 权威保持（现状红：被 stale ns [X] 覆盖）
    const nsData = useNodeStore.getState().nodes['c1']?.data as unknown as Record<string, unknown>;
    expect(nsData.model).toBe('m2');
    expect((nsData.allImages as unknown[]).map((x) => (x as { id: string }).id)).toEqual(['X']);   // ns 域键保留（不静默消失）
    expect(getRecentCollabDiag().filter((e) => e.type === 'write_reject')).toHaveLength(0);        // 零噪声
  });

  it('config 显式携带 allImages：剔除不落（写路径=updatePromptImages/updateMultiImageImages 专用）+单次留痕', () => {
    seedNode(doc, 'c2', 'imageGen', { allImages: [img('X')], model: 'm1' });
    useCanvasStore.setState((s) => ({
      nodes: [...s.nodes, { id: 'c2', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any],
    }));
    useNodeStore.setState({
      nodes: { c2: { id: 'c2', type: 'imageGen', data: { allImages: [img('X')], model: 'm1' } as any } },
    });
    useNodeStore.getState().updateConfig('c2', { allImages: [img('X'), img('INJECT')] } as any);   // 域键误入 updateConfig（对抗面——调用方误用形态）
    expect(idsOf(listContainer(doc, 'c2'))).toEqual(['X']);   // doc 不收（域键不入载荷）
    const nsData = useNodeStore.getState().nodes['c2']?.data as unknown as Record<string, unknown>;
    expect((nsData.allImages as unknown[]).map((x) => (x as { id: string }).id)).toEqual(['X']);   // ns 亦不落
    expect(getRecentCollabDiag().filter((e) => e.type === 'write_reject' && (e.detail as { via?: string } | undefined)?.via === 'array-domain').length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 并发 reorder + add（delete+insert 语义在并发下的合并行为——卡文「并发 add/remove/reorder」第三轴）
// ══════════════════════════════════════════════════════════════════════════
describe('Y1c T17 并发 reorder：delete+insert 语义合并（现状红：整串 LWW 序丢一方）', () => {
  it('A 重排 + B 尾加：合并=R 移至首 + Z 尾随（双方收敛同序）', () => {
    const docA = new Y.Doc();
    openRwWindow();
    seedNode(docA, 'n1', 'imageGen', { allImages: [img('X'), img('R'), img('Y')] });
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    _setIntentDocForTest(docA);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { allImages: [img('R'), img('X'), img('Y')] } }, Origin.LocalUser);
    _setIntentDocForTest(docB);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'n1', patch: { allImages: [img('X'), img('R'), img('Y'), img('Z')] } }, Origin.LocalUser);

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const a = idsOf(listContainer(docA, 'n1'));
    const b = idsOf(listContainer(docB, 'n1'));
    expect(a).toEqual(['R', 'X', 'Y', 'Z']);   // A 的重排效应 + B 的尾加效应并存
    expect(b).toEqual(['R', 'X', 'Y', 'Z']);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 读侧收敛维持：ns 投影/plain 读模型恒 plain array（Y.Array 载体不出 doc）
// ══════════════════════════════════════════════════════════════════════════
describe('Y1c T17 读侧收敛：Y.Array 载体 → 读出口恒 plain array（imageNodeApi/PromptInput 池消费口径不变）', () => {
  it('seam 写后：ns 投影 plain array + toReadModel plain array（双读径同形）', () => {
    const doc = new Y.Doc();
    openRwWindow();
    seedNode(doc, 'r1', 'imageGen', { allImages: [img('X')] });
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'r1', patch: { allImages: [img('X'), img('R')] } }, Origin.LocalUser);
    // ns 投影（projectIntentToStore → applyDataPatchToStores）
    const nsData = useNodeStore.getState().nodes['r1']?.data as unknown as Record<string, unknown>;
    expect(Array.isArray(nsData.allImages)).toBe(true);
    expect(nsData.allImages).toEqual([img('X'), img('R')]);
    // 读模型（全 web 读入口 readCanvasFromDoc 芯=toReadModel）
    const rm = sharedToReadModel(doc);
    const rmNode = rm.nodes.find((n) => n.id === 'r1');
    expect(Array.isArray(rmNode?.data.allImages)).toBe(true);
    expect(rmNode?.data.allImages).toEqual([img('X'), img('R')]);
  });
});
