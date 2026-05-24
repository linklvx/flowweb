import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AudioWaveform } from './AudioWaveform';
import { useAudioStore } from '@/stores/audioStore';

// Hoisted mock state for @wavesurfer/react
const { mockUseWaveSurferReturn } = vi.hoisted(() => {
  return {
    mockUseWaveSurferReturn: {
      wavesurfer: { on: vi.fn(), resize: vi.fn() },
      isReady: true,
      isPlaying: false,
      currentTime: 0,
      duration: 120,
      error: null,
    },
  };
});

vi.mock('@wavesurfer/react', () => ({
  useWaveSurfer: vi.fn(() => mockUseWaveSurferReturn),
}));

// Mock useReactFlow for viewport
vi.mock('@xyflow/react', () => ({
  useReactFlow: vi.fn(() => ({
    viewport: { zoom: 1, x: 0, y: 0 },
  })),
}));

describe('AudioWaveform', () => {
  beforeEach(() => {
    useAudioStore.setState({
      nodes: new Map(),
      activeNodeId: null,
      isGlobalPlaying: false,
    });
    useAudioStore.getState().registerNode('test-node');
    mockUseWaveSurferReturn.wavesurfer = { on: vi.fn(), resize: vi.fn() };
    mockUseWaveSurferReturn.isReady = true;
    mockUseWaveSurferReturn.isPlaying = false;
    mockUseWaveSurferReturn.currentTime = 0;
    mockUseWaveSurferReturn.duration = 120;
    mockUseWaveSurferReturn.error = null;
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
    // jsdom normalizes #2d2d2d to rgb(45, 45, 45) in the style attribute
    const waveformDiv = container.querySelector('[style*="background-color: rgb(45, 45, 45)"]');
    expect(waveformDiv).toBeTruthy();
  });

  // ─── Loading state ───

  it('should show loading overlay when wavesurfer is not ready', () => {
    mockUseWaveSurferReturn.isReady = false;
    mockUseWaveSurferReturn.wavesurfer = null;
    renderComponent();
    expect(screen.getByTestId('waveform-loading')).toBeTruthy();
    mockUseWaveSurferReturn.isReady = true;
  });

  // ─── Play/Pause button ───

  it('should render play button when paused', () => {
    mockUseWaveSurferReturn.isPlaying = false;
    renderComponent();
    expect(screen.getByLabelText('播放')).toBeTruthy();
  });

  it('should render pause button when playing', () => {
    mockUseWaveSurferReturn.isPlaying = true;
    renderComponent();
    expect(screen.getByLabelText('暂停')).toBeTruthy();
  });

  // ─── Time display ───

  it('should display formatted currentTime and duration', () => {
    mockUseWaveSurferReturn.currentTime = 65;
    mockUseWaveSurferReturn.duration = 120;
    renderComponent();
    expect(screen.getByText('01:05 / 02:00')).toBeTruthy();
  });

  // ─── Event isolation ───

  it('should stop propagation on mouse events', () => {
    const { container } = renderComponent();
    const root = container.firstChild as HTMLElement;

    const stopPropagation = vi.spyOn(Event.prototype, 'stopPropagation');

    // mouseleave does NOT bubble natively, so it can't be dispatched to React's delegation
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

  it('should render fallback audio element on error', () => {
    mockUseWaveSurferReturn.error = new Error('Decode failed');
    renderComponent();
    const audioEl = document.querySelector('audio');
    expect(audioEl).toBeTruthy();
    expect(audioEl).toHaveAttribute('src', 'http://example.com/audio.mp3');
    mockUseWaveSurferReturn.error = null;
  });

  // ─── Register/unregister node ───

  it('should register the node on mount', () => {
    // Clean first
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
});
