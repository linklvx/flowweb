export const AUTOSAVE_DEBOUNCE_MS = 1500;
const RETRY_DELAYS_MS = [1000, 4000, 16000];

export interface AutosaveDeps {
  getProjectId: () => string;
  patch: (id: string, body: { data: unknown; baseUpdatedAt: string }) => Promise<{ updatedAt: string }>;
  getData: () => { data: unknown; baseUpdatedAt: string };
  onSaved: (updatedAt: string) => void;
  onStateChange: (s: 'saving' | 'saved' | 'error') => void;
  onConflict: () => void;
  /** B4 单向 latch 镜像（批0d）：true=有未落库编辑（notifyChange 置位）；仅保存成功清 false
   *  （请求中/409/退避耗尽三窗口保持 true——beforeunload 据此拦截关标签）。F3：PATCH 走 REST
   *  独立于 WS 连接态，无 isConnected 门——connStatus 卡 connecting 不再停摆编辑器持久化 */
  onDirtyChange?: (dirty: boolean) => void;
}

export interface AutosaveController {
  notifyChange(): void;
  /** 收起/ESC 用：立即执行排队保存并 await 排空；false=有数据未能排空（最终失败/409 未恢复） */
  flush(): Promise<boolean>;
  /** SAVE_DOT error 手动重试：无条件补发当前 data（dirty 与否都发），退避额度重置 */
  retry(): void;
  /** 批6：外部查询有无未保存工作——dirty/inFlight/queued/防抖 timer/latch 任一即真 */
  hasPendingWork(): boolean;
  dispose(): void;
}

export function createAutosaveController(deps: AutosaveDeps): AutosaveController {
  let dirty = false;
  let inFlight = false;
  let queued = false;
  let retryCount = 0;
  let disposed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // B4 单向 latch：内部 dirty 是排队补发判据（发请求前即清），latch 才是"有未落库编辑"镜像——
  // 仅成功路径清零，请求中/409/退避耗尽三窗口全保持 true（flush/beforeunload 拦截判据）
  let dirtyLatch = false;
  const onDirtyChanged = (v: boolean) => { dirtyLatch = v; deps.onDirtyChange?.(v); };

  const clearDebounce = () => {
    if (debounceTimer != null) { clearTimeout(debounceTimer); debounceTimer = null; }
  };

  const doSave = async (): Promise<void> => {
    if (inFlight || disposed) { queued = true; return; }
    inFlight = true;
    dirty = false;
    deps.onStateChange('saving');
    try {
      const body = deps.getData(); // 批0d：入 try——getData 抛错时 finally 仍执行（inFlight 复位），防 flush 每 10ms 自旋假死
      const r = await deps.patch(deps.getProjectId(), body);
      deps.onSaved(r.updatedAt); // 回填 baseUpdatedAt
      onDirtyChanged(false); // latch 唯一清零点：恰在成功路径
      deps.onStateChange('saved');
      retryCount = 0;
    } catch (e) {
      if ((e as { status?: number })?.status === 409) {
        deps.onConflict(); // 他处修改：停止自动保存（半自动恢复留给用户）
        dirty = false;
        deps.onStateChange('error');
      } else if (retryCount < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[retryCount++];
        deps.onStateChange('error'); // 重试期间状态点保持红
        debounceTimer = setTimeout(() => { debounceTimer = null; void doSave(); }, delay);
      } else {
        deps.onStateChange('error'); // 3 次退避后停（红点可手动重试 = retry）
      }
    } finally {
      inFlight = false;
    }
    if ((queued || dirty) && !disposed && debounceTimer == null) {
      queued = false;
      void doSave(); // latest-wins：排队改动用最新 data 补发
    }
  };

  return {
    notifyChange: () => {
      if (disposed) return;
      onDirtyChanged(true); // latch 置位——编辑发生即"未落库"（含防抖/在途窗口）
      dirty = true;
      clearDebounce();
      debounceTimer = setTimeout(() => { debounceTimer = null; void doSave(); }, AUTOSAVE_DEBOUNCE_MS);
    },
    retry: () => {
      if (disposed || inFlight) return;
      retryCount = 0; // 重置退避——用户显式重试获得完整 3 次额度
      clearDebounce();
      void doSave(); // 无条件补发当前 data（dirty 与否都发——409 后重弹 toast 与"半自动恢复"语义一致）
    },
    flush: async (): Promise<boolean> => {
      if (disposed) return false;
      clearDebounce();
      while (dirty || queued || inFlight || debounceTimer != null) {
        if (!inFlight && debounceTimer == null) {
          await doSave(); // 无退避在途才主动发（不绕退避——review 残留）
        } else {
          await new Promise(r => setTimeout(r, 10)); // 在途/退避 timer 走着——等它自然执行
        }
      }
      return !dirtyLatch; // B4：latch 判据（409/耗尽不清⇒拦截；成功清⇒放行）
    },
    dispose: () => {
      disposed = true;
      clearDebounce();
    },
    hasPendingWork: () => dirty || inFlight || queued || debounceTimer != null || dirtyLatch,
  };
}
