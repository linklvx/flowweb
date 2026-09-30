/**
 * 从 cookie 头解析 flowweb.session_token——session 提取谓词的唯一真相源
 * （收口前 5 处内联正则复制，漂移即鉴权绕过风险）。
 */
export function parseSessionToken(cookieHeader: string | null | undefined): string | null {
  return cookieHeader?.match(/flowweb\.session_token=([^;]+)/)?.[1] ?? null;
}
