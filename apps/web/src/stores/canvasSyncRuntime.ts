// apps/web/src/stores/canvasSyncRuntime.ts
// 画布自动保存运行时（spec: canvas-autosave-design.md D1/D2/D3）。
// ⚠️ 循环依赖裁定（同 canvasHistoryRuntime.ts）：本模块顶层 import canvasStore/canvasHistoryRuntime
//    仅限 import 声明与函数定义，严禁顶层访问其值。canvasHistoryRuntime 反向 import 本模块
//    scheduleSync——双向均为调用点求值，ESM 安全。
import isEqual from 'fast-deep-equal';
import { message } from 'antd';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { pickStructNodes, pickStructEdges } from './canvasHistory';
import { withHistoryPaused, hydrateLoaded } from './canvasHistoryRuntime';
import { syncCanvas } from '@/api/projectApi';
import { apiFetch } from '@/api/client';
import { hydrateNodes } from '@/utils/nodeOrder';

export const AUTO_SAVE_DELAY_MS = 2000;
export const UNDO_SYNC_DELAY_MS = 300;
const FLUSH_RETRY_DELAY_MS = 500;
/** keepalive fetch body 上限约 64KB，超限退化依赖 localStorage 快照兜底 */
const KEEPALIVE_BODY_LIMIT = 60000;

let autoTimer: ReturnType<typeof setTimeout> | null = null;
let dirtyEpoch = 0;

/** 在途保存互斥：并发 doSave 排队串行执行（防双 PUT 同 version 假 409） */
let inFlight: Promise<boolean> | null = null;

/** 同步载荷：canvasStore 结构为基准 + nodeStore data（原 canvasHistoryRuntime.buildSyncPayload 迁入） */
export function buildSyncPayload() {
  const cs = useCanvasStore.getState();
  const ns = useNodeStore.getState();
  return cs.nodes.map((nd) => ({
    id: nd.id,
    type: nd.type || 'videoGen',
    parentId: nd.parentId ?? null,
    position: nd.position,
    data: ns.nodes[nd.id]?.data ?? nd.data,
    width: nd.width,
    height: nd.height,
  }));
}

function clearTimer() {
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
}

/** 调度自动保存：窗口内重复调用合并（trailing debounce），dirty 即时置位供指示器显示 */
export function scheduleSync(delayMs = AUTO_SAVE_DELAY_MS): Promise<void> {
  const pid = useCanvasStore.getState().projectId;
  if (!pid) return Promise.resolve();
  dirtyEpoch++;
  useCanvasStore.setState({ saveStatus: 'dirty' });
  clearTimer();
  return new Promise((resolve) => {
    autoTimer = setTimeout(() => {
      autoTimer = null;
      // H-1：窗口内可能已切换项目——重读校验，防旧 timer 用新状态写旧项目
      const cur = useCanvasStore.getState();
      if (cur.projectId !== pid || cur.isHydrating) { resolve(); return; }
      doSave().then(() => resolve());
    }, delayMs);
  });
}

function reschedule(pid: string) {
  clearTimer();
  autoTimer = setTimeout(() => {
    autoTimer = null;
    const cur = useCanvasStore.getState();
    if (cur.projectId !== pid || cur.isHydrating) return;
    void doSave();
  }, AUTO_SAVE_DELAY_MS);
}

/** 串行化保存：并发调用（debounce 触发/flush/重试）排队执行，后到者在前者结算后
 *  用最新 payload+version 再保存——避免双 PUT 同 version 假 409 触发重载丢本地编辑。
 *  完成路径校验 projectId 未变，防止在途保存污染切换后新项目的状态。 */
function doSave(): Promise<boolean> {
  const prev = inFlight;
  const run = (async (): Promise<boolean> => {
    if (prev) await prev.catch(() => {});
    const cs = useCanvasStore.getState();
    const pid = cs.projectId;
    // 'error' 放行：flush 重试路径需要（debounce 路径不经过此处）
    if (!pid || (cs.saveStatus !== 'dirty' && cs.saveStatus !== 'error')) return true;
    const epoch = dirtyEpoch;
    useCanvasStore.setState({ saveStatus: 'saving' });
    try {
      const latest = useCanvasStore.getState();
      const res = await syncCanvas(pid, {
        nodes: buildSyncPayload(),
        edges: latest.edges as any,
        version: latest.serverVersion,
      });
      if (useCanvasStore.getState().projectId !== pid) return true;
      if (dirtyEpoch !== epoch) {
        // 保存期间又有变更：version 已推进，保持 dirty 重新调度
        useCanvasStore.setState({ serverVersion: res.version, saveStatus: 'dirty' });
        reschedule(pid);
      } else {
        useCanvasStore.setState({ serverVersion: res.version, saveStatus: 'saved' });
      }
      return true;
    } catch (err: any) {
      if (err?.status === 409) {
        await reloadFromServer(pid);
        return true;
      }
      console.error('[canvasSync] save failed', err);
      if (useCanvasStore.getState().projectId !== pid) return true;
      useCanvasStore.setState({ saveStatus: 'error' });
      return false;
    }
  })();
  inFlight = run;
  void run.finally(() => { if (inFlight === run) inFlight = null; });
  return run;
}

/** 409 冲突重载：复用 loadProjectIntoStore 的 hydrate 模式（withHistoryPaused + 清历史，防 undo 栈污染） */
async function reloadFromServer(pid: string) {
  try {
    const project = await apiFetch<any>(`/projects/${pid}`);
    if (useCanvasStore.getState().projectId !== pid) return; // 切换中：放弃陈旧重载
    useCanvasStore.getState().setHydrating(true);
    withHistoryPaused(() => {
      useCanvasStore.setState({
        nodes: hydrateNodes((project.nodes || []).map((n: any) => ({
          ...n, width: n.width ?? undefined, height: n.height ?? undefined,
        }))) as any,
        edges: (project.edges || []).map((e: any) => ({
          id: e.id, source: e.sourceId || e.source, target: e.targetId || e.target,
        })),
        serverVersion: project.version ?? 0,
        saveStatus: 'saved',
      });
      useCanvasStore.getState().applyGroupDerivations();
      refitExpandedGroups();
      const content: Record<string, any> = {};
      for (const n of project.nodes || []) {
        content[n.id] = {
          id: n.id, type: n.type, position: n.position || { x: 0, y: 0 },
          data: n.data || {}, width: n.width ?? undefined, height: n.height ?? undefined,
        };
      }
      useNodeStore.setState({ nodes: content });
    });
    hydrateLoaded();
    useCanvasStore.getState().setHydrating(false);
    message.warning('画布已被他人修改，已加载最新版本');
  } catch (err) {
    console.error('[canvasSync] 409 reload failed', err);
    useCanvasStore.setState({ saveStatus: 'error' });
  }
}

/** P0-4：展开态普通组按子节点包围盒重算（page.tsx loadProjectIntoStore 同语义，提取共用） */
export function refitExpandedGroups() {
  for (const g of useCanvasStore.getState().nodes.filter(
    (n) => n.type === 'group' && (n.data as any).groupType === 'normal'
      && !(n.data as any).collapsed && !(n.data as any).manuallyResized,
  )) {
    useCanvasStore.getState().refitGroupBounds(g.id);
  }
}

/** 立即 flush（跳过 debounce）。守卫放行 dirty 与 error（error 是重试按钮路径）。
 *  execute：失败 500ms 后重试 1 次，仍失败 toast 放行（spec D-a）
 *  retry：error 态指示器点击，单次尝试无 toast（失败保持 error 由指示器反馈）
 *  template：模板保存前，单次尝试，失败返回 false 由调用方阻断提交
 *  返回 true = 已保存/无需保存，false = 失败 */
export async function flushCanvasSync(reason: 'execute' | 'retry' | 'template'): Promise<boolean> {
  clearTimer();
  if (inFlight) await inFlight; // 在途保存（saving 态）：等结算再判定，防 template/execute 在旧数据上放行
  const cs = useCanvasStore.getState();
  if (!cs.projectId || (cs.saveStatus !== 'dirty' && cs.saveStatus !== 'error')) return true;
  if (reason === 'retry' || reason === 'template') return doSave();
  const ok = await doSave();
  if (ok) return true;
  await new Promise((r) => setTimeout(r, FLUSH_RETRY_DELAY_MS));
  const ok2 = await doSave();
  if (!ok2 && useCanvasStore.getState().saveStatus === 'error') {
    message.warning('保存失败，生成将使用上次保存的参数');
  }
  return ok2;
}

/** pagehide 兜底：keepalive fetch（同源 cookie 自动携带；无法感知结果，接受 localStorage 快照兜底） */
export function flushOnUnload(): void {
  const cs = useCanvasStore.getState();
  if (!cs.projectId || cs.saveStatus !== 'dirty') return;
  const body = JSON.stringify({
    nodes: buildSyncPayload(),
    edges: cs.edges,
    version: cs.serverVersion,
  });
  if (body.length > KEEPALIVE_BODY_LIMIT) {
    console.warn('[canvasSync] unload payload 超过 keepalive 限制，跳过（依赖 localStorage 快照兜底）');
    return;
  }
  fetch(`/api/projects/${cs.projectId}/canvas`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body,
  }).catch(() => {});
}

/** 订阅双 store 判脏（spec D1 矩阵：结构/data→dirty；nodeProcessMap/瞬态/isHydrating→不 dirty） */
export function bindCanvasSync(): () => void {
  const unsubCs = useCanvasStore.subscribe((state, prev) => {
    if (state.isHydrating || prev.isHydrating) return;
    if (state.projectId !== prev.projectId) return;
    const changed = !isEqual(pickStructNodes(state.nodes), pickStructNodes(prev.nodes))
      || !isEqual(pickStructEdges(state.edges), pickStructEdges(prev.edges));
    if (changed) void scheduleSync();
  });
  const unsubNs = useNodeStore.subscribe((state, prev) => {
    if (useCanvasStore.getState().isHydrating) return;
    if (state.nodes !== prev.nodes) void scheduleSync();
  });
  return () => { unsubCs(); unsubNs(); };
}
