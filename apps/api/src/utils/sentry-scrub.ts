// apps/api/src/utils/sentry-scrub.ts
// Y0b-5 T11：Sentry 接线三件——事件面 scrub（beforeSend）+release 来源（build-info.json）+collab capture 统一入口。
//
// 裁定背景（plan T11）：
// - csv/cb 白名单保留：WS 无法设自定义头，URL query 是唯一通道；csv=版本门参数/cb=审计透传
//   （clientBuild 预留）——版本事故唯一线索，且非机密（仓库已公有）。
// - 偏离表登记：scrub 只护 Sentry 事件面，不护日志面——project id 非机密裁定，结构化日志保持原文。
// - release：pm2 剥 GIT_* 环境变量 ⇒ env 路恒 "unknown"（事故查不出对应提交）——改读部署链既有
//   产物 build-info.json（deploy.sh:194 {git,builtAt}，随 dist 分发）；缺失回落 package.json
//   version（本地 dev）→'unknown'。SENTRY_DSN 未设时 SDK 未 init，capture 全程 no-op 不阻塞。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Sentry from '@sentry/nestjs';

export const SCRUBBED = '[scrub]';

/** query 白名单：csv/cb 之外全部剥除（大小写敏感——URL 参数名惯例） */
const QUERY_WHITELIST = new Set(['csv', 'cb']);
/** 递归深上限（Sentry 事件对象可能巨大——限深防爆栈；配合 seen 集防循环引用） */
const SCRUB_MAX_DEPTH = 10;

/** 剥 query：保留 csv/cb 参数，其余全剥；非查询串形态（无 '?' 或 '?' 后无 k=v）原样返回 */
export function scrubQuery(s: string): string {
  const q = s.indexOf('?');
  if (q < 0) return s;
  const rest = s.slice(q + 1);
  const hashAt = rest.indexOf('#');
  const qs = hashAt < 0 ? rest : rest.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : rest.slice(hashAt);
  if (!qs.includes('=')) return s;   // 'what?' 类非查询串
  const kept = qs.split('&').filter((kv) => QUERY_WHITELIST.has(kv.slice(0, kv.indexOf('='))));
  return kept.length ? `${s.slice(0, q)}?${kept.join('&')}${hash}` : `${s.slice(0, q)}${hash}`;
}

/** 字符串值规则（键名判据）：token/query/cookie/authorization 键族=整值打码（值形态不可信——
 * cookie/authorization=HTTP 敏感头同族，session token 经 headers.cookie 泄漏正是 token 规则要防的形态）；
 * url 键与泛字符串=白名单剥 query（url 键值含 query ⇒ 保 csv/cb 剥其余——事故可查线索保留）。
 * docName=project:<id> 不含 ?=/token 模式——天然不误伤。 */
function scrubString(key: string, value: string): string {
  const k = key.toLowerCase();
  if (k.includes('token') || k.includes('query') || k.includes('cookie') || k.includes('authorization')) return SCRUBBED;
  return scrubQuery(value);
}

/** 递归值清洗：字符串按键规则；对象/数组逐层下钻（深上限+seen 防环——超限/回环整值 [scrub]）；其余原样 */
function scrubValue(value: unknown, key: string, depth: number, seen: Set<object>): unknown {
  if (typeof value === 'string') return scrubString(key, value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value) || depth >= SCRUB_MAX_DEPTH) return SCRUBBED;
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, key, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = scrubValue(v, k, depth + 1, seen);
  return out;
}

/** Sentry beforeSend 载荷：只清 extra/tags/request/breadcrumbs 四面（事件对象的敏感载荷面），
 *  其余字段（message/contexts/…）零触碰。就地改写并返回原事件（beforeSend 契约：返回值=发送事件）。 */
export function scrubEvent<T extends object>(event: T): T {
  const e = event as Record<string, unknown>;
  for (const face of ['extra', 'tags', 'request', 'breadcrumbs'] as const) {
    if (e[face] !== undefined) e[face] = scrubValue(e[face], face, 0, new Set());
  }
  return event;
}

/**
 * release 解析（单测可注入路径）：build-info.json.git（部署产物——deploy.sh:194）→
 * package.json.version（本地 dev）→ 'unknown'。文件缺失/坏 JSON 一律回落不抛（启动不阻塞）。
 * 运行时默认路径按本模块位置解析：prod=apps/api/dist/utils → ../build-info.json=dist 根 ✓；
 * dev=apps/api/src/utils → src 下无 build-info → package.json version。
 */
export function resolveSentryRelease(
  buildInfoPath: string = resolve(__dirname, '../build-info.json'),
  pkgPath: string = resolve(__dirname, '../../package.json'),
): string {
  try {
    const info = JSON.parse(readFileSync(buildInfoPath, 'utf-8')) as { git?: unknown };
    if (typeof info.git === 'string' && info.git) return info.git;
  } catch { /* 缺失/坏 JSON → 回落 */ }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version) return pkg.version;
  } catch { /* 缺失 → unknown */ }
  return 'unknown';
}

/** collab 关键 catch 统一入口：captureException+scope{docName,reason,connectionId}
 *  （connectionId 无连接上下文的后台路径用 '-'；SENTRY_DSN 未设=SDK 侧 no-op）。事件面禁抛。 */
export function captureCollabException(
  err: unknown,
  tags: { docName: string; reason: string; connectionId: string },
): void {
  try {
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), { tags });
  } catch { /* 事件面禁抛 */ }
}
