// apps/api/src/modules/collab/worker-scope-token.ts
// T13（plan v11.2 ①）：worker 写通道作用域令牌——HMAC 绑定 projectId+intentRowId+execSeq+exp。
// 分层：静态 WORKER_WRITE_TOKEN=传输层 bearer（防随机公网打点——worker-write-auth.guard 既有职责
// 不变）；本令牌=逐请求能力凭据（谁铸造=worker 在 claim 返回面拿到 intentRowId+execSeq 处——
// execution.service/ai-image-edit processor/lighting consumer 的写调用点；签名密钥自静态 token
// 派生〔域分隔 sha256〕，轮换静态 token 即令全部在飞作用域令牌失效——exp=claim lease 量级可接受）。
// 载体选型=header `x-worker-scope`：bearer 承担传输身份、scope 承担能力语义——凭据不混入
// write-batch body（{projectId,ops} 契约面不变，validateWriteBatch 零感知）；验签在端点侧
// （collab-write.controller）经本模块纯函数完成。
// 裸项目档（intentRowId=''）：pre-claim 断言路径（PLAN_MISSING/claim 抛错的 error 投影）无 intent 行
// 可绑——仅绑 projectId+exp；writeNodeData（资金交付面）禁用裸档（端点侧 WORKER_SCOPE_LEVEL 403）。
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** scope 令牌专属 header（bearer 仍是 authorization——两层凭据互不混装）。 */
export const WORKER_SCOPE_HEADER = 'x-worker-scope';
/** exp=claim lease 量级（BullMQ lockDuration 60s 同数量级；上界须覆盖端口内部重试预算
 *  4 次×(10s 请求上界+退避)≈45s——120s 余量充分且仍为分钟级短命凭据）。 */
export const WORKER_SCOPE_TTL_MS = 120_000;
const WORKER_SCOPE_VERSION = 'v1';

/** 令牌载荷（wire 形态——短键省头字节；execSeq 一律 string〔BigInt wire 纪律——manifest EXEC_STATUS_KEYS 同款〕）。 */
export interface WorkerScopePayload {
  /** projectId（必绑——伪造他 project 即 403 的判据单源）。 */
  p: string;
  /** intentRowId（空串=裸项目档——见文件头注；非空=全档）。 */
  i: string;
  /** execSeq wire string（全档必非空——端点侧与 intent 行 execSeq BigInt 严格比对）。 */
  s: string;
  /** exp（epoch ms）。 */
  x: number;
}

/** 铸造侧上下文（intentRowId/execSeq 缺省=裸项目档）。execSeq 接受 BigInt（claim 返回面直接传）。 */
export interface WorkerWriteScope {
  intentRowId?: string;
  execSeq?: string | bigint;
}

/** 签名密钥派生（域分隔——静态 token 本体不直接进 HMAC；同静态 token 双进程同派生=验签单源）。 */
export function deriveWorkerScopeSecret(workerWriteToken: string): Buffer {
  return createHash('sha256').update(`flowweb:worker-scope:${WORKER_SCOPE_VERSION}:`).update(workerWriteToken).digest();
}

export function mintWorkerScopeToken(
  workerWriteToken: string,
  projectId: string,
  scope: WorkerWriteScope = {},
  nowMs: () => number = Date.now,
  ttlMs: number = WORKER_SCOPE_TTL_MS,
): string {
  const payload: WorkerScopePayload = {
    p: projectId,
    i: scope.intentRowId ?? '',
    s: scope.execSeq != null ? String(scope.execSeq) : '',
    x: nowMs() + ttlMs,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', deriveWorkerScopeSecret(workerWriteToken)).update(body).digest().toString('base64url');
  return `${WORKER_SCOPE_VERSION}.${body}.${sig}`;
}

export type WorkerScopeVerifyResult =
  | { ok: true; payload: WorkerScopePayload }
  | { ok: false; reason: 'missing' | 'malformed' | 'bad-signature' | 'expired' };

export function verifyWorkerScopeToken(
  workerWriteToken: string,
  token: string | undefined,
  nowMs: () => number = Date.now,
): WorkerScopeVerifyResult {
  if (!token) return { ok: false, reason: 'missing' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== WORKER_SCOPE_VERSION || !parts[1] || !parts[2]) {
    return { ok: false, reason: 'malformed' };
  }
  const expected = createHmac('sha256', deriveWorkerScopeSecret(workerWriteToken)).update(parts[1]).digest();
  let got: Buffer;
  try {
    got = Buffer.from(parts[2], 'base64url');
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { ok: false, reason: 'bad-signature' };
  let payload: WorkerScopePayload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as WorkerScopePayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.p !== 'string' || payload.p === ''
    || typeof payload.i !== 'string' || typeof payload.s !== 'string' || typeof payload.x !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.i === '' && payload.s !== '') return { ok: false, reason: 'malformed' };   // 裸档禁携 execSeq
  if (payload.i !== '' && (payload.s === '' || !/^\d+$/.test(payload.s))) return { ok: false, reason: 'malformed' };
  if (payload.x < nowMs()) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}
