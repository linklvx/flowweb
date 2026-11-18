// apps/web/src/stores/canvasCollabRuntime.geometry.test.ts
// O0b-0（Spec B）格式批：翻转主锚（几何）+S1 停写锚+web 读侧版本门。
// O0b-1（Spec B）reconcile 单内核扩展（非推翻）：写域四类（①组帧=deriveGroupFrame 派生·含折叠档
// COLLAPSED_SIZE 优先级最高[终裁 82]／②position abs→rel／③非组 wh 直拷·缺键保留现值／④分镜子
// {0,0}）+单遍单 origin+零差异短路（EPS=1e-6·同值保对象引用）+源矩阵（漏斗尾 source:'doc'/
// dispatchProjectionDiff 首行 source:'cs' 全仓恰 1 处/applyDocToStore 尾 source:'doc'）+census
// 四元组断言（B4'-1 落第 4 成员 endGesture——终裁 54②/65① 分期兑现）。
// 几何锚：打开（applyDocToStore）⇒cs 子 rel 逐位≡doc.abs−帧 origin ∧ doc 无 auto 组帧键 ∧
// 二次打开逐位不变（无 S1 回写）。doc 读取=readRecordsFromMaps（docShape 单源，禁从 nsNodes/csNodes
// 反推=直拷回灌）。组帧 origin：manual/storyboard 组=doc position 键；auto 组=calcGroupBounds；
// 分镜子={0,0} 不动。
import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { applyDocToStore, checkProjectionInvariant } from './canvasCollabRuntime';
import { fillDoc, toDocLike, readCanvasFromDoc } from '@/collab/ydocBuilder';
import {
  calcGroupBounds, calcStoryboardSize, COLLAPSED_SIZE, DEFAULT_CHILD_SIZE,
  type StoredNodeRecord,
} from '@flowweb/shared';
import {
  _setIntentDocForTest, dispatchCanvasIntent, captureStoreProjection, dispatchProjectionDiff,
} from './canvasIntents';
import { Origin, detachUndoManager, attachUndoManager } from './canvasUndo';
import { seedCanvas } from '@/test/fixtures/canvas';
import { projectCanvas } from '@/utils/projectCanvas';
import { useRuntimeFeedStore } from './runtimeStore';
import { existsSync, readFileSync, readdirSync } from 'fs';
import * as path from 'path';

/** rw 漏斗窗口（canEdit 真） */
function openRwWindow() {
  useCanvasStore.setState({
    hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1',
  });
}

/** 翻转夹具（v2.1 档——doc=abs 空间）：manual 组+auto 组+分镜组+嵌套子+顶层，fillDoc 后显式 stamp。
 *  M-3（O0b-0 质评）：夹具对齐 StoredNodeRecord/toDocRecords 同构链风格（去 as any）。 */
const FLIPPED_RECORDS: StoredNodeRecord[] = [
  // manual 组（帧三键齐——origin=doc position 键）+子 abs(120,80) → cs 期望 rel(20,30)
  { id: 'g1', type: 'group', position: { x: 100, y: 50 }, width: 400, height: 300, data: { groupType: 'normal', name: 'manual' } },
  { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 120, y: 80 }, width: 100, height: 60, data: {} },
  // auto 组（无帧三键——键集表）+2 子 abs → origin=calcGroupBounds(成员 abs bbox)
  { id: 'g2', type: 'group', data: { groupType: 'normal', name: 'auto' } },
  { id: 'c2', type: 'imageGen', parentId: 'g2', position: { x: 300, y: 100 }, width: 200, height: 100, data: {} },
  { id: 'c3', type: 'imageGen', parentId: 'g2', position: { x: 550, y: 100 }, width: 150, height: 80, data: {} },
  // 分镜组（origin=doc position 键）+分镜子（无 position 带 wh——cs {0,0} 构造默认不动）
  { id: 'sb1', type: 'group', position: { x: 0, y: 400 }, data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: true, stitchResolution: '2K' } } },
  { id: 's1', type: 'imageGen', parentId: 'sb1', width: 320, height: 180, data: { slot: 0 } },
  // 顶层普通节点（abs 直拷）
  { id: 't1', type: 'textInput', position: { x: 700, y: 0 }, data: {} },
];

function buildFlippedDoc(): Y.Doc {
  const d = new Y.Doc();
  fillDoc(d, FLIPPED_RECORDS, []);
  return d;
}

/** O0b-1 折叠档夹具（终裁 82）：manual 组密封帧（doc 三键=展开态值）+collapsed data。 */
function buildCollapsedManualDoc(): Y.Doc {
  const d = new Y.Doc();
  const records: StoredNodeRecord[] = [
    { id: 'g3', type: 'group', position: { x: 100, y: 50 }, width: 400, height: 300, data: { groupType: 'normal', name: 'm', collapsed: true } },
    { id: 'c9', type: 'imageGen', parentId: 'g3', position: { x: 120, y: 80 }, width: 100, height: 60, data: {} },
  ];
  fillDoc(d, records, []);
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

describe('Y2 A3 翻转主锚（几何）：打开 ⇒ renderNodes 子 rel 逐位≡deriveRenderCanvas；cs=作者缓存 doc abs', () => {
  const rnNode = (id: string) => useCanvasStore.getState().renderNodes.find((n) => n.id === id) as any;
  it('manual 组：renderNodes 组=origin、子 rel=abs−origin 逐位；cs 翻 abs=doc 读模型（先红——A3 Step2 转绿）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    expect(rnNode('g1').position).toEqual({ x: 100, y: 50 });       // origin=doc position（渲染列表=内核 rel 域）
    expect(rnNode('c1').position).toEqual({ x: 20, y: 30 });        // (120,80)−(100,50)
    expect(csNode('c1').position).toEqual({ x: 120, y: 80 });       // 作者缓存=doc abs（A3 翻转终态）
  });

  it('auto 组：origin=calcGroupBounds(成员 doc.abs bbox)——renderNodes 组=origin、子 rel 自洽；cs 翻 abs（先红）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    const expected = calcGroupBounds([
      { x: 300, y: 100, width: 200, height: 100 },
      { x: 550, y: 100, width: 150, height: 80 },
    ]);
    expect(rnNode('g2').position).toEqual({ x: expected.x, y: expected.y });
    expect(rnNode('c2').position).toEqual({ x: 300 - expected.x, y: 100 - expected.y });
    expect(rnNode('c3').position).toEqual({ x: 550 - expected.x, y: 100 - expected.y });
    expect(csNode('c2').position).toEqual({ x: 300, y: 100 });   // 作者缓存=doc abs
    expect(csNode('c3').position).toEqual({ x: 550, y: 100 });
  });

  it('分镜组：origin=doc position 键；分镜子不在 RF 列表（格位走 cellNodes）；cs 翻 abs（先红）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    expect(rnNode('sb1').position).toEqual({ x: 0, y: 400 });
    const ids = new Set(useCanvasStore.getState().renderNodes.map((n: any) => n.id));
    expect(ids.has('s1')).toBe(false);   // 分镜子被内核剔除——画面走 cellNodes 通道
    const cells = (rnNode('sb1').data as any).cellNodes as any[];
    expect(Array.isArray(cells)).toBe(true);
    expect(csNode('s1').position).toEqual({ x: 0, y: 0 });   // 作者缓存=doc 读模型（分镜子 doc 无键⇄cs {0,0} 构造默认材料化——三层表第三层）
  });

  it('顶层节点 abs 直拷（renderNodes 顶层 rel=abs；cs=作者缓存）；doc 无 auto 组帧三键（先红）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    expect(rnNode('t1').position).toEqual({ x: 700, y: 0 });
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
    const snap = () => JSON.stringify({
      cs: useCanvasStore.getState().nodes.map((n: any) => ({ id: n.id, position: n.position })),
      rn: useCanvasStore.getState().renderNodes.map((n: any) => ({ id: n.id, position: n.position })),
    });
    const first = snap();
    applyDocToStore(d);
    expect(snap()).toBe(first);
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
    const records: StoredNodeRecord[] = [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 10, height: 10, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, width: 100, height: 60, data: {} },
    ];
    fillDoc(d, records, []);
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

// ══════════ Y2 A3 Step1④：投影不变量新形态（spec §4 前置第 4 步——先红，Step2 删 reconcile 转绿）══════════
// 形态：无手势会话时 作者缓存≡doc 读模型（abs+全节点含隐藏）∧ 渲染列表≡projectCanvas(作者缓存,空覆盖)；
// E17 字段闭环门禁同批——doc 组记录零派生帧键（键集表一字不改=绿锚）。现状红因：cs 子=rel
//（reconcile 尾挂翻转）+hidden:true 落 cs（写域⑤）——Step2 后 cs=records verbatim abs 转绿。
describe('Y2 A3 投影不变量新形态（先红）：无手势 ⇒ 作者缓存≡doc 读模型 ∧ 渲染列表≡projectCanvas(作者缓存,空覆盖)', () => {
  // 两侧归一：id 序（doc Y.Map 插入序≠cs ensureParentOrder 渲染序——批4b-2 先例）+分镜子构造
  // 默认 {0,0}（doc 无键⇄cs 材料化——checkProjectionInvariant 内 withStoryboardChildDefault 同式）
  const byId = (ns: any[]) => [...ns].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // 构造默认 {0,0} 双侧归一（三层表第三层——doc 无 position 键〔分镜子/auto 组〕⇄cs 材料化）
  const withPosDefault = (nodes: any[]) =>
    nodes.map((n) => (n.position == null ? { ...n, position: { x: 0, y: 0 } } : n));

  it('作者缓存≡doc 读模型——abs+全节点在场（含分镜/隐藏子）零派生键（hidden/帧派生不落 cs）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    const docSide = withPosDefault(readCanvasFromDoc(d).nodes as any[]);
    const csSide = useCanvasStore.getState().nodes as any[];
    expect(csSide.length).toBe(docSide.length);   // 全节点——隐藏剔除只在渲染列表（内核），作者缓存不剔
    expect(byId(csSide)).toEqual(byId(docSide));  // 现状红：c1/c2/c3=rel≠doc.abs、s1 携 hidden:true
  });

  it('渲染列表≡projectCanvas(作者缓存, 空覆盖)——可见集合=内核剔除（分镜子不在 RF 列表）', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    applyDocToStore(d);
    const st = useCanvasStore.getState();
    const projected = projectCanvas({
      readModel: { records: st.nodes as any, edges: st.edges as any },
      runtime: useRuntimeFeedStore.getState().projection,
      mediaFacts: useNodeStore.getState().mediaFacts,
      gesture: new Map(),
      localPreview: new Map(),
    });
    expect(byId(st.renderNodes as any[])).toEqual(byId(projected.nodes as any[]));   // 现状红：cs rel 喂投影→子 abs 错位
  });

  it('E17 绿锚：doc 组记录零派生帧键——auto 零帧键（含 position）/分镜只留 position/manual 帧三键齐', () => {
    const d = buildFlippedDoc();
    const recs = new Map((readCanvasFromDoc(d).nodes as any[]).map((n) => [n.id, n]));
    expect(recs.get('g2').position).toBeUndefined();                        // auto——派生帧键零泄漏
    expect(recs.get('g2').width).toBeUndefined();
    expect(recs.get('g2').height).toBeUndefined();
    expect(recs.get('sb1').position).toEqual({ x: 0, y: 400 });             // storyboard 只留 position
    expect(recs.get('sb1').width).toBeUndefined();
    expect(recs.get('sb1').height).toBeUndefined();
    expect(recs.get('g1').position).toEqual({ x: 100, y: 50 });             // manual 帧三键齐（密封 origin）
    expect(recs.get('g1').width).toBe(400);
    expect(recs.get('g1').height).toBe(300);
  });
});

describe('T18 web 读侧版本门退役（版本判据=服务端 PG 列装载门——applyDocToStore DEV 断言删除）', () => {
  it('无戳∧有节点（fillDoc 形态——doc 内容不再带版本）→ applyDocToStore 正常水合不抛', () => {
    const d = new Y.Doc();
    const records: StoredNodeRecord[] = [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }];
    fillDoc(d, records, []);
    expect(() => applyDocToStore(d)).not.toThrow();   // 旧门「无戳∧有节点拒」档退役——读侧全函数
  });

  it('meta 残留旧值（历史载荷）→ applyDocToStore 不抛不解释', () => {
    const d = new Y.Doc();
    d.getMap('meta').set('schemaVersion', 1);
    const records: StoredNodeRecord[] = [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }];
    fillDoc(d, records, []);
    expect(() => applyDocToStore(d)).not.toThrow();
  });

  it('空 doc → 放行（合法空档）', () => {
    expect(() => applyDocToStore(new Y.Doc())).not.toThrow();
  });

  it('正常档水合（buildFlippedDoc 夹具）→ 放行且正常水合', () => {
    openRwWindow();
    const d = buildFlippedDoc();
    expect(() => applyDocToStore(d)).not.toThrow();
    expect(useCanvasStore.getState().nodes.length).toBeGreaterThan(0);
  });
});
// Y2 A3 退役注记：O0b-1 写域①②③④/单遍单 origin/源矩阵四 describes 随 reconcile 单内核整删
//（测的是被删机器——cs 帧派生/rel 写域/'cs' 源反推；形态沿革见 git 历史）。
describe("O0b-1 census：挂点四元组断言（B4'-1 落第 4 成员 endGesture——终裁 54②/65① 分期兑现；B7-1 验终态）", () => {
  it('Y2 A3：reconcileGroupGeometry 生产调用恰 0 处（退役断言——先红后删；四元组形态 2026-11-18 A3 起作废）', () => {
    const calls = reconcileCallLines();
    expect(
      calls.length,
      `挂点数=${calls.length}（${calls.map((c) => c.rel).join(', ')}）——A3 退役后应归零`,
    ).toBe(0);
  });

});
