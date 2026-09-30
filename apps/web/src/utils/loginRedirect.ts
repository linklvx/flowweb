// apps/web/src/utils/loginRedirect.ts
/** 批2-3（v5.10 前移自批 6）：登录跳转收口——next 白名单透传（防 open redirect），
 *  非白名单/外链/异常回落 /works。五处裸跳转（login/register 页、RequireAuth/RequireAdmin、
 *  CanvasTopBar）的唯一真相源。白名单前缀集 = router.tsx 登录后可达的用户路由。 */
const ALLOWED_PREFIXES = ['/canvas', '/works', '/team', '/materials', '/templates', '/settings', '/join', '/videos'];

export function loginUrl(returnTo?: string): string {
  const target = returnTo ?? location.pathname + location.search;
  return `/login?next=${encodeURIComponent(target)}`;
}

export function resolvePostLoginTarget(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/works'; // 外链/协议相对//拒绝
  const path = next.split('?')[0];
  return ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(p + '/')) ? next : '/works';
}
