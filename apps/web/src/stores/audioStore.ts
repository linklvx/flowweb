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
      node.isPlaying = false;
      set({ isGlobalPlaying: false });
    } else {
      // Pause all other playing nodes first
      state.nodes.forEach((n, id) => {
        if (id !== nodeId && n.isPlaying) {
          n.wavesurfer?.pause();
          n.isPlaying = false;
        }
      });
      node.isPlaying = true;
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
