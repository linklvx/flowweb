import { create } from 'zustand';

/** 批3-3：httpExpired 电平——apiFetch 收到 401 时置位（电平语义：保持到显式 reset，
 *  不随下一次成功请求自动回落——401 后的"成功"多半是公开端点，不构成登录恢复证据）。
 *  消费面（登录横幅/蒙层）批 2 接线，本批只留模块+电平。 */
interface SessionExpiryState {
  httpExpired: boolean;
  setHttpExpired: () => void;
  reset: () => void;
}

export const useSessionExpiry = create<SessionExpiryState>((set) => ({
  httpExpired: false,
  setHttpExpired: () => set({ httpExpired: true }),
  reset: () => set({ httpExpired: false }),
}));
