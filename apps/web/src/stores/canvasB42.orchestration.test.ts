// apps/web/src/stores/canvasB42.orchestration.test.ts
// B4'-2（Spec B）：onNodesChange 编排+门判据分型——手势期零 intent（doc 写入=0）+resize 会话+
// 分镜子批按条目丢弃+让位扩展（拖组子代）+保护放弃（远端改 parentId）。
//
// 红测试锚（plan B4'-2 / spec §3.2.1+§3.2.5+终裁 30/44③/56）：
//   ① 拖动单帧 doc 写入=0（THE 根因锚——旧路径 RF 发子 rel 被当 abs 写 doc.abs 槽；手势期零
//      intent 后该洞结构性关闭，松手 finalize 的 reconcile('doc') 不再腐蚀覆盖）。
//   ② 帧原点逐帧恒等（拖叶档——父组帧冻结，真实 onNodesChange 驱动+远端 apply 夹档）。
//   ③ 拖组档：cs[G].position 跟随指针∧width/height≡freeze∧子 rel 逐帧不变（含远端 apply 夹档
//      ——让位 live 层=draggedGroupIds∪组内子代，手势三行表）。
//   ④ 门判据②分型（终裁 30/44③）：position 批∧无 session∧无 resize 批⇒零 intent+DEV 告警；
//      有 resize 批∧目标叶子⇒照常派发（现状锚）；目标为组⇒resize 会话零 intent+松手单提交
//      （提交值=会话末帧 cs 帧三键；子 rel 不随提交重算——RF 反向补偿值即终值；尾批零意图）。
//   ⑤ 分镜子 position 批按条目丢弃（识别按父组 groupType）；end 重放批落 session 内零告警。
//   ⑥ 拖动中远端改被拖节点 parentId ⇒ 放弃该节点保护按 doc 基准重算（防 rel 被当 abs 跳组原点）。
//   ⑦ resize 档 remove 谓词（远端删 resize 目标 ⇒ endGesture('removed')——B4'-1 质评结转缺口）。
//   ⑧ 手势期本地自删（onNodesChange remove during gesture ⇒ 结构批照常+endGesture('removed')）。
//   ⑨ baseline 时点=onNodeDragStart 时刻 cs 值；viewer 批零 doc 写；hidden 双向锚；cs 无
//      draggable/extent 键；拖 auto-collapsed 零帧键。
//
// 测试纪律：零裸 useCanvasStore.setState（文件级棘轮）；几何经 seedCanvas、session 经 store action。
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { applyDocToStore } from './canvasCollabRuntime';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { stampDocSchema, type DocNodeRecord } from '@flowweb/shared';
import { _setIntentDocForTest } from './canvasIntents';
import { seedCanvas, openRwWindow, openRoWindow, resetCanvasStores } from '@/test/fixtures/canvas';

const csNode = (id: string) => useCanvasStore.getState().nodes.find((n: any) => n.id === id) as any;
const session = () => useCanvasStore.getState().dragSession;

const SB_CONFIG = { aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: true, stitchResolution: '2K' };

/** 夹具：manual 组 g1(100,50,400×300)+双子（c1 abs(120,80)/c1b abs(200,90)）+auto 组 g2+子 c2+
 *  分镜组 sb1+分镜子 s1（无 position）+顶层 t1。 */
const FIXTURE: DocNodeRecord[] = [
  { id: 'g1', type: 'group', position: { x: 100, y: 50 }, width: 400, height: 300, data: { groupType: 'normal', name: 'manual' } },
  { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 120, y: 80 }, width: 100, height: 60, data: {} },
  { id: 'c1b', type: 'imageGen', parentId: 'g1', position: { x: 200, y: 90 }, width: 80, height: 50, data: {} },
  { id: 'g2', type: 'group', data: { groupType: 'normal', name: 'auto' } },
  { id: 'c2', type: 'imageGen', parentId: 'g2', position: { x: 300, y: 100 }, width: 200, height: 100, data: {} },
  { id: 'sb1', type: 'group', position: { x: 0, y: 400 }, data: { groupType: 'storyboard', cells: ['s1'], storyboard: SB_CONFIG } },
  { id: 's1', type: 'imageGen', parentId: 'sb1', width: 320, height: 180, data: {} },
  { id: 't1', type: 'textInput', position: { x: 700, y: 0 }, data: {} },
];

function buildDoc(): Y.Doc {
  const d = new Y.Doc();
  fillDoc(d, FIXTURE, []);
  stampDocSchema(toDocLike(d));
  return d;
}

/** 对端远端写（network 事务——applyDocToStore 消费的真实入口形态）。 */
function remoteMutate(d: Y.Doc, fn: (mirror: Y.Doc) => void): void {
  const B = new Y.Doc();
  Y.applyUpdate(B, Y.encodeStateAsUpdate(d));
  fn(B);
  Y.applyUpdate(d, Y.encodeStateAsUpdate(B), 'network');
}

const nodeMap = (d: Y.Doc, id: string) => d.getMap('nodes').get(id) as Y.Map<any>;
const docPos = (d: Y.Doc, id: string) => {
  const p = nodeMap(d, id).get('position') as Y.Map<any>;
  return p ? { x: p.get('x'), y: p.get('y') } : undefined;
};

/** doc 写入计数器（手势期零 intent 的判别面——network 事务不计入本地写）。 */
function docWriteCounter(d: Y.Doc) {
  let n = 0;
  const h = () => { n += 1; };
  d.on('update', h);
  return {
    count: () => n,
    stop: () => d.off('update', h),
  };
}

const begin = (ids: string[], pointerId: number | null = 1) =>
  useCanvasStore.getState().beginDragGesture(ids.map((id) => ({ id })), pointerId);

/** 手势帧（RF position 批形态——dragging:true）。 */
const frame = (id: string, x: number, y: number, dragging = true) =>
  useCanvasStore.getState().onNodesChange([{ type: 'position', id, position: { x, y }, dragging } as any]);

let warnSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  _setIntentDocForTest(null);
  // B5'-1：清残留会话走提交族收尾（doc 已摘 ⇒ commit 零写仅清 session——与旧 'completed' 清理
  // 同型）且不置 gestureAbandoned——abort 族清理会静默下一用例的门判据②告警（无界窗语义）
  const st = useCanvasStore.getState();
  if (st.dragSession) {
    if (st.dragSession.gestureKind === 'drag') st.commitIntents();
    else st.commitResizeGesture();
  }
  useCanvasStore.getState().endLeafResize();
  warnSpy?.mockRestore();
  resetCanvasStores();
});

// ══════════ ① 拖动单帧 doc 写入=0（根因锚） ══════════

describe("B4'-2 手势期零 intent（doc 写入=0）", () => {
  it('拖叶子（子节点）：RF 发 rel 批 ⇒ cs 落 rel ∧ doc.abs 逐位不动（rel-as-abs 洞关闭）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    expect(csNode('c1').position).toEqual({ x: 20, y: 30 });   // hydrate 后 rel（abs−origin）
    begin(['c1']);
    const wc = docWriteCounter(d);
    frame('c1', 45, 60);                                        // RF 对子发 rel 批
    expect(csNode('c1').position).toEqual({ x: 45, y: 60 });    // cs=手势活值（rel）
    expect(docPos(d, 'c1')).toEqual({ x: 120, y: 80 });         // doc.abs 逐位不动（旧路径此处被写成 45,60）
    expect(wc.count()).toBe(0);                                 // 零 intent=零事务
    wc.stop();
  });

  it('拖顶层节点：position 批 ⇒ cs 更新 ∧ doc 零写', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['t1']);
    const wc = docWriteCounter(d);
    frame('t1', 800, 10);
    expect(csNode('t1').position).toEqual({ x: 800, y: 10 });
    expect(docPos(d, 't1')).toEqual({ x: 700, y: 0 });
    expect(wc.count()).toBe(0);
    wc.stop();
  });

  it('多选跨组（两组子+顶层）：全部批零 intent，cs 各自更新（统一 abs 式提交归 B5\'-1）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['c1', 'c2', 't1']);
    const wc = docWriteCounter(d);
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'c1', position: { x: 30, y: 40 }, dragging: true } as any,
      { type: 'position', id: 'c2', position: { x: -10, y: 5 }, dragging: true } as any,
      { type: 'position', id: 't1', position: { x: 900, y: 20 }, dragging: true } as any,
    ]);
    expect(csNode('c1').position).toEqual({ x: 30, y: 40 });
    expect(csNode('c2').position).toEqual({ x: -10, y: 5 });
    expect(csNode('t1').position).toEqual({ x: 900, y: 20 });
    expect(wc.count()).toBe(0);
    expect(docPos(d, 'c1')).toEqual({ x: 120, y: 80 });
    expect(docPos(d, 'c2')).toEqual({ x: 300, y: 100 });
    expect(docPos(d, 't1')).toEqual({ x: 700, y: 0 });
    wc.stop();
  });

  it('拖 auto-collapsed 组：手势全程 doc 零帧键（auto 组不中途变 manual）', () => {
    openRwWindow();
    const d = buildDoc();
    const records: DocNodeRecord[] = [
      { id: 'g4', type: 'group', data: { groupType: 'normal', collapsed: true, name: 'ac' } },
      { id: 't1', type: 'textInput', position: { x: 700, y: 0 }, data: {} },
    ];
    fillDoc(d, records, []);
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['g4']);
    frame('g4', 500, 200);
    useCanvasStore.getState().endGesture('healed');
    expect(nodeMap(d, 'g4').get('width')).toBeUndefined();
    expect(nodeMap(d, 'g4').get('height')).toBeUndefined();
    expect(nodeMap(d, 'g4').get('position')).toBeUndefined();   // 零帧键（含 position）
  });
});

// ══════════ ②③ 拖叶档/拖组档逐帧锚 ══════════

describe("B4'-2 帧原点逐帧恒等（拖叶档——父组帧冻结）", () => {
  it('真实 position 批+远端改无关节点夹档 ⇒ 冻结组帧三字段逐帧不变∧被拖子=手势活值', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['c1']);
    frame('c1', 45, 60);
    remoteMutate(d, (B) => {
      nodeMap(B, 't1').get('position').set('x', 950);
      nodeMap(B, 't1').get('position').set('y', 5);
    });
    applyDocToStore(d);
    expect(csNode('g1').position).toEqual({ x: 100, y: 50 });   // 冻结帧三字段
    expect(csNode('g1').width).toBe(400);
    expect(csNode('g1').height).toBe(300);
    expect(csNode('c1').position).toEqual({ x: 45, y: 60 });    // 手势活值
    expect(csNode('c1b').position).toEqual({ x: 100, y: 40 });  // 兄弟子 rel 不变
    expect(csNode('t1').position).toEqual({ x: 950, y: 5 });    // 无关节点取远端值
  });
});

describe("B4'-2 拖组逐帧锚（终裁 56：origin 活/尺寸冻结/子 rel 逐帧不变）", () => {
  it('cs[G].position 跟随指针 ∧ width/height≡freeze ∧ 子 rel 不变（本地帧）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['g1']);
    expect(session()!.draggedGroupIds.has('g1')).toBe(true);
    const wc = docWriteCounter(d);
    frame('g1', 130, 70);
    frame('g1', 160, 90);
    expect(csNode('g1').position).toEqual({ x: 160, y: 90 });   // origin 活——跟随指针
    expect(csNode('g1').width).toBe(400);                       // 尺寸冻结
    expect(csNode('g1').height).toBe(300);
    expect(csNode('c1').position).toEqual({ x: 20, y: 30 });    // 子 rel 逐帧不变（RF 拖组不发子批）
    expect(csNode('c1b').position).toEqual({ x: 100, y: 40 });
    expect(wc.count()).toBe(0);                                 // 手势期 doc 零写
    wc.stop();
  });

  it('拖组中远端改无关节点（applyDocToStore 夹档）⇒ 子 rel 仍逐帧不变（让位 live 层=draggedGroupIds∪组内子代）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['g1']);
    frame('g1', 130, 70);
    remoteMutate(d, (B) => {
      nodeMap(B, 't1').get('position').set('x', 999);
      nodeMap(B, 't1').get('position').set('y', 999);
    });
    applyDocToStore(d);
    expect(csNode('g1').position).toEqual({ x: 130, y: 70 });   // origin 活值保护
    expect(csNode('g1').width).toBe(400);
    expect(csNode('g1').height).toBe(300);
    expect(csNode('c1').position).toEqual({ x: 20, y: 30 });    // 子 rel 不被 rebase（doc.abs 固定+活 origin 的 rebase 被让位挡住）
    expect(csNode('c1b').position).toEqual({ x: 100, y: 40 });
    expect(csNode('t1').position).toEqual({ x: 999, y: 999 });
  });
});

// ══════════ ④ 门判据②分型（终裁 30/44③） ══════════

describe("B4'-2 门判据②分型", () => {
  it('position 批 ∧ 无 session ∧ 无 resize 批 ⇒ 零 intent+DEV 告警（viewer 同款零 doc 写）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    const wc = docWriteCounter(d);
    frame('t1', 800, 10, false);                                // 无 session 的裸 position 批（外视写入）
    expect(wc.count()).toBe(0);                                 // 零 intent
    expect(csNode('t1').position).toEqual({ x: 800, y: 10 });   // cs 照常吞 RF 批（受控面一致）
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('B4\'-2'));
    wc.stop();
  });

  it('只读窗口（viewer）：无 session position 批 ⇒ doc 零写（nodesDraggable 门外的兜底锚）', () => {
    openRoWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    const wc = docWriteCounter(d);
    frame('t1', 800, 10, false);
    expect(wc.count()).toBe(0);
    expect(docPos(d, 't1')).toEqual({ x: 700, y: 0 });
    wc.stop();
  });

  it('gestureAbandoned 置位后静默（heal 后同手势尾批零告警零 intent）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['t1']);
    frame('t1', 750, 10);
    useCanvasStore.getState().endGesture('healed');             // 自愈收尾（含 gestureAbandoned 置位）
    expect(session()).toBeNull();
    warnSpy!.mockClear();
    frame('t1', 760, 12, false);                                // 同手势尾批（session 已清）
    expect(warnSpy).not.toHaveBeenCalled();
    expect(docPos(d, 't1')).toEqual({ x: 700, y: 0 });
  });

  it('end 重放批（dragging:false）落 session 内 ⇒ 零告警零 intent（F1：重放先于 onNodeDragStop）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['t1']);
    frame('t1', 810, 15, false);                                // RF 拖动结束重放批形态
    expect(warnSpy).not.toHaveBeenCalled();
    expect(csNode('t1').position).toEqual({ x: 810, y: 15 });
    expect(docPos(d, 't1')).toEqual({ x: 700, y: 0 });
  });

  it('有 resize 批 ∧ 目标为叶子 ⇒ 照常派发（现状锚：setAttributes 三态+position 并入 envelope 三键+零告警）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 't1', position: { x: 690, y: 5 } } as any,   // 左上柄位移（同批先于 dimensions）
      { type: 'dimensions', id: 't1', setAttributes: true, resizing: true, dimensions: { width: 220, height: 130 } } as any,
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(nodeMap(d, 't1').get('width')).toBe(220);             // envelope 三键落 doc（现状路径）
    expect(nodeMap(d, 't1').get('height')).toBe(130);
    expect(docPos(d, 't1')).toEqual({ x: 690, y: 5 });
    expect(csNode('t1').width).toBe(220);                        // 松手重载不回跳（doc=cs 同 tick）
  });

  it('叶子 resizePending 标记（三叶子 resizer 接线）：置位期间 position-only 批照常派发零告警', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    useCanvasStore.getState().beginLeafResize();
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 't1', position: { x: 695, y: 8 }, dragging: false } as any,
    ]);
    expect(warnSpy).not.toHaveBeenCalled();                      // resizePending 豁免（终裁 30）
    expect(docPos(d, 't1')).toEqual({ x: 695, y: 8 });           // 逐帧落 doc（叶子 resize 现状）
    useCanvasStore.getState().endLeafResize();
  });

  it('resizePending 悬挂兜底（spec 评发现#1——RF resizeDetected 守卫跳过 onResizeEnd 的只点不拖）：'
    + 'pointerup 一次性兜底清 ⇒ 标记不悬挂（后续 position 批恢复门判据②告警+固化不再被永久抑制）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    useCanvasStore.getState().beginLeafResize();
    expect(useCanvasStore.getState().resizePending).toBe(true);
    window.dispatchEvent(new Event('pointerup'));                 // 只点不拖：无 onResizeEnd、pointerup 兜底
    expect(useCanvasStore.getState().resizePending).toBe(false);  // 悬挂关闭
  });

  it('混批固化不丢（spec 评发现#2）：position+非 setAttributes dimensions 同批（无 session）⇒ 告警照发'
    + '且首测固化候选仍收集（告警分支不吞 fixCandidates）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    // t1=textInput 且 doc 无 wh ⇒ 首测固化候选（dispatchFixtureSizeIntents 类型限定）
    expect((d.getMap('nodes').get('t1') as any).get('width')).toBeUndefined();
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 't1', position: { x: 33, y: 44 } } as any,                       // 外视 position（告警面）
      { type: 'dimensions', id: 't1', dimensions: { width: 300, height: 300 } } as any,        // 首测批（非 setAttributes）
    ]);
    expect(warnSpy).toHaveBeenCalled();                            // 门判据②告警照发
    expect((d.getMap('nodes').get('t1') as any).get('width')).toBe(300);   // 固化候选未被同批 position 吞
  });
});

// ══════════ ④b resize 会话（组目标——终裁 56） ══════════

describe("B4'-2 resize 会话（目标为组：零 intent+松手单提交）", () => {
  it('组 resize 全程 doc 零写（帧三键=指针推算落 cs）+子 abs 逐位不变（RF 反向补偿值即终值）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    useCanvasStore.getState().beginResize('g1', 9);
    const wc = docWriteCounter(d);
    // 左上柄帧：组 origin 位移+扩尺寸+子 rel 反向补偿（RF 批形态——同批 position 先于 dimensions）
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'g1', position: { x: 90, y: 45 } } as any,
      { type: 'dimensions', id: 'g1', setAttributes: true, resizing: true, dimensions: { width: 410, height: 305 } } as any,
      { type: 'position', id: 'c1', position: { x: 30, y: 35 }, dragging: true } as any,   // 补偿后 rel
      { type: 'position', id: 'c1b', position: { x: 110, y: 45 }, dragging: true } as any,
    ]);
    expect(csNode('g1').position).toEqual({ x: 90, y: 45 });     // 帧三键=指针推算
    expect(csNode('g1').width).toBe(410);
    expect(csNode('g1').height).toBe(305);
    expect(csNode('c1').position).toEqual({ x: 30, y: 35 });
    // 子 abs 逐位不变：rel(30,35)+origin(90,45)=(120,80) ≡ 原 abs
    expect(csNode('c1').position.x + csNode('g1').position.x).toBe(120);
    expect(csNode('c1').position.y + csNode('g1').position.y).toBe(80);
    expect(docPos(d, 'c1')).toEqual({ x: 120, y: 80 });          // doc 子 abs 逐位不变（零子代写）
    expect(wc.count()).toBe(0);                                  // 会话期零 intent（含 dimensions 批）
    wc.stop();
  });

  it('松手单提交：commitResizeGesture ⇒ 单 envelope{三键}=会话末帧 cs 帧三键+零子代+尾批零意图', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    useCanvasStore.getState().beginResize('g1', 9);
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'g1', position: { x: 90, y: 45 } } as any,
      { type: 'dimensions', id: 'g1', setAttributes: true, resizing: true, dimensions: { width: 410, height: 305 } } as any,
      { type: 'position', id: 'c1', position: { x: 30, y: 35 }, dragging: true } as any,
    ]);
    const wc = docWriteCounter(d);
    useCanvasStore.getState().commitResizeGesture();             // onResizeEnd（第二参值=末帧——本实现读 cs 末帧单源）
    expect(wc.count()).toBe(1);                                  // 单 transact 单提交
    wc.stop();
    expect(docPos(d, 'g1')).toEqual({ x: 90, y: 45 });           // 提交值=末帧 cs 帧三键
    expect(nodeMap(d, 'g1').get('width')).toBe(410);
    expect(nodeMap(d, 'g1').get('height')).toBe(305);
    expect(docPos(d, 'c1')).toEqual({ x: 120, y: 80 });          // 零子代——子 rel 不随提交重算（doc abs 不动）
    expect(session()).toBeNull();                                // 收尾清 session
    expect(csNode('g1').position).toEqual({ x: 90, y: 45 });     // cs≡doc 收敛（不回跳）
    expect(csNode('c1').position).toEqual({ x: 30, y: 35 });     // RF 补偿值即终值（reconcile 同值）
    // 尾批（onEnd resizing:false 无 setAttributes——F10）：session 已清 ⇒ 零意图（组非 textInput）
    const wc2 = docWriteCounter(d);
    useCanvasStore.getState().onNodesChange([
      { type: 'dimensions', id: 'g1', resizing: false, dimensions: { width: 410, height: 305 } } as any,
    ]);
    expect(wc2.count()).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
    wc2.stop();
    expect(nodeMap(d, 'g1').get('width')).toBe(410);             // 无第二次写
  });

  it('auto 组 resize：会话期 doc 零帧键（不中途变 manual）+提交即唯一密封通道', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    useCanvasStore.getState().beginResize('g2', 9);
    useCanvasStore.getState().onNodesChange([
      { type: 'dimensions', id: 'g2', setAttributes: true, resizing: true, dimensions: { width: 500, height: 300 } } as any,
    ]);
    expect(nodeMap(d, 'g2').get('width')).toBeUndefined();       // 手势期零帧键
    expect(csNode('g2').width).toBe(500);                        // 预览帧活值
    useCanvasStore.getState().commitResizeGesture();
    expect(nodeMap(d, 'g2').get('width')).toBe(500);             // 提交=auto→manual 唯一通道
    expect(nodeMap(d, 'g2').get('height')).toBe(300);
    expect(docPos(d, 'g2')).toBeDefined();                       // 恒三键密封（position 回填）
  });

  it('resize 中远端写 ⇒ 预览帧不被 doc 旧值覆盖（merge 保护——O0b-3 resize 档真会话）+只点不拖零提交', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    useCanvasStore.getState().beginResize('g1', 9);
    useCanvasStore.getState().onNodesChange([
      { type: 'dimensions', id: 'g1', setAttributes: true, resizing: true, dimensions: { width: 500, height: 350 } } as any,
    ]);
    remoteMutate(d, (B) => {
      nodeMap(B, 'g1').set('width', 888);
      nodeMap(B, 't1').get('position').set('x', 999);
    });
    applyDocToStore(d);
    expect(csNode('g1').width).toBe(500);                        // 预览帧（指针推算）不被远端旧值覆盖
    expect(csNode('g1').height).toBe(350);
    expect(csNode('t1').position).toEqual({ x: 999, y: 0 });     // 无关节点取远端值
  });

  it('只点不拖（beginResize 无 resizing 批）⇒ 零提交零帧键（heal 收尾无残留）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    const wc = docWriteCounter(d);
    useCanvasStore.getState().beginResize('g1', 9);
    useCanvasStore.getState().endGesture('healed');              // 点而未拖——收尾
    expect(session()).toBeNull();
    expect(wc.count()).toBe(0);
    expect(nodeMap(d, 'g1').get('width')).toBe(400);             // doc 帧键原值未动
    wc.stop();
  });
});

// ══════════ ⑤ 分镜子批按条目丢弃+杂项锚 ══════════

describe("B4'-2 分镜子 position 批按条目丢弃（识别按父组 groupType）", () => {
  it('分镜子 position 批 ⇒ 条目丢弃（cs {0,0} 构造默认不动∧零告警零 intent）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    expect(csNode('s1').position).toEqual({ x: 0, y: 0 });
    const wc = docWriteCounter(d);
    frame('s1', 50, 50, false);
    expect(csNode('s1').position).toEqual({ x: 0, y: 0 });       // 数据层丢弃——不可移
    expect(wc.count()).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();                      // 丢弃后批内无 position——不触门判据②
    wc.stop();
  });

  it('混批：分镜子条目丢弃∧普通条目照常路由（同批不互相吞）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['t1', 's1']);                                         // 多选拖（session 在——两批均手势期）
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 's1', position: { x: 50, y: 50 }, dragging: true } as any,
      { type: 'position', id: 't1', position: { x: 750, y: 5 }, dragging: true } as any,
    ]);
    expect(csNode('s1').position).toEqual({ x: 0, y: 0 });       // 分镜子丢弃
    expect(csNode('t1').position).toEqual({ x: 750, y: 5 });     // 普通条目照常落 cs
  });
});

describe("B4'-2 baseline 时点+hidden 双向+cs 键集", () => {
  it('baseline 时点=onNodeDragStart 时刻 cs 值（begin 前的 cs 变更计入快照）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    seedCanvas(useCanvasStore.getState().nodes.map((n: any) => (
      n.id === 't1' ? { ...n, position: { x: 710, y: 2 } } : n   // begin 前位移（模拟上一命令尾）
    )));
    begin(['t1']);
    expect(session()!.baseline.get('t1')).toMatchObject({ x: 710, y: 2 });
    frame('t1', 800, 10);
    useCanvasStore.getState().endGesture('aborted');
    expect(csNode('t1').position).toEqual({ x: 700, y: 0 });     // 回滚后 reconcile 直拷 doc（过渡期收尾语义）
  });

  it('hidden 双向锚：拖动中远端折叠/展开父组 ⇒ 被拖子 hidden 即时翻转（数据域不受让位）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['c1']);
    frame('c1', 45, 60);
    remoteMutate(d, (B) => { (B.getMap('nodes').get('g1') as Y.Map<any>).get('data').set('collapsed', true); });
    applyDocToStore(d);
    expect(csNode('c1').hidden).toBe(true);                      // 折叠⇒即时 hidden
    expect(csNode('c1').position).toEqual({ x: 45, y: 60 });     // 几何仍保护
    remoteMutate(d, (B) => { (B.getMap('nodes').get('g1') as Y.Map<any>).get('data').set('collapsed', false); });
    applyDocToStore(d);
    expect(csNode('c1').hidden).toBeFalsy();                     // 展开⇒即时恢复
  });

  it('cs 无 draggable/extent 键（手势全程+resize 会话全程）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['c1', 't1']);
    frame('c1', 30, 40);
    frame('t1', 720, 5);
    useCanvasStore.getState().beginResize('g1', 9);
    useCanvasStore.getState().onNodesChange([
      { type: 'dimensions', id: 'g1', setAttributes: true, resizing: true, dimensions: { width: 420, height: 320 } } as any,
    ]);
    useCanvasStore.getState().commitResizeGesture();
    for (const n of useCanvasStore.getState().nodes) {
      expect((n as any).extent).toBeUndefined();
      expect((n as any).draggable).toBeUndefined();
    }
  });

  it('三行表刷新逐位不变：resize 提交后 applyDocToStore 重放 ⇒ 帧三键与子 rel 逐位稳定', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    useCanvasStore.getState().beginResize('g1', 9);
    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'g1', position: { x: 90, y: 45 } } as any,
      { type: 'dimensions', id: 'g1', setAttributes: true, resizing: true, dimensions: { width: 410, height: 305 } } as any,
      { type: 'position', id: 'c1', position: { x: 30, y: 35 }, dragging: true } as any,
    ]);
    useCanvasStore.getState().commitResizeGesture();
    const before = useCanvasStore.getState().nodes.map((n: any) => ({ id: n.id, p: { ...n.position }, w: n.width, h: n.height }));
    applyDocToStore(d);                                          // 刷新重放
    const after = useCanvasStore.getState().nodes.map((n: any) => ({ id: n.id, p: { ...n.position }, w: n.width, h: n.height }));
    expect(after).toEqual(before);
  });
});

// ══════════ ⑥⑦⑧ 保护放弃+remove 谓词+本地自删 ══════════

describe("B4'-2 拖动中远端改被拖节点 parentId ⇒ 放弃保护按 doc 基准重算", () => {
  it('对端 undo 删组（子顶层化）⇒ 该节点保护放弃：cs=doc 基准 abs（rel 不被当 abs 跳组原点）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['c1']);
    frame('c1', 45, 60);                                         // 手势活值 rel（相对 g1）
    remoteMutate(d, (B) => {                                     // 对端 undo：删组+子顶层化（abs 保持视觉位）
      B.getMap('nodes').delete('g1');
      const c1 = B.getMap('nodes').get('c1') as Y.Map<any>;
      c1.delete('parentId');                                     // 顶层化
      c1.set('position', new Y.Map([['x', 145], ['y', 110]]));   // 顶层 abs=手势视觉位
    });
    applyDocToStore(d);
    expect(csNode('c1').parentId ?? null).toBeNull();            // 顶层化取 doc 最新值
    expect(csNode('c1').position).toEqual({ x: 145, y: 110 });   // doc 基准 abs（旧保护回写会落 45,60=跳组原点）
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === 'g1')).toBe(false);
  });
});

describe("B4'-2 remove 谓词扩展（B4'-1 质评结转：resizeTargetId 缺口）", () => {
  it('resize 会话中远端删 resize 目标 ⇒ endGesture("removed")（帧回滚组已删自然跳过）', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    useCanvasStore.getState().beginResize('g1', 9);
    useCanvasStore.getState().onNodesChange([
      { type: 'dimensions', id: 'g1', setAttributes: true, resizing: true, dimensions: { width: 500, height: 350 } } as any,
    ]);
    remoteMutate(d, (B) => {
      B.getMap('nodes').delete('c1');
      B.getMap('nodes').delete('c1b');
      B.getMap('nodes').delete('g1');
    });
    applyDocToStore(d);
    expect(session()).toBeNull();                                // remove 谓词命中（旧守卫只查 draggingIds——缺口）
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === 'g1')).toBe(false);
    expect(csNode('t1').position).toEqual({ x: 700, y: 0 });
  });
});

describe("B4'-2 手势期本地自删（onNodesChange remove during gesture）", () => {
  it('remove 结构批照常路由（doc 删）+被拖集合成员被删 ⇒ endGesture("removed") 幸存者回 baseline', () => {
    openRwWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['c1', 't1']);
    frame('t1', 800, 10);
    useCanvasStore.getState().onNodesChange([
      { type: 'remove', id: 'c1' } as any,                       // 拖动中本地删除被拖成员（键盘 Delete）
    ]);
    expect(nodeMap(d, 'c1')).toBeUndefined();                    // 结构批照常落 doc
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === 'c1')).toBe(false);
    expect(session()).toBeNull();                                // 会话收尾（removed）
    expect(csNode('t1').position).toEqual({ x: 700, y: 0 });     // 幸存者回 baseline（reconcile 后=doc 基线）
    expect(csNode('g1').position).toEqual({ x: 100, y: 50 });    // 组帧善后完好
  });
});
