import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { AudioWaveform } from './AudioWaveform';
import { useAudioStore } from '@/stores/audioStore';

// Hoisted mock state for @wavesurfer/react
const { mockUseWavesurferReturn } = vi.hoisted(() => {
  return {
    mockUseWavesurferReturn: {
      wavesurfer: { on: vi.fn(), resize: vi.fn(), getDuration: vi.fn(() => 120) },
      isReady: true,
      isPlaying: false,
      currentTime: 0,
    },
  };
});

vi.mock('@wavesurfer/react', () => ({
  useWavesurfer: vi.fn(() => mockUseWavesurferReturn),
}));

// Mock useViewport for zoom changes
vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react');
  return {
    ...actual,
    useViewport: vi.fn(() => ({ zoom: 1, x: 0, y: 0 })),
  };
});

describe('AudioWaveform', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useAudioStore.setState({
      nodes: new Map(),
      activeNodeId: null,
      isGlobalPlaying: false,
    });
    useAudioStore.getState().registerNode('test-node');
    mockUseWavesurferReturn.wavesurfer = { on: vi.fn(), resize: vi.fn(), getDuration: vi.fn(() => 120) };
    mockUseWavesurferReturn.isReady = true;
    mockUseWavesurferReturn.isPlaying = false;
    mockUseWavesurferReturn.currentTime = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  const renderComponent = (props?: Partial<{ audioUrl: string; nodeId: string; waveformUrl?: string }>) =>
    render(<AudioWaveform nodeId="test-node" audioUrl="http://example.com/audio.mp3" {...props} />);

  // ─── Rendering ───

  it('should render the waveform container', () => {
    const { container } = renderComponent();
    const waveformDiv = container.querySelector('[style*="background-color: rgb(45, 45, 45)"]');
    expect(waveformDiv).toBeTruthy();
  });

  // ─── Loading state ───

  it('should show loading overlay when wavesurfer is not ready', () => {
    mockUseWavesurferReturn.isReady = false;
    mockUseWavesurferReturn.wavesurfer = { on: vi.fn(), resize: vi.fn(), getDuration: vi.fn(() => 0) };
    renderComponent();
    expect(screen.getByTestId('waveform-loading')).toBeTruthy();
    mockUseWavesurferReturn.isReady = true;
  });

  // ─── Play/Pause button ───

  it('should render play button when paused', () => {
    mockUseWavesurferReturn.isPlaying = false;
    renderComponent();
    expect(screen.getByLabelText('播放')).toBeTruthy();
  });

  it('should render pause button when playing', () => {
    mockUseWavesurferReturn.isPlaying = true;
    renderComponent();
    expect(screen.getByLabelText('暂停')).toBeTruthy();
  });

  // ─── Time display ───

  it('should display formatted currentTime and duration', () => {
    mockUseWavesurferReturn.currentTime = 65;
    renderComponent();
    expect(screen.getByText('01:05 / 02:00')).toBeTruthy();
  });

  // ─── Event isolation ───

  it('should stop propagation on mouse events', () => {
    const { container } = renderComponent();
    const root = container.firstChild as HTMLElement;

    const stopPropagation = vi.spyOn(Event.prototype, 'stopPropagation');

    ['mousedown', 'mousemove', 'mouseup'].forEach((eventType) => {
      root.dispatchEvent(new MouseEvent(eventType, { bubbles: true }));
    });

    expect(stopPropagation).toHaveBeenCalledTimes(3);
    stopPropagation.mockRestore();
  });

  it('should stop propagation on touch events', () => {
    const { container } = renderComponent();
    const root = container.firstChild as HTMLElement;

    const stopPropagation = vi.spyOn(Event.prototype, 'stopPropagation');

    ['touchstart', 'touchmove', 'touchend'].forEach((eventType) => {
      root.dispatchEvent(new TouchEvent(eventType, { bubbles: true, cancelable: true }));
    });

    expect(stopPropagation).toHaveBeenCalledTimes(3);
    stopPropagation.mockRestore();
  });

  // ─── Error fallback ───

  it('should render fallback audio element on wavesurfer error event', async () => {
    let errorHandler: ((err: unknown) => void) | undefined;
    const mockWs = {
      on: vi.fn((event: string, handler: (err: unknown) => void) => {
        if (event === 'error') errorHandler = handler;
        return vi.fn();
      }),
      resize: vi.fn(),
      getDuration: vi.fn(() => 120),
    };
    mockUseWavesurferReturn.wavesurfer = mockWs;

    renderComponent();

    // Trigger the error handler in act to flush state updates
    expect(errorHandler).toBeDefined();
    await act(async () => {
      errorHandler!(new Error('Decode failed'));
    });

    // Wait for re-render with fallback audio element
    await waitFor(() => {
      const audioEl = document.querySelector('audio');
      expect(audioEl).toBeTruthy();
      expect(audioEl).toHaveAttribute('src', 'http://example.com/audio.mp3');
    });
  });

  // ─── Register/unregister node ───

  it('should register the node on mount', () => {
    useAudioStore.getState().unregisterNode('test-node');
    expect(useAudioStore.getState().nodes.has('test-node')).toBe(false);
    renderComponent();
    expect(useAudioStore.getState().nodes.has('test-node')).toBe(true);
  });

  it('should unregister the node on unmount', () => {
    const { unmount } = renderComponent();
    expect(useAudioStore.getState().nodes.has('test-node')).toBe(true);
    unmount();
    expect(useAudioStore.getState().nodes.has('test-node')).toBe(false);
  });

  // ─── Wavesurfer in store ───

  it('should set the wavesurfer instance in the store', () => {
    renderComponent();
    const node = useAudioStore.getState().nodes.get('test-node');
    expect(node?.wavesurfer).toBeTruthy();
  });

  // ─── Phase 2: waveformUrl prop ───

  it('should accept waveformUrl prop without error', () => {
    const { container } = renderComponent({ waveformUrl: undefined });
    expect(container.querySelector('[style*="background-color: rgb(45, 45, 45)"]')).toBeTruthy();
  });

  // ─── Finish event ───

  it('should reset isPlaying on finish event', () => {
    let finishHandler: (() => void) | undefined;
    const mockWs = {
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'finish') finishHandler = handler;
        return vi.fn();
      }),
      resize: vi.fn(),
      getDuration: vi.fn(() => 120),
    };
    mockUseWavesurferReturn.wavesurfer = mockWs;
    mockUseWavesurferReturn.isPlaying = true;

    renderComponent();

    expect(finishHandler).toBeDefined();
    finishHandler!();

    expect(useAudioStore.getState().nodes.get('test-node')?.isPlaying).toBe(false);
  });
});
