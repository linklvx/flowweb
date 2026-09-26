import { create } from 'zustand';
import { useNodeStore } from './nodeStore';

export interface HandleMenuState {
  x: number;
  y: number;
  nodeId: string;
  side: 'source' | 'target';
  /** 松手点的画布坐标——CanvasView 守卫时经 screenToFlowPosition 换算一次并复用于建节点（spec §3.3） */
  flowPoint: { x: number; y: number };
}

interface MenuState {
  isOpen: boolean;
  position?: { x: number; y: number };
  triggerEl: HTMLButtonElement | null;
  lastMousePos: { x: number; y: number };
  handleMenu?: HandleMenuState;
  styleLibrary: { nodeId: string } | null;
  setTriggerEl: (el: HTMLButtonElement | null) => void;
  updateMousePos: (pos: { x: number; y: number }) => void;
  open: (pos?: { x: number; y: number }) => void;
  close: () => void;
  toggle: () => void;
  openHandleMenu: (m: HandleMenuState) => void;
  closeHandleMenu: () => void;
  openStyleLibrary: (nodeId: string) => void;
  closeStyleLibrary: () => void;
}

export const useMenuStore = create<MenuState>((set, get) => {
  // 三个 open 统一收口：清其余两切片 + 退出画布参考选择模式（spec §4.1；
  // 单向依赖 nodeStore——反向由组件层 onClick 收口防 ESM 循环）
  const exitRefSelect = () => { useNodeStore.getState().exitReferenceSelect(); };
  return {
    isOpen: false,
    position: undefined,
    triggerEl: null,
    lastMousePos: { x: 0, y: 0 },
    handleMenu: undefined,
    styleLibrary: null,
    setTriggerEl: (el) => set({ triggerEl: el }),
    updateMousePos: (pos) => set({ lastMousePos: pos }),
    open: (pos) => { exitRefSelect(); set({ isOpen: true, position: pos, handleMenu: undefined, styleLibrary: null }); },
    close: () => set({ isOpen: false, position: undefined }),
    toggle: () => {
      if (get().isOpen) { set({ isOpen: false, position: undefined }); return; }
      exitRefSelect();
      set({ isOpen: true, handleMenu: undefined, styleLibrary: null });
    },
    openHandleMenu: (m) => { exitRefSelect(); set({ handleMenu: m, isOpen: false, position: undefined, styleLibrary: null }); },
    closeHandleMenu: () => set({ handleMenu: undefined }),
    openStyleLibrary: (nodeId) => { exitRefSelect(); set({ styleLibrary: { nodeId }, isOpen: false, position: undefined, handleMenu: undefined }); },
    closeStyleLibrary: () => set({ styleLibrary: null }),
  };
});
