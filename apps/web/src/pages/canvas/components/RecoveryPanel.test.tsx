// apps/web/src/pages/canvas/components/RecoveryPanel.test.tsx
// Y1c T25b B1/B4（plan :338）：B 场景逐字段裁定 UI+接线闭环。★红形态=「现不可达」——
// recoveryPending.envelope 载体有数据、无任何交互面（组件不存在=import 红）→实装绿。
// 语义锚：修改字段「当前 vs 草稿」二选一**默认保留当前**（DRAFT_FIELD_CHOICE_DEFAULT）+
// 删除显式确认+新增逐 id 确认导入（importDraftEnvelope 生产接通）+完成→denyTracker
// .recoveryComplete（resumeFromRecovery——rejected-recovery.ts:226 生产调用面）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { RecoveryPanel } from './RecoveryPanel';

const importDraftEnvelope = vi.hoisted(() => vi.fn());
const resumeFromRecovery = vi.hoisted(() => vi.fn());
const dispatchIntents = vi.hoisted(() => [] as unknown[]);
vi.mock('@/api/collabApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/collabApi')>()),
  importDraftEnvelope,
}));
vi.mock('@/stores/canvasCollabRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stores/canvasCollabRuntime')>()),
  resumeFromRecovery,
}));
// doc 写路径 spy（dispatchCanvasIntent——面板经此写 doc；无 runtime 会话时 resolveDoc null 静默
// 零写=单测面以 intent 载荷断言为准，写通归 canvasStore/canvasIntents 既有覆盖）
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

beforeEach(() => {
  importDraftEnvelope.mockReset().mockResolvedValue({ confirmation: { contentCounts: { nodeCount: 1, edgeCount: 0 }, droppedRefs: { danglingEdges: 0, missingParentNodes: 0 }, notRestored: { artifacts: true, executionHistory: true, billingRecords: true } }, dispositions: [], resultReplayed: false, epoch: { envelopeGeneration: 3, envelopeHistoryId: 'h1', crossGeneration: false } });
  resumeFromRecovery.mockReset();
  dispatchIntents.length = 0;
  useCanvasStore.setState({
    recoveryPanelOpen: true,
    projectId: 'p1',
    // rw 会话电平（deleteNode canEditCommand 门——2a-6 同款 unlock）
    hydration: 'ready', collabReadOnly: false, wsAuthNotice: null,
    recoveryPending: { kind: 'deny-escape', envelopeNodeCount: 2, envelope: ENVELOPE as never },
    nodes: [
      { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: { prompt: '当前文案', style: '同值' } },
      { id: 'n3', type: 'imageGen', position: { x: 0, y: 0 }, data: { prompt: '被删节点' } },
    ] as never,
    edges: [],
  });
});
afterEach(cleanup);

describe('T25b B1/B4：RecoveryPanel 逐字段裁定', () => {
  it('★修改字段逐字段「当前 vs 草稿」二选一默认保留当前+删除显式确认+新增逐 id 确认（三面齐渲染）', () => {
    render(<RecoveryPanel />);
    expect(screen.getByText(/当前 vs 草稿/)).toBeInTheDocument();
    // 默认保留当前：radio 断言（current 选中）
    expect((screen.getByTestId('choice-n1-prompt-current') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('choice-n1-prompt-draft') as HTMLInputElement).checked).toBe(false);
    // 新增（默认不勾）+删除确认（默认不勾）
    expect((screen.getByTestId('adopt-n2') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('delete-n3') as HTMLInputElement).checked).toBe(false);
  });

  it('★默认全保留完成→零 doc 写+零导入+recoveryComplete 闭环（resumeFromRecovery 接通）', async () => {
    render(<RecoveryPanel />);
    fireEvent.click(screen.getByTestId('recovery-confirm-btn'));
    await vi.waitFor(() => expect(resumeFromRecovery).toHaveBeenCalledTimes(1));   // B4 闭环出口
    expect(importDraftEnvelope).not.toHaveBeenCalled();   // 零采纳零导入
    expect(useCanvasStore.getState().recoveryPanelOpen).toBe(false);
  });

  it('★选草稿+确认删除+采纳新增→doc 字段写 intent（草稿值）+deleteNode+importDraftEnvelope（B4 生产接通）', async () => {
    const before = useCanvasStore.getState().nodes;
    expect(before.find((n: any) => n.id === 'n3')).toBeTruthy();
    render(<RecoveryPanel />);
    fireEvent.click(screen.getByTestId('choice-n1-prompt-draft'));   // 草稿值覆盖 prompt
    fireEvent.click(screen.getByTestId('adopt-n2'));                 // 采纳新增
    fireEvent.click(screen.getByTestId('delete-n3'));                // 确认删除
    fireEvent.click(screen.getByTestId('recovery-confirm-btn'));
    await vi.waitFor(() => expect(importDraftEnvelope).toHaveBeenCalledTimes(1));
    expect(importDraftEnvelope.mock.calls[0][0]).toBe('p1');
    expect(importDraftEnvelope.mock.calls[0][1].nodes.map((n: any) => n.id)).toEqual(['n2']);
    // 草稿值字段=updateNodeData intent 载荷（默认 current 零 dispatch——本用例仅显式选 draft 的 1 字段）
    expect(dispatchIntents).toContainEqual({ intent: { type: 'updateNodeData', id: 'n1', patch: { prompt: '草稿文案' } }, origin: 'local-user' });
    expect(dispatchIntents.filter((d: any) => d.intent?.type === 'updateNodeData')).toHaveLength(1);
    await vi.waitFor(() => {
      expect(useCanvasStore.getState().nodes.find((n: any) => n.id === 'n3')).toBeUndefined();   // 删除确认执行
    });
    expect(resumeFromRecovery).toHaveBeenCalledTimes(1);
  });

  it('信封缺席档（镜像 tab/空画布）→只读告知（无裁定控件）', () => {
    useCanvasStore.setState({ recoveryPending: { kind: 'deny-escape', envelopeNodeCount: 0, envelope: null } });
    render(<RecoveryPanel />);
    expect(screen.getByText(/草稿已导出至下载文件/)).toBeInTheDocument();
    expect(screen.queryByTestId('recovery-confirm-btn')).not.toBeInTheDocument();
  });

  it('关闭按钮→面板合（recoveryPending 电平保持——恢复模式粘住）', () => {
    render(<RecoveryPanel />);
    fireEvent.click(screen.getByTestId('recovery-close-btn'));
    expect(useCanvasStore.getState().recoveryPanelOpen).toBe(false);
    expect(useCanvasStore.getState().recoveryPending?.kind).toBe('deny-escape');
  });
});
