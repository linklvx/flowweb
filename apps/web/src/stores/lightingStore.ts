import { create } from 'zustand';
import { type LightingParams, type LightingTaskStatus, LightingTaskStatuses } from '@flowweb/shared';

interface LightingState {
  visible: boolean;
  nodeId: string | null;
  imageUrl: string | null;
  params: LightingParams;
  taskId: string | null;
  taskStatus: LightingTaskStatus;
  resultUrl: string | null;
  errorMessage: string | null;
}

interface LightingActions {
  openModal: (nodeId: string, imageUrl: string) => void;
  closeModal: () => void;
  updateParams: (params: Partial<LightingParams>) => void;
  resetParams: () => void;
  setTaskInfo: (info: Partial<{
    taskId: string;
    taskStatus: LightingTaskStatus;
    resultUrl: string;
    errorMessage: string;
  }>) => void;
}

type LightingStore = LightingState & LightingActions;

const defaultParams: LightingParams = {
  position: { x: 0, y: 0, z: 6 },
  brightness: 50,
  colorTemperature: 5600,
  rimLight: false,
};

const initialState: LightingState = {
  visible: false,
  nodeId: null,
  imageUrl: null,
  params: { ...defaultParams },
  taskId: null,
  taskStatus: LightingTaskStatuses.PENDING,
  resultUrl: null,
  errorMessage: null,
};

export const useLightingStore = create<LightingStore>((set) => ({
  ...initialState,

  openModal: (nodeId, imageUrl) =>
    set({
      ...initialState,
      visible: true,
      nodeId,
      imageUrl,
    }),

  closeModal: () => set({ ...initialState }),

  updateParams: (params) =>
    set((state) => ({
      params: { ...state.params, ...params },
    })),

  resetParams: () =>
    set({
      params: { ...defaultParams },
    }),

  setTaskInfo: (info) =>
    set((state) => ({
      taskId: info.taskId ?? state.taskId,
      taskStatus: info.taskStatus ?? state.taskStatus,
      resultUrl: info.resultUrl ?? state.resultUrl,
      errorMessage: info.errorMessage ?? state.errorMessage,
    })),
}));
