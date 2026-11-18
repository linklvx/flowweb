// apps/web/src/stores/canvasO0b4.derivation.test.ts
// O0b-4（Spec B）：S1 模块清理+applyGroupDerivations 整删——deriveHidden 并入 reconcile 单内核（终裁 54④）。
//
// 13+1 逐点表（第二十五轮实测 13 处调用点；本轮行号随 O0b-2/3 漂移重测——每行给覆盖通道）：
//   canvasStore 13 处调用（全部删除，覆盖通道=命令尾 dispatch）：
//   ① runCommand finally            → 紧随其后 dispatchProjectionDiff 首行 reconcile('cs') 覆盖
//   ② groupNodes                    → 尾部 dispatchProjectionDiff 同上
//   ③ ungroup                       → 尾部 dispatchProjectionDiff 同上
//   ④ addToGroup                    → 尾部 dispatchProjectionDiff 同上
//   ⑤ removeNodeFromGroup 尾        → 主链 dispatchProjectionDiff 已覆盖（applyGroupFrame 后、善后段前）——本调用冗余
//   ⑥ removeNodeFromGroup ungroup 早退 → ungroup 自带 dispatchProjectionDiff；hidden 清理由 ungroup 自身
//      dispatch + 漏斗尾 reconcile 全域覆盖（单列一行——移出最后子触发 ungroup 后子变顶层 hidden 必须清，
//      断言"折叠组被 ungroup ⇒ 全子代 hidden===false（同命令内）"——第二十六轮 B2）
//   ⑦ dropIntoGroup                 → 尾部 dispatchProjectionDiff
//   ⑧ dropImageIntoStoryboard       → 尾部 dispatchProjectionDiff
//   ⑨ mergeStoryboard               → 尾部 dispatchProjectionDiff
//   ⑩ convertGroup                  → 尾部 dispatchProjectionDiff
//   ⑪ toggleCollapse                → dispatchCanvasIntent 漏斗尾 reconcile('doc')——cs data 写重排至 dispatch 前
//      （原顺序 dispatch→patchGroupDataInner 会使漏斗尾 reconcile 读到旧 data，hidden 断链）
//   ⑫ resizeStoryboardGrid          → 尾部 dispatchProjectionDiff
//   ⑬ addImageToStoryboardCell      → 尾部 dispatchProjectionDiff
//   ⑭ removeStoryboardCell          → 尾部 dispatchProjectionDiff
//   canvasCollabRuntime 1 处：applyDocToStore 内独立步骤 → 同函数尾挂 reconcile(d,'doc') 覆盖
//   （O0b-3 序列草图核销：hidden 独立步骤从保护序草图中消失）。
// viewer 折叠走 localCollapsed override（终裁 58⑥）不经 derivations——核对确认。
//
// hidden 语义（终裁 54④+88⑨）：数据域派生非几何保护域——reconcile 内全量跑、不受让位影响；
// 零差异短路只豁免几何，hidden 每调用必跑（undefined≡false 免写——零 setState 锚不破）。
import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import * as Y from 'yjs';
import { readFileSync, readdirSync, existsSync } from 'fs';
import * as path from 'path';
import { useCanvasStore } from './canvasStore';
import { applyDocToStore, checkProjectionInvariant } from './canvasCollabRuntime';
import { _setIntentDocForTest } from './canvasIntents';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { type StoredNodeRecord, type DragSession } from '@flowweb/shared';
import { seedCanvas, openRwWindow, openRoWindow, resetCanvasStores, seedDragSession } from '@/test/fixtures/canvas';

const csNode = (id: string) => useCanvasStore.getState().nodes.find((n: any) => n.id === id) as any;
const csEdge = (id: string) => useCanvasStore.getState().edges.find((e: any) => e.id === id) as any;

function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = path.dirname(cur);
  }
  throw new Error('repo root not found');
}
const REPO_ROOT = findRepoRoot(process.cwd());

/** 符号整删 census 扫描器（终裁 79 模板：删除类任务 test/守卫/allow 列表也是红相——
 *  含 test/spec 全量扫描，与 reconcileCallLines 的"排除 test"口径分立两套语义）。 */
function collectAllSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'docs', 'vendor', 'backups'].includes(entry.name)) continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(path.join(REPO_ROOT, 'apps'));
  walk(path.join(REPO_ROOT, 'packages'));
  return out;
}

/** 夹具：manual 组 g1(100,50,400×300)+子 c1(abs 120,80)+顶层 t1(700,0)+边 e1(c1→t1)。 */
const FIXTURE: StoredNodeRecord[] = [
  { id: 'g1', type: 'group', position: { x: 100, y: 50 }, width: 400, height: 300, data: { groupType: 'normal' } },
  { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 120, y: 80 }, width: 100, height: 60, data: {} },
  { id: 't1', type: 'textInput', position: { x: 700, y: 0 }, data: {} },
];

function buildDoc(records: StoredNodeRecord[] = FIXTURE, edges: any[] = []): Y.Doc {
  const d = new Y.Doc();
  fillDoc(d, records, edges);
  return d;
}

function sessionSkeleton(over: Partial<DragSession>): DragSession {
  return {
    baseline: new Map(), groupBaseline: new Map(), delta: { x: 0, y: 0 },
    draggingIds: new Set<string>(), dragProtectedIds: new Set<string>(),
    draggedGroupIds: new Set<string>(), frozenFrames: new Map(),
    gestureKind: 'drag', lastActivityAt: 0,
    activePointers: new Set<number>(), gestureAbandoned: false, resizeTargetId: null,
    ...over,
  };
}

/** 对端远端写（network 事务——applyDocToStore 消费的真实入口形态）。 */
function remoteMutate(d: Y.Doc, fn: (mirror: Y.Doc) => void): void {
  const B = new Y.Doc();
  Y.applyUpdate(B, Y.encodeStateAsUpdate(d));
  fn(B);
  Y.applyUpdate(d, Y.encodeStateAsUpdate(B), 'network');
}

afterEach(() => {
  _setIntentDocForTest(null);
  seedDragSession(null);
  resetCanvasStores();
});

// ══════════ 符号整删 census（终裁 79——含测试面零命中） ══════════

describe('O0b-4 符号删除 census', () => {
  /** 计数形态：整行注释（//、*、/* 开头）豁免——账本 note/沿革注释合法记录"谁被删了"；
   *  代码行（含行内调用/字符串字面量/mock 工厂）命中即红。 */
  const isCommentLine = (raw: string) => {
    const t = raw.trim();
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
  };

  it('整删符号全仓（apps+packages src 含 test/spec）代码行零命中：applyGroupDerivations/repairStoryboardCells/refitExpandedGroups/dispatchSystemIntents/pickStructNodes/pickStructEdges/structDiffToIntents', () => {
    const banned = ['applyGroupDerivations', 'repairStoryboardCells', 'refitExpandedGroups',
      'dispatchSystemIntents', 'pickStructNodes', 'pickStructEdges', 'structDiffToIntents'];
    const hits: string[] = [];
    for (const file of collectAllSourceFiles()) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      if (rel === 'apps/web/src/stores/canvasO0b4.derivation.test.ts') continue; // 本文件自证豁免
      for (const raw of readFileSync(file, 'utf8').split('\n')) {
        if (isCommentLine(raw)) continue;
        for (const sym of banned) {
          if (raw.includes(sym)) hits.push(`${rel}: ${sym}`);
        }
      }
    }
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });

  it('canvasHistory 模块引用零命中（import 路径——整模块删除）', () => {
    const hits: string[] = [];
    for (const file of collectAllSourceFiles()) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      if (rel === 'apps/web/src/stores/canvasO0b4.derivation.test.ts') continue;
      for (const raw of readFileSync(file, 'utf8').split('\n')) {
        if (isCommentLine(raw)) continue;
        if (raw.includes('canvasHistory')) hits.push(`${rel}: ${raw.trim()}`);
      }
    }
    expect(hits, JSON.stringify(hits)).toEqual([]);
  });
});

// ══════════ hidden 并入 reconcile 单内核（终裁 54④） ══════════

// Y2 A3 退役注记：hidden 派生并入 reconcile/命令路径 hidden 即时性/让位豁免三 describes 随
// reconcile+保护序整删（可见集合=内核剔除承担——renderNodes 不含隐藏子树；cs 零派生键）。