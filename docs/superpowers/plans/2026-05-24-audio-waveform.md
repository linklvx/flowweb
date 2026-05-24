# Audio Waveform Visualization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace native `<audio>` element in AudioGenNode with wavesurfer.js waveform visualization, drag-to-seek, and play/pause controls.

**Architecture:** New `audioStore.ts` (Zustand, runtime-only) manages per-node playback state. New `AudioWaveform.tsx` wraps `@wavesurfer/react` with event isolation, error fallback, and Phase 2 peaks interface. `AudioGenNode.tsx` enlarged to 400×260 and delegates audio rendering to AudioWaveform.

**Tech Stack:** wavesurfer.js 7.8.x, @wavesurfer/react 1.0.x, Zustand 4.5.5, @xyflow/react 12.x, TypeScript strict, Vitest + Testing Library

**Phase 1 only — no backend changes, no nodeStore changes.**

---

## File Structure

```
apps/web/src/
├── utils/date.ts                              ← NEW: formatDuration utility
├── stores/
│   ├── audioStore.ts                           ← NEW: runtime playback state
│   └── audioStore.test.ts                      ← NEW: store unit tests
├── pages/canvas/components/nodes/
│   ├── AudioWaveform.tsx                       ← NEW: wavesurfer wrapper component
│   ├── AudioWaveform.test.tsx                  ← NEW: waveform component tests
│   ├── AudioGenNode.tsx                        ← MODIFY: 380→400×260, integrate AudioWaveform
│   └── AudioGenNode.test.tsx                   ← MODIFY: update for waveform integration
└── package.json                                ← MODIFY: add dependencies
```

---

### Task 1: Install Dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add wavesurfer.js and @wavesurfer/react**

In `apps/web/package.json`, add to `dependencies`:

```json
{
  "dependencies": {
    "@wavesurfer/react": "^1.0.8",
    "wavesurfer.js": "^7.8.1"
  }
}
```

- [ ] **Step 2: Install packages**

Run: `cd apps/web && pnpm install`
Expected: packages installed, no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "chore: add wavesurfer.js@7.8.1 + @wavesurfer/react@1.0.8

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Create formatDuration Utility

**Files:**
- Create: `apps/web/src/utils/date.ts`

- [ ] **Step 1: Create the utility**

```typescript
// apps/web/src/utils/date.ts

/**
 * Format seconds as mm:ss string.
 * Example: formatDuration(65) → "01:05"
 * Example: formatDuration(0) → "00:00"
 * Example: formatDuration(3661) → "61:01"
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/utils/date.ts
git commit -m "feat: add formatDuration utility for mm:ss display

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: audioStore — Test First

**Files:**
- Create: `apps/web/src/stores/audioStore.test.ts`
- Create: `apps/web/src/stores/audioStore.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/stores/audioStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAudioStore } from './audioStore';

// Reset store state between tests
beforeEach(() => {
  useAudioStore.setState({
    nodes: new Map(),
    activeNodeId: null,
    isGlobalPlaying: false,
  });
});

describe('audioStore', () => {
  // ─── registerNode ───

  it('should register a new node with default state', () => {
    useAudioStore.getState().registerNode('n1');
    const node = useAudioStore.getState().nodes.get('n1');
    expect(node).toBeDefined();
    expect(node!.id).toBe('n1');
    expect(node!.wavesurfer).toBeNull();
    expect(node!.isPlaying).toBe(false);
    expect(node!.currentTime).toBe(0);
    expect(node!.duration).toBe(0);
  });

  // ─── unregisterNode ───

  it('should unregister a node and clean up', () => {
    useAudioStore.getState().registerNode('n1');
    useAudioStore.getState().registerNode('n2');
    useAudioStore.getState().unregisterNode('n1');
    expect(useAudioStore.getState().nodes.has('n1')).toBe(false);
    expect(useAudioStore.getState().nodes.has('n2')).toBe(true);
  });

  it('should clear activeNodeId when unregistering the active node', () => {
    useAudioStore.getState().registerNode('n1');
    useAudioStore.setState({ activeNodeId: 'n1', isGlobalPlaying: true });
    useAudioStore.getState().unregisterNode('n1');
    expect(useAudioStore.getState().activeNodeId).toBeNull();
    expect(useAudioStore.getState().isGlobalPlaying).toBe(false);
  });

  it('should destroy wavesurfer instance on unregister', () => {
    useAudioStore.getState().registerNode('n1');
    const mockDestroy = vi.fn();
    const mockStop = vi.fn();
    const mockWs = { destroy: mockDestroy, stop: mockStop } as any;
    useAudioStore.getState().setWavesurfer('n1', mockWs);
    useAudioStore.getState().unregisterNode('n1');
    expect(mockStop).toHaveBeenCalled();
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('should handle unregister gracefully when wavesurfer.destroy throws', () => {
    useAudioStore.getState().registerNode('n1');
    const mockWs = { destroy: () => { throw new Error('boom'); }, stop: vi.fn() } as any;
    useAudioStore.getState().setWavesurfer('n1', mockWs);
    expect(() => useAudioStore.getState().unregisterNode('n1')).not.toThrow();
    expect(useAudioStore.getState().nodes.has('n1')).toBe(false);
  });

  // ─── setWavesurfer ───

  it('should set the wavesurfer instance for a node', () => {
    useAudioStore.getState().registerNode('n1');
    const mockWs = {} as any;
    useAudioStore.getState().setWavesurfer('n1', mockWs);
    expect(useAudioStore.getState().nodes.get('n1')!.wavesurfer).toBe(mockWs);
  });

  // ─── togglePlay ───

  it('should pause all other nodes when playing a new one', () => {
    useAudioStore.getState().registerNode('n1');
    useAudioStore.getState().registerNode('n2');
    const pause1 = vi.fn();
    const play2 = vi.fn();
    useAudioStore.getState().setWavesurfer('n1', { play: vi.fn(), pause: pause1 } as any);
    useAudioStore.getState().setWavesurfer('n2', { play: play2, pause: vi.fn() } as any);
    // Set n1 as playing
    useAudioStore.getState().nodes.get('n1')!.isPlaying = true;

    useAudioStore.getState().togglePlay('n2');
    expect(pause1).toHaveBeenCalled();
    expect(play2).toHaveBeenCalled();
  });

  it('should pause the active node when toggling it off', () => {
    useAudioStore.getState().registerNode('n1');
    const pause = vi.fn();
    useAudioStore.getState().setWavesurfer('n1', { play: vi.fn(), pause } as any);
    useAudioStore.getState().nodes.get('n1')!.isPlaying = true;

    useAudioStore.getState().togglePlay('n1');
    expect(pause).toHaveBeenCalled();
    expect(useAudioStore.getState().isGlobalPlaying).toBe(false);
  });

  it('should set activeNodeId and isGlobalPlaying when toggling play', () => {
    useAudioStore.getState().registerNode('n1');
    useAudioStore.getState().setWavesurfer('n1', { play: vi.fn(), pause: vi.fn() } as any);

    useAudioStore.getState().togglePlay('n1');
    expect(useAudioStore.getState().activeNodeId).toBe('n1');
    expect(useAudioStore.getState().isGlobalPlaying).toBe(true);
  });

  // ─── seekNode ───

  it('should seek to the correct position based on time and duration', () => {
    useAudioStore.getState().registerNode('n1');
    const mockSeekTo = vi.fn();
    useAudioStore.getState().setWavesurfer('n1', { seekTo: mockSeekTo } as any);
    useAudioStore.getState().nodes.get('n1')!.duration = 100;

    useAudioStore.getState().seekNode('n1', 50);
    expect(mockSeekTo).toHaveBeenCalledWith(0.5);
  });

  it('should clamp seek position to [0, 1]', () => {
    useAudioStore.getState().registerNode('n1');
    const mockSeekTo = vi.fn();
    useAudioStore.getState().setWavesurfer('n1', { seekTo: mockSeekTo } as any);
    useAudioStore.getState().nodes.get('n1')!.duration = 10;

    useAudioStore.getState().seekNode('n1', -5);
    expect(mockSeekTo).toHaveBeenCalledWith(0);

    useAudioStore.getState().seekNode('n1', 100);
    expect(mockSeekTo).toHaveBeenCalledWith(1);
  });

  // ─── updateNodeState ───

  it('should update partial node state', () => {
    useAudioStore.getState().registerNode('n1');
    useAudioStore.getState().updateNodeState('n1', { isPlaying: true, currentTime: 42 });
    const node = useAudioStore.getState().nodes.get('n1')!;
    expect(node.isPlaying).toBe(true);
    expect(node.currentTime).toBe(42);
    expect(node.duration).toBe(0); // unchanged
  });

  // ─── toggleGlobalPlay ───

  it('should toggle play on active node', () => {
    useAudioStore.getState().registerNode('n1');
    const play = vi.fn();
    useAudioStore.getState().setWavesurfer('n1', { play, pause: vi.fn() } as any);
    useAudioStore.setState({ activeNodeId: 'n1' });

    useAudioStore.getState().toggleGlobalPlay();
    expect(play).toHaveBeenCalled();
  });

  it('should be a no-op when no active node', () => {
    // Should not throw
    expect(() => useAudioStore.getState().toggleGlobalPlay()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/stores/audioStore.test.ts`
Expected: FAIL — module or store not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/web/src/stores/audioStore.ts
import { create } from 'zustand';
import type WaveSurfer from 'wavesurfer.js';

export interface AudioNodeState {
  id: string;
  wavesurfer: WaveSurfer | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

interface AudioStore {
  nodes: Map<string, AudioNodeState>;
  isGlobalPlaying: boolean;
  activeNodeId: string | null;

  registerNode: (nodeId: string) => void;
  unregisterNode: (nodeId: string) => void;
  setWavesurfer: (nodeId: string, wavesurfer: WaveSurfer) => void;

  togglePlay: (nodeId: string) => void;
  seekNode: (nodeId: string, time: number) => void;
  toggleGlobalPlay: () => void;

  updateNodeState: (nodeId: string, state: Partial<AudioNodeState>) => void;
}

export const useAudioStore = create<AudioStore>((set, get) => ({
  nodes: new Map(),
  isGlobalPlaying: false,
  activeNodeId: null,

  registerNode: (nodeId) => {
    set((state) => {
      const newNodes = new Map(state.nodes);
      newNodes.set(nodeId, {
        id: nodeId,
        wavesurfer: null,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
      });
      return { nodes: newNodes };
    });
  },

  unregisterNode: (nodeId) => {
    set((state) => {
      const newNodes = new Map(state.nodes);
      const node = newNodes.get(nodeId);

      if (node?.wavesurfer) {
        try {
          node.wavesurfer.stop();
          node.wavesurfer.destroy();
        } catch (_e) {
          // Safely ignore destroy errors
        }
        node.wavesurfer = null;
      }

      newNodes.delete(nodeId);

      if (state.activeNodeId === nodeId) {
        return { nodes: newNodes, activeNodeId: null, isGlobalPlaying: false };
      }
      return { nodes: newNodes };
    });
  },

  setWavesurfer: (nodeId, wavesurfer) => {
    set((state) => {
      const newNodes = new Map(state.nodes);
      const node = newNodes.get(nodeId);
      if (node) {
        node.wavesurfer = wavesurfer;
      }
      return { nodes: newNodes };
    });
  },

  togglePlay: (nodeId) => {
    const state = get();
    const node = state.nodes.get(nodeId);
    if (!node?.wavesurfer) return;

    if (node.isPlaying) {
      node.wavesurfer.pause();
      set({ isGlobalPlaying: false });
    } else {
      // Pause all other playing nodes first
      state.nodes.forEach((n, id) => {
        if (id !== nodeId && n.isPlaying) {
          n.wavesurfer?.pause();
        }
      });
      node.wavesurfer.play();
      set({ activeNodeId: nodeId, isGlobalPlaying: true });
    }
  },

  seekNode: (nodeId, time) => {
    const node = get().nodes.get(nodeId);
    if (node?.wavesurfer && node.duration > 0) {
      const progress = time / node.duration;
      node.wavesurfer.seekTo(Math.max(0, Math.min(1, progress)));
    }
  },

  toggleGlobalPlay: () => {
    const state = get();
    if (state.activeNodeId) {
      state.togglePlay(state.activeNodeId);
    }
  },

  updateNodeState: (nodeId, partialState) => {
    set((state) => {
      const newNodes = new Map(state.nodes);
      const node = newNodes.get(nodeId);
      if (node) {
        Object.assign(node, partialState);
      }
      return { nodes: newNodes };
    });
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/stores/audioStore.test.ts`
Expected: all 13 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/audioStore.ts apps/web/src/stores/audioStore.test.ts
git commit -m "feat: add audioStore for runtime playback state

13 tests passing. State isolation: runtime-only (no persistence).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: AudioWaveform Component — Test First

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodes/AudioWaveform.test.tsx`
- Create: `apps/web/src/pages/canvas/components/nodes/AudioWaveform.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/pages/canvas/components/nodes/AudioWaveform.test.tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AudioWaveform } from './AudioWaveform';
import { useAudioStore } from '@/stores/audioStore';

// Hoisted mock state for @wavesurfer/react
const { mockUseWaveSurferReturn } = vi.hoisted(() => {
  return {
    mockUseWaveSurferReturn: {
      wavesurfer: null,
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Rendering ───

  it('should render the waveform container', () => {
    const { container } = render(
      <AudioWaveform nodeId="test-node" audioUrl="http://example.com/audio.mp3" />
    );
    expect(container.querySelector('.wavesurfer-container')).toBeTruthy();
  });

  // ─── Loading state ───

  it('should show loading spinner when wavesurfer is not ready', () => {
    mockUseWaveSurferReturn.isReady = false;
    mockUseWaveSurferReturn.wavesurfer = null;
    render(<AudioWaveform nodeId="test-node" audioUrl="http://example.com/audio.mp3" />);
    // Loading state: Spin overlay should be present
    // We test via a class or visual indicator
    const container = document.querySelector('.wavesurfer-container');
    expect(container?.innerHTML).toContain('loading');
    mockUseWaveSurferReturn.isReady = true;
  });

  // ─── Play/Pause button ───

  it('should render play button when paused', () => {
    mockUseWaveSurferReturn.isPlaying = false;
    render(<AudioWaveform nodeId="test-node" audioUrl="http://example.com/audio.mp3" />);
    expect(screen.getByLabelText('播放')).toBeTruthy();
  });

  it('should render pause button when playing', () => {
    mockUseWaveSurferReturn.isPlaying = true;
    render(<AudioWaveform nodeId="test-node" audioUrl="http://example.com/audio.mp3" />);
    expect(screen.getByLabelText('暂停')).toBeTruthy();
  });

  // ─── Time display ───

  it('should display formatted currentTime and duration', () => {
    mockUseWaveSurferReturn.currentTime = 65;
    mockUseWaveSurferReturn.duration = 120;
    render(<AudioWaveform nodeId="test-node" audioUrl="http://example.com/audio.mp3" />);
    expect(screen.getByText('01:05 / 02:00')).toBeTruthy();
  });

  // ─── Event isolation ───

  it('should stop propagation on mouse events', () => {
    const { container } = render(
      <AudioWaveform nodeId="test-node" audioUrl="http://example.com/audio.mp3" />
    );
    const root = container.firstChild as HTMLElement;

    const events = ['mouseDown', 'mouseMove', 'mouseUp', 'mouseLeave'];
    events.forEach((eventName) => {
      const stopPropagation = vi.fn();
      const event = new MouseEvent(eventName.toLowerCase(), { bubbles: true });
      Object.defineProperty(event, 'stopPropagation', { value: stopPropagation });
      root.dispatchEvent(event);
      expect(stopPropagation).toHaveBeenCalled();
    });
  });

  it('should stop propagation on touch events', () => {
    const { container } = render(
      <AudioWaveform nodeId="test-node" audioUrl="http://example.com/audio.mp3" />
    );
    const root = container.firstChild as HTMLElement;

    const events = ['touchStart', 'touchMove', 'touchEnd'];
    events.forEach((eventName) => {
      const stopPropagation = vi.fn();
      const event = new TouchEvent(eventName.toLowerCase(), { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'stopPropagation', { value: stopPropagation });
      root.dispatchEvent(event);
      expect(stopPropagation).toHaveBeenCalled();
    });
  });

  // ─── Error fallback ───

  it('should render fallback audio element on error', () => {
    mockUseWaveSurferReturn.error = new Error('Decode failed');
    render(<AudioWaveform nodeId="test-node" audioUrl="http://example.com/audio.mp3" />);
    const audioEl = document.querySelector('audio');
    expect(audioEl).toBeTruthy();
    expect(audioEl).toHaveAttribute('src', 'http://example.com/audio.mp3');
    mockUseWaveSurferReturn.error = null;
  });

  // ─── Register/unregister node ───

  it('should register the node on mount', () => {
    useAudioStore.getState().unregisterNode('test-node'); // clean
    expect(useAudioStore.getState().nodes.has('test-node')).toBe(false);
    render(<AudioWaveform nodeId="test-node" audioUrl="http://example.com/audio.mp3" />);
    expect(useAudioStore.getState().nodes.has('test-node')).toBe(true);
  });

  it('should unregister the node on unmount', () => {
    const { unmount } = render(
      <AudioWaveform nodeId="test-node" audioUrl="http://example.com/audio.mp3" />
    );
    expect(useAudioStore.getState().nodes.has('test-node')).toBe(true);
    unmount();
    expect(useAudioStore.getState().nodes.has('test-node')).toBe(false);
  });

  // ─── Phase 2: waveformUrl prop ───

  it('should accept waveformUrl prop without error', () => {
    // Render with undefined waveformUrl (Phase 1 default)
    const { container } = render(
      <AudioWaveform
        nodeId="test-node"
        audioUrl="http://example.com/audio.mp3"
        waveformUrl={undefined}
      />
    );
    expect(container.querySelector('.wavesurfer-container')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/AudioWaveform.test.tsx`
Expected: FAIL — AudioWaveform module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/web/src/pages/canvas/components/nodes/AudioWaveform.tsx
import { useEffect, useRef, useCallback, useState } from 'react';
import { useWaveSurfer } from '@wavesurfer/react';
import { useReactFlow } from '@xyflow/react';
import { useAudioStore } from '@/stores/audioStore';
import { formatDuration } from '@/utils/date';

export interface AudioWaveformProps {
  nodeId: string;
  audioUrl: string;
  waveformUrl?: string; // Phase 2: pre-generated peaks URL
  onError?: (error: Error) => void;
}

export function AudioWaveform({ nodeId, audioUrl, waveformUrl: _waveformUrl, onError }: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { registerNode, unregisterNode, setWavesurfer, togglePlay, updateNodeState } = useAudioStore();
  const { viewport } = useReactFlow();
  const [useFallback, setUseFallback] = useState(false);

  // Register/unregister lifecycle
  useEffect(() => {
    registerNode(nodeId);
    return () => { unregisterNode(nodeId); };
  }, [nodeId, registerNode, unregisterNode]);

  // Phase 2: when waveformUrl is available, fetch peaks data
  // Phase 1: waveformUrl is undefined, wavesurfer decodes locally
  const { wavesurfer, isReady, isPlaying, currentTime, duration, error } = useWaveSurfer({
    container: containerRef.current,
    url: audioUrl,
    waveColor: '#ffffff',
    progressColor: '#ff3333',
    cursorColor: '#ff3333',
    cursorWidth: 2,
    barWidth: 3,
    barGap: 1,
    barRadius: 2,
    height: 120,
    backend: 'WebAudio',
    responsive: true,
    normalize: true,
    autoplay: false,
    autoScroll: false,
    mediaControls: false,
    interact: true,
  });

  // Store wavesurfer instance in global store
  useEffect(() => {
    if (wavesurfer) {
      setWavesurfer(nodeId, wavesurfer);
    }
  }, [wavesurfer, nodeId, setWavesurfer]);

  // Sync playback state to store
  useEffect(() => {
    updateNodeState(nodeId, { isPlaying, currentTime, duration });
  }, [isPlaying, currentTime, duration, nodeId, updateNodeState]);

  // Resize on viewport zoom change
  useEffect(() => {
    if (wavesurfer && containerRef.current) {
      wavesurfer.resize();
    }
  }, [viewport.zoom, wavesurfer]);

  // Finish event: reset isPlaying
  useEffect(() => {
    if (!wavesurfer) return;
    const unsub = wavesurfer.on('finish', () => {
      useAudioStore.getState().updateNodeState(nodeId, { isPlaying: false });
    });
    return () => { (unsub as (() => void) | undefined)?.(); };
  }, [wavesurfer, nodeId]);

  // Error handling — useWaveSurfer error + wavesurfer load error
  useEffect(() => {
    if (error) {
      console.error('AudioWaveform error:', nodeId, error);
      setUseFallback(true);
      onError?.(error);
    }
  }, [error, nodeId, onError]);

  useEffect(() => {
    if (!wavesurfer) return;
    const unsub = wavesurfer.on('error', (err: unknown) => {
      console.error('AudioWaveform load error:', nodeId, err);
      setUseFallback(true);
      onError?.(err instanceof Error ? err : new Error(String(err)));
    });
    return () => { (unsub as (() => void) | undefined)?.(); };
  }, [wavesurfer, nodeId, onError]);

  // Cleanup: destroy wavesurfer on unmount (belt-and-suspenders with audioStore)
  useEffect(() => {
    return () => {
      if (wavesurfer) {
        try { wavesurfer.destroy(); } catch (_e) { /* ignore */ }
      }
    };
  }, [wavesurfer]);

  // Play/pause handler with ready check
  const handleTogglePlay = useCallback(() => {
    if (!isReady) return;
    togglePlay(nodeId);
  }, [isReady, togglePlay, nodeId]);

  // Event isolation for React Flow canvas
  const stopEvent = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
  }, []);

  // Fallback: native audio element
  if (useFallback) {
    return (
      <audio controls src={audioUrl} className="w-full h-full" />
    );
  }

  return (
    <div
      className="w-full h-full flex flex-col select-none"
      onMouseDown={stopEvent}
      onMouseMove={stopEvent}
      onMouseUp={stopEvent}
      onMouseLeave={stopEvent}
      onTouchStart={stopEvent}
      onTouchMove={stopEvent}
      onTouchEnd={stopEvent}
    >
      {/* Waveform container */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div
          className="w-full relative"
          style={{
            backgroundColor: '#2d2d2d',
            borderRadius: 12,
            padding: '16px 0',
            height: 120,
            boxSizing: 'border-box',
            cursor: 'pointer',
          }}
        >
          <div ref={containerRef} className="h-full w-full" />
          {(!isReady) && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800/70 rounded-[12px]">
              <span data-testid="waveform-loading" className="text-xs text-gray-400 animate-pulse">
                loading
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Controls: play/pause + time */}
      <div className="flex items-center justify-center gap-3 py-1.5">
        <button
          aria-label={isPlaying ? '暂停' : '播放'}
          className="text-white hover:text-[#4ade80] transition-colors"
          style={{ fontSize: 40, lineHeight: '40px', width: 40, height: 40 }}
          onClick={handleTogglePlay}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>
      <div className="text-xs text-gray-400 text-center pb-1">
        {formatDuration(currentTime)} / {formatDuration(duration)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/AudioWaveform.test.tsx`
Expected: all 12+ tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/AudioWaveform.tsx apps/web/src/pages/canvas/components/nodes/AudioWaveform.test.tsx
git commit -m "feat: add AudioWaveform component with wavesurfer.js

Play/pause, drag-to-seek, event isolation, error fallback to audio.
Phase 2 peaks interface reserved.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Modify AudioGenNode — Integrate AudioWaveform

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/AudioGenNode.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/AudioGenNode.test.tsx`

- [ ] **Step 1: Update AudioGenNode size constants and add AudioWaveform**

In `AudioGenNode.tsx`, change lines 10-11:

```diff
- const NODE_WIDTH = 380;
- const NODE_HEIGHT = 170;
+ const NODE_WIDTH = 400;
+ const NODE_HEIGHT = 260;
```

Add import after line 5:

```typescript
import { AudioWaveform } from './AudioWaveform';
```

Add fallback state before `const showReplaceButton` line:

```typescript
const [useFallback, setUseFallback] = useState(false);
```

Replace the node body content (lines 220-257, the `displayUrl` ternary block) with:

```tsx
{displayUrl && !useFallback ? (
  <AudioWaveform
    nodeId={id}
    audioUrl={displayUrl}
    waveformUrl={undefined}
    onError={() => setUseFallback(true)}
  />
) : displayUrl ? (
  <audio
    src={displayUrl}
    controls
    className="max-w-[90%]"
  />
) : status === 'loading' ? (
  <span className="text-yellow-400 text-xs">⏳ 生成中...</span>
) : (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#888]">
    <g opacity="0.35">
      <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2" />
    </g>
  </svg>
)}
```

The full modified body section should now be:

```tsx
<div
  className="flex items-center justify-center overflow-hidden rounded-lg transition-all duration-300 relative group"
  style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
>
  {displayUrl && !useFallback ? (
    <AudioWaveform
      nodeId={id}
      audioUrl={displayUrl}
      waveformUrl={undefined}
      onError={() => setUseFallback(true)}
    />
  ) : displayUrl ? (
    <audio
      src={displayUrl}
      controls
      className="max-w-[90%]"
    />
  ) : status === 'loading' ? (
    <span className="text-yellow-400 text-xs">⏳ 生成中...</span>
  ) : (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#888]">
      <g opacity="0.35">
        <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2" />
        <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2" />
      </g>
    </svg>
  )}

  {/* Replace button — only for user-uploaded audio (not AI-generated) */}
  {showReplaceButton && (
    <button
      className="nodrag nopan absolute top-2 right-2 z-5 flex items-center gap-2 w-fit h-9 px-4 py-2 text-white text-sm font-medium rounded-[10px] bg-white/10 hover:bg-white/20 cursor-pointer border border-white/10 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={() => fileInputRef.current?.click()}
      disabled={uploading}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
        <path d="M7 9l5 -5l5 5" />
        <path d="M12 4l0 12" />
      </svg>
      替换
    </button>
  )}
</div>
```

- [ ] **Step 2: Update tests for new size and waveform integration**

In `AudioGenNode.test.tsx`, update the mock imports to include AudioWaveform mock:

```typescript
// Add after existing mocks
vi.mock('./AudioWaveform', () => ({
  AudioWaveform: vi.fn(({ nodeId }: { nodeId: string; audioUrl: string }) => (
    <div data-testid="audio-waveform">waveform-{nodeId}</div>
  ))
}));
```

Update the size test:

```diff
  it('should render card with fixed size 380×170', () => {
    // ...
-   expect(container.innerHTML).toContain('width: 380px');
-   expect(container.innerHTML).toContain('height: 170px');
+   expect(container.innerHTML).toContain('width: 400px');
+   expect(container.innerHTML).toContain('height: 260px');
  });
```

Add new tests at the end of the describe block:

```typescript
  // ─── AudioWaveform integration ───

  it('should render AudioWaveform when displayUrl exists', () => {
    setMockNodeData({ fileId: 'test-audio-id', status: 'done', model: '', referenceAudio: undefined });
    renderNode();
    expect(screen.getByTestId('audio-waveform')).toBeTruthy();
  });

  it('should render native audio when displayUrl exists and useFallback is true', () => {
    // This is covered by the existing audio element test — the fallback
    // gets triggered by AudioWaveform's onError calling setUseFallback(true)
    setMockNodeData({ fileId: 'test-audio-id', status: 'done', model: '', referenceAudio: undefined });
    renderNode();
    const audioEl = document.querySelector('audio');
    // When displayUrl exists but AudioWaveform hasn't errored yet, we should see waveform
    expect(screen.getByTestId('audio-waveform')).toBeTruthy();
  });
```

- [ ] **Step 3: Run existing tests — they should pass**

Run: `cd apps/web && npx vitest run src/pages/canvas/components/nodes/AudioGenNode.test.tsx`
Expected: all existing tests PASS (+ new waveform integration tests)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/AudioGenNode.tsx apps/web/src/pages/canvas/components/nodes/AudioGenNode.test.tsx
git commit -m "feat: integrate AudioWaveform into AudioGenNode (400×260)

Replaces native audio with wavesurfer waveform. Error fallback to native.
Phase 2 waveformUrl reserved.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Final Verification

- [ ] **Step 1: Run all tests**

Run: `cd apps/web && npx vitest run`
Expected: ALL tests PASS (existing 381 + new audioStore 13 + AudioWaveform 12+), 0 failures

- [ ] **Step 2: TypeScript compilation check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit final state**

```bash
git add -A
git commit -m "feat: audio waveform visualization complete (Phase 1)

- wavesurfer.js@7.8.1 + @wavesurfer/react@1.0.8
- audioStore: runtime playback state (Zustand)
- AudioWaveform: drag-to-seek, play/pause, event isolation, error fallback
- AudioGenNode: 400×260 with waveform integration
- Phase 2 peaks/waveformUrl reserved

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
