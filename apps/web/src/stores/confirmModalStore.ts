import { create } from 'zustand';

export interface ConfirmModalConfig {
  title: string;
  content: string;
  cancelText: string;
  secondaryText?: string;
  primaryText: string;
  primaryType: 'default' | 'primary' | 'danger';
  onClose: () => void;
  onSecondary?: () => void;
  onPrimary: () => void;
}

interface ConfirmModalState extends ConfirmModalConfig {
  isOpen: boolean;
  show: (config: ConfirmModalConfig) => void;
  close: () => void;
}

export const useConfirmModalStore = create<ConfirmModalState>((set, get) => ({
  isOpen: false,
  title: '',
  content: '',
  cancelText: '',
  primaryText: '',
  primaryType: 'default',
  onClose: () => {},
  onPrimary: () => {},

  show: (config) => {
    if (get().isOpen) {
      get().onClose();
    }
    set({ ...config, isOpen: true });
  },
  close: () => set({ isOpen: false }),
}));
