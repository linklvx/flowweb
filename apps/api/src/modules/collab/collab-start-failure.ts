// TD-33/C1a T6 创建（TD-32/C2 扩展）：collab 启动失败面单源。
// isPortError 自 collab.gateway 迁入——gateway 只委托，GC 接线 +2 行由此抵消（锚净零纪律）。
export function isPortError(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === 'EADDRINUSE' || code === 'DOCS_NOT_UNLOADED' || /EADDRINUSE/i.test((e as Error)?.message ?? '');
}
