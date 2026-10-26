// apps/web/src/pages/canvas/components/nodes/runtimeArtifactOverlay.spec.tsx
// Y1c T22 收口批 C-2 组件级红→绿：feed exec.artifact → 媒体 src 渲染（四节点族同型读点
// useMediaUrl(runtimeMediaIdOf(id) ?? fileId)——AudioGenNode 为族代表：mock 面最小〔ImageGen/
// VideoGen/MultiImage 同型改造，选型注明于各组件注释〕）。修前 nodeData.fileId 服务端停写=
// 刷新/新协作者/错过广播会话的产物永久空白（红基线：runtime 投影有 artifact 而 useMediaUrl
// 收到 undefined）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AudioGenNode } from './AudioGenNode';
import { ReactFlowProvider } from '@xyflow/react';
import { useRuntimeFeedStore, resetRuntimeFeed } from '@/stores/runtimeStore';

// useMediaUrl 载荷捕获（overlay 优先级断言面——真 src 由 mock AudioWaveform 回显）
const useMediaUrlArgs: Array<string | null | undefined> = [];
vi.mock('@/hooks/useMediaUrl', () => ({
  useMediaUrl: (fileId: string | null | undefined) => {
    useMediaUrlArgs.push(fileId);
    return fileId
      ? { url: `http://media/${fileId}`, loading: false, error: null, onError: vi.fn() }
      : { url: null, loading: false, error: null, onError: vi.fn() };
  },
}));

const { getMockNodeData } = vi.hoisted(() => {
  // data 恒「无 fileId」形态（C-2 红基线：服务端停写 data.fileId——产物唯一在档源=runtime 投影）
  const mockNodeData: any = { fileId: undefined, status: 'idle', model: '', referenceAudio: undefined };
  return { getMockNodeData: () => mockNodeData };
});

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, useStore: (selector: any) => selector({ nodes: [{ id: 'a1', selected: true } as any] }) };
});

vi.mock('@/stores/nodeStore', () => ({
  useNodeStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = {
        nodes: { a1: { id: 'a1', type: 'audioGen', position: { x: 0, y: 0 }, data: getMockNodeData() } },
        execStatus: new Map(),
        execAligned: new Map(),
        updateConfig: vi.fn(),
        setStatus: vi.fn(),
        setFileResult: vi.fn(),
      };
      return typeof selector === 'function' ? selector(state) : state;
    }),
    {
      getState: () => ({
        nodes: { a1: { id: 'a1', type: 'audioGen', position: { x: 0, y: 0 }, data: getMockNodeData() } },
        execStatus: new Map(),
        execAligned: new Map(),
        setStatus: vi.fn(),
        setFileResult: vi.fn(),
      }),
    },
  ),
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = { projectId: 'test-project' };
      return typeof selector === 'function' ? selector(state) : state;
    }),
    { getState: () => ({ projectId: 'test-project' }) },
  ),
}));

vi.mock('@/services/executionSocket', () => ({
  subscribeNodeStatus: vi.fn(() => () => {}),
  subscribeNodeEditResult: vi.fn(() => () => {}),
  ensureExecutionSocket: vi.fn(() => ({ once: vi.fn(), off: vi.fn() })),
}));

vi.mock('@/api/storageApi', () => ({
  presignUpload: vi.fn().mockResolvedValue({ fileId: 'f', uploadUrl: 'http://minio/f', key: 'k', fields: {} }),
  confirmUpload: vi.fn().mockResolvedValue({ fileId: 'f' }),
}));

vi.mock('@/api/mediaApi', () => ({
  getMediaUrl: vi.fn().mockResolvedValue({ url: 'http://media/x' }),
  toFlowaiUrl: (u: string) => u,
}));

vi.mock('axios', () => ({ default: { post: vi.fn().mockResolvedValue({}) } }));

vi.mock('./AudioWaveform', () => ({
  AudioWaveform: ({ audioUrl }: { nodeId: string; audioUrl: string | null }) => (
    <div data-testid="audio-waveform">{audioUrl}</div>
  ),
}));

const baseNodeProps = {
  id: 'a1', data: {}, type: 'audioGen', draggable: true, dragging: false,
  selectable: true, deletable: true, zIndex: 0, isConnectable: true,
  positionAbsoluteX: 0, positionAbsoluteY: 0,
} as any;

const renderNode = () => render(<ReactFlowProvider><AudioGenNode {...baseNodeProps} /></ReactFlowProvider>);

describe('Y1c T22 收口批 C-2：exec.artifact overlay 读径（四节点族代表=AudioGenNode）', () => {
  afterEach(() => {
    useMediaUrlArgs.length = 0;
    resetRuntimeFeed();
  });

  it('红→绿：runtime 投影 artifact.mediaId（feed exec.artifact）→ useMediaUrl 载荷=overlay 值（doc data.fileId 停写后产物唯一在档源）', () => {
    // data.fileId=undefined（服务端停写后刷新/新协作者形态）+runtime 投影持 artifact 槽
    useRuntimeFeedStore.setState({
      projectId: 'test-project',
      cursor: { historyId: 'h', generation: 0, feedSeq: '2' },
      projection: {
        projectId: 'test-project', generation: 0, feedSeq: '2', pgSeq: '0',
        nodes: { a1: { artifact: { mediaId: 'm-overlay', artifactRev: 1, nodeVersion: '2' } } },
      },
      fetchedAtMs: Date.now(),
    });
    renderNode();
    // 修前：useMediaUrl 收 undefined（nodeData.fileId 缺席）→产物空白；修后=runtimeMediaIdOf overlay 值
    expect(useMediaUrlArgs).toContain('m-overlay');
    expect(screen.getByTestId('audio-waveform').textContent).toBe('http://media/m-overlay');
  });

  it('legacy 兜底序：无 runtime artifact → doc 残留 fileId 照读（overlay 不破坏存量档）', () => {
    useRuntimeFeedStore.setState({
      projectId: 'test-project',
      cursor: { historyId: 'h', generation: 0, feedSeq: '0' },
      projection: { projectId: 'test-project', generation: 0, feedSeq: '0', pgSeq: '0', nodes: {} },
      fetchedAtMs: Date.now(),
    });
    renderNode();
    expect(useMediaUrlArgs).toContain(undefined);   // data.fileId=undefined → null 载荷（占位形态不变）
  });
});
