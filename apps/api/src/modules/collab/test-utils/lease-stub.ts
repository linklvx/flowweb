// apps/api/src/modules/collab/test-utils/lease-stub.ts
// Y0a-3：CollabGateway 构造参数 4 的租约 stub——**契约同构（W5 单点负责制+V1 三件套）**：
// tryAcquireFast 成功 ⇒ ①repo.setLeaseOwner(owner) ②spool.setOwner(owner) ③await onAcquired
// （真实现 onHeld/dispatchAcquired 同序）——**缺①②则 kit 的 spool.scan() 在 activeDir() 处 throw**
// （T4 owner 必填）⇒ 全部 kit 用例落 start-failed=测试地基没了。gateway.onModuleInit 返回即
// collab 面已启动（kit `await onModuleInit() ⇒ 已 listen` 不变量保持）。
// G-3/门用例经 over 关闭。setLeaseOwner 走 ?.（MockRepo 无该键——真 repo 由 T3 实现，stub 面可选）。
import { vi } from 'vitest';

export interface LeaseStub {
  isServing: ReturnType<typeof vi.fn>;
  tryAcquireFast: ReturnType<typeof vi.fn>;
  acquireLoop: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  halt: ReturnType<typeof vi.fn>;
  diag: ReturnType<typeof vi.fn>;
  onAcquired?: () => void | Promise<void>;
  onLost?: (cause: string) => void;
}
export function createLeaseStub(
  over: Partial<LeaseStub> = {},
  deps: { repo?: { setLeaseOwner(o: string | null): void }; spool?: { setOwner(o: string): void } } = {},
): LeaseStub {
  const stub: LeaseStub = {
    isServing: vi.fn(() => true),
    tryAcquireFast: vi.fn(async () => {
      deps.repo?.setLeaseOwner?.('stub-owner-1');    // V1 契约三件套之①②——与真实现 onHeld 同序
      deps.spool?.setOwner('stub-owner-1');
      await stub.onAcquired?.();                     // ③
      return true;
    }),
    acquireLoop: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    halt: vi.fn(() => {}),
    diag: vi.fn(async () => ({ state: 'held', owner: 'stub-owner-1', holder: 'stub-owner-1', epoch: '1', renewedAt: new Date(), statementFailed: false })),
    ...over,
  };
  return stub;
}
