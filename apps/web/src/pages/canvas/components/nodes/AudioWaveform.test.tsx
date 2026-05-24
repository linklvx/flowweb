import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { AudioWaveform } from './AudioWaveform';
import { useAudioStore } from '@/stores/audioStore';

// Hoisted mocks
const { mockUseWavesurferReturn } = vi.hoisted(() => ({
  mockUseWavesurferReturn: {
    wavesurfer: {
      on: vi.fn(),
      getDuration: vi.fn(() => 120),
      getCurrentTime: vi.fn(() => 0),
      getDecodedData: vi.fn(() => ({
        getChannelData: vi.fn(() => {
          const arr = new Float32Array(44100);
          for (let i = 0; i < 44100; i++) arr[i] = 0.5;
          return arr;
        }),
        length: 44100,
        numberOfChannels: 1,
        sampleRate: 44100,
      })),
    },
    isReady: true,
    isPlaying: false,
    currentTime: 0,
  },
}));

vi.mock('@wavesurfer/react', () => ({
  useWavesurfer: vi.fn(() => mockUseWavesurferReturn),
}));

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
    // Reset mock state
    mockUseWavesurferReturn.wavesurfer = {
      on: vi.fn(),
      getDuration: vi.fn(() => 120),
      getCurrentTime: vi.fn(() => 0),
      getDecodedData: vi.fn(() => ({
        getChannelData: vi.fn(() => {
          const arr = new Float32Array(44100);
          for (let i = 0; i < 44100; i++) arr[i] = 0.5;
          return arr;
        }),
        length: 44100,
        numberOfChannels: 1,
        sampleRate: 44100,
      })),
    };
    mockUseWavesurferReturn.isReady = true;
    mockUseWavesurferReturn.isPlaying = false;
    mockUseWavesurferReturn.currentTime = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  const renderComponent = (props?: Partial<{ audioUrl: string; nodeId: string }>) =>
    render(<AudioWaveform nodeId="test-node" audioUrl="http://example.com/audio.mp3" {...props} />);

  // Rendering

  it('should render a canvas element with nodrag class', () => {
    const { container } = renderComponent();
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(canvas?.className).toContain('nodrag');
  });

  it('should render edge fade overlays', () => {
    const { container } = renderComponent();
    const fades = container.querySelectorAll('[style*="linear-gradient"]');
    // Left fade: to right; Right fade: to left
    expect(fades.length).toBeGreaterThanOrEqual(2);
  });

  // Playhead DOM

  it('should render playhead with pointer-events none', () => {
    const { container } = renderComponent();
    const playhead = container.querySelector('[class*="playhead"]');
    expect(playhead).toBeTruthy();
    expect(playhead?.getAttribute('style')).toContain('pointer-events');
  });

  it('should render playhead triangle SVG', () => {
    const { container } = renderComponent();
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  // Loading state

  it('should show loading overlay when wavesurfer is not ready', () => {
    mockUseWavesurferReturn.isReady = false;
    mockUseWavesurferReturn.wavesurfer = {
      on: vi.fn(),
      getDuration: vi.fn(() => 0),
      getCurrentTime: vi.fn(() => 0),
      getDecodedData: vi.fn(() => null) as any,
    };
    renderComponent();
    expect(screen.getByTestId('waveform-loading')).toBeTruthy();
  });

  // Play/Pause

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

  // Time display

  it('should display formatted currentTime and duration', () => {
    mockUseWavesurferReturn.currentTime = 65;
    renderComponent();
    expect(screen.getByText('01:05 / 02:00')).toBeTruthy();
  });

  // Event isolation

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

  // Error fallback

  it('should render fallback audio element on wavesurfer error', async () => {
    let errorHandler: ((err: unknown) => void) | undefined;
    const mockWs = {
      on: vi.fn((event: string, handler: any) => {
        if (event === 'error') errorHandler = handler;
        return vi.fn();
      }),
      getDuration: vi.fn(() => 120),
      getCurrentTime: vi.fn(() => 0),
      getDecodedData: vi.fn(() => {
        const arr = new Float32Array(44100);
        for (let i = 0; i < 44100; i++) arr[i] = 0.5;
        return { getChannelData: () => arr, length: 44100, numberOfChannels: 1, sampleRate: 44100 };
      }),
    };
    mockUseWavesurferReturn.wavesurfer = mockWs as any;

    renderComponent();

    await act(async () => {
      errorHandler!(new Error('Decode failed'));
    });

    await waitFor(() => {
      const audioEl = document.querySelector('audio');
      expect(audioEl).toBeTruthy();
      expect(audioEl).toHaveAttribute('src', 'http://example.com/audio.mp3');
    });
  });

  // Lifecycle

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

  // Finish event

  it('should reset isPlaying on finish event', () => {
    let finishHandler: (() => void) | undefined;
    const mockWs = {
      on: vi.fn((event: string, handler: any) => {
        if (event === 'finish') finishHandler = handler;
        return vi.fn();
      }),
      getDuration: vi.fn(() => 120),
      getCurrentTime: vi.fn(() => 0),
      getDecodedData: vi.fn(() => {
        const arr = new Float32Array(44100);
        for (let i = 0; i < 44100; i++) arr[i] = 0.5;
        return { getChannelData: () => arr, length: 44100, numberOfChildren: 1, sampleRate: 44100 };
      }),
    };
    mockUseWavesurferReturn.wavesurfer = mockWs as any;
    mockUseWavesurferReturn.isPlaying = true;

    renderComponent();
    finishHandler!();
    expect(useAudioStore.getState().nodes.get('test-node')?.isPlaying).toBe(false);
  });
});
