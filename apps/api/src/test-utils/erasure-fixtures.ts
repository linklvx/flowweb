// TD-33/C1b：擦除屏障显式测试夹具。**非生产默认空**——防 DI 漏接=擦除屏障静默消失的 fail-open
// 后门（生产 module 工厂单点接线 ErasureRegistry；直构测试必须显式注入本夹具）。
import {
  CollabSpoolService,
  type SpoolErasureGuard,
  type SpoolErasureSource,
  type SpoolErasureState,
} from '../modules/collab/collab-spool.service';

export const EmptyErasureGuard: SpoolErasureGuard = { isBlocked: () => undefined };

/** 空擦除权威（load/refresh no-op；无 blocked/purgeable；mark 仅本地记账）——测试直构 spool/gateway 用。 */
export class EmptyErasureSource implements SpoolErasureSource {
  private readonly blocked = new Map<string, SpoolErasureState>();
  async load(): Promise<void> { /* no-op */ }
  async refresh(): Promise<void> { /* no-op */ }
  isBlocked(projectId: string): SpoolErasureState | undefined { return this.blocked.get(projectId); }
  blockedMap(): ReadonlyMap<string, SpoolErasureState> { return this.blocked; }
  listPurgeableProjectIds(): string[] { return []; }
  async listPurgeableProjectIdsLive(): Promise<Set<string>> { return new Set(); }
  mark(projectId: string, state: SpoolErasureState): void { this.blocked.set(projectId, state); }
}

/** 测试直构 spool 唯一入口（显式空 source/guard）。 */
export function spoolForTest(dir?: string): CollabSpoolService {
  const s = new CollabSpoolService(dir);
  s.setErasureSource(new EmptyErasureSource());
  return s;
}
