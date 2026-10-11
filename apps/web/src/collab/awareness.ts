// awareness presence 封装（spec T6）：光标/选区/在线成员
// Y0b-3 T7：user 字段写入退位——身份/role/color 由服务端 beforeHandleAwareness 无条件注入
// （客户端自写即伪造面，E73）；配色单源=@flowweb/shared userColorOfUserId（服务端同源算法）。
// Y0b-4 T12（E38）：selection 上报=去抖 200ms trailing+4KB 客户端前置拒（服务端解码后 4KB 判兜底）。
import { QUOTA_DEFAULTS, utf8Bytes } from '@flowweb/shared';
import { recordCollabDiag } from '@/utils/collabDiagnostics';
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

/** T12（E38）：selection 去抖窗——框选逐帧相交变化收敛为末态单帧（2026-09-28 交互重构 spec §7 登记行的解法） */
const SELECTION_DEBOUNCE_MS = 200;

/** T13（E39）：cursor 上报 30s 空闲停报窗——最后 pointermove（noteCursorMove 记账）后长闲置期间，
 *  非 move 源（周期重发/未来心跳式刷新）不再刷 cursor（停更新不清字段；下一次 move 立即恢复报）。
 *  测试常量绑定（fake timers 推进判——改值本测试红）。 */
export const CURSOR_IDLE_STOP_MS = 30_000;

export class AwarenessBridge {
  /** 批1-5：稳定对象——订阅自持（Set<cb>），attach 迁移时重挂单内部 handler（消费方订阅跨实例存活） */
  private readonly listeners = new Set<() => void>();
  private detachProviderListener: (() => void) | null = null;
  private selectionTimer: ReturnType<typeof setTimeout> | null = null;
  /** T13（E39）：最后 pointermove 事件时刻（noteCursorMove 记账——30s 停报守卫基线；Date.now 单源：
   *  30s 粒度无需单调钟）。0=从未 move（无从判"空闲"——守卫放行）。 */
  private lastMoveAt = 0;
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

  /** T13（E39②）：solo 判据——远端 states 零条目（provider awareness 本机 clientID 之外无任何
   *  条目）⇒ 单人自娱自乐：cursor/selection 零写入（不上 wire——无意义流量）；presence/user
   *  照常（§0.4b-17 锚点——成员表/保活链依赖）。服务端 solo 档剔字段为第二道闸（E39 双向短路）。 */
  private isSolo(): boolean {
    return this.getRemoteStates().length === 0;
  }

  /** T13（E39）：pointermove 事件记账（CanvasView 每 move 直调——含被 50ms 节流吞掉的 move；
   *  30s 停报守卫的"新 move"判据基线）。 */
  noteCursorMove(): void {
    this.lastMoveAt = Date.now();
  }

  setCursor(cursor: CursorState | null): void {
    if (this.isSolo()) return;   // E39②：单人 cursor 零写入
    if (this.lastMoveAt > 0 && Date.now() - this.lastMoveAt > CURSOR_IDLE_STOP_MS) return;   // 30s 停报：防非 move 源（周期重发/心跳式刷新）长闲置后刷 cursor——下一次 move（noteCursorMove 刷新基线）恢复
    this.provider.setAwarenessField('cursor', cursor);
  }

  /** T12（E38）：selection 上报——去抖 200ms trailing（连续变更只发末态——框选逐帧相交变化
   *  收敛为单帧，2026-09-28 spec §7 登记行解法）；选区清空立即发（结束选区要及时，不走去抖）；
   *  超限拒发前置在客户端（服务端解码后 4KB 判兜底——QUOTA_DEFAULTS.awarenessLimitBytes 单源）。
   *  清空=setAwarenessField('selection', null)（清字段值非清条目——presence/user 保留 §0.4b-17）。
   *  T13（E39②）：solo 门置顶（单人 selection 零写入——含清空路径，本就未写过）。 */
  setSelection(nodeIds: string[]): void {
    if (this.isSolo()) return;   // E39②：单人 selection 零写入
    if (nodeIds.length === 0) {
      if (this.selectionTimer) { clearTimeout(this.selectionTimer); this.selectionTimer = null; }   // 取消 pending 去抖——尾帧不补发
      this.provider.setAwarenessField('selection', null);
      return;
    }
    const selection = { nodeIds };
    if (utf8Bytes(JSON.stringify(selection)) > QUOTA_DEFAULTS.awarenessLimitBytes) {
      recordCollabDiag('write_reject', { reason: 'selection-too-large' });   // 拒不上 wire（不进管道不补发）
      return;
    }
    if (this.selectionTimer) clearTimeout(this.selectionTimer);
    this.selectionTimer = setTimeout(() => {
      this.selectionTimer = null;
      this.provider.setAwarenessField('selection', selection);
    }, SELECTION_DEBOUNCE_MS);
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
