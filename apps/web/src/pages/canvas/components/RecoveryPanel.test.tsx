// apps/web/src/pages/canvas/components/RecoveryPanel.test.tsx
// Y1c T25b B1/B4（plan :338）：B 场景逐字段裁定 UI+接线闭环。
// ★收口 I-2 红=「同源空转」：deny-escape 信封与 store nodes 同出一 doc（生产形态）——裁定视图
//   current 侧必须取 REST 服务端真值（fetchServerCanvas），否则三面结构性恒空、面板恒渲
//   「无待裁定项」（spec §4.5 B 行「客户端重置到服务端状态」后裁定——测试禁人工注入 store
//   current 掩盖同源空转）。
// ★收口 I-3 红=「裁定 doc 写静默丢失」：裁定动作（草稿值采纳/删除确认）全走 typed REST
//   （importDraftEnvelope+deletionNodeIds——禁 dispatchCanvasIntent/deleteNode doc 写承载）；
//   resume=重建 fresh provider（resyncFull 同款）非旧 provider 重连（被拒帧重放面根除）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { RecoveryPanel } from './RecoveryPanel';

const importDraftEnvelope = vi.hoisted(() => vi.fn());
const fetchServerCanvas = vi.hoisted(() => vi.fn());
const resumeFromRecovery = vi.hoisted(() => vi.fn());
const dispatchIntents = vi.hoisted(() => [] as unknown[]);
vi.mock('@/api/collabApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/collabApi')>()),
  importDraftEnvelope,
  fetchServerCanvas,
}));
vi.mock('@/stores/canvasCollabRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stores/canvasCollabRuntime')>()),
  resumeFromRecovery,
}));
// doc 写路径 spy（I-3 断言面：裁定禁 doc 写承载——dispatchCanvasIntent 零调用为锁）
vi.mock('@/stores/canvasIntents', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/stores/canvasIntents')>();
  return {
    ...orig,
    dispatchCanvasIntent: (intent: unknown, origin: string) => {
      dispatchIntents.push({ intent, origin });
      return orig.dispatchCanvasIntent(intent as never, origin);
    },
  };
});

const ENVELOPE = {
  draftId: 'd-1', projectId: 'p1', generation: 3, schemaVersion: 3, historyId: 'h1',
  capturedAtMs: 1, tabId: 't1',
  nodes: [
    { id: 'n1', type: 'imageGen', data: { prompt: '草稿文案', style: '同值' } },
    { id: 'n2', type: 'imageGen', data: { prompt: '新增节点' } },
  ] as never[],
  edges: [],
  meta: {},
  hashes: { nodes: 'x', edges: 'y' },
};

/** 生产同源形态：store nodes=信封导出时的 doc 投影（同源——I-2 红的构造前提）。 */
const STORE_NODES_SAME_AS_ENVELOPE = [
  { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: { prompt: '草稿文案', style: '同值' } },
  { id: 'n2', type: 'imageGen', position: { x: 0, y: 0 }, data: { prompt: '新增节点' } },
];
/** 服务端真值（REST 读径——与信封分叉：n1 冲突+n3 current-only）。 */
const SERVER_NODES = [
  { id: 'n1', type: 'imageGen', data: { prompt: '当前文案', style: '同值' } },
  { id: 'n3', type: 'imageGen', data: { prompt: '被删节点' } },
];

beforeEach(() => {
  vi.clearAllMocks();
  importDraftEnvelope.mockResolvedValue({ confirmation: { contentCounts: { nodeCount: 2, edgeCount: 0 }, droppedRefs: { danglingEdges: 0, missingParentNodes: 0 }, notRestored: { artifacts: true, executionHistory: true, billingRecords: true } }, dispositions: [], resultReplayed: false, deletions: { requested: 1, applied: 1 }, epoch: { envelopeGeneration: 3, envelopeHistoryId: 'h1', crossGeneration: false } });
  fetchServerCanvas.mockResolvedValue({ nodes: SERVER_NODES, edges: [] });
  dispatchIntents.length = 0;
  useCanvasStore.setState({
    recoveryPanelOpen: true,
    projectId: 'p1',
    hydration: 'ready', collabReadOnly: false, wsAuthNotice: null,
    recoveryPending: { kind: 'deny-escape', envelopeNodeCount: 2, envelope: ENVELOPE as never },
    nodes: STORE_NODES_SAME_AS_ENVELOPE as never,   // ★生产同源形态（I-2：store 侧不可作 current 源）
    edges: [],
  });
});
afterEach(cleanup);

describe('T25b 收口 I-2：裁定 current 侧=REST 服务端真值（同源空转根修）', () => {
  it('★i2-1 store 与信封同源（生产形态）仍渲染服务端分叉面——修前视图恒空「无待裁定项」（红）', async () => {
    render(<RecoveryPanel />);
    await waitFor(() => expect(fetchServerCanvas).toHaveBeenCalledWith('p1'));   // REST 读径消费
    await waitFor(() => expect(screen.getByText(/当前 vs 草稿/)).toBeInTheDocument());
    // 服务端分叉面：n1 冲突（prompt）+n2 新增+n3 删除候选——修前（store 同源）三面恒空（红）
    expect((screen.getByTestId('choice-n1-prompt-current') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('adopt-n2')).toBeInTheDocument();
    expect(screen.getByTestId('delete-n3')).toBeInTheDocument();
    expect(screen.queryByText('草稿与服务端一致——无待裁定项')).not.toBeInTheDocument();
  });

  it('服务端读失败→重试面（禁静默以 store 同源兜底=空转复发）', async () => {
    fetchServerCanvas.mockRejectedValue(new Error('network down'));
    render(<RecoveryPanel />);
    await waitFor(() => expect(screen.getByTestId('recovery-server-retry')).toBeInTheDocument());
    expect(screen.queryByTestId('recovery-confirm-btn')).not.toBeInTheDocument();
    fetchServerCanvas.mockResolvedValue({ nodes: SERVER_NODES, edges: [] });
    fireEvent.click(screen.getByTestId('recovery-server-retry'));
    await waitFor(() => expect(screen.getByTestId('recovery-confirm-btn')).toBeInTheDocument());
  });
});

describe('T25b 收口 I-3：裁定全走 typed REST+resume 重建 fresh（双约束）', () => {
  it('★i3-1 默认全保留完成→零 REST 导入+零 doc 写+resume（恢复模式出口）', async () => {
    render(<RecoveryPanel />);
    await waitFor(() => expect(screen.getByTestId('recovery-confirm-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('recovery-confirm-btn'));
    await waitFor(() => expect(resumeFromRecovery).toHaveBeenCalledTimes(1));
    expect(importDraftEnvelope).not.toHaveBeenCalled();   // 零动作面零 REST
    expect(dispatchIntents).toHaveLength(0);              // ★禁 doc 写承载裁定
    expect(useCanvasStore.getState().recoveryPanelOpen).toBe(false);
  });

  it('★i3-2 草稿值+采纳+删除确认→typed 导入载荷（replace/新增/deletionNodeIds）承载全裁定——禁 doc 写', async () => {
    render(<RecoveryPanel />);
    await waitFor(() => expect(screen.getByTestId('choice-n1-prompt-draft')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('choice-n1-prompt-draft'));   // prompt 取草稿
    fireEvent.click(screen.getByTestId('adopt-n2'));                 // 采纳新增
    fireEvent.click(screen.getByTestId('delete-n3'));                // 确认删除
    fireEvent.click(screen.getByTestId('recovery-confirm-btn'));
    await waitFor(() => expect(importDraftEnvelope).toHaveBeenCalledTimes(1));
    const [pid, env, choices, deletions] = importDraftEnvelope.mock.calls[0];
    expect(pid).toBe('p1');
    expect(env.nodes.map((n: any) => n.id).sort()).toEqual(['n1', 'n2']);   // 冲突 replace 节点+采纳新增
    expect((env.nodes.find((n: any) => n.id === 'n1').data as any).prompt).toBe('草稿文案');
    expect(choices).toEqual({ n1: 'replace' });
    expect(deletions).toEqual(['n3']);                                      // 删除确认 typed 承载
    expect(dispatchIntents).toHaveLength(0);                                // ★修前：updateNodeData intent 承载（红锚）
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id)).toEqual(['n1', 'n2']);   // 本地 store 零变动（裁定/删除全在服务端侧承载——修前 deleteNode 本地删）
    await waitFor(() => expect(resumeFromRecovery).toHaveBeenCalledTimes(1));
  });
});

describe('T25b B1 既有面（信封缺席档/关闭）', () => {
  it('信封缺席档（镜像 tab/空画布）→只读告知（无裁定控件）', async () => {
    useCanvasStore.setState({ recoveryPending: { kind: 'deny-escape', envelopeNodeCount: 0, envelope: null } });
    render(<RecoveryPanel />);
    expect(screen.getByText(/无草稿副本/)).toBeInTheDocument();
    expect(screen.queryByTestId('recovery-confirm-btn')).not.toBeInTheDocument();
  });

  it('关闭按钮→面板合（recoveryPending 电平保持——恢复模式粘住）', async () => {
    render(<RecoveryPanel />);
    await waitFor(() => expect(screen.getByTestId('recovery-close-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('recovery-close-btn'));
    expect(useCanvasStore.getState().recoveryPanelOpen).toBe(false);
    expect(useCanvasStore.getState().recoveryPending?.kind).toBe('deny-escape');
  });
});
