// TD-33/C1b T14：擦除运行面双 timer（registry refresh 10s + spool purgeable sweep 60s）。
// 抽取动机=gateway 锚预算（C1b 接线单行委托纪律；逻辑单点可单测）。生命周期：serving 启动；
// selfIsolate/onApplicationShutdown 停止；**drain 不停**（drain-auto-release 不经 listenCollab 直接
// transition('serving')，停=永不重启）——drain 期零 DB/零删盘由 tick 首行 allowed() 守卫承载。
import type { CollabSpoolService, SpoolErasureSource } from './collab-spool.service';

export const ERASURE_REFRESH_DEFAULT_MS = 10_000;
export const ERASURE_REFRESH_MAX_MS = 60_000;
export const PURGE_SWEEP_INTERVAL_MS = 60_000;

export function resolveErasureRefreshMs(raw: string | undefined): number {
  const n = Number(raw);
  if (!(n > 0)) return ERASURE_REFRESH_DEFAULT_MS;
  return Math.min(n, ERASURE_REFRESH_MAX_MS);
}

export class CollabErasureRuntime {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly source: SpoolErasureSource,
    private readonly spool: CollabSpoolService,
    private readonly allowed: () => boolean,
    private readonly refreshMs: number = resolveErasureRefreshMs(process.env.COLLAB_ERASURE_REFRESH_MS),
  ) {}

  start(): void {
    this.stop();
    this.refreshTimer = setInterval(() => {
      if (!this.allowed()) return;
      void this.source.refresh();   // 内部 single-flight+失败保留旧 Map（age 继续增长）
    }, this.refreshMs);
    this.refreshTimer.unref?.();
    this.sweepTimer = setInterval(() => {
      if (!this.allowed()) return;
      void this.spool.sweepPurgeableSpoolLive(this.source).catch(() => { /* 内部已计数 */ });
    }, PURGE_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  stop(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    if (this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null; }
  }

  running(): boolean {
    return this.refreshTimer != null || this.sweepTimer != null;
  }
}
