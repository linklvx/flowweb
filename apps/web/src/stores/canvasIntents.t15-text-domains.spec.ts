// apps/web/src/stores/canvasIntents.t15-text-domains.spec.ts
// Y1c T15（plan v1.7 卡：容器规则先行+Y.Text 域）——web 写 seam 红绿用例。
// 两条红轴（卡文「先红」逐字）：
//   红① 整串覆盖写被拒（getHTML/整串 diff 形态）：Y.Text 域键的 updateNodeData patch 必须经
//       splice 单一 seam 落为最小 diff——data.set 整串覆盖容器（现状 LWW 形态）结构性禁止；
//   红② 缺容器=拒绝不懒建：data 缺 prompt 容器（结构错误）时写必须被拒，不得静默懒建掩盖
//       （现状：updateNodeData 对缺席键无条件 data.set=懒建）。
// 三域迁移（spec §3.1 基准）：audioGen.prompt=Y.Text（content:string 同卡迁）；
// multiImageGen.prompt=Y.Text（死字段赋形）；textInput.prompt=Y.Map{text:Y.Text}。
// 用例面：IME/粘贴/选区/两端同位插入并发（Y.Text 语义合并不丢边）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { dispatchCanvasIntent, _setIntentDocForTest } from './canvasIntents';
import { Origin, attachUndoManager, detachUndoManager, stopCapturing, undoCanvas } from './canvasUndo';

/** canEdit 真（hydration ready + 非 readOnly + 无 terminal）——漏斗 dispatch 门放行。 */
function openRwWindow() {
  useCanvasStore.setState({
    nodes: [], edges: [], hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1',
  });
  useNodeStore.setState({ nodes: {} });
}

/** 手建 audioGen 节点（红阶段 fillDoc 尚未物化容器——种子须独立于被测实现）。 */
function seedAudioNode(doc: Y.Doc, id: string, opts?: { promptContainer?: string; withDataMap?: boolean }) {
  const data = new Y.Map();
  data.set('model', 'm-audio');
  if (opts?.promptContainer !== undefined) data.set('prompt', new Y.Text(opts.promptContainer));
  const n = new Y.Map();
  n.set('type', 'audioGen');
  n.set('data', data);
  doc.getMap('nodes').set(id, n);
  return { node: n, data };
}

describe('Y1c T15 红①：整串覆盖写被拒（Y.Text 域键经 splice 单一 seam——容器永不 data.set 替换）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    openRwWindow();
  });
  afterEach(() => _setIntentDocForTest(null));

  it('audioGen prompt=Y.Text 容器：整串 patch 经 diff-splice 落内容——容器实例保持（现状红：data.set 整串替换为 string）', () => {
    const { data } = seedAudioNode(doc, 'a1', { promptContainer: 'abc' });
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'a1', patch: { prompt: 'abd' } }, Origin.LocalUser);
    const after = data.get('prompt');
    // 容器未被整串覆盖替换（getHTML/整串 diff 形态的 data.set 写=结构性禁止）
    expect(after instanceof Y.Text).toBe(true);
    expect((after as Y.Text).toString()).toBe('abd');
  });

  it('textInput prompt=Y.Map{text:Y.Text} 容器：{text} patch splice 内层——容器与 text 子键保持（现状红：整对象 LWW 替换）', () => {
    const data = new Y.Map();
    const promptMap = new Y.Map();
    promptMap.set('text', new Y.Text('面板词'));
    data.set('prompt', promptMap);
    const n = new Y.Map();
    n.set('type', 'textInput');
    n.set('data', data);
    doc.getMap('nodes').set('t1', n);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 't1', patch: { prompt: { text: '面板词扩展' } } }, Origin.LocalUser);
    const after = data.get('prompt');
    expect(after instanceof Y.Map).toBe(true);
    const inner = (after as Y.Map<unknown>).get('text');
    expect(inner instanceof Y.Text).toBe(true);
    expect((inner as Y.Text).toString()).toBe('面板词扩展');
  });
});

describe('Y1c T15 红②：缺容器=拒绝不懒建（结构错误暴露而非静默兜底）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    openRwWindow();
  });
  afterEach(() => _setIntentDocForTest(null));

  it('audioGen data 无 prompt 容器：写被拒——doc 零新增键（现状红：data.set 懒建 string 键）', () => {
    const { data } = seedAudioNode(doc, 'a1');
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'a1', patch: { prompt: 'x' } }, Origin.LocalUser);
    expect(data.has('prompt')).toBe(false);
  });

  it('容器形状错（prompt=string 而非 Y.Text）：写被拒不覆写——结构错误不被掩盖（现状红：同值覆写）', () => {
    const { data } = seedAudioNode(doc, 'a1');
    data.set('prompt', 'legacy-string');
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'a1', patch: { prompt: 'whole-overwrite' } }, Origin.LocalUser);
    expect(data.get('prompt')).toBe('legacy-string');
  });

  it('节点无 data Y.Map：写被拒不懒建 data（现状红：懒建 data Y.Map 后照写）', () => {
    const n = new Y.Map();
    n.set('type', 'audioGen');
    doc.getMap('nodes').set('a2', n);
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'a2', patch: { model: 'm2' } }, Origin.LocalUser);
    expect(n.has('data')).toBe(false);
  });
});

describe('Y1c T15 创建 seam：结构创建时一次性建容器（fillDoc 物化+域键缺省补齐）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    openRwWindow();
  });
  afterEach(() => _setIntentDocForTest(null));

  it('addNode audioGen：data 缺 prompt 键 ⇒ 创建 seam 补齐空容器（doc Y.Text + store 投影空串——现状红：无容器）', () => {
    dispatchCanvasIntent({
      type: 'addNode',
      node: { id: 'a9', type: 'audioGen', position: { x: 0, y: 0 }, data: { model: 'm' } },
    }, Origin.LocalUser);
    const data = (doc.getMap('nodes').get('a9') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    expect(data.get('prompt') instanceof Y.Text).toBe(true);
    expect((data.get('prompt') as Y.Text).toString()).toBe('');
    // store 投影同读补齐值（doc ≡ store——checkProjectionInvariant 口径）
    expect((useNodeStore.getState().nodes['a9']?.data as unknown as Record<string, unknown>)?.prompt).toBe('');
  });

  it('addNode textInput：prompt=Y.Map{text:Y.Text} 一次性建（现状红：无容器/无键）', () => {
    dispatchCanvasIntent({
      type: 'addNode',
      node: { id: 't9', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '' } },
    }, Origin.LocalUser);
    const data = (doc.getMap('nodes').get('t9') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    const p = data.get('prompt');
    expect(p instanceof Y.Map).toBe(true);
    const inner = (p as Y.Map<unknown>).get('text');
    expect(inner instanceof Y.Text).toBe(true);
    expect((inner as Y.Text).toString()).toBe('');
  });

  it('addNode multiImageGen：死字段赋形——prompt=Y.Text 空容器随结构创建（现状红：无容器）', () => {
    dispatchCanvasIntent({
      type: 'addNode',
      node: { id: 'm9', type: 'multiImageGen', position: { x: 0, y: 0 }, data: { images: [], mainImageIndex: 0 } },
    }, Origin.LocalUser);
    const data = (doc.getMap('nodes').get('m9') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    expect(data.get('prompt') instanceof Y.Text).toBe(true);
  });

  it('创建携带初值：data.prompt=string ⇒ fillDoc 物化为 Y.Text（值随容器落位，现状红：string 裸存）', () => {
    dispatchCanvasIntent({
      type: 'addNode',
      node: { id: 'a8', type: 'audioGen', position: { x: 0, y: 0 }, data: { model: 'm', prompt: '初值词' } },
    }, Origin.LocalUser);
    const data = (doc.getMap('nodes').get('a8') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    const p = data.get('prompt');
    expect(p instanceof Y.Text).toBe(true);
    expect((p as Y.Text).toString()).toBe('初值词');
  });

  it('undo 重建合法（新容器）：删节点→重加同 id ⇒ fillDoc 再物化**全新** Y.Text 实例（别名禁入）', () => {
    dispatchCanvasIntent({
      type: 'addNode',
      node: { id: 'a7', type: 'audioGen', position: { x: 0, y: 0 }, data: { model: 'm', prompt: 'v1' } },
    }, Origin.LocalUser);
    const first = ((doc.getMap('nodes').get('a7') as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('prompt') as Y.Text;
    dispatchCanvasIntent({ type: 'deleteNode', id: 'a7' }, Origin.LocalUser);
    expect(doc.getMap('nodes').has('a7')).toBe(false);
    dispatchCanvasIntent({
      type: 'addNode',
      node: { id: 'a7', type: 'audioGen', position: { x: 0, y: 0 }, data: { model: 'm', prompt: 'v2' } },
    }, Origin.LocalUser);
    const second = ((doc.getMap('nodes').get('a7') as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('prompt') as Y.Text;
    expect(second).not.toBe(first);            // 新容器（undo 重建=新实例——旧容器别名结构性禁入）
    expect(second.toString()).toBe('v2');
  });
});

describe('Y1c T15 用例面：IME/粘贴/选区/两端同位插入并发（splice seam 语义）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    openRwWindow();
    seedAudioNode(doc, 'a1', { promptContainer: '' });
  });
  afterEach(() => _setIntentDocForTest(null));

  const textOf = (): string => (((doc.getMap('nodes').get('a1') as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('prompt') as Y.Text).toString();

  it('IME 组段连续过渡：かな→汉字每步整串 patch，最终态精确收敛', () => {
    for (const step of ['にほんご', '日本語', '日本語です']) {
      dispatchCanvasIntent({ type: 'updateNodeData', id: 'a1', patch: { prompt: step } }, Origin.LocalUser);
    }
    expect(textOf()).toBe('日本語です');
  });

  it('粘贴：中段大块插入 + 选区整段替换', () => {
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'a1', patch: { prompt: 'hello world' } }, Origin.LocalUser);
    // 粘贴：中段插入长块
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'a1', patch: { prompt: 'hello 【粘贴的长文本块】 world' } }, Origin.LocalUser);
    expect(textOf()).toBe('hello 【粘贴的长文本块】 world');
    // 选区替换：选中「粘贴的长文本块」换成「短词」
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'a1', patch: { prompt: 'hello 短词 world' } }, Origin.LocalUser);
    expect(textOf()).toBe('hello 短词 world');
  });

  it('两端同位插入并发：双端各自 splice 同位，update 合并双方保留（整串覆盖 LWW 必丢一边——splice 语义锚）', () => {
    // 先建立共同基线 'abc'（A 写入并同步到 B）
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'a1', patch: { prompt: 'abc' } }, Origin.LocalUser);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(doc));
    const bData = (docB.getMap('nodes').get('a1') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    const bPrompt = bData.get('prompt') as Y.Text;
    expect(bPrompt.toString()).toBe('abc');
    // A 端：在 'abc' 后插入 'X'（经 seam——整串 patch 'abcX' 落为 insert(3,'X')）
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'a1', patch: { prompt: 'abcX' } }, Origin.LocalUser);
    // B 端：同位插入 'Y'（Y.Text 原生 splice——对端等价写路径）
    docB.transact(() => bPrompt.insert(3, 'Y'));
    // 双向交换 update（合并）
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(doc));
    const merged = textOf();
    expect(merged).toContain('X');
    expect(merged).toContain('Y');
    expect(merged.startsWith('abc')).toBe(true);
  });
});

describe('T15 收口 A（Q-I-1）：拒写半落根修——doc 拒 ⇒ store 投影同拒（doc ≡ store）', () => {
  let doc: Y.Doc;
  const seedMismatch = (): void => {
    // 容器形状错：prompt=string 覆在 Y.Text 位（结构错误——写 seam 拒 container-type-mismatch）
    const data = new Y.Map();
    data.set('model', 'm-audio');
    data.set('prompt', 'legacy-string');
    const n = new Y.Map();
    n.set('type', 'audioGen');
    n.set('data', data);
    doc.getMap('nodes').set('a1', n);
  };
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    openRwWindow();
    seedMismatch();
    // ns 同形种子（applyDocToStore 水合形态——updateNodeData 投影对缺席 ns 节点 no-op，须在案）
    useNodeStore.setState({
      nodes: { a1: { id: 'a1', type: 'audioGen', data: { model: 'm-audio', prompt: 'legacy-string' } as any } },
    });
  });
  afterEach(() => _setIntentDocForTest(null));

  it('dispatch 混 patch {prompt,model}：doc 拒 prompt 落 model ⇒ ns 同拒 prompt 同落 model（现状红：ns 半落 prompt 新值）', () => {
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'a1', patch: { prompt: 'whole', model: 'm2' } }, Origin.LocalUser);
    const docData = (doc.getMap('nodes').get('a1') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    expect(docData.get('prompt')).toBe('legacy-string');   // doc 拒（结构错误不掩盖）
    expect(docData.get('model')).toBe('m2');
    const nsData = useNodeStore.getState().nodes['a1']?.data as unknown as Record<string, unknown>;
    expect(nsData?.prompt).toBe('legacy-string');          // ns 同拒——不显示 doc 未收的新值（reload 静默消失根修）
    expect(nsData?.model).toBe('m2');
  });

  it('applyNodeDataPatch 直写面同拒：面板路径全拒 patch ⇒ ns 零落（现状红：直写体无条件落 ns）', () => {
    useNodeStore.getState().applyNodeDataPatch('a1', { prompt: 'whole-overwrite' });
    const docData = (doc.getMap('nodes').get('a1') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    const nsData = useNodeStore.getState().nodes['a1']?.data as unknown as Record<string, unknown>;
    expect(docData.get('prompt')).toBe('legacy-string');
    expect(nsData?.prompt).toBe('legacy-string');          // 直写体与投影同剥被拒键
  });
});

describe('T15 收口 E（Q-M-5）：真 UndoManager 路径——um.undo() item 级恢复后写经 seam 合法（不绕懒建）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    openRwWindow();
  });
  afterEach(() => { _setIntentDocForTest(null); detachUndoManager(); });

  it('attachUndoManager 真配置（[nodes,edges]×trackedOrigins LocalUser）：删节点→undoCanvas() 恢复同实例容器，后续 seam 写 ok', async () => {
    const um = attachUndoManager(doc);
    dispatchCanvasIntent({
      type: 'addNode',
      node: { id: 'a1', type: 'audioGen', position: { x: 0, y: 0 }, data: { model: 'm', prompt: 'v1' } },
    }, Origin.LocalUser);
    const before = ((doc.getMap('nodes').get('a1') as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('prompt') as Y.Text;
    expect(before.toString()).toBe('v1');   // 删除前容器在案（集成态读取零告警）
    stopCapturing();
    dispatchCanvasIntent({ type: 'deleteNode', id: 'a1' }, Origin.LocalUser);
    expect(doc.getMap('nodes').has('a1')).toBe(false);
    await undoCanvas();
    expect(doc.getMap('nodes').has('a1')).toBe(true);
    const restored = ((doc.getMap('nodes').get('a1') as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('prompt');
    expect(restored instanceof Y.Text).toBe(true);
    // 恢复态=完整容器（undo 后 map 入口是新 JS 句柄——删除期旧句柄 first 已失效〔delete set 读空〕，
    // item 级内容经 UndoManager 保留：值随子树恢复）
    expect((restored as Y.Text).toString()).toBe('v1');
    // 恢复后写经 seam 合法：容器在（undo 不产生缺容器态），splice 直落
    dispatchCanvasIntent({ type: 'updateNodeData', id: 'a1', patch: { prompt: 'v2' } }, Origin.LocalUser);
    expect((restored as Y.Text).toString()).toBe('v2');
    um.destroy();
  });
});
