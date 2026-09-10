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
  /** 收起/ESC 用：立即执行排队保存并 await 排空；false=有数据未能排空（离线或最终失败） */
  flush(): Promise<boolean>;
  /** SAVE_DOT error 手动重试：无条件补发当前 data（dirty 与否都发），退避额度重置 */
  retry(): void;
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
      dirty = true;
      clearDebounce();
      debounceTimer = setTimeout(() => { debounceTimer = null; void doSave(); }, AUTOSAVE_DEBOUNCE_MS);
    },
    notifyConnected: () => {
      if (disposed) return;
      if (dirty || queued) { clearDebounce(); void doSave(); }
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
          if (!deps.isConnected()) return false; // 离线且有未保存数据——排空失败
          await doSave(); // 无退避在途才主动发（不绕退避——review 残留）
        } else {
          await new Promise(r => setTimeout(r, 10)); // 在途/退避 timer 走着——等它自然执行
        }
      }
      // retryCount===0：全部排空成功（成功路径清 0）；耗尽=最终失败——false 阻止关闭（数据留 editorStore）
      // 409 冲突放行（retryCount 不增，用户已收 toast——半自动恢复语义）
      return retryCount === 0;
    },
    dispose: () => {
      disposed = true;
      clearDebounce();
    },
  };
}
