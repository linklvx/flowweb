import { initCollab, initCollabLocal, destroyCollab, safeReload, type CollabSessionMeta } from '@/stores/canvasCollabRuntime';
// Y5 T10：项目请求失败后的离线分型（T9 纯函数）+ meta 两表读（session 证明/binding 元数据）。
import { decideOfflineRoute, type OfflineRouteInput } from './offline-route';
import { getSessionRows, getBindingRow, putBindingRow, putNameRow, buildYjsDbName, listNameRows, sweepStartup } from '@/collab/local-yjs-store';
// Y5 T10：localStorage historyId 单键（与 runtime 水合链同源——rejected-recovery 的读写面）。
import { loadPersistedHistoryId } from '@/collab/rejected-recovery';
// Y5 T10（C1）：binding/names 写失败 fail-soft 但可观测（local-cache-degraded 是既有受控 reason）。
import { recordCollabDiag } from '@/utils/collabDiagnostics';
// Y5 T7：他标签登出拆会话回调注册（AuthProvider 的 storage 监听触发；本页不独占 storage 监听）
import { registerCollabSessionTeardown } from '@/collab/auth-teardown-registry';
import { attachSpecbPerfProbe } from '@/stores/specbPerfProbe';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { message, Spin } from 'antd';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { NodePalette } from './components/NodePalette';
import { AddNodeMenu } from './components/AddNodeMenu';
import { HandleAddNodeMenu } from './components/HandleAddNodeMenu';
import { BatchAddNodeMenu } from './components/groups/BatchAddNodeMenu';
import { StyleLibraryModal } from './components/style-library/StyleLibraryModal';
import { KeyboardShortcutsPanel } from './components/KeyboardShortcutsPanel';
import { CanvasView } from './components/CanvasView';
import { SyncBanner } from './components/SyncBanner';
import { QuotaBanner } from './components/QuotaBanner';
import { RecoveryPanel } from './components/RecoveryPanel';   // T25b B1：B 场景草稿裁定面
import MaterialLibraryModal from '@/components/MaterialLibrary/MaterialLibraryModal';
import { HistoryModal } from '@/components/HistoryPage/HistoryModal';
import { LightingModal } from './components/Lighting/LightingModal';
import { Angle3DModal } from './components/Angle3D/Angle3DModal';
import { VideoEditorShell } from './video-editor/components/VideoEditorShell';
import { useMenuStore } from '@/stores/menuStore';
import { CanvasTopBar } from './components/CanvasTopBar';
import { ProjectTitle } from './components/ProjectTitle';
import { bindViewportPersistence } from '@/utils/viewportPersistence';
import { useSessionKeepalive } from '@/hooks/useSessionKeepalive';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { useGroupKeyboard } from '@/hooks/useGroupKeyboard';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { createCanvas, getProjectFolder } from '@/api/canvasApi';
import { apiFetch } from '@/api/client';
// Y4b T11：批注面板+会话身份（threadsStore 接线单点——组件侧全 props 注入）
import { useAuth } from '@/components/AuthProvider';
import { ThreadsPanel, type ThreadsViewData } from './components/threads/ThreadsPanel';
import {
  ThreadComposer, THREADS_COMPOSE_EVENT, type ThreadComposeRequest, type ThreadCreateInput,
} from './components/threads/ThreadComposer';
import {
  setSessionUserId, threadsView$, subscribeThreadsView, cleanupOrphans, addComment, setResolved, createThread,
} from '@/stores/threadsStore';

const PROJECT_ID_KEY = 'flowweb_projectId';

/** Y0b-5 T4：本地副本导出（localCacheReady 分支横幅动作）——与 runtime escapeWithLocalExport
 *  （终态逃生=导出+强制刷新）语义分立：不刷新（正在重连——副本连续性保持，副本本就渲染在画布上）。 */
function exportLocalCopy(): void {
  try {
    const cs = useCanvasStore.getState();
    const payload = JSON.stringify({ nodes: cs.nodes, edges: cs.edges });
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `canvas-local-copy-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch { /* 导出失败不阻断——副本仍在画布上可见 */ }
}

// 空名创建：编号由后端生成，画布进入工作空间根目录
async function createUntitledProject(): Promise<{ id: string; name: string; meta: CollabSessionMeta }> {
  const { projectId, name, teamId, collabGeneration, collabSchemaVersion, collabViewerUid } = await createCanvas('', null);
  localStorage.setItem(PROJECT_ID_KEY, projectId);
  useCanvasStore.getState().setTeamId(teamId ?? null);
  // Y0b-5 T5：新建路径同透传世代通道（canvas.service create 随行三字段——0 代首会话即享四维缓存键）
  return { id: projectId, name, meta: { collabGeneration, collabSchemaVersion, viewerUid: collabViewerUid } };
}

// F14 三义分家：404（确定性不存在）/ 403（无权访问）/ 5xx·网络·json 异常（暂不可用，可重试）
// Y5 T10（裁定 ①）：HTTP status 必须透传到离线分型——401（http-expired）与 5xx/网络（瞬态）同落
// ProjectLoadError 会让 401+本地有效凭证误走 open-local（违反 §0.2 步 1）；禁把 undefined 当 401。
class ProjectNotFoundError extends Error {
  readonly status = 404;
}
class ProjectInaccessibleError extends Error {
  readonly status = 403;
}
/** 其余失败（5xx/网络/json）：status 保留原值（undefined=无状态/网络错误——decideOfflineRoute 的瞬态输入）。 */
class ProjectLoadError extends Error {
  readonly status: number | undefined;
  constructor(status?: number) {
    super(`project load failed${status === undefined ? '' : ` (${status})`}`);
    this.status = status;
  }
}

/**
 * Y5 T10（C1 / spec §0.1.4）：离线路径的 meta 写点——`putBindingRow` 全仓唯一生产调用者。
 * 只在 fetchProjectMeta 成功且「响应 uid = 当前 session 行 uid」时写（跨账号本地泄漏防线：
 * 裸 pid 键会让 B 打开 A 的库）。historyToken 必填（缺 token 时离线三合取结构性失败）。
 * names 行同点登记（库名全集来源=清扫/删除闸），但 **不覆盖既有 hold/tombstone**：
 * 先读同名行，存量行若已 hold 或 tombstone 则原样保留（hold/tombstone 互斥，二者都是
 * 「未裁定/已裁定待删」的裁定结果，普通成功路径无权翻案——I4/M4）。
 * 全程 fail-soft（在线主链不可被本地存储故障打断），失败留 `local-cache-degraded` 遥测。
 */
async function persistOfflineMeta(
  projectId: string,
  responseUid: string | null | undefined,
  meta: CollabSessionMeta,
  name: string,
  teamId: string | null,
): Promise<void> {
  try {
    const uid = typeof responseUid === 'string' && responseUid.length > 0 ? responseUid : null;
    const generation = meta.collabGeneration;
    const schemaVersion = meta.collabSchemaVersion;
    const historyToken = loadPersistedHistoryId();
    if (uid === null || typeof generation !== 'number' || typeof schemaVersion !== 'number' || historyToken === null) return;
    // ② 证明 uid 同源：session 表恰一行且 uid 相等（0/多行=歧义，fail-closed 不写）
    const sessionRows = await getSessionRows();
    if (sessionRows.length !== 1 || sessionRows[0].uid !== uid) return;

    await putBindingRow(uid, projectId, { uid, generation, schemaVersion, historyToken, name, teamId });
    // names 登记（库名全集）——存量 hold/tombstone 原样保留（M4：不盲写 hold:false）
    const dbName = buildYjsDbName(uid, projectId, generation, schemaVersion, historyToken);
    let existingHold = false;
    let existingTombstone = false;
    try {
      const existing = (await listNameRows()).find((row) => row.dbName === dbName);
      existingHold = existing?.hold === true;
      existingTombstone = existing?.tombstone === true;
    } catch { /* 读失败=按新行写（保守：不携带无法读到的裁定标记） */ }
    await putNameRow(dbName, {
      uid, pid: projectId, generation, schemaVersion, historyToken,
      hold: existingHold, ...(existingTombstone ? { tombstone: true } : {}),
    });
  } catch {
    // fail-soft：在线路径不因本地 meta 写失败中断（离线路径届时 fail-closed 到 unavailable）
    recordCollabDiag('ws_status', { reason: 'local-cache-degraded' });
  }
}

/** 仅取项目元数据（名称/团队上下文/世代通道三元）；doc 会话统一由 openSession 建立（R5 单一漏斗）。
 *  批3-3：裸 fetch 收编 apiFetch（401 电平/契约统一）；F14 三义分家由抛错的 status 承载。
 *  Y0b-5 T5：世代可见通道透传（E3「鉴权握手返回」——先于 initCollab，零新往返零新端点）；
 *  字段缺失（旧后端/代理剥离）⇒meta 缺项⇒runtime fail-closed 不启用本地缓存。 */
async function fetchProjectMeta(
  projectId: string,
  isCancelled?: () => boolean,
): Promise<{ name: string; meta: CollabSessionMeta }> {
  try {
    const project = await apiFetch<{
      name: string; teamId: string | null;
      collabGeneration?: number | null; collabSchemaVersion?: number | null; collabViewerUid?: string | null;
    }>(`/projects/${projectId}`);
    const meta: CollabSessionMeta = {
      collabGeneration: project.collabGeneration ?? undefined,
      collabSchemaVersion: project.collabSchemaVersion ?? undefined,
      viewerUid: project.collabViewerUid ?? undefined,
    };
    const name = project.name || '未命名项目';
    // 丢弃过期响应（effect 重跑/StrictMode）的 store 写入
    if (isCancelled?.()) return { name, meta };

    // 画布团队上下文（顶栏积分/上传/素材库消费）
    useCanvasStore.getState().setTeamId(project.teamId ?? null);
    // Y5 T10（C1）：离线路径的元数据载体写点——`putBindingRow` 全仓唯一生产调用。
    // 三合取 fail-closed（spec §0.1.4）：①响应 collabViewerUid 非空串；②它等于当前 session 行
    // 的 uid（session 表恰一行）；③localStorage 有 historyToken（无 token 时离线三合取必失败，
    // 写行无意义）。任一不成立⇒不写（不是错误——在线路径照常）。fail-soft：写失败只留遥测
    // （helper 内部全 try/catch 永不 reject——await 只为顺序确定，不改变在线主链 fail-soft 契约）。
    await persistOfflineMeta(projectId, project.collabViewerUid, meta, name, project.teamId ?? null);
    return { name, meta };
  } catch (e) {
    // R5：json 异常不再静默降级为"可编辑无 doc 会话"（原 return '未命名项目' 是刷新蒸发根源之一）
    // Y5 T10（裁定 ①）：status 原值随错误透传（未归一为 undefined）——离线分型靠它区分
    // 401（http-expired）/403/404（no-read-access）/5xx·无状态（瞬态三合取）。
    const status = (e as { status?: number }).status;
    if (status === 404) throw new ProjectNotFoundError();
    if (status === 403) throw new ProjectInaccessibleError();
    throw new ProjectLoadError(status);   // 5xx/网络/json 异常兜底（status 保留：undefined=网络错误）
  }
}

export function CanvasPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('未命名项目');
  const [loadError, setLoadError] = useState<'inaccessible' | 'unavailable' | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const queryProjectId = searchParams.get('projectId');
  const lastPidRef = useRef<string | null>(null);
  // StrictMode 双执行共享同一次创建请求，避免重复建画布；失败后清空以允许重试
  const createPromiseRef = useRef<Promise<{ id: string; name: string; meta: CollabSessionMeta }> | null>(null);
  const sessionEpochRef = useRef(0);

  /** R17 硬契约前置（批0a 版 / 批2-1 四态化）：先推 epoch/置 pending（桥禁写门），再清 store——
   *  清空不被旧会话订阅翻译成删除 */
  function resetSession() {
    sessionEpochRef.current++;
    useCanvasStore.getState().setHydration('pending');
    useCanvasStore.setState({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, teamId: null });
    useNodeStore.setState({ nodes: {} });
  }

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    // Y2 A3 退役注记：geometryTrap bootstrap（O0b-8 接线）随 withGeometryWriter 仲裁体系整删
    //（cs=作者缓存 doc 读模型直写——几何写者域消解）。每轮开局归零沿袭（三保险之一——批2-1 四态：idle=无会话）
    useCanvasStore.getState().setHydration('idle');

    // 项目切换/新建前同步清空模块级 store 残留，否则残留会骗过下方 DB 空守卫（Bug 3）
    const storedId = queryProjectId || localStorage.getItem(PROJECT_ID_KEY);
    const target = storedId ?? null;
    if (target === null || target !== lastPidRef.current) {
      resetSession();
    }
    lastPidRef.current = target;

    /** R5 结构性根修：四条项目就绪路径唯一入口（原 finish 私有化收编）——
     *  新建/404 回退不再"只 finish 不建 doc 会话"（可编辑但刷新蒸发的活 bug）。
     *  批2-1：首行置 pending（先于任何渲染就绪）；ready/failed 归 runtime 单写——
     *  initCollab 超时（failed）不被此处的完成动作遮蔽（旧代码 setHydrating(false) 吞超时蒙层） */
    async function openSession(id: string, name: string, meta?: CollabSessionMeta) {
      if (cancelled) return;
      sessionEpochRef.current++;
      const epoch = sessionEpochRef.current;
      useCanvasStore.getState().setHydration('pending');
      await initCollab(id, meta);   // Y0b-5 T5：世代通道三元随会话（缺失⇒runtime fail-closed）
      if (cancelled || epoch !== sessionEpochRef.current) return; // 期间用户切项目——丢弃陈旧结果
      useCanvasStore.setState({ projectId: id });
      setProjectId(id);
      setProjectName(name);
    }

    /** Y5 T10（§0.2 步 1 / 验收 17）：离线开库腿——binding 是唯一元数据源（name/teamId/三元），
     *  runtime 走 initCollabLocal（本地库装载→五合取→local）。
     *  I1b：initCollabLocal 抛错（IDB 全不可用等）必须有明确终态——fail-closed 到
     *  `failed`（只读/暂不可用 UI），绝不把 rejection 逸出 effect 变 unhandled。 */
    async function openLocalSession(
      id: string,
      binding: Extract<OfflineRouteInput['binding'], object>,
    ): Promise<void> {
      if (cancelled) return;
      sessionEpochRef.current++;
      const epoch = sessionEpochRef.current;
      useCanvasStore.getState().setHydration('pending');
      let ok = true;
      try {
        useCanvasStore.getState().setTeamId(binding.teamId);
        await initCollabLocal(id, {
          viewerUid: binding.uid,
          collabGeneration: binding.generation,
          collabSchemaVersion: binding.schemaVersion,
          name: binding.name,
          teamId: binding.teamId,
        });
      } catch {
        ok = false;
      }
      if (cancelled || epoch !== sessionEpochRef.current) return;
      if (!ok) {
        // 明确终态：会话未建立 → failed（只读副本/重试 UI 由既有 failed 分支承载）
        useCanvasStore.getState().setHydration('failed');
        setLoadError('unavailable');
        return;
      }
      useCanvasStore.setState({ projectId: id });
      setProjectId(id);
      setProjectName(binding.name);
    }

    /** Y5 T10（spec §0.2 步 1 决定表）：项目请求失败后的分型路由——401=既有 httpExpired（不开库）；
     *  403/404=无读权；瞬态失败才读 meta 两表做三合取，全过=open-local（binding 顶 meta）。
     *  无 projectId 恒 unavailable（禁 createUntitledProject——裁定 ②）。 */
    async function routeOffline(id: string, status: number | undefined): Promise<void> {
      // 服务端显式否认优先（§0.2 步 1）：401=http-expired、403/404=no-read-access——**meta 两表零读**
      // （denial 路径连 session/binding 都不查，本地库更不会被打开）。
      let sessionRows: Awaited<ReturnType<typeof getSessionRows>> = [];
      let binding: Awaited<ReturnType<typeof getBindingRow>> = null;
      if (status !== 401 && status !== 403 && status !== 404) {
        try {
          sessionRows = await getSessionRows();
          // binding 键=uid+pid；uid 只能从 session 行取（单活行歧义/缺失时不查——分型函数同款 fail-closed）
          binding = sessionRows.length === 1 ? await getBindingRow(sessionRows[0].uid, id) : null;
        } catch { /* 两表不可读（IDB 受限）=凭证不可得——分型函数 unavailable */ }
        if (cancelled) return;
      }
      const decision = decideOfflineRoute({
        projectId: id,
        status,
        sessionRows,
        binding,
        historyId: loadPersistedHistoryId() ?? undefined,
        now: Date.now(),
      });
      if (decision.kind === 'open-local') {
        await openLocalSession(id, decision.binding);
        return;
      }
      useCanvasStore.getState().setHydration('idle');
      if (decision.kind === 'no-read-access') setLoadError('inaccessible');
      else setLoadError('unavailable');   // http-expired：现状 httpExpired 电平已由 apiFetch 置位（横幅），页面同停「暂不可用」
    }

    // 优先 query 参数（工作空间/模板导入），否则恢复最近项目
    if (storedId) {
      if (queryProjectId) localStorage.setItem(PROJECT_ID_KEY, queryProjectId);
      // Y5 T13（§0.6 启动清扫）：会话建立前扫一次本地库（墓碑直删/异代过删除闸/孤儿库并集）。
      // fail-soft：清扫失败绝不阻断水合（清库是磁盘卫生层，水合正确性不依赖它）。
      // uid 取本地证明（session 表单活行）——此 effect 早于 useAuth 声明，禁引用 user。
      void getSessionRows()
        .then((rows) => (rows.length === 1 ? sweepStartup(rows[0].uid) : null))
        .catch(() => undefined);
      fetchProjectMeta(storedId, () => cancelled)
        .then(({ name, meta }) => openSession(storedId, name, meta))
        .catch((e: unknown) => {
          if (cancelled) return;
          // 裁定 ②：无参 404 自动新建只认确定性 404（在线遗留分支）。离线/瞬态失败类型不同
          //（ProjectLoadError）→ 永不可达本分支；decideOfflineRoute 的 no-read-access/unavailable
          // 也不反推自动新建。
          if (e instanceof ProjectNotFoundError && !queryProjectId) {
            // 无参路径 404（确定性不存在）：清 key → fallback 新建（loading 不中断，避免闪烁）
            localStorage.removeItem(PROJECT_ID_KEY);
            message.warning('上次的画布已不存在，已为你新建');
            createPromiseRef.current ??= createUntitledProject();
            createPromiseRef.current
              .then(({ id, name, meta }) => openSession(id, name, meta))
              .catch(() => {
                createPromiseRef.current = null;
                if (cancelled) return;
                useCanvasStore.getState().setHydration('idle');
                setLoadError('unavailable');
              });
            return;
          }
          // Y5 T10：F14 三义分家的三档全部并入离线分型（status 已透传）——
          // 403/404⇒inaccessible、401⇒http-expired 停「暂不可用」、瞬态三合取全过⇒open-local。
          const status = e instanceof ProjectLoadError
            ? e.status
            : e instanceof ProjectNotFoundError
              ? 404
              : e instanceof ProjectInaccessibleError ? 403 : undefined;
          // I1c：不 void 一个可能 reject 的异步链——内部已各自收敛（openLocalSession 兜住
          // initCollabLocal），这里再兜一层：意外抛错也落明确 UI 态，绝不 unhandled。
          routeOffline(storedId, status).catch(() => {
            if (cancelled) return;
            useCanvasStore.getState().setHydration('failed');
            setLoadError('unavailable');
          });
        });
    } else {
      // Normal flow — create new project
      // 裁定 ②：无 projectId 的失败一律停「暂不可用」（不自动新建——§0.2 步 1）
      createPromiseRef.current ??= createUntitledProject();
      createPromiseRef.current
        .then(({ id, name, meta }) => openSession(id, name, meta))
        .catch(() => {
          createPromiseRef.current = null;
          if (!cancelled) {
            useCanvasStore.getState().setHydration('idle');
            setLoadError('unavailable');
          }
        });
    }
    return () => {
      cancelled = true;
      void destroyCollab();
    };
  }, [queryProjectId, retryKey]);

  const handleRetry = () => setRetryKey((k) => k + 1);

  // 批2-1 R27 首屏可达性：!projectId 分支按 hydration 分档（failed 给行动，其余加载中）
  const hydration = useCanvasStore((s) => s.hydration);

  if (loadError) {
    const isInaccessible = loadError === 'inaccessible';
    return (
      <div className="flex h-screen bg-bg flex-col items-center justify-center gap-5">
        <span className="text-text-dim-3 text-sm">
          {isInaccessible ? '画布不存在或无权访问' : '画布加载失败，请检查网络后重试'}
        </span>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleRetry}
            className="px-4 h-9 rounded-lg bg-overlay-2 hover:bg-overlay-3 text-text text-sm border-0"
          >
            重试
          </button>
          {isInaccessible ? (
            <button
              type="button"
              onClick={() => navigate('/works')}
              className="px-4 h-9 rounded-lg bg-overlay-2 hover:bg-overlay-3 text-text text-sm border-0"
            >
              返回工作空间
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // 等待项目就绪后才渲染
  if (!projectId) {
    // 批2-1 R27：failed（超时/陈旧轮残留）给重试行动——首屏不挂死在"加载画布..."
    if (hydration === 'failed') {
      return (
        <div className="flex h-screen bg-bg flex-col items-center justify-center gap-5">
          <span className="text-text-dim-3 text-sm">画布同步失败，请检查网络后重试</span>
          <button
            type="button"
            onClick={() => safeReload('generic')}
            className="px-4 h-9 rounded-lg bg-overlay-2 hover:bg-overlay-3 text-text text-sm border-0"
          >
            重试连接
          </button>
        </div>
      );
    }
    return (
      <div className="flex h-screen bg-bg items-center justify-center">
        <span className="text-text-dim-1">加载画布...</span>
      </div>
    );
  }

  return (
    <CanvasPageInner projectId={projectId} projectName={projectName} onNameChange={setProjectName} />
  );
}

// 内层组件仅在 projectId 就绪后挂载
function CanvasPageInner({ projectId, projectName, onNameChange }: { projectId: string; projectName: string; onNameChange: (name: string) => void }) {
  // 批2-1 蒙层分型（替代 isHydrating/syncFailed 双布尔）：
  //  idle=会话未建立（切项目窗口正常瞬态/漏斗新入口自报）；pending=非阻断同步骨架；
  //  failed=10s 超时（修D——provider 保留，重试行动）；ready=无蒙层。
  //  会话中途断连不弹蒙层（hydration 保持 ready——connStatus/connUi 由指示器与 SyncBanner 非阻断告知）
  //  Y0b-5 T4 蒙层三分支：pending+瞬态 notice→「服务繁忙，正在自动重试…」（死线延长期间）；
  //  failed+terminal notice→阻断蒙层让位（终态 UX 即出口——SyncBanner 指引承载，z-50 蒙层不遮横幅）；
  //  failed+localCacheReady∧有缓存内容→只读横幅「本地副本(只读)· 正在重连」+导出（T8 联动预埋，
  //  真实翻转归 T8；failed 态 canEdit false——hydration 非 ready/local）。
  const hydration = useCanvasStore((s) => s.hydration);
  const wsAuthNotice = useCanvasStore((s) => s.wsAuthNotice);
  const localCacheReady = useCanvasStore((s) => s.localCacheReady);
  const hasCacheContent = useCanvasStore((s) => s.nodes.length > 0);
  const localCacheActive = hydration === 'failed' && localCacheReady && hasCacheContent;

  // idle 的 dev 留痕（非抛错——切项目窗口 'idle' 是正常态，抛错必炸）：漏 openSession 漏斗的
  // 新入口当场自报姓名，比 toast 早且准
  useEffect(() => {
    if (hydration === 'idle' && import.meta.env.DEV) {
      console.error('[collab] hydration=idle：画布会话未建立（切项目窗口为正常瞬态；持续出现=漏 openSession 漏斗的新入口）');
    }
  }, [hydration]);

  // viewport 本地偏好持久化（projectId null 守卫防写错 key，返回 unbind 即 cleanup）
  useEffect(() => {
    if (!projectId) return;
    return bindViewportPersistence(projectId);
  }, [projectId]);

  // 批3-3 F8：15min 静默 me 探活——session 滑动续期（DB touch + cookie 重发）的唯一 HTTP 载体
  useSessionKeepalive();

  // Y5 T7：把本页拆会话回调交给 AuthProvider（他标签登出 epoch 事件 → setUser(null)+本回调）。
  // 回调内不写 session、不再次 bump（发起标签已写）；卸载解绑防陈旧页覆盖新页注册。
  useEffect(() => registerCollabSessionTeardown(() => { void destroyCollab(); }), []);

  // AddNodeMenu state — shared by + button and right-click triggers
  const menuIsOpen = useMenuStore((s) => s.isOpen);
  const menuPosition = useMenuStore((s) => s.position);
  const menuClose = useMenuStore((s) => s.close);
  const triggerEl = useMenuStore((s) => s.triggerEl);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { triggerRef.current = triggerEl; }, [triggerEl]);

  // Y4b T11（spec §3.1）：会话用户挂载——threadsStore 写前谓词的作者比较输入；本轮登出/切号即时反映
  const { user } = useAuth();
  useEffect(() => {
    setSessionUserId(user?.id ?? null);
  }, [user?.id]);

  // Y4b T11：批注侧滑面板开合（TopBar「批注」按钮经 window 事件触达——顶栏不引面板/store）
  const [threadsOpen, setThreadsOpen] = useState(false);
  useEffect(() => {
    const open = () => setThreadsOpen(true);
    window.addEventListener('threads:open', open);
    return () => window.removeEventListener('threads:open', open);
  }, []);
  // 面板视图（T10 threadsView$ 投影：三组互斥；未 attach 时返空三组——面板走空态）。
  // 重算触发=线程投影自广播（T10 subscribeThreadsView——threads observeDeep/nodes 键增删/文本锚
  // 片段变化三面归一受体）。Y4b 组3 收口：改投订阅面而非 doc.on('update')——后者需经
  // resolveDoc() 触 canvasCollabRuntime 内部（page.test.tsx 的 runtime mock 无 getDoc 导出，
  // 26 例连带红）；订阅面零 runtime 依赖，且只在线程域真变更时重算（不再被节点几何更新空触发）。
  const [threadsTick, setThreadsTick] = useState(0);
  useEffect(() => {
    const bump = () => setThreadsTick((v) => v + 1);
    return subscribeThreadsView(bump);
  }, []);
  const threadsView: ThreadsViewData = useMemo(() => threadsView$(), [threadsTick, projectId]);

  // Y4b T11：composer 开窗请求（入口 A=节点右键 / 入口 B=文本选区浮标——组件侧零 store 依赖）
  const [composeReq, setComposeReq] = useState<ThreadComposeRequest | null>(null);
  useEffect(() => {
    const onCompose = (e: Event) => setComposeReq((e as CustomEvent<ThreadComposeRequest>).detail);
    window.addEventListener(THREADS_COMPOSE_EVENT, onCompose);
    return () => window.removeEventListener(THREADS_COMPOSE_EVENT, onCompose);
  }, []);

  // Sync projectId to canvasStore so React Flow nodes can access it for socket room join
  useEffect(() => {
    useCanvasStore.getState().setProjectId(projectId);
  }, [projectId]);

  // B7-2 性能冒烟 e2e 探针：?perfProbe=1 显式 opt-in 才挂 window.__specbPerf（普通访问零成本）
  useEffect(() => {
    attachSpecbPerfProbe();
  }, []);

  // 标题栏面包屑：folderId → folders 平铺列表沿 parentId 拼「顶层→直接父级」链；任何失败回退主目录
  const [folderPath, setFolderPath] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    setFolderPath([]); // projectId 切换/重新加载时清除旧路径，加载期显示主目录/
    getProjectFolder(projectId)
      .then(async ({ folderId }) => {
        if (cancelled || !folderId) return;
        const data = await apiFetch<{ folders: { id: string; name: string; parentId: string | null }[] }>('/folders');
        if (cancelled) return;
        const chain: string[] = [];
        let cur = data.folders.find((f) => f.id === folderId);
        let depth = 0;
        while (cur && depth < 10) { // 上限防脏数据循环引用死循环
          chain.unshift(cur.name);
          const pid = cur.parentId;
          cur = pid ? data.folders.find((f) => f.id === pid) : undefined;
          depth++;
        }
        setFolderPath(chain);
      })
      .catch(() => {
        // 未登录/网络失败/接口异常 → 保持主目录
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const [isShortcutsOpen, setShortcutsOpen] = useState(false);

  // 屏蔽浏览器原生右键菜单，后续开发 Canvas 专用右键菜单
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  // Abort all in-progress node processes when leaving canvas page
  useEffect(() => {
    return () => {
      const state = useCanvasStore.getState();
      const map = state?.nodeProcessMap;
      if (map) {
        for (const entry of Object.values(map)) {
          entry.abortController?.abort();
        }
      }
    };
  }, []);

  // 无限画布页面禁止 body/html 滚动条
  useEffect(() => {
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, []);

  return (
    <ReactFlowProvider>
      <CanvasKeyboardHandler />
      <div className="h-screen bg-bg relative overflow-hidden">
        <ProjectTitle projectId={projectId} projectName={projectName} folderPath={folderPath} onNameChange={onNameChange} />
        <NodePalette onToggleShortcuts={() => setShortcutsOpen((v) => !v)} />
        <CanvasView projectId={projectId} />
        <CanvasTopBar projectId={projectId} />
        {/* Y4b T11：批注侧滑面板（TopBar「批注」按钮开；三组互斥+清理入口） */}
        <ThreadsPanel
          view={threadsView}
          open={threadsOpen}
          onClose={() => setThreadsOpen(false)}
          onCleanup={() => { cleanupOrphans(); }}
          onAddComment={addComment}
          onSetResolved={setResolved}
        />
        {/* Y4b T11：composer（入口 A/B 共用开窗点——createThread 接线单点） */}
        {composeReq && (
          <ThreadComposer
            input={{ ...composeReq, body: '' }}
            onSubmit={(input: ThreadCreateInput) => createThread(input)}
            onClose={() => setComposeReq(null)}
          />
        )}
        {/* Y0b-3 T9 Step6：协作横幅（终态分档/write-frozen/connUi 分级——非阻断，批1-5 connUi 消费者） */}
        <SyncBanner />
        {/* Y0b-4 T11：配额横幅（三级：软阈通告/硬阈双主按钮/4404·4410 终态档——与 SyncBanner 独立同挂载点） */}
        <QuotaBanner projectId={projectId} />
        {/* T25b B1：B 场景逐字段草稿裁定面（recoveryPanelOpen 门——SyncBanner recovery 档按钮开） */}
        <RecoveryPanel />
        <KeyboardShortcutsPanel isOpen={isShortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <MaterialLibraryModal />
        <HistoryModal />
        <LightingModal />
        <Angle3DModal />
        <VideoEditorShell />
        <AddNodeMenu isOpen={menuIsOpen} onClose={menuClose} triggerRef={triggerRef} position={menuPosition} />
        <HandleAddNodeMenu />
        <BatchAddNodeMenu />
        <StyleLibraryModal />
        {hydration === 'idle' && (
          <div
            data-testid="hydrate-overlay"
            role="alert"
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/50"
          >
            <span className="text-text">画布会话未建立</span>
          </div>
        )}
        {hydration === 'pending' && (
          // 非阻断骨架：pointer-events-none 不锁交互（批2-1 蒙层分型——旧阻断遮罩退役）；
          // T4：瞬态 notice（死线延长期）文案分型——「服务繁忙，正在自动重试…」（禁死 spinner 由 25s 封顶保证）
          <div
            data-testid="hydrate-overlay"
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
          >
            <div className="flex flex-col items-center gap-2 text-text">
              <Spin />
              <span>{wsAuthNotice && !wsAuthNotice.terminal ? '服务繁忙，正在自动重试…' : '正在同步'}</span>
            </div>
          </div>
        )}
        {localCacheActive && (
          // Y0b-5 T4（T8 联动预埋）：本地副本只读横幅——非阻断（副本在下方画布渲染，底部条防与
          // SyncBanner 顶部重叠）；failed 态 canEdit false（hydration 非 ready/local）
          <div
            data-testid="local-cache-banner"
            role="alert"
            className="absolute left-1/2 bottom-6 z-40 -translate-x-1/2 flex items-center gap-3 px-4 h-10 rounded-xl border text-sm whitespace-nowrap bg-overlay-2/95 border-overlay-2 text-text-dim-1"
          >
            <span>本地副本(只读)· 正在重连</span>
            <button
              type="button"
              onClick={exportLocalCopy}
              className="shrink-0 px-3 h-7 rounded-lg bg-overlay-3 hover:bg-overlay-2 text-text text-xs border border-overlay-2"
            >
              导出
            </button>
          </div>
        )}
        {hydration === 'failed' && !localCacheActive && !wsAuthNotice?.terminal && (
          // 终态档不渲染阻断蒙层（终态 UX 即出口——SyncBanner 指引承载且 z-50 蒙层会遮横幅）；
          // localCacheReady=false 或零缓存内容时维持现有文案（恒真——不谎报"有本地副本"）
          <div
            data-testid="offline-overlay"
            role="alert"
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/50"
          >
            <div className="flex flex-col items-center gap-3 text-text">
              <span>画布同步失败</span>
              <button
                type="button"
                onClick={() => safeReload('generic')}
                className="px-4 h-9 rounded-lg bg-overlay-2 hover:bg-overlay-3 text-text text-sm border-0"
              >
                重试连接
              </button>
            </div>
          </div>
        )}
      </div>
    </ReactFlowProvider>
  );
}

/** Global canvas keyboard shortcuts — must be inside ReactFlowProvider to use useReactFlow */
function CanvasKeyboardHandler() {
  const { fitView } = useReactFlow();
  useGroupKeyboard();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // TD-4（批2-1 四态化）：会话未就绪（idle/pending/failed）忽略快捷键（蒙层封指针路径，这里封键盘路径）
      // Y5 T8：local（本地 DB 已装载可编辑）同 ready 放行——仅 idle/pending/failed 拦截
      const hydration = useCanvasStore.getState().hydration;
      if (hydration !== 'ready' && hydration !== 'local') return;
      if (useVideoEditorStore.getState().open) return; // 视频编辑器打开期间画布快捷键全禁（spec 验收 27——Tab/Ctrl+0/Alt+Shift+F 不再开幽灵菜单/改视口）
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (useNodeStore.getState().referenceSelect) return; // 参考选择模式 Tab 不弹 AddNodeMenu（spec §3.1；Ctrl+0/Alt+Shift+F fitView 为接受边界仍生效）
        e.preventDefault();
        const pos = useMenuStore.getState().lastMousePos;
        useMenuStore.getState().open(pos);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        fitView({ duration: 300, padding: 0.2 });
        return;
      }

      if (e.altKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        fitView({ duration: 300, padding: 0.2 });
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [fitView]);

  return null;
}
