// apps/web/src/stores/hydration-local.spec.ts
// Y5 T8：hydration 第五态 local——本地 DB 已装载可编辑，但 provider 未同步/无服务端确认。
// 判据：canEdit=非终态∧!collabReadOnly∧(ready∨local)；canExecute=内联 ready 合取
// （§0.3.2：local 恒不可执行，即使 connStatus 假想为 connected）；threads 闸=canEdit 调用时求值。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCanvasStore, type CanvasState } from './canvasStore';
import { canEdit, canExecute } from './syncStatus';

// threads 闸闭包捕获（vi.hoisted：mock 工厂提升后可达——断言 attachThreads 注入的真实判据）
const gate = vi.hoisted(() => ({ predicates: [] as Array<() => boolean> }));

vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

vi.mock('./threadsStore', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./threadsStore')>();
  return {
    ...orig,
    attachThreads: (doc: Y.Doc, getSynced: () => boolean) => {
      gate.predicates.push(getSynced);
      orig.attachThreads(doc, getSynced);
    },
  };
});

import * as runtime from './canvasCollabRuntime';

/** 铺底=local 可编辑态；用例只拨被测键（谓词只读少量字段，避免整 state 手构） */
const st = (over: Partial<CanvasState>): CanvasState => ({
  hydration: 'local',
  collabReadOnly: false,
  wsAuthNotice: null,
  connStatus: 'offline',
  writeFrozen: false,
  ...over,
} as CanvasState);

describe('Y5 T8：hydration=local 谓词（编辑放行/执行锁死）', () => {
  it('local ∧ !readOnly ∧ 非终态 ⇒ canEdit true', () => {
    expect(canEdit(st({ hydration: 'local' }))).toBe(true);
  });

  it('canExecute 在 local 恒假——connStatus=connected ∧ writeFrozen=false 亦假（§0.3.2 内联谓词）', () => {
    expect(canExecute(st({ hydration: 'local', connStatus: 'connected', writeFrozen: false }))).toBe(false);
  });

  it('ready 断线（connStatus=offline）：canEdit true 而 canExecute false（A3/验收 18 形态）', () => {
    expect(canEdit(st({ hydration: 'ready', connStatus: 'offline' }))).toBe(true);
    expect(canExecute(st({ hydration: 'ready', connStatus: 'offline' }))).toBe(false);
  });

  it.each(['idle', 'pending', 'failed'] as const)('回归：hydration=%s ⇒ canEdit false', (h) => {
    expect(canEdit(st({ hydration: h }))).toBe(false);
  });
});

describe('Y5 T8：threads 写闸判据=canEdit（attachThreads 注入闭包调用时求值）', () => {
  const lastProvider = () => (HocuspocusProvider as any).instances.at(-1) as any;

  beforeEach(() => {
    gate.predicates.length = 0;
    (HocuspocusProvider as any).instances.length = 0;
    useCanvasStore.setState({
      connStatus: 'connecting', nodes: [], edges: [],
      hydration: 'idle', collabReadOnly: true, wsAuthNotice: null,
    });
  });

  afterEach(async () => {
    await runtime.destroyCollab();
  });

  it('local ∧ !readOnly ∧ 非终态 ⇒ 闭包 true（provider.isSynced=false 不再拦）；退出 local 回 false', async () => {
    void runtime.initCollab('p-local');
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(gate.predicates.length).toBeGreaterThan(0);
    const getSynced = gate.predicates.at(-1)!;
    expect(lastProvider().isSynced).toBe(false);   // provider 未同步——旧判据 provider.isSynced===true 下必假

    useCanvasStore.setState({ hydration: 'local', collabReadOnly: false, wsAuthNotice: null });
    expect(getSynced()).toBe(true);

    useCanvasStore.setState({ hydration: 'pending' });   // 反向腿：非可编辑态仍拦
    expect(getSynced()).toBe(false);
  });
});
