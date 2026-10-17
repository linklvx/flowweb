// apps/api/src/modules/collab/collab-limits.spec.ts
// R4b'（v3）：limits 派生契约——fail-fast 三校验+2MiB 下限+ALLOWANCE 余量+满帧算术。
// 红相：模块不存在 import 失败（元纪律⑥——「pass 0 fail 1」落档）。
// v2：入参收窄 Pick（QUOTA_DEFAULTS 无 msgRate/bytesRate——QuotaConfig 四键形态 TS2345 根除）。
import { describe, it, expect } from 'vitest';
import { QUOTA_DEFAULTS, FRAME_ALLOWANCE_BYTES } from '@flowweb/shared';
import {
  WS_MAX_PAYLOAD_BYTES, BACKPRESSURE_DROP_BYTES, OUTBOUND_BUDGET_BYTES,
  deriveCollabLimits, DEFAULT_COLLAB_LIMITS,
} from './collab-limits';
import type { QuotaConfig } from './collab-doc-registry.service';

// v3 勘正：入参型用 QuotaConfig（number 宽型——collab-quota-config.spec.ts:30 同款惯例），
// 勿用 typeof QUOTA_DEFAULTS（as const 字面量型——number 不可赋给 8388608，tsconfig.scripts 红）。
const q = (o: Partial<Pick<QuotaConfig, 'maxDocBytes' | 'maxTxBytes'>>) => ({ ...QUOTA_DEFAULTS, ...o });

describe('R4b\' collab-limits 派生契约', () => {
  it('常量族单源值：maxPayload 16MiB（自 factory:68 迁入）/drop 1MiB（自 SG:62 迁入）/budget 100,663,296B=96MiB（v3: 64→96——10 人×8MB 扇出 80.6<96；字面量=check-ecosystem 提取式兼容）', () => {
    expect(WS_MAX_PAYLOAD_BYTES).toBe(16_777_216);
    expect(BACKPRESSURE_DROP_BYTES).toBe(1_048_576);
    expect(OUTBOUND_BUDGET_BYTES).toBe(100_663_296);
  });

  it('默认档：close = 2×ss2Gate + ALLOWANCE = 16,973,824（满帧×2+ack 不误杀——v3 余量）+预算联动通过', () => {
    const l = DEFAULT_COLLAB_LIMITS;
    expect(l.ss2FrameGate).toBe(QUOTA_DEFAULTS.maxDocBytes + FRAME_ALLOWANCE_BYTES);
    expect(l.backpressureCloseBytes).toBe(2 * l.ss2FrameGate + FRAME_ALLOWANCE_BYTES);
    expect(l.backpressureCloseBytes).toBe(16_973_824);
    expect(l.backpressureCloseBytes).toBeLessThanOrEqual(l.outboundBudgetBytes / 2);
    expect(l.bytesBucketCapacity).toBe(l.ss2FrameGate);   // B8 先例形态平移（T8 裁定 24⑵ 不变量）
  });

  it('小配额档：close=2MiB 下限 > drop=1MiB（close<drop 反转根修——B17 夹具族形态）', () => {
    for (const maxDoc of [2_048, 8_192, 40_000]) {
      const l = deriveCollabLimits(q({ maxDocBytes: maxDoc }));
      expect(l.backpressureCloseBytes).toBe(2 * BACKPRESSURE_DROP_BYTES);
      expect(l.backpressureCloseBytes).toBeGreaterThan(l.backpressureDropBytes);
    }
  });

  it('fail-fast ①：ss2Gate > maxPayload 抛错（16MiB doc 档——走本分支；B6 footgun 根修）', () => {
    expect(() => deriveCollabLimits(q({ maxDocBytes: 16 * 1024 * 1024 }))).toThrow();
  });

  it('fail-fast ②：2×maxTxBytes > maxPayload 抛错（maxTx=10MiB 档）', () => {
    expect(() => deriveCollabLimits(q({ maxTxBytes: 10 * 1024 * 1024 }))).toThrow();
  });

  it('fail-fast ③：close > budget/2 抛错（注入小 budget——默认档 close 16,973,824 > 2.5MiB）', () => {
    expect(() => deriveCollabLimits(q({}), 5 * 1024 * 1024)).toThrow();
  });

  it('满帧边界算术：两满帧+一 ack 投影 ≤ close（前瞻判定语义自洽）', () => {
    const l = DEFAULT_COLLAB_LIMITS;
    const full = l.ss2FrameGate;
    expect(2 * full + 64).toBeLessThanOrEqual(l.backpressureCloseBytes);
  });
});
