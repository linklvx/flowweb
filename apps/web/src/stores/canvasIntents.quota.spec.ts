// apps/web/src/stores/canvasIntents.quota.spec.ts
// Y0b-4 T9a Step 3（4a 出口 D-14）：canApplyIntent 判据①-③ + runCommand precheck 骨架。
// 判据④（快照+delta 插值+软限滞回判定）依赖 T10 插值器——本 spec 只覆盖①-③骨架（④ it 标记 TODO T10）。
// 装置：纯函数直测 + store 直构（openRwWindow 同 canvasIntents.spec.ts——canEdit 真窗口；
// 无 doc 时 dispatchProjectionDiff 零 intents 早退，runCommand 照旧路径零副作用）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
// canvasIntents→canvasCollabRuntime 顶层 import HocuspocusProvider——空 mock（canvasIntents.spec.ts 同款）
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import type { DocNodeRecord } from '@flowweb/shared';
import { QUOTA_DEFAULTS, utf8Bytes } from '@flowweb/shared';
import { useCanvasStore } from './canvasStore';
import { canApplyIntent, type CanvasIntent } from './canvasIntents';
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';

vi.mock('@/api/videoProjectApi', () => ({ deleteProjectByNode: vi.fn().mockResolvedValue(undefined) }));

const rec = (id: string, data: Record<string, unknown> = { content: 'hi' }): DocNodeRecord => ({
  id, type: 'textInput', data,
});

/** canEdit 真（hydration ready + 非 readOnly + 无 terminal）——runCommand canEdit 门放行 */
function openRwWindow() {
  useCanvasStore.setState({
    nodes: [], edges: [], hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1',
  });
}

describe('Y0b-4 T9a D-14：canApplyIntent 判据①-③（Q-I 前三判据——④插值器归 T10）', () => {
  beforeEach(() => {
    openRwWindow();
    _resetCollabDiagForTest();
  });

  it('①key-too-large 先判（中文 utf8 3× 量纲）：单键超 256KB 拒——嵌套 data 字段递归命中且先于②', () => {
    // 中文 3B/字（.length===1 的量纲分歧核心）：构造超 maxKeyBytes 的单串
    const zhChars = Math.ceil((QUOTA_DEFAULTS.maxKeyBytes + 1) / 3) + 1;
    const big = '中'.repeat(zhChars);
    expect(utf8Bytes(big)).toBeGreaterThan(QUOTA_DEFAULTS.maxKeyBytes);
    expect(big.length).toBeLessThan(utf8Bytes(big)); // 量纲分歧锚：码元数 < 字节数
    // 嵌套 data 字段（updateNodeData.patch.content）——iterStringValues 递归命中
    const intent: CanvasIntent = { type: 'updateNodeData', id: 'n1', patch: { content: big } };
    // ①先于②：该 intent 整体 JSON 同样超 tx 限（超 tx 的单串必超 key 限——①⊆②包含关系），
    // 期望抢答 reason=key-too-large 而非 tx-too-large
    expect(utf8Bytes(JSON.stringify(intent))).toBeGreaterThan(QUOTA_DEFAULTS.maxTxBytes);
    expect(canApplyIntent([intent])).toEqual({ ok: false, reason: 'key-too-large' });
    // addNode.node.data 嵌套形态同构命中
    expect(canApplyIntent([{ type: 'addNode', node: rec('n2', { content: big }) }]))
      .toEqual({ ok: false, reason: 'key-too-large' });
  });

  it('②tx-too-large（Σ utf8Bytes(JSON) 超 256KB）——单键均低于①限+①⊆②量纲关系锚', () => {
    // ASCII 1B/字：单键 90KB < maxKeyBytes(256KB)——①不触发；3 个累计 >270KB 超 maxTxBytes
    const mid = 'a'.repeat(90_000);
    expect(utf8Bytes(mid)).toBeLessThan(QUOTA_DEFAULTS.maxKeyBytes);
    const intents: CanvasIntent[] = [0, 1, 2].map((k) => ({
      type: 'addNode', node: rec(`n${k}`, { content: mid }),
    }));
    const txBytes = intents.reduce((n, i) => n + utf8Bytes(JSON.stringify(i)), 0);
    expect(txBytes).toBeGreaterThan(QUOTA_DEFAULTS.maxTxBytes);
    expect(canApplyIntent(intents)).toEqual({ ok: false, reason: 'tx-too-large' });
    // ①⊆② 子集关系注释锚（QUOTA_DEFAULTS 锁定）：maxKeyBytes ≤ maxTxBytes ⇒ 任一单串超 tx 限
    // 必已超 key 限 ⇒ ①先判抢答——②只在"多键累计"形态独立触发（①判存在的理由）
    expect(QUOTA_DEFAULTS.maxKeyBytes).toBeLessThanOrEqual(QUOTA_DEFAULTS.maxTxBytes);
  });

  it('③too-many-nodes（addNode > 2000）——最小形态 tx 字节低于②限防抢答', () => {
    const many: CanvasIntent[] = Array.from({ length: QUOTA_DEFAULTS.maxNodesPerTx + 1 }, (_, i) => ({
      type: 'addNode', node: rec(`n${i}`, {}),
    }));
    // 前提锚：①②均不触发（最小 addNode 形态累计 ~140KB < 256KB）——③独立命中
    const txBytes = many.reduce((n, i) => n + utf8Bytes(JSON.stringify(i)), 0);
    expect(txBytes).toBeLessThanOrEqual(QUOTA_DEFAULTS.maxTxBytes);
    expect(canApplyIntent(many)).toEqual({ ok: false, reason: 'too-many-nodes' });
  });

  it('runCommand precheck 拒=fn 零调用+write_reject diag 记录；无 precheck/ok:true 照旧调用', () => {
    // 拒路径：canEdit 真（前置锚）→ precheck 拒 → fn 零调用 + diag 末条 write_reject
    expect(useCanvasStore.getState().hydration).toBe('ready');
    const fn = vi.fn();
    useCanvasStore.getState().runCommand(fn, () => ({ ok: false, reason: 'tx-too-large' }));
    expect(fn).not.toHaveBeenCalled();
    const diag = getRecentCollabDiag();
    expect(diag[diag.length - 1]?.type).toBe('write_reject');
    expect(diag[diag.length - 1]?.detail).toEqual({ reason: 'tx-too-large' });
    // 无 precheck 照旧（既有调用方零迁移——可选参数不破坏）
    const fn2 = vi.fn();
    useCanvasStore.getState().runCommand(fn2);
    expect(fn2).toHaveBeenCalledTimes(1);
    // precheck ok:true 放行
    const fn3 = vi.fn();
    useCanvasStore.getState().runCommand(fn3, () => ({ ok: true }));
    expect(fn3).toHaveBeenCalledTimes(1);
  });

  it('全部通过=ok（混合类型小集合 + ③边界：恰 2000 addNode 不拒——`>` 才拒）', () => {
    const mixed: CanvasIntent[] = [
      { type: 'addNode', node: rec('n1') },
      { type: 'updateNodeData', id: 'n1', patch: { content: 'x' } },
      { type: 'moveNode', id: 'n1', position: { x: 1, y: 2 } },
      { type: 'updateNodeEnvelope', id: 'n1', patch: { width: 100 } },
      { type: 'upsertEdge', edge: { id: 'e1', source: 'n1', target: 'n2' } },
      { type: 'deleteNode', id: 'n2' },
      { type: 'deleteEdge', id: 'e1' },
    ];
    expect(canApplyIntent(mixed)).toEqual({ ok: true });
    // ③边界锚：恰好 maxNodesPerTx 个 addNode 放行（tx ~130KB < 256KB 前提同③用例）
    const exactly: CanvasIntent[] = Array.from({ length: QUOTA_DEFAULTS.maxNodesPerTx }, (_, i) => ({
      type: 'addNode', node: rec(`n${i}`, {}),
    }));
    expect(canApplyIntent(exactly)).toEqual({ ok: true });
    // it.todo('④（T10）：快照+delta 插值+软限滞回判定——插值器归 T10 后补全量+分块粘贴')
  });
});
