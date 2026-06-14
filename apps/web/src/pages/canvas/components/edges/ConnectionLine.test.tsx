import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ConnectionLine } from './ConnectionLine';
import { ReactFlowProvider } from '@xyflow/react';

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: {
    getState: () => ({
      onEdgesChange: vi.fn(),
    }),
  },
}));

// mock useStore from @xyflow/react
const mockNodeInternals = new Map<string, { selected: boolean }>();
vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react');
  return {
    ...actual,
    useStore: vi.fn(),
  };
});

import { useStore } from '@xyflow/react';

const defaultProps: any = {
  id: 'e1',
  sourceX: 0,
  sourceY: 100,
  targetX: 200,
  targetY: 100,
  sourcePosition: 'right' as const,
  targetPosition: 'left' as const,
  selected: false,
  source: 'node1',
  target: 'node2',
};

function setupMockUseStore(sourceSelected: boolean, targetSelected: boolean) {
  mockNodeInternals.clear();
  mockNodeInternals.set('node1', { selected: sourceSelected } as any);
  mockNodeInternals.set('node2', { selected: targetSelected } as any);

  vi.mocked(useStore).mockImplementation((selector: any) => {
    return selector({
      nodeInternals: new Map(mockNodeInternals),
    });
  });
}

const renderWithProviders = (props = {}) =>
  render(
    <ReactFlowProvider>
      <svg>
        <ConnectionLine {...defaultProps} {...props} />
      </svg>
    </ReactFlowProvider>,
  );

describe('ConnectionLine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render edge path', () => {
    setupMockUseStore(false, false);
    const { container } = renderWithProviders();
    expect(container.querySelector('path')).toBeInTheDocument();
  });

  it('should have amber stroke when edge itself selected', () => {
    setupMockUseStore(false, false);
    const { container } = renderWithProviders({ selected: true });
    const path = container.querySelector('path')!;
    expect(path.getAttribute('style')).toContain('#f59e0b');
  });

  it('should have gray stroke when not selected', () => {
    setupMockUseStore(false, false);
    const { container } = renderWithProviders({ selected: false });
    const path = container.querySelector('path')!;
    expect(path.getAttribute('style')).toContain('#888');
  });

  it('should show particles when source node is selected', () => {
    setupMockUseStore(true, false);
    const { container } = renderWithProviders();
    const particlesGroup = container.querySelector('.edge-flow-particles');
    expect(particlesGroup).toBeInTheDocument();
    expect(container.querySelectorAll('circle')).toHaveLength(6); // 3 outward + 3 inward
  });

  it('should show particles when target node is selected', () => {
    setupMockUseStore(false, true);
    const { container } = renderWithProviders();
    const particlesGroup = container.querySelector('.edge-flow-particles');
    expect(particlesGroup).toBeInTheDocument();
  });

  it('should NOT show particles when neither endpoint is selected', () => {
    setupMockUseStore(false, false);
    const { container } = renderWithProviders();
    const particlesGroup = container.querySelector('.edge-flow-particles');
    expect(particlesGroup).not.toBeInTheDocument();
  });

  it('should show highlight overlay when endpoint selected and edge not selected', () => {
    setupMockUseStore(true, false);
    const { container } = renderWithProviders({ selected: false });
    const paths = container.querySelectorAll('path');
    // BaseEdge renders 2 paths (edge + interaction) + highlight overlay = 3 total
    expect(paths.length).toBe(3);
  });

  it('should NOT show highlight overlay when edge itself is selected', () => {
    setupMockUseStore(true, false);
    const { container } = renderWithProviders({ selected: true });
    const paths = container.querySelectorAll('path');
    // BaseEdge renders 2 paths: edge + interaction. No highlight overlay (would be a 3rd path).
    expect(paths.length).toBe(2);
  });

  it('should handle missing nodeInternals gracefully', () => {
    // empty Map: get() returns undefined
    mockNodeInternals.clear();
    vi.mocked(useStore).mockImplementation((selector: any) => {
      return selector({ nodeInternals: new Map() });
    });
    const { container } = renderWithProviders();
    // should render without crash
    expect(container.querySelector('path')).toBeInTheDocument();
  });

  it('should show particles when both endpoints are selected', () => {
    setupMockUseStore(true, true);
    const { container } = renderWithProviders();
    // still 6 particles total (not doubled)
    expect(container.querySelectorAll('circle')).toHaveLength(6);
  });
});
