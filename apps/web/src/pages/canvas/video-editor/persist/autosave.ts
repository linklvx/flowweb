export const AUTOSAVE_DEBOUNCE_MS = 1500;
const RETRY_DELAYS_MS = [1000, 4000, 16000];

export interface AutosaveDeps {
  getProjectId: () => string;
  patch: (id: string, body: { data: unknown; baseUpdatedAt: string }) => Promise<{ updatedAt: string }>;
  getData: () => { data: unknown; baseUpdatedAt: string };
  onSaved: (updatedAt: string) => void;
  onStateChange: (s: 'saving' | 'saved' | 'error') => void;
  onConflict: () => void;
  isConnected: () => boolean;
}

export interface AutosaveController {
  notifyChange(): void;
  /** 协作连接恢复 connected 时调用：有待存数据立即补发 */
  notifyConnected(): void;
  /** 收起/ESC 用：立即执行排队保存并 await 排空 */
  flush(): Promise<void>;
  dispose(): void;
}

export function createAutosaveController(deps: AutosaveDeps): AutosaveController {
  let dirty = false;
  let inFlight = false;
  let queued = false;
  let retryCount = 0;
  let disposed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const clearDebounce = () => {
    if (debounceTimer != null) { clearTimeout(debounceTimer); debounceTimer = null; }
  };

  const doSave = async (): Promise<void> => {
    if (inFlight || disposed) { queued = true; return; }
    if (!deps.isConnected()) return; // 离线暂停——notifyConnected 恢复
    inFlight = true;
    dirty = false;
    deps.onStateChange('saving');
    const body = deps.getData();
    try {
      const r = await deps.patch(deps.getProjectId(), body);
      deps.onSaved(r.updatedAt); // 回填 baseUpdatedAt
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
        deps.onStateChange('error'); // 3 次退避后停（红点可手动重试 = flush）
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
      dirty = true;
      clearDebounce();
      debounceTimer = setTimeout(() => { debounceTimer = null; void doSave(); }, AUTOSAVE_DEBOUNCE_MS);
    },
    notifyConnected: () => {
      if (disposed) return;
      if (dirty || queued) { clearDebounce(); void doSave(); }
    },
    flush: async () => {
      if (disposed) return;
      clearDebounce();
      if (dirty || queued) await doSave();
      while (inFlight) await new Promise(r => setTimeout(r, 10)); // await 排空
    },
    dispose: () => {
      disposed = true;
      clearDebounce();
    },
  };
}
