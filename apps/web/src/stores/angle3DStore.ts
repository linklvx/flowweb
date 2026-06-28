import { create } from 'zustand';
import {
  type Angle3DParams,
  type Angle3DPresetKey,
  type Angle3DTaskStatus,
  ANGLE3D_DEFAULTS,
  ANGLE3D_PRESETS,
} from '@flowweb/shared';

interface NodeCallbacks {
  onReplaceCurrentNode: (resultUrl: string) => void;
  onCreateNewNode: (resultUrl: string) => void;
}

interface Angle3DState {
  visible: boolean;
  nodeId: string | null;
  canvasId: string | null;
  imageUrl: string | null;
  params: Angle3DParams;
  taskId: string | null;
  taskStatus: Angle3DTaskStatus;
  resultUrl: string | null;
  estimatedCredits: number;
  errorMessage: string | null;
}

interface Angle3DActions {
  openModal: (nodeId: string, imageUrl: string, canvasId: string) => void;
  closeModal: () => void;
  updateParams: (partial: Partial<Angle3DParams>) => void;
  applyPreset: (key: Angle3DPresetKey) => void;
  resetParams: () => void;
  setTaskState: (partial: Partial<Pick<Angle3DState, 'taskId' | 'taskStatus' | 'resultUrl' | 'errorMessage'>>) => void;
  setEstimatedCredits: (value: number) => void;
  retryTask: () => void;
  setNodeCallbacks: (nodeId: string, callbacks: NodeCallbacks | null) => void;
  replaceCurrentNode: (resultUrl: string) => void;
  createNewNode: (resultUrl: string) => void;
}

type Angle3DStore = Angle3DState & Angle3DActions;

const initialParams = { ...ANGLE3D_DEFAULTS };

const initialState: Angle3DState = {
  visible: false,
  nodeId: null,
  canvasId: null,
  imageUrl: null,
  params: { ...initialParams },
  taskId: null,
  taskStatus: 'idle' as Angle3DTaskStatus,
  resultUrl: null,
  estimatedCredits: 15,
  errorMessage: null,
};

const nodeCallbacksMap = new Map<string, NodeCallbacks>();

export const useAngle3DStore = create<Angle3DStore>((set, get) => ({
  ...initialState,

  openModal: (nodeId, imageUrl, canvasId) => {
    const current = get();
    if (current.nodeId === nodeId) {
      // Same node — preserve params/taskInfo but always update imageUrl (fresh presigned URL)
      set({ visible: true, imageUrl });
    } else {
      // Different or new node — full reset
      set({
        ...initialState,
        visible: true,
        nodeId,
        imageUrl,
        canvasId,
      });
    }
  },

  closeModal: () => {
    set({ visible: false });
  },

  updateParams: (partial) => {
    set((state) => ({
      params: { ...state.params, ...partial },
    }));
  },

  applyPreset: (key) => {
    const preset = ANGLE3D_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    set({
      params: {
        ...get().params,
        horizontalAngle: preset.horizontalAngle,
        verticalAngle: preset.verticalAngle,
        zoom: preset.zoom,
      },
    });
  },

  resetParams: () => {
    set({ params: { ...initialParams } });
  },

  setTaskState: (partial) => {
    set((state) => ({
      taskId: partial.taskId !== undefined ? partial.taskId : state.taskId,
      taskStatus: partial.taskStatus !== undefined ? partial.taskStatus : state.taskStatus,
      resultUrl: partial.resultUrl !== undefined ? partial.resultUrl : state.resultUrl,
      errorMessage: partial.errorMessage !== undefined ? partial.errorMessage : state.errorMessage,
    }));
  },

  setEstimatedCredits: (value) => {
    set({ estimatedCredits: value });
  },

  retryTask: () => {
    set({
      taskStatus: 'idle' as Angle3DTaskStatus,
      errorMessage: null,
      resultUrl: null,
    });
  },

  setNodeCallbacks: (nodeId, callbacks) => {
    if (callbacks === null) {
      nodeCallbacksMap.delete(nodeId);
    } else {
      nodeCallbacksMap.set(nodeId, callbacks);
    }
  },

  replaceCurrentNode: (resultUrl) => {
    const current = get();
    if (!current.nodeId) return;
    const cb = nodeCallbacksMap.get(current.nodeId);
    cb?.onReplaceCurrentNode(resultUrl);
  },

  createNewNode: (resultUrl) => {
    const current = get();
    if (!current.nodeId) return;
    const cb = nodeCallbacksMap.get(current.nodeId);
    cb?.onCreateNewNode(resultUrl);
  },
}));
