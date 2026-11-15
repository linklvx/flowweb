// TD-32/C2 T17：listener 关闭让位单源（selfIsolate 与 listenCollab 后置失败同款；禁 server.destroy()
// ——4.8.0 destroyPromise ??= runDestroy() 记忆化污染后最终 shutdown 关不掉 re-listen 的新 listener）。
export interface ClosableHttpServer {
  closeAllConnections?: () => void;
  close: (cb: () => void) => void;
}

export function closeCollabListener(
  httpServer: ClosableHttpServer | null | undefined,
  onError?: (e: unknown) => void,
): Promise<void> {
  return new Promise<void>((res) => {
    try {
      httpServer?.closeAllConnections?.();   // Node≥18.2 清 keep-alive
      httpServer?.close(() => res());
      setTimeout(res, 2_000).unref?.();      // close 回调兜底
    } catch (e) {
      onError?.(e);
      res();
    }
  });
}
