// apps/api/src/modules/collab/collab.gateway.env.spec.ts
// 批3-4 env 接线：COLLAB_DEBOUNCE（dev 1000/prod 2000）+ maxDebounce ≤ debounce×1.5 +
// COLLAB_TIMEOUT（双语义：同一值驱动握手超时+检查周期）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollabGateway, resolveCollabDebounce } from './collab.gateway';
import { describe, it, expect, afterEach, vi } from 'vitest';

afterEach(() => vi.unstubAllEnvs());

function buildGateway(opts?: { debounce?: number; timeout?: number }) {
  return new CollabGateway(
    {} as any, new EventEmitter2() as any, {} as any, { syncFromPeers: vi.fn(async () => {}) } as any,
    { resolve: vi.fn() } as any,
    48000 + Math.floor(Math.random() * 4000),
    opts?.debounce, opts?.timeout,
  );
}

describe('批3-4 COLLAB_DEBOUNCE 接线', () => {
  it('显式注入值优先（测试缝——collab.gateway.spec 用 300）', () => {
    expect(resolveCollabDebounce(300)).toBe(300);
    expect(buildGateway({ debounce: 300 }).server.configuration.debounce).toBe(300);
  });

  it('env COLLAB_DEBOUNCE 覆盖缺省', () => {
    vi.stubEnv('COLLAB_DEBOUNCE', '800');
    expect(resolveCollabDebounce()).toBe(800);
  });

  it('缺省 dev 1000 / prod(含 test) 2000（原硬编码 5000 收紧——debounce×5 的丢失窗口）', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(resolveCollabDebounce()).toBe(1000);
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveCollabDebounce()).toBe(2000);
  });

  it('maxDebounce ≤ debounce×1.5 写死（防漏配——maxDebounce 独立配置则连续编辑下窗口仍为旧 maxDebounce）', () => {
    const g300 = buildGateway({ debounce: 300 });
    expect(g300.server.configuration.maxDebounce).toBe(Math.ceil(300 * 1.5));
    const gDefault = buildGateway();   // NODE_ENV=test → 2000
    expect(gDefault.server.configuration.debounce).toBe(2000);
    expect(gDefault.server.configuration.maxDebounce).toBe(3000);
  });
});

describe('批3-4 COLLAB_TIMEOUT 接线', () => {
  it('显式注入值优先（用例注入小值测 60s 死线的缝）', () => {
    expect(buildGateway({ timeout: 1500 }).server.configuration.timeout).toBe(1500);
  });

  it('env COLLAB_TIMEOUT 覆盖缺省；缺省 30000（库默认）', () => {
    vi.stubEnv('COLLAB_TIMEOUT', '1234');
    expect(buildGateway().server.configuration.timeout).toBe(1234);
    vi.stubEnv('COLLAB_TIMEOUT', '');
    expect(buildGateway().server.configuration.timeout).toBe(30000);
  });
});
