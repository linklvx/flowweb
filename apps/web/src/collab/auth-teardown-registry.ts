// apps/web/src/collab/auth-teardown-registry.ts
// Y5 T7：他标签登出拆会话回调注册表——AuthProvider 的 storage 监听（bindLogoutEpochTeardown）
// 触发时先 setUser(null)，再调用画布注册的拆会话函数。本模块只为避免 AuthProvider import
// canvasCollabRuntime（认证组件不依赖协作运行时——分层同 mediaUrlCache/local-cache-key）。
// 单槽：画布页挂载注册、卸载解绑；回调内不写 session、不再次 bump epoch（职责在 AuthProvider）。
let teardown: (() => void) | null = null;

/** 画布页注册拆会话回调（返回解绑；仅当槽内仍是自己时才清——后挂载页覆盖先挂载页）。 */
export function registerCollabSessionTeardown(fn: () => void): () => void {
  teardown = fn;
  return () => {
    if (teardown === fn) teardown = null;
  };
}

/** storage 监听触发点调用：fail-soft（拆会话失败不得炸登出链）。 */
export function invokeCollabSessionTeardown(): void {
  try {
    teardown?.();
  } catch { /* 拆会话失败不阻断 setUser(null) 已完成的状态 */ }
}
