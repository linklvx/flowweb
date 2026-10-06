// apps/api/src/test-utils/mock-repo.ts
// Y0a-1：repo mock 工厂——gateway 侧 spec 的 repo stub 收敛到单点（接口变更改这里，不改 15 处）。
// hydrateWithRecovery 默认委托 loadForHydration（gateway 实际调用的就是它——缺此键则 5 个既有 spec 的
// gateway 一装载 doc 即 TypeError）：逐用例覆写 loadForHydration 即改装载行为（挂起不 reject 不进
// catch，红4 语义保持）；需模拟自愈语义时直接覆写 hydrateWithRecovery。
import { vi } from 'vitest';

export interface MockRepo {
  append: ReturnType<typeof vi.fn>;
  loadForHydration: ReturnType<typeof vi.fn>;
  hydrateWithRecovery: ReturnType<typeof vi.fn>;
  compact: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
}

export function createMockRepo(over: Partial<MockRepo> = {}): MockRepo {
  const repo = {
    append: vi.fn(async () => ({ ok: true as const, seq: 1n })),          // AppendResult（spec v2.4 §1.2——Y0a-2 BOI 按契约 15 消费）
    loadForHydration: vi.fn(async () => ({ state: null, updates: [] as Buffer[], stateSeq: 0n })),
    compact: vi.fn(async () => ({ compacted: true as const })),            // 返回契约（spec v2.4 §1.3——maybeCompact 仅成功开窗依赖此形状）
    count: vi.fn(async () => 0),
    ...over,
  };
  // 委托本身也是 vi.fn：用例可直接 repo.hydrateWithRecovery.mockResolvedValueOnce(...) 覆写；
  // 未覆写时落到 loadForHydration（含其 Once 队列/挂起 impl——红4 挂起语义经委托等价保持）
  (repo as MockRepo).hydrateWithRecovery =
    over.hydrateWithRecovery ?? vi.fn(async (projectId: string) => (repo as MockRepo).loadForHydration(projectId));
  return repo as MockRepo;
}
