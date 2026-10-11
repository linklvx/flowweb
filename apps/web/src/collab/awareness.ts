// awareness presence 封装（spec T6）：光标/选区/在线成员
// Y0b-3 T7：user 字段写入退位——身份/role/color 由服务端 beforeHandleAwareness 无条件注入
// （客户端自写即伪造面，E73）；配色单源=@flowweb/shared userColorOfUserId（服务端同源算法）。
import type { HocuspocusProvider } from '@hocuspocus/provider';

export interface CollabUser {
  id: string;
  name: string;
  role?: string;
  color?: string;
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

export class AwarenessBridge {
  /** 批1-5：稳定对象——订阅自持（Set<cb>），attach 迁移时重挂单内部 handler（消费方订阅跨实例存活） */
  private readonly listeners = new Set<() => void>();
  private detachProviderListener: (() => void) | null = null;
  private provider!: HocuspocusProvider; // 构造经 attach 赋值（definite assignment）

  constructor(provider: HocuspocusProvider) {
    this.attach(provider);
  }

  /** 批1-3：终态重建迁移——bridge 稳定对象，provider 引用重指向；
   *  批1-5：内部 handler 随迁重挂（旧订阅不孤儿——awarenessUpdate 持续可达） */
  attach(provider: HocuspocusProvider): void {
    this.detachProviderListener?.();
    this.provider = provider;
    const handler = () => { for (const cb of this.listeners) cb(); };
    provider.on('awarenessUpdate', handler);
    this.detachProviderListener = () => provider.off('awarenessUpdate', handler);
  }

  /** 批1-3 终态重建/Y0b-1 tick 自愈两承重点的本地态锚点恢复（T7 改形/T10 根修——名 replayLocalUser
   *  已名不副实：现语义=恢复**非空本地态锚点**）：null ⇒ setLocalState({ presence: true })。
   *  ① 非空对象是 cursor 写入与 30s 续期帧的前置（null 态下 setLocalStateField 吞 cursor 写入+续期
   *  停摆——R24）；② presence 标记使真身帧**非空态**——服务端 guardAwareness 幽灵判据（首见∧空态∧
   *  doc 无此 id）不会误杀真身帧（T10 实证：空态真身帧被剔=零回显=客户端 30-45s 重连循环）。
   *  非 user 字段（身份归服务端注入——客户端自写即伪造面，E73）。非空即 no-op（不打 clock）。 */
  replayLocalUser(): void {
    if (this.provider.awareness && this.provider.awareness.getLocalState() == null) {
      this.provider.awareness.setLocalState({ presence: true });
    }
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

  /** 批1-5：订阅自持（Set<cb>）——退订/通知不再穿透 provider 实例（attach 迁移零影响） */
  onStateChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
}
