// apps/web/src/stores/canvasO0b2.sizing.test.ts
// O0b-2（Spec B）：尺寸真源完整链（四写者）+投影层几何键全删+台账五件。
//
// 四写者（附录二/卡五——节点类型×wh 权威表）：
//   (i)   命令体显式值：copyPlan wh→intent.node 带 wh→fillDoc 落 doc→副本 cs.wh=原件逐位+同 tick；
//         建组组行带 deriveGroupFrame 输出；addChildNode(s) intent.node 扩 wh 键；分镜落子/生成结果入组
//         wh=命令体显式值（hidden 无 load 事件永不内容事件永不固化）。
//   (ii)  内容事件写者（允许覆盖）：图片 load/换图比例/替换/拼接完成/视频元数据经 updateNodeEnvelope{wh}
//         Origin.Geometry；触发禁令=仅 DOM/回调事件（禁测量触发/禁 cs.wh 变更触发/禁 data 变更触发——
//         防 live-lock）；同值去重（写前比对同值⇒零 intent——"同值重复触发⇒doc 零 update"）；
//         multiImage=组件显式上报（四类触发点；公式单源 shared multiImageSize）；onError/broken fileId
//         兜底 wh 必然落定。
//   (iii) 首测固化兜底（降兜底档）：仅 doc 无 wh∧仅 textInput 类（内容型退出）；dimensions 批
//         （无 setAttributes∧非手势期）⇒同 tick 批量合并单 transact 恰一次 envelope{wh}（Origin.Geometry
//         不入撤销栈；normalizeSize=Math.ceil）；首写者胜仅本类；不与 LocalUser 提交同 transact 合批。
//   (iv)  resize 提交（现状已有——保通锚）。
//
// 台账五件：(a) 写域① auto 展开档 wh 接管+键集判定 doc-oracle 化（toDocRecords 第三参——shared 侧
// 纯函数锚在 docShape.toDocRecords.test.ts）；(b) applyGroupFrame 帧键落 doc 面一并收口（零泄漏断言；
// 函数本体退役归 O0b-5）；(c) reconcile 'doc' 源 crec 缺失子 fallbackAbs 维度混用结构修法（排除该子）；
// (d) deriveGroupFrame storyboard 分支冗余并（行为不变锚已有——无新测试）；(e) DEV 分镜 config 门
// throw 窗口批后复核（登记——现执行序下窗口不可达：patchGroupData doc 先写/mergeStoryboard 新组
// rec 缺席回落 cs data，无新测试）。
import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import * as Y from 'yjs';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { applyDocToStore, reconcileGroupGeometry, readGroupFrameModes } from './canvasCollabRuntime';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { stampDocSchema, calcStoryboardSize, normalizeSize, type DocNodeRecord } from '@flowweb/shared';
import {
  _setIntentDocForTest, dispatchCanvasIntent, captureStoreProjection, dispatchProjectionDiff,
  reportNodeSize,
} from './canvasIntents';
import { Origin, attachUndoManager, detachUndoManager } from './canvasUndo';
import { seedCanvas, makeChild, makeGroup, openRwWindow, resetCanvasStores } from '@/test/fixtures/canvas';
import { contentEventSize } from '@flowweb/shared';

const csNode = (id: string) => useCanvasStore.getState().nodes.find((n: any) => n.id === id) as any;

function docRecord(d: Y.Doc, id: string): DocNodeRecord | undefined {
  const m = d.getMap('nodes').get(id);
  if (!(m instanceof Y.Map)) return undefined;
  const posV = m.get('position');
  return {
    id,
    type: m.get('type') as string,
    ...(m.get('parentId') != null ? { parentId: m.get('parentId') as string } : {}),
    ...(posV instanceof Y.Map ? { position: { x: posV.get('x') as number, y: posV.get('y') as number } } : {}),
    ...(m.get('width') != null ? { width: m.get('width') as number } : {}),
    ...(m.get('height') != null ? { height: m.get('height') as number } : {}),
    data: m.get('data') instanceof Y.Map ? Object.fromEntries([...(m.get('data') as Y.Map<any>).entries()]) : {},
  };
}

function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = path.dirname(cur);
  }
  throw new Error('repo root not found');
}
const REPO_ROOT = findRepoRoot(process.cwd());
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

afterEach(() => {
  _setIntentDocForTest(null);
  detachUndoManager();
  resetCanvasStores();   // fixture 单点——测试文件零直接 useCanvasStore.setState（文件级棘轮纪律）
});

// ══════════ (i) 命令体显式值 ══════════

describe('O0b-2 (i) 命令体显式值：addChildNode(s) intent.node 扩 wh 键（终裁 59①[i]——删 customSize 后初始尺寸显式形参）', () => {
  it('addChildNode data 携 wh⇒提到信封：doc 落 wh（normalizeSize ceil）∧cs 同 tick wh=值∧data 不带 wh 键', () => {
    openRwWindow();
    const d = new Y.Doc();
    stampDocSchema(toDocLike(d));
    _setIntentDocForTest(d);
    seedCanvas([makeChild({ id: 'src', type: 'imageGen', position: { x: 0, y: 0 }, width: 400, height: 300, data: { status: 'done' } })]);
    useNodeStore.setState({ nodes: { src: { id: 'src', type: 'imageGen', data: { status: 'done' } } } as any });
    const id = useCanvasStore.getState().addChildNode('src', { status: 'done', fileId: 'f1', width: 555.4, height: 333.2 });
    expect(id).toBeTruthy();
    const rec = docRecord(d, id!);
    expect(rec?.width).toBe(556);   // ceil(555.4)——命令体显式值经 normalizeSize 单源
    expect(rec?.height).toBe(334);  // ceil(333.2)
    expect(rec?.data.width).toBeUndefined();  // wh 是信封键——不落 data
    expect(csNode(id!).width).toBe(556);      // 同 tick（reconcile 写域③直拷）
    expect(csNode(id!).height).toBe(334);
  });

  it('addChildNode data 无 wh⇒intent.node 不带 wh 键（doc 无 wh——内容事件/固化路径接管）', () => {
    openRwWindow();
    const d = new Y.Doc();
    stampDocSchema(toDocLike(d));
    _setIntentDocForTest(d);
    seedCanvas([makeChild({ id: 'src', type: 'imageGen', position: { x: 0, y: 0 }, width: 400, height: 300, data: { status: 'done' } })]);
    useNodeStore.setState({ nodes: { src: { id: 'src', type: 'imageGen', data: { status: 'done' } } } as any });
    const id = useCanvasStore.getState().addChildNode('src', { status: 'idle' })!;
    expect(docRecord(d, id)?.width).toBeUndefined();
    expect(docRecord(d, id)?.height).toBeUndefined();
  });

  it('addChildNodes 同通道：item.data 携 wh⇒逐节点信封落 doc（splitImage 命令体路径）', () => {
    openRwWindow();
    const d = new Y.Doc();
    stampDocSchema(toDocLike(d));
    _setIntentDocForTest(d);
    seedCanvas([makeChild({ id: 'src', type: 'imageGen', position: { x: 0, y: 0 }, width: 400, height: 300, data: { status: 'done' } })]);
    useNodeStore.setState({ nodes: { src: { id: 'src', type: 'imageGen', data: { status: 'done' } } } as any });
    const ids = useCanvasStore.getState().addChildNodes('src', [
      { data: { status: 'done', fileId: 'a', width: 200.4, height: 100 }, gridRow: 0, gridCol: 0 },
      { data: { status: 'done', fileId: 'b' }, gridRow: 0, gridCol: 1 },
    ]);
    expect(docRecord(d, ids[0])?.width).toBe(201);   // ceil(200.4)
    expect(docRecord(d, ids[0])?.height).toBe(100);
    expect(docRecord(d, ids[1])?.width).toBeUndefined();  // 无 wh⇒不带键
  });
});

describe('O0b-2 (i) 命令体显式值：复制链迁 doc 源（锚"复制从未 resize 图片节点⇒副本 doc wh≡源 doc wh；源无 wh⇒副本无 wh 键"）', () => {
  function setupDoc(records: DocNodeRecord[]): Y.Doc {
    const d = new Y.Doc();
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    _setIntentDocForTest(d);
    return d;
  }

  it('源 doc 有 wh（从未 resize 图片节点）⇒duplicateNodes 副本 doc wh≡源 doc wh 逐位', () => {
    openRwWindow();
    const d = setupDoc([
      { id: 'img', type: 'imageGen', position: { x: 100, y: 100 }, width: 320, height: 180, data: { status: 'done', fileId: 'f' } },
    ]);
    useNodeStore.setState({ nodes: { img: { id: 'img', type: 'imageGen', data: { status: 'done', fileId: 'f' } } } as any });
    const copyId = useCanvasStore.getState().duplicateNodes(['img']);
    expect(copyId).toBeTruthy();
    const src = docRecord(d, 'img');
    const copy = docRecord(d, copyId!);
    expect(copy?.width).toBe(src?.width);      // ≡源 doc wh（measured 不经 copyPlan 进 doc）
    expect(copy?.height).toBe(src?.height);
    expect(csNode(copyId!).width).toBe(320);   // cs 同 tick（reconcile 写域③）
  });

  it('源 doc 无 wh⇒副本 intent.node 不带 wh 键（doc 无 wh——measured 第 5 写者路径封死）', () => {
    openRwWindow();
    const d = setupDoc([
      { id: 'img2', type: 'imageGen', position: { x: 100, y: 100 }, data: { status: 'idle' } },
    ]);
    useNodeStore.setState({ nodes: { img2: { id: 'img2', type: 'imageGen', data: { status: 'idle' } } } as any });
    // cs 注入 measured（RF 首测形态——fixture 写者上下文）
    seedCanvas(useCanvasStore.getState().nodes.map((nd: any) => (
      nd.id === 'img2' ? { ...nd, measured: { width: 999, height: 888 } } : nd
    )));
    const copyId = useCanvasStore.getState().duplicateNodes(['img2'])!;
    expect(docRecord(d, copyId)?.width).toBeUndefined();  // measured≠doc wh——禁落 doc
    expect(docRecord(d, copyId)?.height).toBeUndefined();
  });
});

describe('O0b-2 (i) 命令体显式值：分镜落子/生成结果入组（hidden 无 load 事件⇒永不内容事件永不固化）', () => {
  it('addImageToStoryboardCell⇒doc wh=载荷尺寸（320×180 命令体——非渲染测量）', () => {
    openRwWindow();
    const d = new Y.Doc();
    const records: DocNodeRecord[] = [
      { id: 'sb', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: [], storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: true, stitchResolution: '2K' } } },
    ];
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    _setIntentDocForTest(d);
    useCanvasStore.getState().addImageToStoryboardCell('sb', 0, 'file-x');
    const sb = docRecord(d, 'sb');
    const cellId = (sb?.data.cells as string[])[0] as string;
    const cell = docRecord(d, cellId);
    expect(cell?.width).toBe(320);   // 命令体显式值（经差分 after 快照——分镜子 wh 自由面）
    expect(cell?.height).toBe(180);
    expect(csNode(cellId).width).toBe(320);
  });
});

// ══════════ (ii) 内容事件写者 ══════════

describe('O0b-2 (ii) 内容事件纯函数 contentEventSize（shared 单源——三分支决策；禁测量/cs.wh/data 触发的结构性收口=handler 只吃 DOM 事件参数）', () => {
  it('分支③ 无现存约束框⇒calcConstrainedSize(natural)（冷启动首帧非 ratioDimensions 兜底）', () => {
    const out = contentEventSize({ naturalW: 2000, naturalH: 1200, bounds: { maxW: 548, maxH: 500, minW: 200, minH: 100 } });
    expect(out.size).toEqual({ width: 548, height: 329 });   // ceil(328.8)
    expect(out.changed).toBe(true);
  });

  it('分支② 有现存框且比例未变⇒沿用当前 wh（"以当前 wh 为准"——重载/同比例换图不退默认，changed=false 零写）', () => {
    const out = contentEventSize({
      currentWH: { width: 700, height: 394 },
      existingAspectRatio: 16 / 9,
      naturalW: 1920, naturalH: 1080,
      bounds: { maxW: 548, maxH: 500, minW: 200, minH: 100 },
    });
    expect(out.size).toEqual({ width: 700, height: 394 });
    expect(out.changed).toBe(false);
  });

  it('分支① 比例变化⇒adaptToFit(当前框, 新比例)（contain-fit——wh=滚动约束框，行为等价现状 adaptCustomSize）', () => {
    const out = contentEventSize({
      currentWH: { width: 700, height: 394 },
      existingAspectRatio: 16 / 9,
      naturalW: 1080, naturalH: 1920,   // 竖图（比例 0.5625）——比例变化
      bounds: { maxW: 548, maxH: 500, minW: 200, minH: 100 },
    });
    // fitByWidth=394*0.5625=221.6≤700 ⇒ 高约束：{ceil(394*0.5625)=222, 394}
    expect(out.size).toEqual({ width: 222, height: 394 });
    expect(out.changed).toBe(true);
    expect(out.aspectRatio).toBeCloseTo(1080 / 1920);
  });

  it('resize 后换图⇒按新比例 contain-fit 重算（尊重用户约束框——锚:resize 到 W×H 再换图⇒wh=contain-fit(W×H,R2)）', () => {
    const out = contentEventSize({
      currentWH: { width: 900, height: 300 },   // 用户 resize 后的约束框
      existingAspectRatio: 3,
      naturalW: 3000, naturalH: 3000,           // 方图——比例变化
      bounds: { maxW: 548, maxH: 500, minW: 200, minH: 100 },
    });
    // fitByWidth=300/1=300≤900 ⇒ 高约束：{300, 300}
    expect(out.size).toEqual({ width: 300, height: 300 });
    expect(out.changed).toBe(true);
  });
});

describe('O0b-2 (ii) 内容事件 dispatch：reportNodeSize 同值去重+Geometry origin（不入撤销栈）', () => {
  it('同值重复触发⇒doc 零 update（终裁 83⑥——Y 层写前比对）；异值⇒doc 落 wh∧cs 同 tick 补齐', () => {
    openRwWindow();
    const d = new Y.Doc();
    const records: DocNodeRecord[] = [
      { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, width: 320, height: 180, data: {} },
    ];
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    _setIntentDocForTest(d);
    let docUpdates = 0;
    d.on('afterTransaction', (tr: any) => { if (tr.origin === Origin.Geometry) docUpdates++; });
    reportNodeSize('n1', 320, 180);   // 同值⇒零 intent
    expect(docUpdates).toBe(0);
    reportNodeSize('n1', 548, 309);   // 异值⇒恰一次
    expect(docUpdates).toBe(1);
    expect(docRecord(d, 'n1')?.width).toBe(548);
    expect(csNode('n1').width).toBe(548);   // reconcile 同 tick（写域③）
  });

  it('固化/内容事件 Origin.Geometry 不入撤销栈（undoStack 零捕获）', () => {
    openRwWindow();
    const d = new Y.Doc();
    const records: DocNodeRecord[] = [
      { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} },
    ];
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    const um = attachUndoManager(d);
    _setIntentDocForTest(d);
    reportNodeSize('n1', 548, 309);
    expect(um.undoStack.length).toBe(0);
  });
});

// ══════════ (iii) 首测固化兜底（降兜底档——仅 textInput 类）══════════

describe('O0b-2 (iii) 首测固化：onNodesChange dimensions 批（非 setAttributes∧非手势期）∧doc 无 wh∧textInput 类', () => {
  function setupTextInputDoc(): Y.Doc {
    const d = new Y.Doc();
    const records: DocNodeRecord[] = [
      { id: 't1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: 'a' } },
      { id: 't2', type: 'textInput', position: { x: 400, y: 0 }, data: { content: 'b' } },
      { id: 'img', type: 'imageGen', position: { x: 800, y: 0 }, data: {} },
    ];
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    _setIntentDocForTest(d);
    return d;
  }

  it('dimensions 批（setAttributes=false）textInput⇒doc 落 ceil wh∧批量合并单 transact 恰一次', () => {
    openRwWindow();
    const d = setupTextInputDoc();
    let geoTx = 0;
    d.on('afterTransaction', (tr: any) => { if (tr.origin === Origin.Geometry) geoTx++; });
    useCanvasStore.getState().onNodesChange([
      { id: 't1', type: 'dimensions', dimensions: { width: 200.4, height: 100.2 }, setAttributes: false } as any,
      { id: 't2', type: 'dimensions', dimensions: { width: 300, height: 200 }, setAttributes: false } as any,
    ]);
    expect(docRecord(d, 't1')?.width).toBe(201);   // normalizeSize ceil 单源
    expect(docRecord(d, 't1')?.height).toBe(101);
    expect(docRecord(d, 't2')?.width).toBe(300);
    expect(geoTx).toBe(1);                          // 批量合并单 transact
    expect(csNode('t1').width).toBe(201);           // cs 同 tick（reconcile 写域③）
  });

  it('首写者胜（仅本类）：doc 有 wh 后零固化 intent——后续测量≠doc 不写（doc 值保持）', () => {
    openRwWindow();
    const d = setupTextInputDoc();
    useCanvasStore.getState().onNodesChange([
      { id: 't1', type: 'dimensions', dimensions: { width: 200, height: 100 }, setAttributes: false } as any,
    ]);
    expect(docRecord(d, 't1')?.width).toBe(200);
    // 二次测量（值漂移）——首写者胜：零固化 intent
    useCanvasStore.getState().onNodesChange([
      { id: 't1', type: 'dimensions', dimensions: { width: 999, height: 999 }, setAttributes: false } as any,
    ]);
    expect(docRecord(d, 't1')?.width).toBe(200);   // doc 不被覆盖
  });

  it('内容型退出：imageGen dimensions（非 setAttributes）零固化——doc 零写', () => {
    openRwWindow();
    const d = setupTextInputDoc();
    useCanvasStore.getState().onNodesChange([
      { id: 'img', type: 'dimensions', dimensions: { width: 500, height: 400 }, setAttributes: false } as any,
    ]);
    expect(docRecord(d, 'img')?.width).toBeUndefined();  // 内容型退出固化——wh 归内容事件
  });

  it('固化不与 LocalUser 提交同 transact 合批（同批 remove+dimensions⇒Geometry 与 LocalUser 两 transact）', () => {
    openRwWindow();
    const d = setupTextInputDoc();
    const txOrigins: string[] = [];
    d.on('afterTransaction', (tr: any) => { txOrigins.push(tr.origin); });
    useCanvasStore.getState().onNodesChange([
      { id: 't2', type: 'dimensions', dimensions: { width: 300, height: 200 }, setAttributes: false } as any,
      { id: 'img', type: 'remove' } as any,
    ]);
    expect(txOrigins).toContain(Origin.Geometry);      // 固化独立 transact
    expect(txOrigins).toContain(Origin.LocalUser);     // remove 独立 transact
    expect(txOrigins.filter((o) => o === Origin.Geometry).length).toBe(1);
  });

  it('resize 提交（iv）保通：setAttributes=true dimensions⇒envelope 落 doc（LocalUser——现状链）', () => {
    openRwWindow();
    const d = setupTextInputDoc();
    useCanvasStore.getState().onNodesChange([
      { id: 'img', type: 'dimensions', dimensions: { width: 777, height: 444 }, setAttributes: true } as any,
    ]);
    expect(docRecord(d, 'img')?.width).toBe(777);   // resize 提交写者（现状保通）
    expect(docRecord(d, 'img')?.height).toBe(444);
  });
});

// ══════════ O0b-5（Spec B）：组 resize 提交=单 updateNodeEnvelope{三键}（终裁 50——不带 data 标记）══════════
// manual 组（doc 帧三键齐）是 resize 写者的密封面：提交=帧三键（position+width+height）单 intent
// 单 transact；markManuallyResized 删除后零 data 写。手势期 cs.width 每帧=活值（reconcile manual
// 档读 doc 活帧——无"回落到手势前 doc 值"档）。
describe('O0b-5 组 resize 提交（manual 组 rig——doc 帧三键齐）', () => {
  function setupManualGroupDoc(): Y.Doc {
    const d = new Y.Doc();
    const records: DocNodeRecord[] = [
      { id: 'gm', type: 'group', position: { x: 100, y: 50 }, width: 400, height: 300, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'gm', position: { x: 120, y: 80 }, width: 100, height: 60, data: {} },
    ];
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    _setIntentDocForTest(d);
    return d;
  }

  it('松手 afterTransaction=1：position+dimensions(setAttributes) 同批 ⇒ 单 updateNodeEnvelope{三键} 单 transact∧零 data 标记', () => {
    openRwWindow();
    const d = setupManualGroupDoc();
    let tx = 0;
    d.on('afterTransaction', () => { tx++; });   // 观察器在 setup 后挂——只计本次提交
    useCanvasStore.getState().onNodesChange([
      { id: 'gm', type: 'position', position: { x: 90, y: 40 } } as any,
      { id: 'gm', type: 'dimensions', dimensions: { width: 500, height: 380 }, setAttributes: true } as any,
    ]);
    expect(tx).toBe(1);   // 单 transact（拆 moveNode+envelope 双 dispatch / 外加 data 标记 dispatch 均红）
    const dm = d.getMap('nodes').get('gm') as Y.Map<any>;
    expect((dm.get('position') as Y.Map<any>).toJSON()).toEqual({ x: 90, y: 40 });   // 三键齐落 doc
    expect(dm.get('width')).toBe(500);
    expect(dm.get('height')).toBe(380);
    expect([...(dm.get('data') as Y.Map<any>).keys()]).toEqual(['groupType']);   // resize 提交不带 data 标记（manuallyResized 整链删）
  });

  it('cs.width 逐帧不回落：手势帧序列 340→280→500 每帧终值=活值（无回落到手势前 doc 值的档）', () => {
    openRwWindow();
    setupManualGroupDoc();
    const frames = [340, 280, 500];
    const seen: number[] = [];
    for (const w of frames) {
      useCanvasStore.getState().onNodesChange([
        { id: 'gm', type: 'dimensions', dimensions: { width: w, height: 300 }, setAttributes: true } as any,
      ]);
      seen.push(csNode('gm').width);
    }
    expect(seen).toEqual(frames);   // 每帧 cs.width=本帧活值（含收缩帧 280——回落 400/340 即红）
  });
});

// ══════════ O0b-5 质评收口 C-1：auto 组 dimensions-only 批（右/下柄）——恒三键密封 ══════════
// RF ResizeControl 仅左上方向柄同批发 position 变更；右/下柄发 dimensions-only 批（setAttributes）。
// 无 pos 回填时 auto 组（doc 0 帧键）resize 提交落 2 键部分帧形态——frameMode 判 auto ⇒ 漏斗尾
// reconcile('doc') 重派生 bbox 帧（resize 静默回弹）+违 assertNoAutoGroupFrameKeys 形态。
// 修=缺位回填 cs 现节点 position（手势末 auto 组=reconcile 派生帧 origin）——提交恒三键密封
// {position,width,height}，auto→manual 经 resize 转换（manuallyResized 删除后唯一通道）。
describe('O0b-5 质评收口 C-1：auto 组 dimensions-only resize 提交——pos 回填恒三键密封（终裁 50）', () => {
  function setupAutoGroupDoc(): Y.Doc {
    const d = new Y.Doc();
    const records: DocNodeRecord[] = [
      { id: 'ga', type: 'group', data: { groupType: 'normal' } },
      { id: 'k1', type: 'imageGen', parentId: 'ga', position: { x: 300, y: 100 }, width: 200, height: 100, data: {} },
      { id: 'k2', type: 'imageGen', parentId: 'ga', position: { x: 550, y: 100 }, width: 150, height: 80, data: {} },
    ];
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    _setIntentDocForTest(d);
    return d;
  }

  it('右/下柄批（无 position change）：doc 落三键∧frameMode=manual∧后续 reconcile 不回弹（2 键部分帧即红）', () => {
    openRwWindow();
    const d = setupAutoGroupDoc();
    // bbox: x∈[300,700] y∈[100,200] ⇒ 派生帧=(280,50,440,170)（applyDocToStore 尾 reconcile）
    expect(csNode('ga').position).toEqual({ x: 280, y: 50 });
    // RF 右/下柄方向：同批只有 dimensions（setAttributes:true）——无 position 变更
    useCanvasStore.getState().onNodesChange([
      { id: 'ga', type: 'dimensions', dimensions: { width: 800, height: 600 }, setAttributes: true } as any,
    ]);
    // (a) doc 组记录三键齐（2 键部分帧形态即红——auto 组携带帧键违 invariant 形态）
    const rec = docRecord(d, 'ga');
    expect(rec?.position).toEqual({ x: 280, y: 50 });   // 回填值=手势末 cs 帧 origin（reconcile 派生）
    expect(rec?.width).toBe(800);
    expect(rec?.height).toBe(600);
    // (c) 帧模式 auto→manual（resize=manuallyResized 删除后唯一密封转换通道）
    expect(readGroupFrameModes(d).get('ga')).toBe('manual');
    // (b) 下一次漏斗尾 reconcile('doc')：manual 密封源不动——帧不回弹到 bbox 派生值（440×170）
    reconcileGroupGeometry(d, 'doc');
    expect(csNode('ga').width).toBe(800);
    expect(csNode('ga').height).toBe(600);
    expect(csNode('ga').position).toEqual({ x: 280, y: 50 });
  });
});

// ══════════ 连带面：removeNodeFromGroup 分镜分支（分镜子 wh 陈旧收口——终裁 78④）══════════

describe('O0b-2 连带面：removeNodeFromGroup 分镜分支 placementBesideGroup envelope{wh=当前格尺寸}', () => {
  it('resizeStoryboardGrid 后移出格子⇒尺寸=当前格尺寸（非入格旧值）∧落点=帧右上外 20px∧cells 清槽（O0c-3）', () => {
    openRwWindow();
    const d = new Y.Doc();
    const records: DocNodeRecord[] = [
      { id: 'sb', type: 'group', position: { x: 100, y: 50 }, data: { groupType: 'storyboard', cells: ['c1'], storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: true, stitchResolution: '2K' } } },
      { id: 'c1', type: 'imageGen', parentId: 'sb', width: 320, height: 180, data: { status: 'done', fileId: 'f' } },
    ];
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    _setIntentDocForTest(d);
    // config 变更（2×2 + 1:1）后移出——格尺寸与入格旧值（320×180）在 height 维度可区分
    useCanvasStore.getState().resizeStoryboardGrid('sb', 2, 2);
    useCanvasStore.getState().updateStoryboardConfig('sb', { aspectRatio: '1:1' });
    const sbSize = calcStoryboardSize(2, 2, '1:1');   // {width:642, height:642, cellWidth:320, cellHeight:320}
    useCanvasStore.getState().removeNodeFromGroup('sb', 'c1');
    const out = docRecord(d, 'c1');
    expect(out?.width).toBe(normalizeSize(sbSize.cellWidth));   // 当前格尺寸（normalizeSize=Math.ceil 单源——非入格旧 180 高）
    expect(out?.height).toBe(normalizeSize(sbSize.cellHeight));
    expect(out?.height).not.toBe(180);                        // 鉴别力：height 随当前 config 而非入格旧值
    expect(out?.position).toEqual({ x: 100 + sbSize.width + 20, y: 50 });   // 帧右上外 20px（placementBesideGroup——基准=cs 派生帧）
    expect(out?.parentId).toBeUndefined();
    expect(csNode('c1').width).toBe(normalizeSize(sbSize.cellWidth));
    // O0c-3 分镜移出三坏收口锚：cells 清槽（槽===null——此前槽位残留 'c1' ⇒ GroupNode cellNodes
    // 谓词[cells.includes]漏渲染已移出节点；移出后 cellNodes 消失=槽 null ∧ parentId 已解双通道断开）
    expect(docRecord(d, 'sb')?.data.cells).toEqual([null]);
    expect((csNode('sb').data as any).cells).toEqual([null]);
  });
});

// ══════════ 台账 (a)(b)：写域① auto 展开档 wh 接管+键集 doc-oracle 化+applyGroupFrame 零泄漏 ══════════

describe('O0b-2 台账(a)(b)：reconcile 写域① auto 档写 wh 全三字段∧差分面 auto 帧键零泄漏（applyGroupFrame 收口）', () => {
  function setupAutoGroupDoc(): Y.Doc {
    const d = new Y.Doc();
    const records: DocNodeRecord[] = [
      { id: 'g', type: 'group', data: { groupType: 'normal' } },
      { id: 'a', type: 'imageGen', parentId: 'g', position: { x: 300, y: 100 }, width: 200, height: 100, data: {} },
      { id: 'b', type: 'imageGen', parentId: 'g', position: { x: 550, y: 100 }, width: 150, height: 80, data: {} },
    ];
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    _setIntentDocForTest(d);
    return d;
  }

  it('接管锚：cs auto 组 wh 被 seedCanvas 破坏后 reconcile(doc) 重写=deriveGroupFrame 派生值（wh 不再留现状链）', () => {
    openRwWindow();
    const d = setupAutoGroupDoc();
    seedCanvas(useCanvasStore.getState().nodes.map((nd: any) => (
      nd.id === 'g' ? { ...nd, width: 1, height: 1 } : nd
    )));
    reconcileGroupGeometry(d, 'doc');
    const expected = { x: 300 - 20, y: 100 - 50, width: 400 + 200 + 20, height: 100 + 50 + 20 };
    // bbox: x∈[300,700] y∈[100,200] ⇒ frame=(280,50,440,170)
    expect(csNode('g').width).toBe(440);
    expect(csNode('g').height).toBe(170);
    expect(csNode('g').position).toEqual({ x: 280, y: 50 });
    void expected;
  });

  it('零泄漏锚：applyGroupFrame 写 cs 帧后差分落 doc⇒doc auto 组仍 0 帧键（oracle 化收口——现状链泄漏面封死）', () => {
    openRwWindow();
    const d = setupAutoGroupDoc();
    // 命令：入组（触发 applyGroupFrame 守恒 refit 写 cs 帧三键）→差分
    seedCanvas([...useCanvasStore.getState().nodes,
      makeChild({ id: 'top', type: 'textInput', position: { x: 0, y: 0 }, data: {} })]);
    useNodeStore.setState({ nodes: { ...useNodeStore.getState().nodes, top: { id: 'top', type: 'textInput', data: {} } } as any });
    useCanvasStore.getState().addToGroup('g', 'top');
    const g = docRecord(d, 'g');
    expect(g?.position).toBeUndefined();   // doc auto 组 0 帧键（position 不落）
    expect(g?.width).toBeUndefined();
    expect(g?.height).toBeUndefined();
  });
});

// ══════════ 台账 (c)：reconcile 'doc' 源 crec 缺失子——排除该子（维度混用结构修法）══════════

describe('O0b-2 台账(c)：reconcile(doc) cs 有子而 doc 无记录⇒该子排除出帧 bbox（不掺 cs 活值——缺键排除）', () => {
  it('doc 只有组无子记录⇒帧=空 auto 组档 COLLAPSED_SIZE@fallbackOrigin（子活值不掺算术）', () => {
    openRwWindow();
    const d = new Y.Doc();
    const records: DocNodeRecord[] = [
      { id: 'g', type: 'group', data: { groupType: 'normal' } },
    ];
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    // cs 有组+幽灵子（doc 无记录——结构不可达窗口的防御面）
    seedCanvas([
      makeGroup({ id: 'g', position: { x: 100, y: 100 } }),
      makeChild({ id: 'ghost', parentId: 'g', position: { x: 9999, y: 9999 }, width: 500, height: 400 }),
    ]);
    reconcileGroupGeometry(d, 'doc');
    const g = csNode('g');
    expect(g.width).toBe(220);   // 空 auto 组档 COLLAPSED_SIZE（ghost 的 9999 活值未掺 bbox）
    expect(g.height).toBe(160);
  });
});

// ══════════ 连带面 census（符号级/形态级静态断言——删除类红相载体）══════════

describe('O0b-2 census：customSize 并入 envelope+contain-fit 单源+复制三档链形态', () => {
  /** 非注释行扫描（census 计数形态——注释自文档化提及相关符号名不算命中）。 */
  const codeLines = (rel: string): string[] =>
    readSrc(rel).split('\n').filter((raw) => {
      const line = raw.trim();
      return !(line.startsWith('//') || line.startsWith('*') || line.startsWith('/*'));
    });

  it('customSize 符号四面清零（nodeStore 类型/ImageGenNode/VideoGenNode/useStitchTask——非注释行）', () => {
    for (const rel of [
      'apps/web/src/stores/nodeStore.ts',
      'apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx',
      'apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx',
      'apps/web/src/hooks/useStitchTask.ts',
    ]) {
      expect(codeLines(rel).some((l) => l.includes('customSize')), `${rel} 仍含 customSize`).toBe(false);
    }
  });

  it('calcConstrainedSize 定义点=1（shared geometry.ts——三组件本地定义删除）+adaptCustomSize 符号不存在', () => {
    let defs = 0;
    for (const rel of [
      'packages/shared/src/canvas/geometry.ts',
      'apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx',
      'apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx',
      'apps/web/src/pages/canvas/components/nodes/MultiImageNode.tsx',
      'apps/web/src/utils/resizeUtils.ts',
    ]) {
      if (codeLines(rel).some((l) => l.includes('function calcConstrainedSize'))) defs++;
    }
    expect(defs).toBe(1);
    expect(codeLines('apps/web/src/utils/resizeUtils.ts').some((l) => l.includes('adaptCustomSize'))).toBe(false);
    // 消费面：三组件改 import shared 单源
    for (const rel of [
      'apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx',
      'apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx',
      'apps/web/src/pages/canvas/components/nodes/MultiImageNode.tsx',
    ]) {
      expect(readSrc(rel).includes('from \'@flowweb/shared\''), `${rel} 未消费 shared 尺寸单源`).toBe(true);
    }
  });

  it('census"除 RF 自身无组件直写 RF node.width/height"（终裁 49②——ImageGenNode 两处 setNodes 直写删除）', () => {
    for (const rel of [
      'apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx',
      'apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx',
    ]) {
      expect(codeLines(rel).some((l) => l.includes('setNodes(')), `${rel} 仍含 setNodes 直写（RF node.width/height 组件直写唯一违例面）`).toBe(false);
    }
  });

  it('canvasStore 复制/duplicate/落位族 A 类行三档链形态（doc wh 第一/measured 第二/常量最后——.measured 不得在链首）', () => {
    const src = readSrc('apps/web/src/stores/canvasStore.ts');
    const violations: string[] = [];
    for (const [i, raw] of src.split('\n').entries()) {
      if (!raw.includes('.measured?.width') && !raw.includes('.measured?.height')) continue;
      const line = raw.trim();
      if (line.startsWith('//') || line.startsWith('*')) continue;
      // A 类形态断言：.measured 命中必须在 ?? 链中且链首非 .measured（同行为 const x = a.measured?.width 直接取=违例）
      const before = line.split('.measured')[0];
      if (!before.includes('??')) violations.push(`canvasStore.ts:${i + 1}: ${line}`);
    }
    expect(violations, `measured 链首违例（应为 n.width ?? n.measured?.width ?? 常量）：\n${violations.join('\n')}`).toEqual([]);
  });

  it('product-node 视频导出尺寸迁三档链（A 类形态——链首非 .measured）', () => {
    const src = readSrc('apps/web/src/pages/canvas/video-editor/export/product-node.ts');
    const measuredLine = src.split('\n').find((l) => l.includes('.measured'));
    expect(measuredLine).toBeTruthy();
    expect(measuredLine!.indexOf('.measured')).toBeGreaterThan(measuredLine!.indexOf('width ??'));
  });

  it('multiImage 公式单源：组件消费 shared multiImageSize（本地 expandedW/H 算术删除）', () => {
    const src = readSrc('apps/web/src/pages/canvas/components/nodes/MultiImageNode.tsx');
    expect(src.includes('multiImageSize')).toBe(true);
    expect(src.includes('expandedW = Math.min(')).toBe(false);   // 本地公式定义删除（单源=shared）
  });
});

// ══════════ Step 3/4：投影层几何键全删（plan O0b-2 Step 3/4）══════════
// projectIntentToStore 三处几何直写删（moveNode case 整删/addNode position 结构默认/envelope 几何键）；
// cs 帧键由漏斗尾 reconcile('doc') 同 tick 补齐（写域①②③④）；absToCsPosition 过渡换算随删
//（projectCanvasNodes O0b-2 前瞻注释兑现）。分镜子节点构造恒带 position:{x:0,y:0} 结构默认。

describe('O0b-2 Step3/4 投影删：dispatch 几何 intent⇒投影后 cs 由 reconcile 同 tick 补齐', () => {
  function setupDoc(): Y.Doc {
    const d = new Y.Doc();
    stampDocSchema(toDocLike(d));
    _setIntentDocForTest(d);
    return d;
  }

  it('moveNode intent⇒doc position 更新∧cs position 同 tick≡doc.abs（reconcile 写域②——投影 moveNode case 已删）', () => {
    openRwWindow();
    const d = setupDoc();
    dispatchCanvasIntent({ type: 'addNode', node: { id: 'n1', type: 'textInput', position: { x: 10, y: 0 }, data: {} } }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'moveNode', id: 'n1', position: { x: 99, y: 88 } }, Origin.LocalUser);
    const m = d.getMap('nodes').get('n1') as Y.Map<any>;
    expect((m.get('position') as Y.Map<any>).toJSON()).toEqual({ x: 99, y: 88 });   // doc 面更新
    expect(csNode('n1').position).toEqual({ x: 99, y: 88 });                        // cs 同 tick 补齐
  });

  it('envelope{width,height} intent⇒投影后 cs 帧键零缺口（reconcile 写域③同 tick 补齐）', () => {
    openRwWindow();
    const d = setupDoc();
    dispatchCanvasIntent({ type: 'addNode', node: { id: 'n2', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'updateNodeEnvelope', id: 'n2', patch: { width: 777, height: 555 } }, Origin.LocalUser);
    expect(docRecord(d, 'n2')?.width).toBe(777);
    expect(csNode('n2').width).toBe(777);     // reconcile 同 tick（写域③ doc→cs 直拷）
    expect(csNode('n2').height).toBe(555);
  });

  it('addNode 分镜子⇒cs position={0,0} 结构默认∧组子 cs rel=doc.abs−帧 origin（reconcile 写域②④）', () => {
    openRwWindow();
    const d = setupDoc();
    dispatchCanvasIntent([
      { type: 'addNode', node: { id: 'sb', type: 'group', position: { x: 100, y: 50 }, data: { groupType: 'storyboard', cells: [], storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: true, stitchResolution: '2K' } } } },
      { type: 'addNode', node: { id: 'sc', type: 'imageGen', parentId: 'sb', width: 320, height: 180, data: {} } },
      { type: 'addNode', node: { id: 'gs', type: 'group', data: { groupType: 'normal' } } },
      { type: 'addNode', node: { id: 'gc', type: 'textInput', parentId: 'gs', position: { x: 300, y: 300 }, data: {} } },
    ], Origin.LocalUser);
    expect(csNode('sc').position).toEqual({ x: 0, y: 0 });       // 分镜子结构默认（写域④）
    // 普通组子：cs rel=doc.abs−帧 origin（写域②——reconcile 同 tick 补齐，非投影直写）
    const gAbs = docRecord(d, 'gs')?.position;
    expect(csNode('gc').position.x + (csNode('gs').position.x ?? gAbs?.x)).toBe(300);
  });
});

describe('O0b-2 Step3/4 census：canvasIntents 投影面几何直写清零', () => {
  const codeLines = (rel: string): string[] =>
    readSrc(rel).split('\n').filter((raw) => {
      const line = raw.trim();
      return !(line.startsWith('//') || line.startsWith('*') || line.startsWith('/*'));
    });

  it('absToCsPosition 符号不存在（过渡换算随删——projectCanvasNodes O0b-2 前瞻注释兑现）', () => {
    expect(codeLines('apps/web/src/stores/canvasIntents.ts').some((l) => l.includes('absToCsPosition'))).toBe(false);
  });

  it('projectIntentToStore 无 moveNode case（投影域 0——moveNode 构造点=提交/差分域）', () => {
    const src = readSrc('apps/web/src/stores/canvasIntents.ts');
    const fnIdx = src.indexOf('export function projectIntentToStore');
    expect(fnIdx).toBeGreaterThanOrEqual(0);
    const nextExport = src.indexOf('export ', fnIdx + 10);
    const body = src.slice(fnIdx, nextExport === -1 ? undefined : nextExport);
    expect(body.includes("case 'moveNode'")).toBe(false);
  });

  it('addNode 投影构造恒 {0,0} 结构默认∧updateNodeEnvelope 投影只写 type/parentId（卡二）', () => {
    const src = readSrc('apps/web/src/stores/canvasIntents.ts');
    const fnIdx = src.indexOf('export function projectIntentToStore');
    const nextExport = src.indexOf('export ', fnIdx + 10);
    const body = src.slice(fnIdx, nextExport === -1 ? undefined : nextExport);
    expect(body.includes('absToCsPosition')).toBe(false);
    expect(body.includes('position: { x: 0, y: 0 }')).toBe(true);   // 结构默认行在场
    // envelope case 不投影 width/height（几何键——reconcile 写域③ 单写者）
    const envIdx = body.indexOf("case 'updateNodeEnvelope'");
    const envBody = body.slice(envIdx, body.indexOf('case ', envIdx + 10) === -1 ? undefined : body.indexOf('case ', envIdx + 10));
    expect(envBody.includes('width')).toBe(false);
    expect(envBody.includes('height')).toBe(false);
  });
});
