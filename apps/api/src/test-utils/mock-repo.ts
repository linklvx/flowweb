// apps/api/src/test-utils/mock-repo.ts
// Y0a-1：repo mock 工厂——gateway 侧 spec 的 repo stub 收敛到单点（接口变更改这里，不改 15 处）。
// hydrateWithRecovery 默认委托 loadForHydration（gateway 实际调用的就是它——缺此键则 5 个既有 spec 的
// gateway 一装载 doc 即 TypeError）：逐用例覆写 loadForHydration 即改装载行为（挂起不 reject 不进
// catch，红4 语义保持）；需模拟自愈语义时直接覆写 hydrateWithRecovery。
import { vi } from 'vitest';

export interface MockRepo {
  append: ReturnType<typeof vi.fn>;
  appendBatch: ReturnType<typeof vi.fn>;   // Y1c T9：actor drain 批/回灌行新写面（新表形态）
  loadForHydration: ReturnType<typeof vi.fn>;
  hydrateWithRecovery: ReturnType<typeof vi.fn>;
  compact: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  pgSeqFloors: ReturnType<typeof vi.fn>;   // C1'①（T11 双评审+复核 round-2）：boot 三元组播种读面（gateway startCollabAfterLease init 步消费——先于 replayAll）
  readWatermark: ReturnType<typeof vi.fn>;   // Y1c T12：withDoc canonical 名世代真值读面（缺省 null=gen0 裸名）
  readGeneration: ReturnType<typeof vi.fn>;   // Y1c T12：auth 世代准入真值读面（缺省 null=gen0）
  assertSchemaGenerationDiscipline: ReturnType<typeof vi.fn>;   // Y1c T12：schemaVersion⇒generation 启动断言（boot 消费——缺省放行）
}

export function createMockRepo(over: Partial<MockRepo> = {}): MockRepo {
  const repo = {
    append: vi.fn(async () => { throw new Error('append retired in Y1c T9——mock 请走 appendBatch（actor drain 批/回灌行）'); }),   // T9：旧单帧 append 退役（现役写面=appendBatch；保留键防 silent-miss）
    appendBatch: vi.fn(async (_projectId: string, rows: unknown[] = []) => ({ ok: true as const, rows: rows.length })),   // Y1c T9：批行 append 默认全成功（用例可覆写 fenced/throw）
    loadForHydration: vi.fn(async () => ({ state: null, updates: [] as Buffer[], stateSeq: 0n })),
    // Y1c T11 返回契约（compact 重写）：成功面扩 snapshotRev/stateSeq/purgeBelowSeq（发布事务产物
    // ——maybeCompact purgeBelowSeq spool confirm 消费依赖）；失败面 reason 词表={abandoned|empty|miss}
    // （not-owner 随授权换轴〔行锁+CAS〕退役）。
    compact: vi.fn(async () => ({ compacted: true as const, snapshotBytes: 0, deletedRows: 0, tombstoneBytes: 0, snapshotRev: 0n, stateSeq: 0n, purgeBelowSeq: 0n })),
    count: vi.fn(async () => 0),
    pgSeqFloors: vi.fn(async () => [] as Array<{ projectId: string; generation: number; pgSeq: bigint }>),   // C1'①：boot 三元组播种默认空集（用例可覆写布景）
    readWatermark: vi.fn(async () => null),   // Y1c T12：行缺失=gen0（canonical=裸名——存量装置零变化）
    readGeneration: vi.fn(async () => null),   // Y1c T12：行缺失=gen0（auth 世代准入缺省放行裸名）
    assertSchemaGenerationDiscipline: vi.fn(async () => undefined),   // Y1c T12：缺省无违例（用例可覆写拒启形态）
    ...over,
  };
  // 委托本身也是 vi.fn：用例可直接 repo.hydrateWithRecovery.mockResolvedValueOnce(...) 覆写；
  // 未覆写时落到 loadForHydration（含其 Once 队列/挂起 impl——红4 挂起语义经委托等价保持）
  (repo as MockRepo).hydrateWithRecovery =
    over.hydrateWithRecovery ?? vi.fn(async (projectId: string) => (repo as MockRepo).loadForHydration(projectId));
  return repo as MockRepo;
}
