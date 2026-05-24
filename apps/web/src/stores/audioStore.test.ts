import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    expect(() => useAudioStore.getState().toggleGlobalPlay()).not.toThrow();
  });
});
