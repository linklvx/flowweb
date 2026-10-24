// apps/api/src/modules/collab/collab-limits.ts
// R4b'（v3）：出站背压/帧闸派生契约单源——自 SG 常量族与 factory maxPayload 收敛（B16 单源化）。
// 三 fail-fast 校验=env footgun 根修（B6：COLLAB_MAX_DOC_BYTES 配 20MB 时应用层 4404 永不可达）。
// v2 勘正：maxTxBytes>maxDocBytes 不校验（tx=单事务上限/doc=内容配额，tx>doc 合法形态——B17 六夹具
// +drill 子进程经 app.module:46 validateEnv 会被 40KB/256KB 打死——env superRefine 方案同因撤销）。
// close 语义：前瞻判定 backlog+frame>close → 帧型分支执法（sync 前瞻 close/stateless 仅 backlog 判定
// /awareness 永 drop——v3 帧型四档已落档 collab-outbound-budget.ts）；+ALLOWANCE 余量=两满帧+ack 不误杀。
// OUTBOUND_BUDGET_BYTES 用字面量（check-ecosystem 提取式 [\d_]+ 不匹配乘式）。
import { QUOTA_DEFAULTS, FRAME_ALLOWANCE_BYTES, COLLAB_WS_MAX_PAYLOAD_BYTES } from '@flowweb/shared';
import type { QuotaConfig } from './collab-doc-registry.service';

// Y1c T9（偏离 38⑱）：WS maxPayload 16→9MiB——值单源=shared COLLAB_WS_MAX_PAYLOAD_BYTES
// （>SS2 帧闸 8.06MiB 恰容纳；16MiB 纯增攻击面）。再导出保既有 import 面（factory/census 消费方零触碰）。
export const WS_MAX_PAYLOAD_BYTES = COLLAB_WS_MAX_PAYLOAD_BYTES;   // 9_437_184
export const BACKPRESSURE_DROP_BYTES = 1_048_576;      // 自 collab-session-guard.service.ts:62 迁入
export const OUTBOUND_BUDGET_BYTES = 100_663_296;      // v3: 64→96MiB（10 人×8MB 扇出 80.6<96；折衷值非推导值——spec §6.4 登记）

export interface CollabLimits {
  ss2FrameGate: number;
  updateFrameGate: number;
  bytesBucketCapacity: number;
  backpressureDropBytes: number;
  backpressureCloseBytes: number;
  outboundBudgetBytes: number;
}

/** v2：入参收窄——limits 派生只消费 doc/tx 两量（QUOTA_DEFAULTS 无 msgRate/bytesRate 勿绑速率桶字段）。 */
export function deriveCollabLimits(q: Pick<QuotaConfig, 'maxDocBytes' | 'maxTxBytes'>, budget = OUTBOUND_BUDGET_BYTES): CollabLimits {
  const ss2FrameGate = q.maxDocBytes + FRAME_ALLOWANCE_BYTES;
  const updateFrameGate = 2 * q.maxTxBytes;
  if (ss2FrameGate > WS_MAX_PAYLOAD_BYTES) {
    throw new Error(`collab-limits: maxDocBytes(${q.maxDocBytes})+ALLOWANCE > ws maxPayload(${WS_MAX_PAYLOAD_BYTES})——应用层 4404 不可达（env COLLAB_MAX_DOC_BYTES 超界）`);
  }
  if (updateFrameGate > WS_MAX_PAYLOAD_BYTES) {
    throw new Error(`collab-limits: 2×maxTxBytes(${q.maxTxBytes}) > ws maxPayload(${WS_MAX_PAYLOAD_BYTES})——Update 闸形同虚设（env COLLAB_MAX_TX_BYTES 超界）`);
  }
  const backpressureCloseBytes = Math.max(2 * ss2FrameGate + FRAME_ALLOWANCE_BYTES, 2 * BACKPRESSURE_DROP_BYTES);
  if (backpressureCloseBytes > budget / 2) {
    throw new Error(`collab-limits: backpressureClose(${backpressureCloseBytes}) > outbound budget/2(${budget / 2})——预算与单连接上界失配`);
  }
  return { ss2FrameGate, updateFrameGate, bytesBucketCapacity: ss2FrameGate, backpressureDropBytes: BACKPRESSURE_DROP_BYTES, backpressureCloseBytes, outboundBudgetBytes: budget };
}

export const DEFAULT_COLLAB_LIMITS = deriveCollabLimits(QUOTA_DEFAULTS);
