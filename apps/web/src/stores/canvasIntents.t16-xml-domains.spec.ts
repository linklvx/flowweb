// apps/web/src/stores/canvasIntents.t16-xml-domains.spec.ts
// Y1c T16（plan v1.7 卡：XmlFragment+Tiptap 双端——G3 主体）——web 写/合并 seam 红绿用例。
// 两条红轴（卡文「先红」逐字）：
//   红① 现 getHTML 整串写 data.content=红：textInput.content 与 imageGen/videoGen/imageExtGen
//       .prompt 为 XmlFragment 域（容器规则=T15）——创建 seam 一次性建容器；整串写（getHTML/
//       PromptValue JSON 形态的 data.set）=容器替换对抗面（G17b）必须被拒；
//   红② 两客户端格式化合并后树合法性=红：双端并发整串写（现状 LWW data.set 载体）必丢一方
//       ——XmlFragment CRDT 载体下双端并发格式化/文本插入合并后两方内容均在且树合法。
// 域基准（spec §3.1 xml 域行）：textInput{content:XmlFragment}；imageGen/videoGen/imageExtGen
// {prompt:XmlFragment（mention/image=PM 节点）→PromptValue{text,html,referencedImageIds} 三出口}。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { dispatchCanvasIntent, _setIntentDocForTest } from './canvasIntents';
import { Origin } from './canvasUndo';

/** canEdit 真（hydration ready + 非 readOnly + 无 terminal）——漏斗 dispatch 门放行。 */
function openRwWindow() {
  useCanvasStore.setState({
    nodes: [], edges: [], hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1',
  });
  useNodeStore.setState({ nodes: {} });
}

/** 现状 getHTML 整串写形态（TextInputNode.onUpdate → updateText(id, editor.getHTML())）。 */
const WHOLE_STRING_HTML = '<p><strong>加粗正文</strong></p>';
/** 现状 PromptValue JSON 整串写形态（PromptInput.onUpdate → updateConfig(prompt)）。 */
const PROMPT_VALUE_JSON = { text: '一只猫', html: '<p>一只猫</p>', referencedImageIds: [] as string[] };

describe('Y1c T16 红①：现 getHTML 整串写 data.content=红（XmlFragment 域键永不 data.set）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    openRwWindow();
  });
  afterEach(() => _setIntentDocForTest(null));

  it('创建 seam：textInput addNode ⇒ data.content 物化 Y.XmlFragment 容器（现状红：空串 string 载体）', () => {
    const [outcome] = dispatchCanvasIntent({
      type: 'addNode',
      node: { id: 't1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '' } },
    }, Origin.LocalUser);
    expect(outcome.rejectedKeys.size).toBe(0);
    const data = (doc.getMap('nodes').get('t1') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    expect(data.get('content') instanceof Y.XmlFragment).toBe(true);
  });

  it('三域创建 seam：imageGen/videoGen/imageExtGen addNode ⇒ data.prompt 物化 Y.XmlFragment（现状红：PromptValue JSON/缺席）', () => {
    for (const [id, type] of [['i1', 'imageGen'], ['v1', 'videoGen'], ['e1', 'imageExtGen']] as const) {
      dispatchCanvasIntent({
        type: 'addNode',
        node: { id, type, position: { x: 0, y: 0 }, data: { model: 'm' } },
      }, Origin.LocalUser);
      const data = (doc.getMap('nodes').get(id) as Y.Map<unknown>).get('data') as Y.Map<unknown>;
      expect(data.get('prompt') instanceof Y.XmlFragment, `${type}.prompt 非 XmlFragment`).toBe(true);
    }
  });

  it('整串 getHTML 写被拒：textInput content patch（getHTML 形态）⇒ rejectedKeys 含 content+容器原样（现状红：data.set 整串落）', () => {
    dispatchCanvasIntent({
      type: 'addNode',
      node: { id: 't2', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '' } },
    }, Origin.LocalUser);
    const data = (doc.getMap('nodes').get('t2') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    const container = data.get('content');
    const [outcome] = dispatchCanvasIntent(
      { type: 'updateNodeData', id: 't2', patch: { content: WHOLE_STRING_HTML } }, Origin.LocalUser,
    );
    expect([...outcome.rejectedKeys]).toContain('content');
    // 容器未被替换为 string（G17b 容器替换对抗面）
    expect(data.get('content')).toBe(container);
    expect(data.get('content') instanceof Y.XmlFragment).toBe(true);
  });

  it('PromptValue JSON 写被拒：imageGen prompt patch ⇒ rejectedKeys 含 prompt+容器原样（现状红：JSON 覆盖）', () => {
    dispatchCanvasIntent({
      type: 'addNode',
      node: { id: 'i2', type: 'imageGen', position: { x: 0, y: 0 }, data: { model: 'm' } },
    }, Origin.LocalUser);
    const data = (doc.getMap('nodes').get('i2') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    const container = data.get('prompt');
    const [outcome] = dispatchCanvasIntent(
      { type: 'updateNodeData', id: 'i2', patch: { prompt: PROMPT_VALUE_JSON } }, Origin.LocalUser,
    );
    expect([...outcome.rejectedKeys]).toContain('prompt');
    expect(data.get('prompt')).toBe(container);
    expect(data.get('prompt') instanceof Y.XmlFragment).toBe(true);
  });

  it('非域键写不受影响：textInput model patch 照落（XmlFragment 守卫只辖域键）', () => {
    dispatchCanvasIntent({
      type: 'addNode',
      node: { id: 't3', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '' } },
    }, Origin.LocalUser);
    const [outcome] = dispatchCanvasIntent(
      { type: 'updateNodeData', id: 't3', patch: { model: 'gpt-x' } }, Origin.LocalUser,
    );
    expect(outcome.rejectedKeys.size).toBe(0);
    const data = (doc.getMap('nodes').get('t3') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    expect(data.get('model')).toBe('gpt-x');
  });
});

describe('Y1c T16 红②：两客户端格式化合并后树合法性（整串 LWW 载体必丢一方=红）', () => {
  // 装置：两端各自 doc 经同一 intent seam 写 content（现状=整串 data.set 载体），
  // 帧交换（Y.update ⇄ applyUpdate 双向）后断言两方文本均在——现状 LWW 必红。
  function seedTextNode(doc: Y.Doc): void {
    _setIntentDocForTest(doc);
    openRwWindow();
    dispatchCanvasIntent({
      type: 'addNode',
      node: { id: 't-merge', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '' } },
    }, Origin.LocalUser);
  }

  it('双端并发：整串写双端全拒+容器载体并发回合两方内容均在（现状红=LWW 丢一方；绿相=容器载体）', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    // 基线同步（共享空容器——创建 seam 物化）
    seedTextNode(docA);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const dataB = (docB.getMap('nodes').get('t-merge') as Y.Map<unknown>).get('data') as Y.Map<unknown>;

    // 双端并发「getHTML 整串写」（现状 TextInputNode.onUpdate 形态）——两端 seam 全拒
    //（红相：现状 data.set LWW 载体合并必丢一方；绿相：写形式本身被结构性禁止）
    _setIntentDocForTest(docA);
    const [rA] = dispatchCanvasIntent(
      { type: 'updateNodeData', id: 't-merge', patch: { content: '<p><strong>A 端加粗</strong></p>' } }, Origin.LocalUser,
    );
    _setIntentDocForTest(docB);
    const [rB] = dispatchCanvasIntent(
      { type: 'updateNodeData', id: 't-merge', patch: { content: '<p>B 端正文</p>' } }, Origin.LocalUser,
    );
    expect([...rA.rejectedKeys]).toContain('content');
    expect([...rB.rejectedKeys]).toContain('content');

    // 容器载体并发回合（ySyncPlugin 写形态的 seam 级模拟——真编辑器双端归 G3 spec）：
    // A 端容器内插入加粗段落，B 端容器内插入普通段落
    const dataA = (docA.getMap('nodes').get('t-merge') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    const fragA = dataA.get('content') as Y.XmlFragment;
    const fragB = dataB.get('content') as Y.XmlFragment;
    const pa = new Y.XmlElement('paragraph');
    const ta = new Y.XmlText();
    ta.insert(0, 'A 端加粗');
    ta.setAttribute('bold', 'true');
    pa.insert(0, [ta]);
    fragA.insert(0, [pa]);
    const pb = new Y.XmlElement('paragraph');
    const tb = new Y.XmlText();
    tb.insert(0, 'B 端正文');
    pb.insert(0, [tb]);
    fragB.insert(0, [pb]);

    // 帧交换（双端全量互灌——并发回合）后两方内容均在且双端一致（树合法性）
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const textA = fragA.toString();
    const textB = fragB.toString();
    expect(textA).toContain('A 端加粗');
    expect(textA).toContain('B 端正文');
    expect(textB).toBe(textA);
    // 合并后域键仍为 XmlFragment 容器（容器替换对抗面零发生）
    expect(dataA.get('content') instanceof Y.XmlFragment).toBe(true);
    expect(dataB.get('content') instanceof Y.XmlFragment).toBe(true);
    _setIntentDocForTest(null);
  });

  it('XmlFragment 载体并发回合（绿相目标锚）：双端各自容器内插入不同段落——合并后均在', () => {
    // 直接以目标载体构造（独立于被测 seam——验证 Yjs 嵌套 XmlFragment 并发合并不丢边，
    // 为 G3「双端并发格式化」提供 shared 侧机制锚）
    const docA = new Y.Doc();
    const mk = (doc: Y.Doc) => {
      const data = new Y.Map();
      data.set('content', new Y.XmlFragment());
      const n = new Y.Map();
      n.set('type', 'textInput');
      n.set('data', data);
      doc.getMap('nodes').set('t', n);
      return data.get('content') as Y.XmlFragment;
    };
    const fragA = mk(docA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const fragB = (docB.getMap('nodes').get('t') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    const fb = fragB.get('content') as Y.XmlFragment;
    // 并发：A 端插入加粗段落，B 端插入普通段落
    const pa = new Y.XmlElement('paragraph');
    const ta = new Y.XmlText();
    ta.insert(0, 'A 端加粗');
    ta.setAttribute('bold', 'true');
    pa.insert(0, [ta]);
    fragA.insert(0, [pa]);
    const pb = new Y.XmlElement('paragraph');
    const tb = new Y.XmlText();
    tb.insert(0, 'B 端正文');
    pb.insert(0, [tb]);
    fb.insert(0, [pb]);
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const textA = fragA.toString();
    const textB = fb.toString();
    expect(textA).toContain('A 端加粗');
    expect(textA).toContain('B 端正文');
    expect(textB).toBe(textA);
  });
});
