import { createHash } from 'node:crypto';
import { EXEC_DEFAULTS } from '../../config/env';

/** Y0b-2 T1（Z82）：idemKey=内容+手势幂等键（sha256）——claim 唯一判据（findUnique({where:{idemKey}})）。
 *  join('|') 无注入：token 是末段且前置字段（cuid/uuid/kind/hex 哈希）均不含 '|'，token 位带 regen: 前缀
 *  ⇒ 结构性无碰撞（token 内含 '|' 只改变末段内容，不产生跨字段重组）。 */
export function deriveIdemKey(input: { projectId: string; nodeId: string; kind: string; paramsHash: string; regenToken?: string }): string {
  return createHash('sha256')
    .update([input.projectId, input.nodeId, input.kind, input.paramsHash,
             input.regenToken ? `regen:${input.regenToken}` : 'run'].join('|')).digest('hex');
}

/** token 上限（Z79）：gestureKey 是客户端可控无界字符串——超长截断+warn 非 400（T1 的 DTO 还是
 *  intentId 位不能破兼容；T6 转严格 400）。非法字符仅剥 NUL（'|' 无害见上）。 */
const GESTURE_TOKEN_MAX = 128;

export function normalizeRegenToken(
  raw: string | undefined | null,
  warn: (msg: string) => void,
): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.replace(/\0/g, '').trim();
  if (!trimmed) return undefined;
  if (trimmed.length > GESTURE_TOKEN_MAX) {
    warn(`gestureToken 超长（${trimmed.length}）——截断至 ${GESTURE_TOKEN_MAX}（T6 转严格 400）`);
    return trimmed.slice(0, GESTURE_TOKEN_MAX);
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
