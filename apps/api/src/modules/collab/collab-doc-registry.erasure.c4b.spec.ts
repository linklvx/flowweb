// apps/api/src/modules/collab/collab-doc-registry.erasure.c4b.spec.ts
// C4-b（plan Task C4-2 ⑤——装载面 fast-path）：DR.loadDocument lifecycle 门（auth 后竞窗收口）。
// DELETING ⇒ 拒装载（reason=NOT_FOUND——重连即撞 auth 4414 terminal；closeUpgradeTerminal 单一
// terminal 投递面不在此重复）；ACTIVE/行缺失 ⇒ 放行（装载继续）。计数 collabLoadRejectedTotal
// {reason:'project-erasing'}。
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { CollabDocRegistryService } from './collab-doc-registry.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { CollabAuthReason } from '@flowweb/shared';

const loggerStub = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} } as never;

function buildRegistry(lifecycleState: string | null) {
  const repo = createMockRepo();
  (repo as unknown as Record<string, unknown>).readLifecycleState = vi.fn(async () => lifecycleState);
  const registry = new CollabDocRegistryService(repo as never, {
    observeDocument: () => {}, seedCompactBaseline: () => {}, persistUnhealthy: new Set<string>(),
    withReplaySuppressed: (d: Y.Doc, u: Uint8Array) => { Y.applyUpdate(d, u); },
    peekSpoolFrames: async () => [], hasPendingWrites: () => false,
  } as never, undefined);
  registry.bindHost({
    logger: loggerStub,
    documents: () => new Map(),
    unloadingDocuments: () => new Set(),
    shouldUnloadDocument: () => false,
    isServingState: () => true,
    isDrainingState: () => false,
    heapPressureSample: () => ({ tripped: false }),
    applyWriteFreeze: () => {}, releaseFreezeForDoc: () => {}, hardClose: () => {},
    docConnections: () => [], onFencedByWrite: async () => {}, switchWalGeneration: () => {},
  } as never);
  return { registry, repo };
}

describe('C4-b loadDocument 擦除装载门（lifecycle 非 ACTIVE 拒载——auth 后竞窗收口）', () => {
  it('DELETING ⇒ reason=NOT_FOUND 拒装载（hydrateWithRecovery 零调用——不进入装载链）', async () => {
    const { registry, repo } = buildRegistry('DELETING');
    await expect(
      registry.loadDocument({ document: new Y.Doc(), documentName: 'project:p-erased', socketId: 's1' } as never),
    ).rejects.toMatchObject({ reason: CollabAuthReason.NOT_FOUND });
    expect(repo.hydrateWithRecovery).not.toHaveBeenCalled();
  });

  it('ACTIVE ⇒ 放行（装载继续——hydrateWithRecovery 消费）；行缺失（null）同放行（懒建档语义）', async () => {
    const { registry, repo } = buildRegistry('ACTIVE');
    await expect(
      registry.loadDocument({ document: new Y.Doc(), documentName: 'project:p-live', socketId: 's1' } as never),
    ).resolves.toBeUndefined();
    expect(repo.hydrateWithRecovery).toHaveBeenCalledWith('p-live');
  });
});
