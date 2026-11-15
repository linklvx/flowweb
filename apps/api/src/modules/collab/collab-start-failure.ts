// TD-33/C1a T6 创建（TD-32/C2 扩展）：collab 启动失败面单源。
// isPortError 自 collab.gateway 迁入——gateway 只委托，GC 接线 +2 行由此抵消（锚净零纪律）。
export function isPortError(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === 'EADDRINUSE' || code === 'DOCS_NOT_UNLOADED' || /EADDRINUSE/i.test((e as Error)?.message ?? '');
}

// TD-32/C2 T17：typed 启动失败面（drill IPC/控制库同读；gateway 只委托）。
// stateSince=进入当前状态时刻（start-failed 档=grace 起算点；transition 时写）；at=失败事件时刻。
export type CollabStartFailureKind = 'port-in-use' | 'docs-not-unloaded' | 'other';

export interface CollabStartFailure {
  code?: string;
  message: string;
  at: number;
  attempt: number;
  kind: CollabStartFailureKind;
  stateSince: number;
}

export interface CollabStartSnapshot {
  state: string;
  stateSince: number;
  attempt: number;
  lastStartFailure: CollabStartFailure | null;
}

function kindOf(e: unknown): CollabStartFailureKind {
  const code = (e as { code?: string })?.code;
  if (code === 'EADDRINUSE') return 'port-in-use';
  if (code === 'DOCS_NOT_UNLOADED') return 'docs-not-unloaded';
  if (code === 'EACCES' || code === 'EPERM') return 'other';   // typed DrillCollabStartFailed 面不换口
  return /EADDRINUSE/i.test((e as Error)?.message ?? '') ? 'port-in-use' : 'other';
}

export class CollabStartFailureTracker {
  private attempt = 0;
  private state = 'initializing';
  private stateSince = Date.now();
  private failure: Omit<CollabStartFailure, 'stateSince'> | null = null;

  /** transition 单点调用（gateway.transition）——stateSince 随状态进入时刻变化。 */
  noteState(next: string, now = Date.now()): void {
    this.state = next;
    this.stateSince = now;
  }

  /** 新 attempt 入口——计数递增+清空旧失败（旧 attempt 不误判）。 */
  noteAttempt(): number {
    this.attempt += 1;
    this.failure = null;
    return this.attempt;
  }

  /** catch 内先于 transition('start-failed') 赋值——stateSince 由随后的 noteState 落定（本方法不返回
   *  快照：此刻 stateSince 仍是前一状态时刻，外露易误用）。 */
  noteFailure(e: unknown, now = Date.now()): void {
    const err = e as { code?: string; message?: string } | null;
    this.failure = {
      code: err?.code,
      message: err?.message ?? String(e),
      at: now,
      attempt: this.attempt,
      kind: kindOf(e),
    };
  }

  /** serving 入口清空（失败面只反映未服务态）。 */
  noteServing(): void {
    this.failure = null;
  }

  lastStartFailure(): CollabStartFailure | null {
    return this.failure ? { ...this.failure, stateSince: this.stateSince } : null;
  }

  snapshot(): CollabStartSnapshot {
    return { state: this.state, stateSince: this.stateSince, attempt: this.attempt, lastStartFailure: this.lastStartFailure() };
  }
}
