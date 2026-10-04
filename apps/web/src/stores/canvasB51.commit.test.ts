// apps/web/src/stores/canvasB51.commit.test.ts
// B5'-1（Spec B）：commitIntents 三段式——拖动松手提交（终裁序：构造 intents[末帧差分]→清 session
// 同步块[无条件先于判空]→单 transact dispatch[Origin.LocalUser]+漏斗尾 reconcile 全域→invariant）。
//
// 红测试锚（plan B5'-1 / spec 终裁 48/66④/78⑩）：
//   ① 提交 origin=LocalUser（终裁 48——拖动一步 undo）：拖顶层/拖叶（冻结 origin 翻转 abs）/
//      拖组（N 子 abs+manual 帧三键）/auto 组拖动（零帧键）——各单 transact 单栈项。
//   ② 空操作手势⇒doc 零键零栈项零写事务+session 清（无条件——含 watchdog clearTimeout）。
//   ③ 零净变更=零事务（cs 往返 exact 回 baseline ⇒ 零 intent 零写）。
//   ④ 慢拖停顿单栈项（跨 captureTimeout 间歇不裂项——手势期零 intent+提交单 transact）。
//   ⑤ 终末对齐=reconcile 全域（集合废止——唯一豁免=让位集合）：拖 auto 组子远超帧⇒提交后 auto
//      帧重派生≡bbox+padding（非冻结值）——收尾链"清 session 先于 dispatch"不可交换锚。
//   ⑥ 松手时序：RF 尾批（dragging:false）先于 onNodeDragStop 落 session 内；commit 后 heal 再触发
//      =no-op（cs 稳定+doc 零新写）。
//   ⑦ 结构性断言（终裁 78⑩——防未来复用重演 P0-10）：commitIntents 调用图不含 endGesture∧无自有
//      reconcile 调用点（提交收尾=漏斗尾 reconcile，transact 先于收尾）；endGesture=abort 族三分支
//      （'completed' 退役）；commitResizeGesture 同为提交族（不经 endGesture）。
//   ⑧ resize 会话不经 commitIntents（幂等守卫——resize 提交=commitResizeGesture 专属）。
//
// 测试纪律：零裸 useCanvasStore.setState（文件级棘轮）；几何经 seedCanvas、session 经 store action。
import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { applyDocToStore } from './canvasCollabRuntime';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { stampDocSchema, calcGroupBounds, type DocNodeRecord } from '@flowweb/shared';
import { _setIntentDocForTest } from './canvasIntents';
import { attachUndoManager, detachUndoManager, Origin } from './canvasUndo';
import { openRwWindow, openRoWindow, resetCanvasStores } from '@/test/fixtures/canvas';

function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = path.dirname(cur);
  }
  throw new Error('repo root not found');
}
const STORE_PATH = path.join(findRepoRoot(process.cwd()), 'apps/web/src/stores/canvasStore.ts');

const csNode = (id: string) => useCanvasStore.getState().nodes.find((n: any) => n.id === id) as any;
const session = () => useCanvasStore.getState().dragSession;

const SB_CONFIG = { aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: true, stitchResolution: '2K' };

/** 夹具（B42 同款）：manual 组 g1(100,50,400×300)+双子（c1 abs(120,80)/c1b abs(200,90)）+
 *  auto 组 g2（doc 无帧键——帧=reconcile 派生）+子 c2(abs 300,100)+顶层 t1(700,0)。 */
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

const nodeMap = (d: Y.Doc, id: string) => d.getMap('nodes').get(id) as Y.Map<any>;
const docPos = (d: Y.Doc, id: string) => {
  const p = nodeMap(d, id).get('position') as Y.Map<any>;
  return p ? { x: p.get('x'), y: p.get('y') } : undefined;
};

/** doc 写入计数器（'update' 事件——零事务判别面；network/种子 origin 不计由调用侧保证不混入）。 */
function docWriteCounter(d: Y.Doc) {
  let n = 0;
  const h = () => { n += 1; };
  d.on('update', h);
  return { count: () => n, stop: () => d.off('update', h) };
}

const begin = (ids: string[], pointerId: number | null = 1) =>
  useCanvasStore.getState().beginDragGesture(ids.map((id) => ({ id })), pointerId);

/** 手势帧（RF position 批形态——dragging:true 落 cs；RF 尾批 dragging:false 同窗）。 */
const frame = (id: string, x: number, y: number, dragging = true) =>
  useCanvasStore.getState().onNodesChange([{ type: 'position', id, position: { x, y }, dragging } as any]);

/** 意图观察器（origin 断言面——afterTransaction 逐事务 origin 收集）。 */
function originLog(d: Y.Doc) {
  const origins: string[] = [];
  const h = (_u: unknown, origin: unknown) => { if (typeof origin === 'string') origins.push(origin); };
  d.on('update', h as any);
  return { origins, stop: () => d.off('update', h as any) };
}

/** 拖前 hydrate 同一窗（rw+doc 注入+applyDocToStore——用例公共头）。 */
function hydrate() {
  openRwWindow();
  const d = buildDoc();
  _setIntentDocForTest(d);
  applyDocToStore(d);
  return d;
}

afterEach(() => {
  _setIntentDocForTest(null);
  detachUndoManager();
  vi.useRealTimers();
  resetCanvasStores();
});

// ══════════ ① 三段式提交：origin=LocalUser 拖动入栈（终裁 48） ══════════

describe("B5'-1 commitIntents 三段式提交", () => {
  it('拖顶层：doc=末帧 abs+cs≡末帧（66④①）+单 transact origin=LocalUser+单栈项；undo 一步回 baseline', () => {
    const d = hydrate();
    const um = attachUndoManager(d);
    begin(['t1']);
    frame('t1', 800, 10);
    expect(docPos(d, 't1')).toEqual({ x: 700, y: 0 });      // 手势期 doc 零写（B4'-2）
    const ol = originLog(d);
    useCanvasStore.getState().commitIntents();
    ol.stop();
    expect(ol.origins).toEqual([Origin.LocalUser]);          // 提交 origin=LocalUser（终裁 48）
    expect(docPos(d, 't1')).toEqual({ x: 800, y: 10 });      // doc=末帧 abs
    expect(csNode('t1').position).toEqual({ x: 800, y: 10 }); // cs≡末帧（提交不回跳）
    expect(session()).toBeNull();                             // 清 session（无条件）
    expect(um.undoStack.length).toBe(1);                      // 拖动=一步 undo
    um.undo();
    expect(docPos(d, 't1')).toEqual({ x: 700, y: 0 });       // undo 一步回 baseline
  });

  it('拖叶（manual 父组冻结帧）：abs=rel+冻结 origin 单 moveNode——组帧零键变更+子 rel 末帧保持', () => {
    const d = hydrate();
    const um = attachUndoManager(d);
    begin(['c1']);
    frame('c1', 45, 60);                                     // RF 对子发 rel 批
    useCanvasStore.getState().commitIntents();
    expect(docPos(d, 'c1')).toEqual({ x: 145, y: 110 });      // abs=rel(45,60)+冻结 origin(100,50)
    expect(nodeMap(d, 'g1').get('width')).toBe(400);          // manual 帧三键密封不动
    expect(docPos(d, 'g1')).toEqual({ x: 100, y: 50 });
    expect(csNode('c1').position).toEqual({ x: 45, y: 60 });  // rel 末帧（冻结 origin 未动）
    expect(um.undoStack.length).toBe(1);
  });

  it('拖组（manual）：N 子 abs+组帧三键 envelope 单 transact——undo 一步全恢复（子 abs+组位）', () => {
    const d = hydrate();
    const um = attachUndoManager(d);
    let txCount = 0;
    d.on('afterTransaction', () => { txCount++; });
    begin(['g1']);
    frame('g1', 150, 70);                                    // 组位移（子 rel 不变——RF 语义）
    useCanvasStore.getState().commitIntents();
    expect(txCount).toBe(1);                                  // 单 transact（N 子+帧三键一批）
    expect(docPos(d, 'c1')).toEqual({ x: 170, y: 100 });      // c1 abs=rel(20,30)+活 origin(150,70)
    expect(docPos(d, 'c1b')).toEqual({ x: 250, y: 110 });     // c1b abs=rel(100,40)+活 origin
    expect(docPos(d, 'g1')).toEqual({ x: 150, y: 70 });       // manual 帧三键密封（手势三行表"拖组"行）
    expect(nodeMap(d, 'g1').get('width')).toBe(400);
    expect(nodeMap(d, 'g1').get('height')).toBe(300);
    expect(csNode('g1').position).toEqual({ x: 150, y: 70 });
    expect(csNode('c1').position).toEqual({ x: 20, y: 30 });  // rel 随新 origin 重基（abs 守恒）
    expect(um.undoStack.length).toBe(1);
    um.undo();
    expect(docPos(d, 'c1')).toEqual({ x: 120, y: 80 });       // undo 一步全恢复
    expect(docPos(d, 'c1b')).toEqual({ x: 200, y: 90 });
    expect(docPos(d, 'g1')).toEqual({ x: 100, y: 50 });
  });

  it('拖组（auto）：N 子 abs+零帧键（auto 恒无帧键）——cs 帧重派生≡bbox+padding', () => {
    const d = hydrate();
    // hydrate 派生帧自证：c2 abs(300,100) ⇒ g2 帧=calcGroupBounds
    expect(csNode('g2').position).toEqual({ x: 280, y: 50 });
    expect(csNode('c2').position).toEqual({ x: 20, y: 50 }); // rel=abs−派生 origin
    begin(['g2']);
    frame('g2', 10, 10);
    useCanvasStore.getState().commitIntents();
    expect(docPos(d, 'c2')).toEqual({ x: 30, y: 60 });        // c2 abs=rel(20,50)+活 origin(10,10)
    expect(nodeMap(d, 'g2').get('position')).toBeUndefined(); // auto 恒无帧键（终裁 89）
    expect(nodeMap(d, 'g2').get('width')).toBeUndefined();
    const expectFrame = calcGroupBounds([{ x: 30, y: 60, width: 200, height: 100 }]);
    expect(csNode('g2').position).toEqual({ x: expectFrame.x, y: expectFrame.y }); // 派生帧=新 origin
    expect(csNode('g2').width).toBe(expectFrame.width);
  });
});

// ══════════ ②③ 空操作/零净变更：零事务零栈项 ══════════

describe("B5'-1 空操作与零净变更（零事务零栈项）", () => {
  it('空操作手势：doc 零键零栈项零写事务+session 清（无条件先于判空——watchdog clearTimeout 同步块）', () => {
    vi.useFakeTimers();
    const d = hydrate();
    const um = attachUndoManager(d);
    begin(['t1']);
    expect(vi.getTimerCount()).toBe(1);                      // watchdog armed
    const wc = docWriteCounter(d);
    useCanvasStore.getState().commitIntents();
    expect(wc.count()).toBe(0);                               // 零写事务（空批零 intent）
    wc.stop();
    expect(um.undoStack.length).toBe(0);                      // 零栈项
    expect(nodeMap(d, 't1').get('width')).toBeUndefined();    // doc 零键变更（t1 无 wh 键面）
    expect(session()).toBeNull();                             // 清 session 无条件（先于判空）
    expect(vi.getTimerCount()).toBe(0);                       // watchdog clearTimeout 同步块
  });

  it('零净变更=零事务：cs 往返 exact 回 baseline ⇒ 零 intent 零写零栈项', () => {
    const d = hydrate();
    const um = attachUndoManager(d);
    begin(['t1']);
    frame('t1', 800, 10);
    frame('t1', 700, 0);                                      // 往返 exact（末帧≡baseline）
    const wc = docWriteCounter(d);
    useCanvasStore.getState().commitIntents();
    expect(wc.count()).toBe(0);                               // 零事务（末帧≡doc 零 intent）
    wc.stop();
    expect(um.undoStack.length).toBe(0);
    expect(session()).toBeNull();
    expect(docPos(d, 't1')).toEqual({ x: 700, y: 0 });
  });
});

// ══════════ ④ 慢拖停顿单栈项+⑥ 松手时序 ══════════

describe("B5'-1 单栈项与松手时序", () => {
  it('慢拖停顿单栈项：跨 captureTimeout 间歇（watchdog 续挂）不裂项——提交=唯一 transact', () => {
    vi.useFakeTimers();
    const d = hydrate();
    const um = attachUndoManager(d);
    begin(['t1']);
    frame('t1', 750, 20);
    vi.advanceTimersByTime(700);                              // 停顿 >captureTimeout(500ms)
    useCanvasStore.getState().noteDragActivity();             // 续拖（watchdog 重挂）
    frame('t1', 800, 25);
    vi.advanceTimersByTime(700);
    useCanvasStore.getState().commitIntents();
    expect(um.undoStack.length).toBe(1);                      // 停顿不裂项（手势期零 intent）
    expect(docPos(d, 't1')).toEqual({ x: 800, y: 25 });
  });

  it('松手时序：RF 尾批（dragging:false）先落 session 内零告警；commit 后 heal 再触发=no-op（cs 稳定+doc 零新写）', () => {
    const d = hydrate();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    begin(['t1']);
    frame('t1', 810, 15);
    frame('t1', 810, 15, false);                              // RF 尾批（updateNodePositions dragging:false → onNodeDragStop 前达）
    useCanvasStore.getState().commitIntents();                // onNodeDragStop（RF 顺序：尾批先于 stop 回调）
    const wc = docWriteCounter(d);
    useCanvasStore.getState().endGesture('healed');           // 后续 pointermove[buttons===0] 自愈——session 已清
    expect(session()).toBeNull();
    expect(wc.count()).toBe(0);                               // no-op（无回滚无新写）
    wc.stop();
    expect(csNode('t1').position).toEqual({ x: 810, y: 15 }); // 提交值稳定
    expect(errSpy).not.toHaveBeenCalled();                    // 尾批落 session 内——门判据②零告警
    errSpy.mockRestore();
  });
});

// ══════════ ⑤ 终末对齐=reconcile 全域（收尾链不可交换锚） ══════════

describe("B5'-1 终末对齐（集合废止——reconcile 全域）", () => {
  it('拖 auto 组子远超帧：提交后 auto 帧重派生≡bbox+padding（非冻结值）——清 session 先于 dispatch 不可交换', () => {
    const d = hydrate();
    const frozenFrame = { ...csNode('g2').position } as { x: number; y: number };
    begin(['c2']);
    frame('c2', 700, 600);                                    // 拖出冻结帧远端（rel 批）
    expect(csNode('g2').position).toEqual(frozenFrame);       // 手势期冻结帧不动（让位）
    useCanvasStore.getState().commitIntents();
    expect(docPos(d, 'c2')).toEqual({ x: 700 + 280, y: 600 + 50 }); // abs=rel+冻结 origin(280,50)
    const expectFrame = calcGroupBounds([{ x: 980, y: 650, width: 200, height: 100 }]);
    expect(csNode('g2').position).toEqual({ x: expectFrame.x, y: expectFrame.y }); // 全域重派生（集合废止）
    expect(csNode('g2').width).toBe(expectFrame.width);
    expect(csNode('g2').height).toBe(expectFrame.height);
    expect(csNode('c2').position).toEqual({ x: 980 - expectFrame.x, y: 650 - expectFrame.y }); // rel 重基（abs 守恒）
  });
});

// ══════════ spec 评审收口 P1 两件（2026-10-03） ══════════

describe("B5'-1 spec 评审收口（P1：storyboard 组键集违例+折叠组 invariant 豁免）", () => {
  it('P1-A 拖 storyboard 组：envelope=position-only（键集表"storyboard 组无 wh"）——doc 零 wh 键+不抛+子 abs 随组', () => {
    const d = hydrate();
    begin(['sb1']);
    frame('sb1', 100, 420);                                     // 组位移（origin 活）
    useCanvasStore.getState().commitIntents();                  // 修复前：envelope 三键⇒doc 落 wh 键+invariant 抛
    expect(docPos(d, 'sb1')).toEqual({ x: 100, y: 420 });       // position 更新
    expect(nodeMap(d, 'sb1').get('width')).toBeUndefined();     // 键集表：storyboard 组零 wh 键
    expect(nodeMap(d, 'sb1').get('height')).toBeUndefined();
    expect(docPos(d, 's1')).toBeUndefined();                    // 分镜子 doc 恒无 position 键（键集表——格位由组渲染派生）
  });

  it('P1-B 画布含折叠 manual 组：拖无关顶层节点提交不抛（cs 帧=COLLAPSED_SIZE 派生 vs doc 三键展开态密封=终裁 82 设计内分叉——invariant 折叠档豁免）', () => {
    const d = hydrate();
    // 折叠 g1（单意图 data.collapsed——O0b-5；cs 帧由 reconcile 写域① collapsed 档派生 COLLAPSED_SIZE）
    useCanvasStore.getState().toggleCollapse('g1');
    expect(csNode('g1').width).toBe(220);                       // COLLAPSED_SIZE（cs 派生档）
    expect(nodeMap(d, 'g1').get('width')).toBe(400);            // doc 密封展开态（终裁 82）
    begin(['t1']);
    frame('t1', 900, 30);
    expect(() => useCanvasStore.getState().commitIntents()).not.toThrow();   // 修复前：invariant 全表比较必抛
    expect(docPos(d, 't1')).toEqual({ x: 900, y: 30 });         // 提交照常落 doc
    expect(nodeMap(d, 'g1').get('width')).toBe(400);            // 密封值不被腐蚀
  });
});

// ══════════ ⑦⑧ 结构断言+会话分型守卫 ══════════

describe("B5'-1 结构断言（终裁 78⑩——commitIntents 调用图不含 endGesture）", () => {
  /** 函数体提取（action 形态 `  name: (…) => {`——brace matching；ratchet/geometry census 同款）。 */
  function actionBody(src: string, name: string): string {
    const lines = src.split('\n');
    const startIdx = lines.findIndex((l) => new RegExp(`^  ${name}:.*=> \\{`).test(l));
    if (startIdx < 0) throw new Error(`action ${name} 未找到`);
    let depth = 0;
    let seen = false;
    const body: string[] = [];
    for (let i = startIdx; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') { depth++; seen = true; }
        else if (ch === '}') depth--;
      }
      if (seen) body.push(lines[i]);
      if (seen && depth === 0) break;
    }
    return body.join('\n');
  }

  /** 代码行提取（剥整行注释——断言面=调用图非注释；census 计数形态同款纪律）。 */
  const codeLines = (body: string) => body.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  it('commitIntents 调用图不含 endGesture∧无自有 reconcile 调用点（提交收尾=漏斗尾 reconcile[transact 先于收尾]；endGesture=中止/自愈/remove 谓词三分支——防复用重演 P0-10）', () => {
    const src = readFileSync(STORE_PATH, 'utf8');
    const body = codeLines(actionBody(src, 'commitIntents'));
    expect(body.length).toBeGreaterThan(0);
    expect(body, 'commitIntents 内出现 endGesture（提交不经 endGesture——终裁 78⑩；abort 族收尾会回滚）').not.toContain('endGesture');
    expect(body, 'commitIntents 内出现自有 reconcile 调用（提交收尾=漏斗尾 reconcile——census 四元组维持）').not.toContain('reconcileGroupGeometry(');
    expect(body, '提交走意图漏斗（transact 先于收尾）').toContain('dispatchCanvasIntent(');
  });

  it("commitResizeGesture 同为提交族：不经 endGesture（'completed' reason 随 B5'-1 退役）", () => {
    const src = readFileSync(STORE_PATH, 'utf8');
    const body = codeLines(actionBody(src, 'commitResizeGesture'));
    expect(body, 'commitResizeGesture 内出现 endGesture（提交族收尾=清 session 同步块，非 abort 族链）').not.toContain('endGesture');
  });

  it("endGesture reason 联合类型=中止/自愈/remove 谓词三分支（'completed' 退役）+生产面零 endGesture('completed') 调用", () => {
    const src = readFileSync(STORE_PATH, 'utf8');
    const sig = src.split('\n').find((l) => l.includes('endGesture: (reason:'));
    expect(sig).toBeTruthy();
    expect(sig!).toContain("'aborted'");
    expect(sig!).toContain("'healed'");
    expect(sig!).toContain("'removed'");
    expect(sig!, "endGesture reason 联合类型残留 'completed'（B5'-1 起提交不经 endGesture）").not.toContain("'completed'");
    const code = codeLines(src);
    expect(code, "生产面残留 endGesture('completed') 调用（提交族应走清 session 同步块）").not.toContain("endGesture('completed')");
  });

  it('resize 会话不经 commitIntents（幂等守卫：非 drag 会话 no-op——resize 提交=commitResizeGesture 专属）', () => {
    const d = hydrate();
    useCanvasStore.getState().beginResize('g1', 9);
    useCanvasStore.getState().onNodesChange([
      { type: 'dimensions', id: 'g1', setAttributes: true, resizing: true, dimensions: { width: 500, height: 350 } } as any,
    ]);
    const wc = docWriteCounter(d);
    useCanvasStore.getState().commitIntents();                // resize 会话——no-op（不误清不误提交）
    expect(wc.count()).toBe(0);
    wc.stop();
    expect(session()).not.toBeNull();                         // resize 会话保留（归 commitResizeGesture）
    expect(csNode('g1').width).toBe(500);                     // 预览帧不被吞
    useCanvasStore.getState().commitResizeGesture();          // 正道提交
    expect(nodeMap(d, 'g1').get('width')).toBe(500);
    expect(session()).toBeNull();
  });

  it('无会话 commitIntents=no-op（松手后再触发幂等）', () => {
    const d = hydrate();
    const wc = docWriteCounter(d);
    useCanvasStore.getState().commitIntents();
    expect(wc.count()).toBe(0);
    wc.stop();
    expect(session()).toBeNull();
  });

  it('viewer 窗口提交：dispatch 门拦 ⇒ doc 零写+session 清+cs 停末帧（设计内分叉——下一 reconcile 收敛；B4’-2 viewer 锚的提交面承接）', () => {
    openRoWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['t1']);
    frame('t1', 800, 10);
    const wc = docWriteCounter(d);
    useCanvasStore.getState().commitIntents();
    expect(wc.count()).toBe(0);                               // doc 零写（VIEWER 硬门）
    wc.stop();
    expect(session()).toBeNull();                             // 会话仍终结
    expect(csNode('t1').position).toEqual({ x: 800, y: 10 }); // cs 停末帧（不回滚——提交语义；下一 applyDocToStore 收敛）
  });
});
