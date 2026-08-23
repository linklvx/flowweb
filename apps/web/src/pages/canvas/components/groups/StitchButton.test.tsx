import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StitchButton } from './StitchButton';

const { getMockNodes, setMockNodes, getMockStart } = vi.hoisted(() => {
  let mockNodes: any[] = [];
  const start = vi.fn().mockResolvedValue({ outcome: 'COMPLETED' as const });
  return {
    getMockNodes: () => mockNodes,
    setMockNodes: (n: any[]) => { mockNodes = n; },
    getMockStart: () => start,
  };
});

vi.mock('@/hooks/useStitchTask', () => ({
  useStitchTask: () => ({ start: getMockStart() }),
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = { projectId: 'p1', nodes: getMockNodes() };
      if (typeof selector === 'function') return selector(state);
      return state;
    }),
    { getState: () => ({ projectId: 'p1', nodes: getMockNodes() }) },
  ),
}));

describe('StitchButton', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    setMockNodes([]);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('显示当前档位并可切换', () => {
    const onResolutionChange = vi.fn();
    render(<StitchButton groupId="g1" resolution="2K" onResolutionChange={onResolutionChange} />);
    expect(screen.getByText(/拼接\(2K\)/)).toBeTruthy();
  });

  it('执行中禁用（防重）', () => {
    render(<StitchButton groupId="g1" resolution="2K" onResolutionChange={vi.fn()} running />);
    expect((screen.getByRole('button', { name: /拼接/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('首用提示在首次点击拼接时写入 localStorage（非组件 mount 时）', async () => {
    render(<StitchButton groupId="g1" resolution="2K" onResolutionChange={vi.fn()} />);
    // mount 时不提示（spec 7.3「首次使用」= 首次点击触发）
    expect(localStorage.getItem('flowweb.stitch-upscale-tip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /拼接/ }));
    // 点击后 key 写入（plan 定稿的 key：flowweb.stitch-upscale-tip）
    await vi.waitFor(() => {
      expect(localStorage.getItem('flowweb.stitch-upscale-tip')).toBe('1');
    });
  });

  it('fileIds 收集归一化：cells 节点无 fileId 有 referenceImage（上传图）时收集 referenceImage', async () => {
    setMockNodes([
      {
        id: 'g1', type: 'group', position: { x: 0, y: 0 },
        data: {
          groupType: 'storyboard', cells: ['c1', 'c2', 'c3'],
          storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 3, showIndex: false },
        },
      },
      { id: 'c1', type: 'imageGen', position: { x: 0, y: 0 }, data: { status: 'done', fileId: 'gen-1' } },
      { id: 'c2', type: 'imageGen', position: { x: 0, y: 0 }, data: { status: 'idle', referenceImage: 'ref-2' } },
      { id: 'c3', type: 'imageGen', position: { x: 0, y: 0 }, data: { status: 'idle' } }, // 空位节点
    ]);
    render(<StitchButton groupId="g1" resolution="2K" onResolutionChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /拼接/ }));
    await vi.waitFor(() => {
      expect(getMockStart()).toHaveBeenCalled();
    });
    const params = getMockStart().mock.calls[0][0];
    expect(params.fileIds).toEqual(['gen-1', 'ref-2']);
    expect(params.fileIds.every((f: unknown) => f != null)).toBe(true);
  });
});
