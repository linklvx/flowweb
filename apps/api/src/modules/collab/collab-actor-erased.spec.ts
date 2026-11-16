// TD-33/C1b T12：actor 双 catch 终态族 4414——SpoolProjectBlockedError（ERASING/ERASED 全档）∨
// FrameRejectError.code===4414（team DISBANDING 档帧）→ 连接项 hardClose(4414)+reject；维护项仅 reject；
// 不 Sentry 不计 wal-failed。旧实现：批 WAL 失败一律 SLOW_CONSUMER 'wal-append-failed' + capture（红）。
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import type { Logger } from '@nestjs/common';

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('../../utils/sentry-scrub', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/sentry-scrub')>();
  return { ...actual, captureCollabException: capture };
});

// 卡② K4：mock 半径=只替换 captureCollabException（importOriginal 展开）——scrubEvent 等真实导出面保持
it('K4 mock 半径：scrubEvent 仍为函数+captureCollabException===capture（同一 hoisted 函数）', async () => {
  const mod = await import('../../utils/sentry-scrub');
  expect(typeof mod.scrubEvent).toBe('function');
  expect(mod.captureCollabException).toBe(capture);
});

import { CollabProjectActorService, FrameRejectError } from './collab-project-actor.service';
import { CollabSpoolService, SpoolProjectBlockedError } from './collab-spool.service';
import { EmptyErasureGuard } from '../../test-utils/erasure-fixtures';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { CollabCloseCode, PROJECT_ERASED_TERMINAL_REASON } from '@flowweb/shared';

class TerminalSpool extends CollabSpoolService {
  mode: 'blocked' | 'frame4414' = 'blocked';
  constructor(d: string) { super(d); this.setOwner('o1'); this.setErasureGuard(EmptyErasureGuard); }
  override async appendBatch(): Promise<never> {
    if (this.mode === 'frame4414') throw new FrameRejectError(CollabCloseCode.PROJECT_ERASED, 'team-disbanding');
    throw new SpoolProjectBlockedError('ERASING');
  }
}

function build(spool: CollabSpoolService, documents: Map<string, Y.Doc>) {
  const repo = createMockRepo();
  const hardClose = vi.fn();
  const actor = new CollabProjectActorService(spool, repo as never);
  (actor as unknown as { bindHost(h: unknown): void }).bindHost({
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn(), fatal: vi.fn(), localInstance: true } as unknown as Logger,
    documents: () => documents,
    hardClose: (c: unknown, code: number, reason: string) => hardClose(c, code, reason),
    isQuotaFrozen: () => false,
    generationOf: () => 0,
    noteReadOnlyDrop: () => false,
    onFencedByWrite: async () => {},
  });
  return { actor, hardClose };
}

const frame = (): Uint8Array => Y.encodeStateAsUpdate(new Y.Doc());
const conn = () => ({ socketId: 's1', readOnly: false, sendStateless: vi.fn() }) as never;

describe('TD-33 T12：actor 终态族 4414 双 catch', () => {
  it('主批：SpoolProjectBlockedError(ERASING)→连接项 hardClose(4414 terminal)+reject(4414)；不 Sentry', async () => {
    capture.mockClear();
    const { dir, cleanup } = await makeSpoolDir('td33-t12-');
    try {
      const spool = new TerminalSpool(dir);
      const doc = new Y.Doc();
      const { actor, hardClose } = build(spool, new Map([['project:p1', doc]]));
      const c = conn();
      await expect(actor.submit('p1', frame(), c, 'update')).rejects.toMatchObject({
        code: CollabCloseCode.PROJECT_ERASED, reason: PROJECT_ERASED_TERMINAL_REASON,
      });
      expect(hardClose).toHaveBeenCalledWith(c, CollabCloseCode.PROJECT_ERASED, PROJECT_ERASED_TERMINAL_REASON);
      expect(capture).not.toHaveBeenCalled();
    } finally { await cleanup(); }
  });

  it('主批：FrameRejectError.code=4414（team DISBANDING 档帧）同族处理——不落 1011', async () => {
    capture.mockClear();
    const { dir, cleanup } = await makeSpoolDir('td33-t12-team-');
    try {
      const spool = new TerminalSpool(dir);
      spool.mode = 'frame4414';
      const { actor, hardClose } = build(spool, new Map([['project:p1', new Y.Doc()]]));
      const c = conn();
      await expect(actor.submit('p1', frame(), c, 'update')).rejects.toMatchObject({ code: CollabCloseCode.PROJECT_ERASED });
      expect(hardClose).toHaveBeenCalledWith(c, CollabCloseCode.PROJECT_ERASED, PROJECT_ERASED_TERMINAL_REASON);
      expect(capture).not.toHaveBeenCalled();
    } finally { await cleanup(); }
  });

  it('detached 维护批：blocked→仅 reject(4414)，无连接可关；不 Sentry', async () => {
    capture.mockClear();
    const { dir, cleanup } = await makeSpoolDir('td33-t12-maint-');
    try {
      const spool = new TerminalSpool(dir);
      const { actor, hardClose } = build(spool, new Map());   // doc 不在——维护帧走 detached 分支
      await expect(actor.submitMaintenance('pm', frame())).rejects.toMatchObject({
        code: CollabCloseCode.PROJECT_ERASED, reason: PROJECT_ERASED_TERMINAL_REASON,
      });
      expect(hardClose).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();
    } finally { await cleanup(); }
  });
});
