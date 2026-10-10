import { createHash } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { EXEC_DEFAULTS } from '../../config/env';

/** Y0b-2 T1（Z82）：idemKey=内容+手势幂等键（sha256）——claim 唯一判据（findUnique({where:{idemKey}})）。
 *  join('|') 无注入：token 是末段且前置字段（cuid/uuid/kind/hex 哈希）均不含 '|'，token 位带 regen: 前缀
 *  ⇒ 结构性无碰撞（token 内含 '|' 只改变末段内容，不产生跨字段重组）。 */
export function deriveIdemKey(input: { projectId: string; nodeId: string; kind: string; paramsHash: string; regenToken?: string }): string {
  return createHash('sha256')
    .update([input.projectId, input.nodeId, input.kind, input.paramsHash,
             input.regenToken ? `regen:${input.regenToken}` : 'run'].join('|')).digest('hex');
}

/** Y0b-2 T6（Z79）转严格 400：形态校验 ^[0-9a-zA-Z_-]{8,64}$——非法 throw IDEMPOTENCY_TOKEN_INVALID
 *  （T1 的截断+warn 过渡退役：静默截断=客户端 bug 被吞、idemKey 与 gestureKey 漂移两键）。
 *  空白/null → undefined（无 token=普通执行，内容键路径合法形态）。crypto.randomUUID()（36 位）天然合法。 */
const GESTURE_TOKEN_RE = /^[0-9a-zA-Z_-]{8,64}$/;

export function normalizeRegenToken(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (!GESTURE_TOKEN_RE.test(trimmed)) {
    throw new BusinessException(
      'IDEMPOTENCY_TOKEN_INVALID',
      `regenToken 形态非法（须 8-64 位 [0-9a-zA-Z_-]，收到长度 ${trimmed.length}）`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return trimmed;
}

/** kind→deadline 常量映射（Z68）：env 字面量直读（EXEC_DEADLINE_*）+EXEC_DEFAULTS 兜底单源。
 *  未知 kind 走 EDIT 档（保守短档——fail-loud 归 claim 白名单上游 normalizeIntentParams）。 */
export function deadlineMsForKind(kind: string): number {
  const env = (v: string | undefined, d: number) => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) && n >= 1000 ? n : d;
  };
  switch (kind) {
    case 'text': return env(process.env.EXEC_DEADLINE_TEXT_MS, EXEC_DEFAULTS.DEADLINE_TEXT);
    case 'image': return env(process.env.EXEC_DEADLINE_IMAGE_MS, EXEC_DEFAULTS.DEADLINE_IMAGE);
    case 'video': return env(process.env.EXEC_DEADLINE_VIDEO_MS, EXEC_DEFAULTS.DEADLINE_VIDEO);
    case 'outpaint': case 'erase': case 'redraw': return env(process.env.EXEC_DEADLINE_EDIT_MS, EXEC_DEFAULTS.DEADLINE_EDIT);
    case 'lighting': return env(process.env.EXEC_DEADLINE_LIGHTING_MS, EXEC_DEFAULTS.DEADLINE_LIGHTING);
    default: return env(process.env.EXEC_DEADLINE_EDIT_MS, EXEC_DEFAULTS.DEADLINE_EDIT);
  }
}
