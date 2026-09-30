// awareness presence 封装（spec T6）：光标/选区/在线成员
import type { HocuspocusProvider } from '@hocuspocus/provider';

export interface CollabUser {
  id: string;
  name: string;
}

export interface CursorState {
  x: number;
  y: number;
}

export interface SelectionState {
  nodeIds: string[];
}

export interface AwarenessState {
  user: CollabUser;
  cursor?: CursorState;
  selection?: SelectionState;
}

const COLORS = ['#5DDCFF', '#FF7A9E', '#9EFF8A', '#FFC56D', '#C39EFF', '#7AD7FF'];

export function userColor(userId: string | undefined = ''): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

export class AwarenessBridge {
  /** 批1-3：终态重建重放缓存——setLocalUser 时快照（重放完整态，禁 {}——R24） */
  private lastLocalUser: CollabUser | null = null;

  constructor(private provider: HocuspocusProvider) {}

  /** 批1-3：终态重建迁移——bridge 稳定对象，provider 引用重指向（消费方/监听零改动） */
  attach(provider: HocuspocusProvider): void {
    this.provider = provider;
  }

  setLocalUser(user: CollabUser): void {
    this.lastLocalUser = user;
    this.provider.setAwarenessField('user', user);
  }

  /** 批1-3：终态重建后的本地态重放（null=从未设置，no-op——不打 Awareness clock） */
  replayLocalUser(): void {
    if (this.lastLocalUser) this.provider.setAwarenessField('user', this.lastLocalUser);
  }

  setCursor(cursor: CursorState | null): void {
    this.provider.setAwarenessField('cursor', cursor);
  }

  // ⚠️ 当前无生产调用方（仅测试）。勿接到画布选中态——框选逐帧改 selected 会使每次相交变化
  // 变成 WS awareness 写（2026-09-28 交互重构 spec §7 登记行）。
  setSelection(nodeIds: string[]): void {
    this.provider.setAwarenessField('selection', { nodeIds });
  }

  getStates(): Map<number, AwarenessState> {
    if (!this.provider.awareness) return new Map();
    return this.provider.awareness.getStates() as Map<number, AwarenessState>;
  }

  /** 远端成员（排除本地 clientID） */
  getRemoteStates(): AwarenessState[] {
    const states = this.getStates();
    const out: AwarenessState[] = [];
    for (const [clientID, state] of states) {
      if (clientID !== this.provider.awareness?.clientID) out.push(state as AwarenessState);
    }
    return out;
  }

  onStateChange(cb: () => void): () => void {
    const handler = () => cb();
    this.provider.on('awarenessUpdate', handler);
    return () => this.provider.off('awarenessUpdate', handler);
  }
}
