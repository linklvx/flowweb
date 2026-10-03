// apps/web/src/stores/canvasCollabRuntime.geometry.test.ts
// O0b-0（Spec B）格式批：翻转主锚（几何）+S1 停写锚+web 读侧版本门。
// O0b-1（Spec B）reconcile 单内核扩展（非推翻）：写域四类（①组帧=deriveGroupFrame 派生·含折叠档
// COLLAPSED_SIZE 优先级最高[终裁 82]／②position abs→rel／③非组 wh 直拷·缺键保留现值／④分镜子
// {0,0}）+单遍单 origin+零差异短路（EPS=1e-6·同值保对象引用）+源矩阵（漏斗尾 source:'doc'/
// dispatchProjectionDiff 首行 source:'cs' 全仓恰 1 处/applyDocToStore 尾 source:'doc'）+census
// 三元组过渡断言（B7-1 升四元组：endGesture 第 4 成员随 B4'-1 落地）。
// 几何锚：打开（applyDocToStore）⇒cs 子 rel 逐位≡doc.abs−帧 origin ∧ doc 无 auto 组帧键 ∧
// 二次打开逐位不变（无 S1 回写）。doc 读取=readRecordsFromMaps（docShape 单源，禁从 nsNodes/csNodes
// 反推=直拷回灌）。组帧 origin：manual/storyboard 组=doc position 键；auto 组=calcGroupBounds；
// 分镜子={0,0} 不动。
import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { applyDocToStore, checkProjectionInvariant, reconcileGroupGeometry } from './canvasCollabRuntime';
import { fillDoc, toDocLike, readCanvasFromDoc } from '@/collab/ydocBuilder';
import {
  stampDocSchema, calcGroupBounds, calcStoryboardSize, COLLAPSED_SIZE, DEFAULT_CHILD_SIZE,
  type DocNodeRecord,
} from '@flowweb/shared';
import {
  _setIntentDocForTest, dispatchCanvasIntent, captureStoreProjection, dispatchProjectionDiff,
} from './canvasIntents';
import { Origin, detachUndoManager, attachUndoManager } from './canvasUndo';
import { seedCanvas } from '@/test/fixtures/canvas';
import { existsSync, readFileSync, readdirSync } from 'fs';
import * as path from 'path';

/** rw 漏斗窗口（canEdit 真） */
function openRwWindow() {
  useCanvasStore.setState({
    hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1',
  });
}

/** 翻转夹具（v2.1 档——doc=abs 空间）：manual 组+auto 组+分镜组+嵌套子+顶层，fillDoc 后显式 stamp。
 *  M-3（O0b-0 质评）：夹具对齐 DocNodeRecord/toDocRecords 同构链风格（去 as any）。 */
const FLIPPED_RECORDS: DocNodeRecord[] = [
  // manual 组（帧三键齐——origin=doc position 键）+子 abs(120,80) → cs 期望 rel(20,30)
  { id: 'g1', type: 'group', position: { x: 100, y: 50 }, width: 400, height: 300, data: { groupType: 'normal', name: 'manual' } },
  { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 120, y: 80 }, width: 100, height: 60, data: {} },
  // auto 组（无帧三键——键集表）+2 子 abs → origin=calcGroupBounds(成员 abs bbox)
  { id: 'g2', type: 'group', data: { groupType: 'normal', name: 'auto' } },
  { id: 'c2', type: 'imageGen', parentId: 'g2', position: { x: 300, y: 100 }, width: 200, height: 100, data: {} },
  { id: 'c3', type: 'imageGen', parentId: 'g2', position: { x: 550, y: 100 }, width: 150, height: 80, data: {} },
  // 分镜组（origin=doc position 键）+分镜子（无 position 带 wh——cs {0,0} 构造默认不动）
  { id: 'sb1', type: 'group', position: { x: 0, y: 400 }, data: { groupType: 'storyboard', cells: ['s1'], storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: true, stitchResolution: '2K' } } },
  { id: 's1', type: 'imageGen', parentId: 'sb1', width: 320, height: 180, data: {} },
  // 顶层普通节点（abs 直拷）
  { id: 't1', type: 'textInput', position: { x: 700, y: 0 }, data: {} },
];

function buildFlippedDoc(): Y.Doc {
  const d = new Y.Doc();
  fillDoc(d, FLIPPED_RECORDS, []);
  stampDocSchema(toDocLike(d));
  return d;
}

/** O0b-1 折叠档夹具（终裁 82）：manual 组密封帧（doc 三键=展开态值）+collapsed data。 */
function buildCollapsedManualDoc(): Y.Doc {
  const d = new Y.Doc();
  const records: DocNodeRecord[] = [
    { id: 'g3', type: 'group', position: { x: 100, y: 50 }, width: 400, height: 300, data: { groupType: 'normal', name: 'm', collapsed: true } },
    { id: 'c9', type: 'imageGen', parentId: 'g3', position: { x: 120, y: 80 }, width: 100, height: 60, data: {} },
  ];
  fillDoc(d, records, []);
  stampDocSchema(toDocLike(d));
  return d;
}

const csNode = (id: string) => useCanvasStore.getState().nodes.find((n: any) => n.id === id) as any;

/** O0b-1 census 扫描域=apps 与 packages 两族的 src 目录（终裁 54②——排除 dist/docs/vendor/backups/node_modules；
 *  test/spec 文件不入计数） */
function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = path.dirname(cur);
  }
  throw new Error('repo root not found');
}
const REPO_ROOT = findRepoRoot(process.cwd());

function collectProdFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'docs', 'vendor', 'backups'].includes(entry.name)) continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(path.join(REPO_ROOT, 'apps'));
  walk(path.join(REPO_ROOT, 'packages'));
  return out;
}

/** 计数形态（终裁 54②）：行含 reconcileGroupGeometry( 且非注释/import/re-export/类型声明/函数定义行。 */
function reconcileCallLines(): { rel: string; line: string }[] {
  const calls: { rel: string; line: string }[] = [];
  for (const file of collectProdFiles()) {
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      if (!raw.includes('reconcileGroupGeometry(')) continue;
      const line = raw.trim();
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue; // 注释
      if (line.startsWith('import ') || line.startsWith('export {') || line.startsWith('export *') || line.startsWith('export type')) continue; // import/re-export/类型出口
      if (line.includes('function reconcileGroupGeometry(')) continue;                      // 函数定义行
      calls.push({ rel: path.relative(REPO_ROOT, file).split(path.sep).join('/'), line: raw });
    }
  }
  return calls;
}

// 文件级清理（原两 describe 各自 afterEach 收敛于此——本文件全部用例共用）
afterEach(() => {
  _setIntentDocForTest(null);
  detachUndoManager();
  useCanvasStore.setState({ nodes: [], edges: [] });
  useNodeStore.setState({ nodes: {} as any });
});

describe('O0b-0 翻转主锚（几何）：打开 ⇒ cs 子 rel 逐位≡doc.abs−帧 origin', () => {
  it('manual 组：origin=doc position 键——cs 组=origin、子 rel=abs−origin 逐位', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    expect(csNode('g1').position).toEqual({ x: 100, y: 50 });      // origin=doc position
    expect(csNode('c1').position).toEqual({ x: 20, y: 30 });        // (120,80)−(100,50)
  });

  it('auto 组：origin=calcGroupBounds(成员 doc.abs bbox)——cs 组=origin、子 rel 同 tick 自洽', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    const expected = calcGroupBounds([
      { x: 300, y: 100, width: 200, height: 100 },
      { x: 550, y: 100, width: 150, height: 80 },
    ]);
    expect(csNode('g2').position).toEqual({ x: expected.x, y: expected.y });
    expect(csNode('c2').position).toEqual({ x: 300 - expected.x, y: 100 - expected.y });
    expect(csNode('c3').position).toEqual({ x: 550 - expected.x, y: 100 - expected.y });
  });

  it('分镜组：origin=doc position 键；分镜子={0,0} 不动（doc 无 position 键）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    expect(csNode('sb1').position).toEqual({ x: 0, y: 400 });
    expect(csNode('s1').position).toEqual({ x: 0, y: 0 });
  });

  it('顶层节点 abs 直拷；doc 无 auto 组帧三键（键集表形态保持——翻转只改空间语义不改键集）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    expect(csNode('t1').position).toEqual({ x: 700, y: 0 });
    const g2 = d.getMap('nodes').get('g2') as Y.Map<any>;
    expect(g2.has('position')).toBe(false);
    expect(g2.has('width')).toBe(false);
    expect(g2.has('height')).toBe(false);
  });

  it('二次打开逐位不变（恢复链幂等——reconcile 确定性直拷无漂移）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    const first = JSON.stringify(useCanvasStore.getState().nodes.map((n: any) => ({ id: n.id, position: n.position, width: n.width, height: n.height })));
    applyDocToStore(d);
    const second = JSON.stringify(useCanvasStore.getState().nodes.map((n: any) => ({ id: n.id, position: n.position, width: n.width, height: n.height })));
    expect(second).toBe(first);
    expect(checkProjectionInvariant(d)).toBe(true);
  });

  it('恢复链零回写锚：远端 apply 后 doc 写入计数=0（S1 停写——系统回写通道已随 O0b-4 删除）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    let nonNetworkWrites = 0;
    d.on('afterTransaction', (tr: any) => { if (tr.origin !== 'network') nonNetworkWrites++; });
    // 对端改无关节点 data → 本端 apply（恢复链）——除远端 network 事务外零 doc 写
    const B = new Y.Doc();
    Y.applyUpdate(B, Y.encodeStateAsUpdate(d));
    (B.getMap('nodes').get('t1') as Y.Map<any>).get('data').set('content', 'remote-edit');
    Y.applyUpdate(d, Y.encodeStateAsUpdate(B), 'network');
    applyDocToStore(d);
    expect(nonNetworkWrites).toBe(0);
  });

  it('S1 停写：违反不变量的组框不再回写 doc——doc 原值保持（修复职责移交 reconcile 写 cs 面）', () => {
    useCanvasStore.setState({ nodes: [], edges: [] });
    useNodeStore.setState({ nodes: {} as any });
    useCanvasStore.setState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1' });
    const d = new Y.Doc();
    const records: DocNodeRecord[] = [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 10, height: 10, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, width: 100, height: 60, data: {} },
    ];
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    const m = d.getMap('nodes').get('g1') as Y.Map<any>;
    expect(m.get('width')).toBe(10);   // 非 calcGroupBounds 修复值——doc 停写
    expect(m.get('height')).toBe(10);
  });

  it('undo 栈零污染：applyDocToStore（含 reconcile）不产生 Geometry 事务入栈', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    const um = attachUndoManager(d);
    applyDocToStore(d);
    expect(um.undoStack.length).toBe(0);
  });
});

describe('O0b-0 web 读侧版本门（DEV——收到的版本四档同条件）', () => {
  it('无戳∧有节点 → applyDocToStore throw（DEV 断言）', () => {
    const d = new Y.Doc();
    const records: DocNodeRecord[] = [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }];
    fillDoc(d, records, []);
    // 不 stamp——无戳有节点（构造纪律：fillDoc 本批已不写 meta，裸形态即门档）
    expect(() => applyDocToStore(d)).toThrow(/schemaVersion/);
  });

  it('戳=1 → applyDocToStore throw（v1 旧档）', () => {
    const d = new Y.Doc();
    d.getMap('meta').set('schemaVersion', 1);
    const records: DocNodeRecord[] = [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }];
    fillDoc(d, records, []);
    expect(() => applyDocToStore(d)).toThrow(/schemaVersion/);
  });

  it('无戳∧零节点（空 doc）→ 放行（合法空档——与门判据一致）', () => {
    expect(() => applyDocToStore(new Y.Doc())).not.toThrow();
  });

  it('v2 档（stamp 夹具）→ 放行且正常水合', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    expect(() => applyDocToStore(d)).not.toThrow();
    expect(useCanvasStore.getState().nodes.length).toBeGreaterThan(0);
  });
});

// ══════════ O0b-1 reconcile 单内核（Spec B——写域四类+源矩阵+零差异短路）══════════

describe('O0b-1 写域①：组帧三字段≡deriveGroupFrame 派生（oracle=doc 侧键）', () => {
  it('manual/storyboard/auto 展开档全三字段（O0b-2 接管——台账 a：auto wh=deriveGroupFrame 派生值）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    // manual g1：密封三键=doc 值（写侧键集表可往返——doc 镜像同值零差异）
    expect(csNode('g1').width).toBe(400);
    expect(csNode('g1').height).toBe(300);
    // auto g2：全三字段=写域① 派生（O0b-2 接管——wh 不再留现状链；doc 面零泄漏由差分出口
    // oracle 化保证，见 canvasO0b2.sizing.test 帧键零泄漏锚）
    const b2 = calcGroupBounds([
      { x: 300, y: 100, width: 200, height: 100 },
      { x: 550, y: 100, width: 150, height: 80 },
    ]);
    expect(csNode('g2').position).toEqual({ x: b2.x, y: b2.y });
    expect(csNode('g2').width).toBe(b2.width);
    expect(csNode('g2').height).toBe(b2.height);
    // storyboard sb1：尺寸=config 权威 calcStoryboardSize（无 padding；写侧键集表剥 wh——零泄漏）；
    // position=doc 键
    const sb = calcStoryboardSize(1, 1, '16:9');
    expect(csNode('sb1').width).toBe(sb.width);
    expect(csNode('sb1').height).toBe(sb.height);
    expect(csNode('sb1').position).toEqual({ x: 0, y: 400 });
    expect(checkProjectionInvariant(d)).toBe(true);
  });

  it('帧模式 oracle=doc 侧记录键——禁 cs 派生帧当 storedFrame（auto 组防 manual 死锁：cs 伪造帧值+伪造 origin 不参与 mode 判定）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    const b2 = calcGroupBounds([
      { x: 300, y: 100, width: 200, height: 100 },
      { x: 550, y: 100, width: 150, height: 80 },
    ]);
    // 伪造 cs 派生帧键+伪造 origin（若被当 storedFrame 喂 frameMode 则 auto 组误判 manual——
    // 帧取伪造值死锁；正确实现 mode 恒=doc 侧判定（doc 0 帧键⇒auto）⇒origin 恒按 bbox 重派生）
    seedCanvas(useCanvasStore.getState().nodes.map((nd: any) => (
      nd.id === 'g2' ? { ...nd, position: { x: 9999, y: 9999 }, width: 999, height: 888 } : nd
    )));
    reconcileGroupGeometry(d, 'doc');
    expect(csNode('g2').position).toEqual({ x: b2.x, y: b2.y });   // 非 {9999,9999}——mode 恒 auto
    // O0b-2 写域① 接管：伪造 wh 被 reconcile 重写=deriveGroupFrame 派生值（非 999 现状链）
    expect(csNode('g2').width).toBe(b2.width);
    expect(csNode('g2').height).toBe(b2.height);
  });

  it('写域①折叠档（终裁 82）：manual 组 collapsed⇒cs 帧≡COLLAPSED_SIZE、优先级最高∧doc 三键保持展开态值不动', () => {
    openRwWindow();
    const d = buildCollapsedManualDoc();
    applyDocToStore(d);
    expect(csNode('g3').width).toBe(COLLAPSED_SIZE.width);    // 不吃 doc 展开态 400
    expect(csNode('g3').height).toBe(COLLAPSED_SIZE.height);  // 不吃 doc 展开态 300
    expect(csNode('g3').position).toEqual({ x: 100, y: 50 }); // 密封 origin=帧 position 键
    // doc 三键=展开态密封源（终裁 82——reconcile 纯 cs 写不吃不写）
    const g = d.getMap('nodes').get('g3') as Y.Map<any>;
    expect(g.get('width')).toBe(400);
    expect(g.get('height')).toBe(300);
    expect(csNode('c9').position).toEqual({ x: 20, y: 30 });  // 子 rel 不受折叠档影响（abs−origin）
  });

  it('写域①折叠档：auto 组 collapsed⇒COLLAPSED_SIZE 覆写（origin 照旧 bbox 派生）', () => {
    openRwWindow();
    const d = new Y.Doc();
    const records: DocNodeRecord[] = [
      { id: 'g4', type: 'group', data: { groupType: 'normal', collapsed: true } },
      { id: 'k1', type: 'imageGen', parentId: 'g4', position: { x: 500, y: 300 }, width: 200, height: 100, data: {} },
      { id: 'k2', type: 'imageGen', parentId: 'g4', position: { x: 800, y: 300 }, width: 100, height: 50, data: {} },
    ];
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    const b4 = calcGroupBounds([
      { x: 500, y: 300, width: 200, height: 100 },
      { x: 800, y: 300, width: 100, height: 50 },
    ]);
    expect(csNode('g4').position).toEqual({ x: b4.x, y: b4.y });       // origin 照旧 bbox 派生
    expect(csNode('g4').width).toBe(COLLAPSED_SIZE.width);             // COLLAPSED_SIZE 覆写
    expect(csNode('g4').height).toBe(COLLAPSED_SIZE.height);
  });

  it('toggleCollapse 全流锚（O0b-5 单意图化重写）：doc 注册→折叠=唯 updateNodeData{collapsed} 落 doc∧单 transact∧cs 帧=COLLAPSED_SIZE（reconcile 写域① collapsed 档派生）∧doc 三键密封（终裁 82——折叠分支 envelope 写删）', () => {
    openRwWindow();
    // 最小 manual 组夹具（无分镜子）：manual oracle=doc 帧三键形态——gm 三键齐⇒manual 档
    const d = new Y.Doc();
    const records: DocNodeRecord[] = [
      { id: 'gm', type: 'group', position: { x: 100, y: 50 }, width: 400, height: 300, data: { groupType: 'normal', name: 'manual' } },
      { id: 'cm', type: 'imageGen', parentId: 'gm', position: { x: 120, y: 80 }, width: 100, height: 60, data: {} },
    ];
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    _setIntentDocForTest(d);
    let txCount = 0;
    d.on('afterTransaction', () => { txCount++; });   // 观察器在 fillDoc 后挂，初态不计
    // 全流折叠：store action 经漏斗（doc 注册态）——夹具纪律：生产同构链（applyDocToStore 水合+store action），零裸几何 setState
    useCanvasStore.getState().toggleCollapse('gm');
    expect(txCount).toBe(1);                                     // 单意图单 transact
    expect(csNode('gm').width).toBe(COLLAPSED_SIZE.width);       // cs 折叠渲染档=reconcile 派生（非 cs 直写 envelope）
    expect(csNode('gm').height).toBe(COLLAPSED_SIZE.height);
    expect(csNode('gm').position).toEqual({ x: 100, y: 50 });    // 密封 origin 不动
    expect(csNode('cm').position).toEqual({ x: 20, y: 30 });     // 子 rel 不受折叠档影响
    expect((csNode('gm').data as Record<string, unknown>).collapsed).toBe(true);
    const g = d.getMap('nodes').get('gm') as Y.Map<any>;
    expect(g.get('width')).toBe(400);    // 终裁 82：doc 三键=展开态密封值——折叠不写 COLLAPSED_SIZE
    expect(g.get('height')).toBe(300);
    expect((g.get('data') as Y.Map<any>).get('collapsed')).toBe(true);
    // 幂等：二次全流全节点几何逐位不变
    const geoOf = (s: { nodes: any[] }) => s.nodes.map((n) => `${n.id}:${n.position?.x},${n.position?.y},${n.width},${n.height}`).join('|');
    const geoSnap = geoOf(useCanvasStore.getState());
    dispatchProjectionDiff(captureStoreProjection(), Origin.LocalUser);
    expect(geoOf(useCanvasStore.getState())).toBe(geoSnap);
  });
});

describe('O0b-1 写域②③④+一写者通则', () => {
  it('新顶层节点（addNode 漏斗）同 tick cs.position≡doc.abs 逐位∧渲染位≠{0,0}（前提=applyIntentToDoc addNode 经 fillDoc 落 position——显式锚）', () => {
    openRwWindow();
    const d = new Y.Doc();
    stampDocSchema(toDocLike(d));
    _setIntentDocForTest(d);
    dispatchCanvasIntent(
      { type: 'addNode', node: { id: 'n9', type: 'textInput', position: { x: 500, y: 300 }, data: {} } },
      Origin.LocalUser,
    );
    expect(csNode('n9').position).toEqual({ x: 500, y: 300 });   // ≡doc.abs 逐位 ∧ ≠{0,0}
    const m = d.getMap('nodes').get('n9') as Y.Map<any>;
    expect((m.get('position') as Y.Map<any>).get('x')).toBe(500); // fillDoc 落 position（前提锚）
    expect(checkProjectionInvariant(d)).toBe(true);
  });

  it('写域③：非组 wh doc→cs 直拷；doc 缺 wh⇒保留 cs 现值（禁 undefined）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    expect(csNode('c1').width).toBe(100);      // doc wh 直拷
    expect(csNode('c1').height).toBe(60);
    // t1 doc 无 wh——seedCanvas 注入 cs 现值后 reconcile 保留（缺键分支）
    seedCanvas(useCanvasStore.getState().nodes.map((nd: any) => (
      nd.id === 't1' ? { ...nd, width: 55, height: 66 } : nd
    )));
    reconcileGroupGeometry(d, 'doc');
    expect(csNode('t1').width).toBe(55);
    expect(csNode('t1').height).toBe(66);
  });

  it('写域④：分镜子 position={0,0} 停住——cs 漂移值被拉回构造默认', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    seedCanvas(useCanvasStore.getState().nodes.map((nd: any) => (
      nd.id === 's1' ? { ...nd, position: { x: 9, y: 9 } } : nd
    )));
    reconcileGroupGeometry(d, 'doc');
    expect(csNode('s1').position).toEqual({ x: 0, y: 0 });
  });

  it('一写者通则：全节点写前 Number.isFinite 守卫——doc 非有限 position 不写 cs（保留现值引用）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    const before = csNode('t1').position;
    // 人为构造：doc t1 position 子 Map 写 NaN（Y 层可存——传播终点就地拦截）
    const m = d.getMap('nodes').get('t1') as Y.Map<any>;
    (m.get('position') as Y.Map<any>).set('x', Number.NaN);
    reconcileGroupGeometry(d, 'doc');
    expect(csNode('t1').position).toBe(before);   // 引用不变=未写（非有限守卫）
    expect(Number.isFinite(csNode('t1').position.x)).toBe(true);
  });

  it('一写者通则：auto 组 doc 无帧键⇒写域②③跳过该组帧直拷——cs origin 恒写域①派生值（wh 现状链，O0b-2 接手）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    const g2 = d.getMap('nodes').get('g2') as Y.Map<any>;
    expect(g2.has('position')).toBe(false);   // doc 0 帧键——无直拷对象
    const b2 = calcGroupBounds([
      { x: 300, y: 100, width: 200, height: 100 },
      { x: 550, y: 100, width: 150, height: 80 },
    ]);
    expect(csNode('g2').position).toEqual({ x: b2.x, y: b2.y });   // cs origin=写域① 派生值
  });
});

describe('O0b-1 单遍单 origin+零差异短路', () => {
  it('auto 组因成员移动整体位移⇒子 abs 逐位不变∧cs.rel 与新 origin 同 tick 自洽', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    const originBefore = { ...csNode('g2').position };
    // 远端移动 c2：abs(300,100)→(310,100)（对端 doc update 模拟——network 事务）
    const B = new Y.Doc();
    Y.applyUpdate(B, Y.encodeStateAsUpdate(d));
    ((B.getMap('nodes').get('c2') as Y.Map<any>).get('position') as Y.Map<any>).set('x', 310);
    Y.applyUpdate(d, Y.encodeStateAsUpdate(B), 'network');
    applyDocToStore(d);
    const origin = csNode('g2').position;
    expect(origin).not.toEqual(originBefore);                  // 组 origin 随 bbox 位移
    expect(csNode('c2').position.x + origin.x).toBe(310);      // abs 逐位（自洽）
    expect(csNode('c2').position.y + origin.y).toBe(100);
    expect(csNode('c3').position.x + origin.x).toBe(550);      // 未动成员 abs 逐位不变
    expect(csNode('c3').position.y + origin.y).toBe(100);
  });

  it('零差异短路（source:\'doc\'）：连续两次 reconcile 第二次零 setState（订阅计数=0）∧几何变更恰一次', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    // 破坏一致性：cs c2 rel 漂移（seedCanvas 注入）→ 首次 reconcile 恰一次 setState
    seedCanvas(useCanvasStore.getState().nodes.map((nd: any) => (
      nd.id === 'c2' ? { ...nd, position: { x: nd.position.x + 37, y: nd.position.y } } : nd
    )));
    let count = 0;
    const un = useCanvasStore.subscribe(() => { count++; });
    reconcileGroupGeometry(d, 'doc');
    const afterFirst = count;
    reconcileGroupGeometry(d, 'doc');
    un();
    expect(afterFirst).toBe(1);   // 几何变更恰一次
    expect(count).toBe(1);        // 第二次零 setState（零差异短路）
  });

  it("零差异短路（source:'cs'）：连续两次 reconcile('cs') 第二次零 setState——O0a-3 计划锚转实（shared 侧纯函数幂等等价锚的 reconcile 面落点）", () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    const origin0 = { ...csNode('g2').position };
    // 命令几何已落 cs、doc 未更新形态：c2 rel 外移（帧未跟）→ 首次 reconcile('cs') 重派生帧+同 tick 重基 rel
    seedCanvas(useCanvasStore.getState().nodes.map((nd: any) => (
      nd.id === 'c2' ? { ...nd, position: { x: nd.position.x + 200, y: nd.position.y } } : nd
    )));
    const c2AbsCommand = {   // 漂移后的 cs 活值 abs（=命令几何，doc 落后未含）
      x: csNode('c2').position.x + origin0.x,
      y: csNode('c2').position.y + origin0.y,
    };
    const c3Abs = {
      x: csNode('c3').position.x + origin0.x,
      y: csNode('c3').position.y + origin0.y,
    };
    let count = 0;
    const un = useCanvasStore.subscribe(() => { count++; });
    reconcileGroupGeometry(d, 'cs');
    const afterFirst = count;
    reconcileGroupGeometry(d, 'cs');
    un();
    expect(afterFirst).toBe(1);   // 帧重派生+子重基=单次 setState
    expect(count).toBe(1);        // 第二次零 setState
    // 命令几何不丢：子 abs（rel+新 origin）与 reconcile 前的 cs 活值 abs 逐位相等
    const originNew = csNode('g2').position;
    expect(originNew).not.toEqual(origin0);   // 帧随外移成员重派生
    expect(csNode('c2').position.x + originNew.x).toBe(c2AbsCommand.x);
    expect(csNode('c2').position.y + originNew.y).toBe(c2AbsCommand.y);
    expect(csNode('c3').position.x + originNew.x).toBe(c3Abs.x);
    expect(csNode('c3').position.y + originNew.y).toBe(c3Abs.y);
  });

  it('零差异短路：renameGroup⇒reconcile 零 setState（几何面订阅计数=0）∧几何变更零次', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    _setIntentDocForTest(d);
    const geoOf = (s: { nodes: any[] }) => s.nodes.map((n) => `${n.id}:${n.position?.x},${n.position?.y},${n.width},${n.height}`).join('|');
    const geoSnap = geoOf(useCanvasStore.getState());
    let prev = geoSnap;
    let geoChanges = 0;
    const un = useCanvasStore.subscribe((s: any) => {
      const cur = geoOf(s);
      if (cur !== prev) { geoChanges++; prev = cur; }
    });
    useCanvasStore.getState().renameGroup('g1', '改名');
    un();
    expect(geoChanges).toBe(0);   // 漏斗尾 reconcile 零 setState（几何面）
    expect(geoOf(useCanvasStore.getState())).toBe(geoSnap);   // 几何变更零次（变更恰一次=此前 hydrate 那次）
    expect((csNode('g1').data as Record<string, unknown>).name).toBe('改名');
    expect((((d.getMap('nodes').get('g1') as Y.Map<any>).get('data') as Y.Map<any>).get('name'))).toBe('改名');
  });

  it('远端改任意无关节点⇒本地其它节点 cs 对象引用不变（防直拷回灌——零差异短路保引用，M-5）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    const t1 = csNode('t1');
    const c1 = csNode('c1');
    const c2 = csNode('c2');
    // 对端改 c3 data（无关节点——几何零变化）
    const B = new Y.Doc();
    Y.applyUpdate(B, Y.encodeStateAsUpdate(d));
    (B.getMap('nodes').get('c3') as Y.Map<any>).get('data').set('content', 'remote');
    Y.applyUpdate(d, Y.encodeStateAsUpdate(B), 'network');
    reconcileGroupGeometry(d, 'doc');
    expect(csNode('t1')).toBe(t1);
    expect(csNode('c1')).toBe(c1);
    expect(csNode('c2')).toBe(c2);
  });

  it("投影派发前非让位节点 doc.abs==cs.rel+origin 逐位成立（'网格内'限定删——二进制分数夹具保浮点逐位，量化单侧）", () => {
    openRwWindow();
    const d = new Y.Doc();
    const records: DocNodeRecord[] = [
      { id: 'gm', type: 'group', position: { x: 4, y: 8 }, width: 400, height: 300, data: { groupType: 'normal' } },
      { id: 'cc', type: 'imageGen', parentId: 'gm', position: { x: 1.5, y: 2.25 }, width: 100, height: 60, data: {} },
    ];
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    const origin = csNode('gm').position;
    const rel = csNode('cc').position;
    expect(rel.x + origin.x).toBe(1.5);    // 逐位 ===（0.05px 容差废止——量化后应严格相等）
    expect(rel.y + origin.y).toBe(2.25);
  });
});

describe('O0b-1 源矩阵：diff 首行 source:\'cs\'——命令几何不丢', () => {
  it('addToGroup（分支 A 守恒 refit）：t1 入 auto 组后 doc.abs 逐位保留∧cs rel+origin 自洽', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    _setIntentDocForTest(d);
    const t1AbsBefore = { ...csNode('t1').position };
    useCanvasStore.getState().addToGroup('g2', 't1');
    const docT1 = readCanvasFromDoc(d).nodes.find((n) => n.id === 't1');
    expect(docT1?.parentId).toBe('g2');
    expect(docT1?.position).toEqual(t1AbsBefore);            // abs 逐位（几何不丢）
    // 注：分支 A refit 的组帧键经差分落 doc=命令体现状链（与 groupNodes 同机制——O0b-2 写者收口
    // 前的过渡语义，非 reconcile 泄漏：reconcile('cs') 对 auto 展开档只写 origin，见函数头偏差登记）
    const origin = csNode('g2').position;
    expect(csNode('t1').position.x + origin.x).toBe(t1AbsBefore.x);  // cs rel+origin 自洽
    expect(csNode('t1').position.y + origin.y).toBe(t1AbsBefore.y);
  });

  it('arrangeSelection 命令几何经 diff 落 doc 不丢——doc.abs≡cs.position 逐位', () => {
    openRwWindow();
    const d = new Y.Doc();
    const records: DocNodeRecord[] = [
      { id: 'a1', type: 'textInput', position: { x: 700, y: 0 }, data: {} },
      { id: 'a2', type: 'textInput', position: { x: 200, y: 600 }, data: {} },
    ];
    fillDoc(d, records, []);
    stampDocSchema(toDocLike(d));
    applyDocToStore(d);
    _setIntentDocForTest(d);
    useCanvasStore.getState().arrangeSelection(['a1', 'a2'], 'horizontal');
    for (const id of ['a1', 'a2']) {
      const rec = readCanvasFromDoc(d).nodes.find((n) => n.id === id);
      expect(rec?.position).toEqual(csNode(id).position);    // 逐位
    }
    expect(checkProjectionInvariant(d)).toBe(true);
  });
});

// ══════════ O0b-1 census（扫描域=apps/*/src+packages/*/src——终裁 54②）══════════

describe('O0b-1 census：挂点三元组过渡断言（B7-1 升四元组——endGesture 第 4 成员随 B4\'-1 落地）', () => {
  it('reconcileGroupGeometry 调用行恰 3 处：漏斗尾+diff 首行（canvasIntents）+applyDocToStore 尾（canvasCollabRuntime）', () => {
    const calls = reconcileCallLines();
    expect(
      calls.length,
      `挂点数=${calls.length}（${calls.map((c) => c.rel).join(', ')}）——O0b 期三元组过渡断言：漏斗尾/diff 首行/applyDocToStore 尾恰各 1；第 4 成员（endGesture）随 B4'-1 落地后由 B7-1 升四元组断言`,
    ).toBe(3);
    const byFile = calls.map((c) => c.rel);
    expect(byFile.filter((r) => r.endsWith('apps/web/src/stores/canvasIntents.ts')).length).toBe(2);
    expect(byFile.filter((r) => r.endsWith('apps/web/src/stores/canvasCollabRuntime.ts')).length).toBe(1);
  });

  it("source:'cs' 全仓恰 1 处（仅 dispatchProjectionDiff 首行——卡一源矩阵不变量）", () => {
    const csCalls = reconcileCallLines().filter((c) => /['"]cs['"]/.test(c.line));
    expect(csCalls.length, JSON.stringify(csCalls)).toBe(1);
    expect(csCalls[0].rel.endsWith('apps/web/src/stores/canvasIntents.ts')).toBe(true);
  });

  it('reconcile 函数体纯 cs 写——零 doc 写原语（census：禁出现 doc 写侧符号；doc 读取=readRecordsFromMaps 薄委托单源）', () => {
    const src = readFileSync(path.join(REPO_ROOT, 'apps/web/src/stores/canvasCollabRuntime.ts'), 'utf8');
    const lines = src.split('\n');
    const startIdx = lines.findIndex((l) => l.includes('export function reconcileGroupGeometry('));
    expect(startIdx).toBeGreaterThanOrEqual(0);   // 扫描面非空自证
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
    const block = body.join('\n');
    expect(block).toContain('readCanvasFromDoc(');   // docShape 单源读取
    for (const banned of ['applyIntentToDoc(', 'setDocPosition(', 'fillDoc(', '.transact(',
      'dispatchCanvasIntent(']) {
      expect(block, `reconcile 内出现 doc 写原语 ${banned}（禁 doc 写——纯 cs 写）`).not.toContain(banned);
    }
  });

  it('帧装配算术实现点=1——GROUP_PADDING 生产命中行只在 shared geometry.ts（calcGroupBounds 单源；min/clamp 族=被约束量不在计数域）', () => {
    const geoSrc = readFileSync(path.join(REPO_ROOT, 'packages/shared/src/canvas/geometry.ts'), 'utf8');
    expect(geoSrc).toContain('export function calcGroupBounds(');   // 单源自证
    const violations: string[] = [];
    for (const file of collectProdFiles()) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      const isGeometry = rel === 'packages/shared/src/canvas/geometry.ts';
      for (const raw of readFileSync(file, 'utf8').split('\n')) {
        if (!raw.includes('GROUP_PADDING')) continue;
        const line = raw.trim();
        if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue; // 注释
        if (/^[\w\s,]+$/.test(line)) continue;   // 纯标识符清单（named import 续行/re-export）——非算术
        if (line.includes(' from ')) continue;   // import 行
        if (!isGeometry) violations.push(`${rel}: ${line.trim()}`);
      }
    }
    expect(
      violations,
      `GROUP_PADDING 算术出现于 geometry.ts 之外=${violations.join(' | ')}——帧装配实现点须唯一（禁自写 padding 公式成第二实现）`,
    ).toEqual([]);
  });
});

// DEFAULT_CHILD_SIZE 引用锚（auto 组空档推导的缺省尺寸单源——防本地复制常量）
void DEFAULT_CHILD_SIZE;
