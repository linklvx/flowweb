// apps/web/src/stores/specbProdCarrier.spec.ts
// B7-2 prod 断言载体锚（终裁 58④）：import.meta.env.PROD（DEV=false）下注入脏 doc ⇒ 不抛 +
// reportShapeViolation 计数 +1（prod 不阻断+计数器——DEV 直抛/prod 收编分流的载体接线验证）。
// 脏形态=分镜组 children⊄cells（assertStoryboardMembership 违例——reconcile 不修 membership，
// 违例能活着走到尾挂断言；几何类违例会被先行的 reconcile 写域修平=不可达，勿用）。
// 门禁分层注记：vitest 本跑 DEV 构建——本用例经 vi.stubEnv('DEV', false) 走 prod 分支；
// e2e 侧（vite preview=真 prod 构建）由 gate-collab 套件覆盖真 PROD 面。
import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import * as Y from 'yjs';
import { applyDocToStore } from './canvasCollabRuntime';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { stampDocSchema, resetShapeViolationStats, shapeViolationStats, type DocNodeRecord } from '@flowweb/shared';
import { _setIntentDocForTest } from './canvasIntents';
import { detachUndoManager } from './canvasUndo';
import { resetCanvasStores } from '@/test/fixtures/canvas';

/** 脏 doc：分镜组 cells=['s1'] + 越权成员 rogue（parentId 指 sb1 但不在 cells——children⊄cells 违例） */
function buildDirtyStoryboardDoc(): Y.Doc {
  const records: DocNodeRecord[] = [
    { id: 'sb1', type: 'group', position: { x: 0, y: 400 }, data: {
      groupType: 'storyboard', cells: ['s1'],
      storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: true, stitchResolution: '2K' },
    } },
    { id: 's1', type: 'imageGen', parentId: 'sb1', width: 320, height: 180, data: {} },
    { id: 'rogue', type: 'imageGen', parentId: 'sb1', width: 320, height: 180, data: {} }, // 不在 cells
  ];
  const d = new Y.Doc();
  fillDoc(d, records, []);
  stampDocSchema(toDocLike(d));
  return d;
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetShapeViolationStats();
  _setIntentDocForTest(null);
  detachUndoManager();
  resetCanvasStores();   // 夹具复位单点（静态棘轮——test 面零手写 setState）
});

describe('B7-2 prod 断言载体：脏 doc ⇒ DEV 直抛 / prod 不抛+计数+1', () => {
  it('DEV=true：applyDocToStore 尾挂断言直抛（membership 违例）', () => {
    vi.stubEnv('DEV', true);
    const d = buildDirtyStoryboardDoc();
    expect(() => applyDocToStore(d)).toThrow(/assertStoryboardMembership|cells/);
  });

  it('DEV=false（prod 档）：不抛 + reportShapeViolation 计数+1（rogue 违例入账）', () => {
    vi.stubEnv('DEV', false);
    const d = buildDirtyStoryboardDoc();
    resetShapeViolationStats();
    expect(() => applyDocToStore(d)).not.toThrow(); // prod 不阻断（终裁 85①——按字面抛会白屏）
    expect(shapeViolationStats().size).toBe(1);
    const [[key, count]] = [...shapeViolationStats()];
    expect(key).toContain('rogue');   // 变更 id 去重的去重键含节点 id
    expect(count).toBe(1);            // 计数 +1（同 key 首报——采样日志单源）
  });
});
