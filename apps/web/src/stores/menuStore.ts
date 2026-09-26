import { create } from 'zustand';

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
  setTriggerEl: (el: HTMLButtonElement | null) => void;
  updateMousePos: (pos: { x: number; y: number }) => void;
  open: (pos?: { x: number; y: number }) => void;
  close: () => void;
  toggle: () => void;
  openHandleMenu: (m: HandleMenuState) => void;
  closeHandleMenu: () => void;
}

export const useMenuStore = create<MenuState>((set) => ({
  isOpen: false,
  position: undefined,
  triggerEl: null,
  lastMousePos: { x: 0, y: 0 },
  handleMenu: undefined,
  setTriggerEl: (el) => set({ triggerEl: el }),
  updateMousePos: (pos) => set({ lastMousePos: pos }),
  // 双向互斥（spec §3.3）：右键菜单开时清 handle 菜单
  open: (pos) => set({ isOpen: true, position: pos, handleMenu: undefined }),
  close: () => set({ isOpen: false, position: undefined }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  // 双向互斥另一侧：handle 菜单开时关右键菜单
  openHandleMenu: (m) => set({ handleMenu: m, isOpen: false, position: undefined }),
  closeHandleMenu: () => set({ handleMenu: undefined }),
}));
