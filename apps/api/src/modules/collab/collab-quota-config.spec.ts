// apps/api/src/modules/collab/collab-quota-config.spec.ts
// Y0b-4 T2：quota 构造注入——env 默认（QUOTA_DEFAULTS/常量 fallback）+注入覆盖+parsePositiveInt
// 拒 0/NaN。Q-P 纪律：构造期一次读入 this.quota，运行期不再读 env；禁模块级测试钩子。
// 直构先例=collab-gateway.options.spec buildGateway（esbuild 无 decorator metadata——位置参数全传）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QUOTA_DEFAULTS } from '@flowweb/shared';
import { CollabGateway, parsePositiveInt, type QuotaConfig } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0b4-quota-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => spoolCleanup());

/** env 四键隔离（save/delete/restore）——防宿主环境泄漏干扰默认值断言 */
const QUOTA_ENV_KEYS = ['COLLAB_MAX_DOC_BYTES', 'COLLAB_MAX_TX_BYTES', 'COLLAB_MSG_RATE_PER_CONN', 'COLLAB_BYTES_RATE_PER_CONN'];
const savedEnv: Record<string, string | undefined> = {};   // Y0b-4 T3 顺手修：prefer-const（只 mutate 属性从不重赋）
beforeEach(() => { for (const k of QUOTA_ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

function buildGateway(opts?: { quota?: Partial<QuotaConfig> }): CollabGateway {
  return new CollabGateway(
    {} as any, new EventEmitter2() as any, {} as any, createLeaseStub() as any,
    { resolve: vi.fn() } as any,
    48000 + Math.floor(Math.random() * 4000),
    undefined, undefined, undefined, new CollabSpoolService(spoolDir),
    opts?.quota,
  );
}

describe('Y0b-4 T2：quota 构造注入+parsePositiveInt', () => {
  it('默认=QUOTA_DEFAULTS/常量 fallback（env 未设时构造期读入四值）', () => {
    expect(buildGateway()['quota']).toEqual({
      maxDocBytes: QUOTA_DEFAULTS.maxDocBytes,   // 8MB
      maxTxBytes: QUOTA_DEFAULTS.maxTxBytes,     // 256KB
      msgRate: 200,                              // COLLAB_MSG_RATE_PER_CONN 默认（常量非 QUOTA_DEFAULTS 域）
      bytesRate: 2_097_152,                      // COLLAB_BYTES_RATE_PER_CONN 默认 2MB/s（§4.1② 字节速率闸）
    });
  });

  it('quota 构造注入覆盖 env 默认；0/NaN 不静默吞（parsePositiveInt）', () => {
    const g = buildGateway({ quota: { maxDocBytes: 1024 } });
    expect(g['quota'].maxDocBytes).toBe(1024);
    expect(g['quota'].maxTxBytes).toBe(QUOTA_DEFAULTS.maxTxBytes);   // 未注入键维持默认
    expect(parsePositiveInt('0', 99)).toBe(99);   // 0 拒
    expect(parsePositiveInt('abc', 99)).toBe(99); // NaN 拒
    expect(parsePositiveInt('512', 99)).toBe(512); // 合法值直通
  });

  it('env 显式值优先于默认（构造期 parsePositiveInt 接线——msgRate/bytesRate 同族取一键代表）', () => {
    process.env.COLLAB_BYTES_RATE_PER_CONN = '1048576';
    const g = buildGateway();
    expect(g['quota'].bytesRate).toBe(1_048_576);
    expect(g['quota'].msgRate).toBe(200);   // 未设键不受邻居影响
  });
});
