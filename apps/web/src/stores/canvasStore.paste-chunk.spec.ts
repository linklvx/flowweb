// apps/web/src/stores/canvasStore.paste-chunk.spec.ts
// Y0b-4 T10（Q-J 分块粘贴——T0 探针③实证：粘贴 100 节点=单 transact 非天然分块 → chunkCopyPlan 贪心切块）：
// E39① 1MB 文本+100 节点粘贴=逐块 ≤256KB transact 过 seam+undo 一步（undoStack.length===1）；
// 中途预算耗尽=已贴块保留+剩余丢弃+diag（块=原子不半块回滚）。
// 装置：rich provider mock + initCollab（插值器/undoManager 生产挂载——判据④消费逐块增长的 localDelta）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Y0b-5 T3：mock 收敛——唯一载体 @/test/fixtures/fakeHocuspocusProvider（裁定 24⑪⑤）。
vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});
import { HocuspocusProvider } from '@hocuspocus/provider';
import { message } from 'antd';
import { QUOTA_DEFAULTS, utf8Bytes } from '@flowweb/shared';
import type { CopyRecord } from '@flowweb/shared';
import { useCanvasStore, chunkCopyPlan, chunkIntentsOf } from './canvasStore';
import { useNodeStore } from './nodeStore';
import * as runtime from './canvasCollabRuntime';
import { getDoc } from './canvasCollabRuntime';
import { getUndoManager } from './canvasUndo';
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';

vi.mock('@/api/videoProjectApi', () => ({ deleteProjectByNode: vi.fn().mockResolvedValue(undefined) }));

const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;
const Mocks = HocuspocusProvider as any;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function driveToSynced(pid = 'p1') {
  const done = runtime.initCollab(pid);
  await tick();
  const p = lastInstance();
  p.emit('status', { status: 'connected' });
  p.isAuthenticated = true;
  p.emit('authenticated', { scope: 'read-write' });
  p.isSynced = true;
  p.emit('synced', {});
  await done;
  return p;
}

const docStatus = (o: { rev: number; bytes?: number; softLimitBytes?: number }) => JSON.stringify({
  type: 'doc-status',
  rev: o.rev,
  writeFrozen: false,
  quota: {
    state: 'ok',
    bytes: o.bytes ?? 0,
    limit: 8_388_608,
    maxTxBytes: 262_144,
    softLimitBytes: o.softLimitBytes ?? 6_710_886,
  },
});

const KB = 1024;

/** 播种：组 g1 + N textInput 子（ns data.content 每子 contentBytes——1MB 总量的分块输入） */
function seedGroup(childrenCount: number, contentBytesEach: number) {
  const nsNodes: Record<string, any> = {};
  const csNodes: any[] = [
    { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 800, height: 6000, data: {} },
  ];
  for (let i = 0; i < childrenCount; i++) {
    csNodes.push({
      id: `c${i}`, type: 'textInput', parentId: 'g1',
      position: { x: 16, y: 16 + i * 60 }, width: 256, height: 48, data: {},
    });
    nsNodes[`c${i}`] = { id: `c${i}`, type: 'textInput', data: { content: 'x'.repeat(contentBytesEach) } };
  }
  useCanvasStore.setState({ nodes: csNodes, edges: [], selectedId: null } as any);
  useNodeStore.setState({ nodes: nsNodes } as any);
}

beforeEach(() => {
  Mocks.instances.length = 0;
  _resetCollabDiagForTest();
  useCanvasStore.setState({
    nodes: [], edges: [], connStatus: 'connecting', connUi: 'ok', hydration: 'idle',
    collabReadOnly: true, wsAuthNotice: null, writeFrozen: false, collabEscapePending: false,
    connReadOnly: false, quotaOver: false, quotaLimitBytes: 0, quotaTxBytes: 0,
    quotaSoftLimitBytes: 0, quotaResidueBytes: undefined, lastDocStatusRev: 0,
    localDocBytes: 0, localDelta: 0, pendingGenerationReload: 0, projectId: 'p1',
  });
});
afterEach(async () => {
  await runtime.destroyCollab();
  vi.restoreAllMocks();
});

describe('Y0b-4 T10：分块粘贴（Q-J——chunkCopyPlan 形态）', () => {
  it('E39①：1MB 文本+100 节点粘贴成功（分块逐块过 seam——每帧 ≤256KB）+undo 一步（undoStack.length===1）', async () => {
    await driveToSynced();
    seedGroup(100, 10 * KB);
    useCanvasStore.getState().copyGroupToClipboard('g1');
    const frames: number[] = [];
    getDoc()!.on('update', (u: Uint8Array) => frames.push(u.byteLength));
    const firstTop = useCanvasStore.getState().pasteGroupClipboard({ x: 1000, y: 0 });
    expect(firstTop).toBeTruthy();
    const s = useCanvasStore.getState();
    expect(s.nodes).toHaveLength(202);                        // 101 原件 + 101 副本全量落位
    const d = getDoc()!;
    expect(d.getMap('nodes').size).toBe(101);                 // 副本全量落 doc（原件为播种态从未入 doc）
    expect(frames.length).toBeGreaterThanOrEqual(3);          // 非单 transact（探针③形态——分块落 wire）
    expect(Math.max(...frames)).toBeLessThanOrEqual(262_144); // 每块过 seam（服务端 tx 门 256KB）
    expect(frames.reduce((a, b) => a + b, 0)).toBeGreaterThan(900_000);   // 1MB 内容实质上 wire
    expect(getUndoManager()!.undoStack.length).toBe(1);       // captureTimeout 窗合并=1 undo 项
    getUndoManager()!.undo();                                 // 撤销一步整撤全部分块
    expect(d.getMap('nodes').size).toBe(0);
  });

  it('中途预算耗尽：已贴块保留+剩余丢弃+diag+toast（块=原子不半块回滚——doc/store 对已贴块一致）', async () => {
    const p = await driveToSynced();
    seedGroup(100, 10 * KB);
    useCanvasStore.getState().copyGroupToClipboard('g1');
    p.emit('stateless', { payload: docStatus({ rev: 1, bytes: 0, softLimitBytes: 450 * KB }) });
    const warn = vi.spyOn(message, 'warning');
    useCanvasStore.getState().pasteGroupClipboard({ x: 1000, y: 0 });
    const s = useCanvasStore.getState();
    const pasted = s.nodes.length - 101;
    expect(pasted).toBeGreaterThan(0);                        // 已贴块保留
    expect(pasted).toBeLessThan(101);                         // 剩余丢弃
    expect(getDoc()!.getMap('nodes').size).toBe(pasted);      // 已贴块 doc/store 一致（逐块 diff 收口）
    const rejects = getRecentCollabDiag().filter((e) => e.type === 'write_reject');
    expect(rejects.length).toBeGreaterThanOrEqual(1);
    expect(rejects[rejects.length - 1]!.detail).toMatchObject({ reason: 'doc-over-budget' });
    expect(warn).toHaveBeenCalledWith('画布已达容量上限（约 0.4MB），请瘦身或删除内容');   // 450KB 配置 → 460800/1048576=0.4（1024 基与配额常量同口径）
    expect(getUndoManager()!.undoStack.length).toBe(1);       // 已贴块仍单 undo 项（部分粘贴可一步撤销）
  });
});

describe('Y0b-4 T10 微修复：块预算 headroom 守卫（外审 Issue 1——纯函数直测）', () => {
  it('极端形态两臂——500 最小节点块 / 单个近 200KB 节点块——chunkIntentsOf 的 txBytes（判据②度量）≤ maxTxBytes', () => {
    const copy = (id: string, contentBytes: number): CopyRecord => ({
      id, type: 'textInput', position: { x: 0, y: 0 }, width: 256, height: 48,
      data: { content: 'x'.repeat(contentBytes) },
    });
    // 臂一（数量极端）：500 个最小节点——CHUNK_MAX_NODES 全入一块，intent 包装开销总和 ~15KB
    const armMany = Array.from({ length: 500 }, (_, i) => copy(`n${i}`, 0));
    // 臂二（字节极端）：单个近 200KB 节点——copy 项字节贴近 CHUNK_UTF8_BUDGET（预留 ~150B 信封键）
    const armBig = [copy('big', 204_800 - 150)];
    for (const copies of [armMany, armBig]) {
      const chunks = chunkCopyPlan({ copies, newEdges: [], idMap: new Map() });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      for (const ch of chunks) {
        const txBytes = chunkIntentsOf(ch).reduce((n, i) => n + utf8Bytes(JSON.stringify(i)), 0);
        expect(txBytes).toBeLessThanOrEqual(QUOTA_DEFAULTS.maxTxBytes);
      }
    }
  });
});
