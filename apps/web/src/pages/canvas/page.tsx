import { initCollab, destroyCollab } from '@/stores/canvasCollabRuntime';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { message, Spin } from 'antd';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { NodePalette } from './components/NodePalette';
import { AddNodeMenu } from './components/AddNodeMenu';
import { HandleAddNodeMenu } from './components/HandleAddNodeMenu';
import { StyleLibraryModal } from './components/style-library/StyleLibraryModal';
import { KeyboardShortcutsPanel } from './components/KeyboardShortcutsPanel';
import { CanvasView } from './components/CanvasView';
import MaterialLibraryModal from '@/components/MaterialLibrary/MaterialLibraryModal';
import { HistoryModal } from '@/components/HistoryPage/HistoryModal';
import { LightingModal } from './components/Lighting/LightingModal';
import { Angle3DModal } from './components/Angle3D/Angle3DModal';
import { VideoEditorShell } from './video-editor/components/VideoEditorShell';
import { useMenuStore } from '@/stores/menuStore';
import { CanvasTopBar } from './components/CanvasTopBar';
import { ProjectTitle } from './components/ProjectTitle';
import { bindViewportPersistence } from '@/utils/viewportPersistence';
import { ensureExecutionSocket, teardownExecutionSocket } from '@/services/executionSocket';
import { useSessionKeepalive } from '@/hooks/useSessionKeepalive';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { useGroupKeyboard } from '@/hooks/useGroupKeyboard';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { createCanvas, getProjectFolder } from '@/api/canvasApi';
import { apiFetch } from '@/api/client';

const PROJECT_ID_KEY = 'flowweb_projectId';

// 空名创建：编号由后端生成，画布进入工作空间根目录
async function createUntitledProject(): Promise<{ id: string; name: string }> {
  const { projectId, name, teamId } = await createCanvas('', null);
  localStorage.setItem(PROJECT_ID_KEY, projectId);
  useCanvasStore.getState().setTeamId(teamId ?? null);
  return { id: projectId, name };
}

// F14 三义分家：404（确定性不存在）/ 403（无权访问）/ 5xx·网络·json 异常（暂不可用，可重试）
class ProjectNotFoundError extends Error {}
class ProjectInaccessibleError extends Error {}
class ProjectLoadError extends Error {}

/** 仅取项目元数据（名称/团队上下文）；doc 会话统一由 openSession 建立（R5 单一漏斗）。
 *  批3-3：裸 fetch 收编 apiFetch（401 电平/契约统一）；F14 三义分家由抛错的 status 承载。 */
async function fetchProjectMeta(
  projectId: string,
  isCancelled?: () => boolean,
): Promise<string> {
  try {
    const project = await apiFetch<{ name: string; teamId: string | null }>(`/projects/${projectId}`);
    // 丢弃过期响应（effect 重跑/StrictMode）的 store 写入
    if (isCancelled?.()) return project.name || '未命名项目';

    // 画布团队上下文（顶栏积分/上传/素材库消费）
    useCanvasStore.getState().setTeamId(project.teamId ?? null);
    return project.name || '未命名项目';
  } catch (e) {
    // R5：json 异常不再静默降级为"可编辑无 doc 会话"（原 return '未命名项目' 是刷新蒸发根源之一）
    const status = (e as { status?: number }).status;
    if (status === 404) throw new ProjectNotFoundError();
    if (status === 403) throw new ProjectInaccessibleError();
    throw new ProjectLoadError();   // 5xx/网络/json 异常（apiFetch 结构化错误均无 status）
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
  const createPromiseRef = useRef<Promise<{ id: string; name: string }> | null>(null);
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
    // 每轮开局归零：清上一轮 cancelled 遗留的悬停态（三保险之一——批2-1 四态：idle=无会话）
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
    async function openSession(id: string, name: string) {
      if (cancelled) return;
      sessionEpochRef.current++;
      const epoch = sessionEpochRef.current;
      useCanvasStore.getState().setHydration('pending');
      await initCollab(id);
      if (cancelled || epoch !== sessionEpochRef.current) return; // 期间用户切项目——丢弃陈旧结果
      useCanvasStore.setState({ projectId: id });
      setProjectId(id);
      setProjectName(name);
    }

    // 优先 query 参数（工作空间/模板导入），否则恢复最近项目
    if (storedId) {
      if (queryProjectId) localStorage.setItem(PROJECT_ID_KEY, queryProjectId);
      fetchProjectMeta(storedId, () => cancelled)
        .then((name) => openSession(storedId, name))
        .catch((e: unknown) => {
          if (cancelled) return;
          if (e instanceof ProjectNotFoundError && !queryProjectId) {
            // 无参路径 404（确定性不存在）：清 key → fallback 新建（loading 不中断，避免闪烁）
            localStorage.removeItem(PROJECT_ID_KEY);
            message.warning('上次的画布已不存在，已为你新建');
            createPromiseRef.current ??= createUntitledProject();
            createPromiseRef.current
              .then(({ id, name }) => openSession(id, name))
              .catch(() => {
                createPromiseRef.current = null;
                if (cancelled) return;
                useCanvasStore.getState().setHydration('idle');
                setLoadError('unavailable');
              });
            return;
          }
          // F14 三义分家：403/有参 404=inaccessible（不清 key 不自动新建）；5xx/网络/json 异常=unavailable
          useCanvasStore.getState().setHydration('idle');
          const isInaccessible =
            e instanceof ProjectNotFoundError || e instanceof ProjectInaccessibleError;
          setLoadError(isInaccessible ? 'inaccessible' : 'unavailable');
        });
    } else {
      // Normal flow — create new project
      createPromiseRef.current ??= createUntitledProject();
      createPromiseRef.current
        .then(({ id, name }) => openSession(id, name))
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
            onClick={() => window.location.reload()}
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
  const hydration = useCanvasStore((s) => s.hydration);

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

  // /execution socket 单例生命周期挂画布 page（mount ensure / unmount teardown；节点组件只 subscribe 不建连）
  useEffect(() => {
    ensureExecutionSocket(projectId);
    return () => teardownExecutionSocket();
  }, [projectId]);

  // 批3-3 F8：15min 静默 me 探活——session 滑动续期（DB touch + cookie 重发）的唯一 HTTP 载体
  useSessionKeepalive();

  // AddNodeMenu state — shared by + button and right-click triggers
  const menuIsOpen = useMenuStore((s) => s.isOpen);
  const menuPosition = useMenuStore((s) => s.position);
  const menuClose = useMenuStore((s) => s.close);
  const triggerEl = useMenuStore((s) => s.triggerEl);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { triggerRef.current = triggerEl; }, [triggerEl]);

  // Sync projectId to canvasStore so React Flow nodes can access it for socket room join
  useEffect(() => {
    useCanvasStore.getState().setProjectId(projectId);
  }, [projectId]);

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
        <CanvasTopBar projectId={projectId} projectName={projectName} />
        <KeyboardShortcutsPanel isOpen={isShortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <MaterialLibraryModal />
        <HistoryModal />
        <LightingModal />
        <Angle3DModal />
        <VideoEditorShell />
        <AddNodeMenu isOpen={menuIsOpen} onClose={menuClose} triggerRef={triggerRef} position={menuPosition} />
        <HandleAddNodeMenu />
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
          // 非阻断骨架：pointer-events-none 不锁交互（批2-1 蒙层分型——旧阻断遮罩退役）
          <div
            data-testid="hydrate-overlay"
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
          >
            <div className="flex flex-col items-center gap-2 text-text">
              <Spin />
              <span>正在同步</span>
            </div>
          </div>
        )}
        {hydration === 'failed' && (
          <div
            data-testid="offline-overlay"
            role="alert"
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/50"
          >
            <div className="flex flex-col items-center gap-3 text-text">
              <span>画布同步失败</span>
              <button
                type="button"
                onClick={() => window.location.reload()}
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
      if (useCanvasStore.getState().hydration !== 'ready') return;
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
