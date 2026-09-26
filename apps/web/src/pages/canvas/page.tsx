import { initCollab, destroyCollab } from '@/stores/canvasCollabRuntime';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { message, Spin } from 'antd';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { NodePalette } from './components/NodePalette';
import { AddNodeMenu } from './components/AddNodeMenu';
import { HandleAddNodeMenu } from './components/HandleAddNodeMenu';
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
import { useCanvasPersistence } from './hooks/useCanvasPersistence';
import { loadSnapshot, isEmptySnapshot } from './hooks/canvasSnapshot';
import { hydrateNodes } from '@/utils/nodeOrder';
import { ensureExecutionSocket, teardownExecutionSocket } from '@/services/executionSocket';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { useGroupKeyboard } from '@/hooks/useGroupKeyboard';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { createCanvas, getProjectFolder } from '@/api/canvasApi';
import { apiFetch } from '@/api/client';
import { refitExpandedGroups } from '@/stores/canvasCollabRuntime';

const PROJECT_ID_KEY = 'flowweb_projectId';

// 空名创建：编号由后端生成，画布进入工作空间根目录
async function createUntitledProject(): Promise<{ id: string; name: string }> {
  const { projectId, name, teamId } = await createCanvas('', null);
  localStorage.setItem(PROJECT_ID_KEY, projectId);
  useCanvasStore.getState().setTeamId(teamId ?? null);
  return { id: projectId, name };
}

class ProjectInaccessibleError extends Error {}
class ProjectLoadError extends Error {}

async function loadProjectIntoStore(
  projectId: string,
  isCancelled?: () => boolean,
): Promise<string> {
  const res = await fetch(`/api/projects/${projectId}`);
  if (res.status === 404 || res.status === 403) throw new ProjectInaccessibleError();
  if (!res.ok) throw new ProjectLoadError();
  const json = await res.json();
  if (json.code !== 0 || !json.data) return '未命名项目';
  const project = json.data;

  // 丢弃过期响应（effect 重跑/StrictMode）的 store 写入
  if (isCancelled?.()) return project.name || '未命名项目';

  // 画布团队上下文（顶栏积分/上传/素材库消费）
  useCanvasStore.getState().setTeamId(project.teamId ?? null);

  // Task14：画布内容改经 server doc 加载（synced 后 applyDocToStore；
  // 本地崩溃快照在连接前 apply 到本地 doc，标准 sync 自动合并——D2）
  await initCollab(projectId);
  if (isCancelled?.()) return project.name || '未命名项目';
  return project.name || '未命名项目';
}

export function CanvasPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('未命名项目');
  const [loadError, setLoadError] = useState<'inaccessible' | 'network' | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const queryProjectId = searchParams.get('projectId');
  const lastPidRef = useRef<string | null>(null);
  // StrictMode 双执行共享同一次创建请求，避免重复建画布；失败后清空以允许重试
  const createPromiseRef = useRef<Promise<{ id: string; name: string }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    // 每轮开局归零：清上一轮 cancelled 遗留的悬停 hydrating（三保险之一）
    useCanvasStore.getState().setHydrating(false);

    // 项目切换/新建前同步清空模块级 store 残留，否则残留会骗过下方 DB 空守卫（Bug 3）
    const storedId = queryProjectId || localStorage.getItem(PROJECT_ID_KEY);
    const target = storedId ?? null;
    if (target === null || target !== lastPidRef.current) {
      // hydrate 窗口开启：清 store 至 DB 加载/兜底恢复完成期间，抑制本地快照空写
      useCanvasStore.getState().setHydrating(true);
      useCanvasStore.setState({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, teamId: null });
      useNodeStore.setState({ nodes: {} });
    }
    lastPidRef.current = target;

    const finish = (id: string, name: string) => {
      if (cancelled) return;
      useCanvasStore.getState().setHydrating(false);
      setProjectId(id);
      setProjectName(name);
    };

    // 优先 query 参数（工作空间/模板导入），否则恢复最近项目
    if (storedId) {
      if (queryProjectId) localStorage.setItem(PROJECT_ID_KEY, queryProjectId);
      loadProjectIntoStore(storedId, () => cancelled)
        .then((name) => finish(storedId, name))
        .catch((e: unknown) => {
          if (cancelled) return;
          if (e instanceof ProjectInaccessibleError && !queryProjectId) {
            // 无参路径：项目已删除/无权 → 清 key → fallback 新建（loading 不中断，避免闪烁）
            localStorage.removeItem(PROJECT_ID_KEY);
            message.warning('上次的画布已不存在，已为你新建');
            createPromiseRef.current ??= createUntitledProject();
            createPromiseRef.current
              .then(({ id, name }) => finish(id, name))
              .catch(() => {
                createPromiseRef.current = null;
                if (cancelled) return;
                useCanvasStore.getState().setHydrating(false);
                setLoadError('network');
              });
            return;
          }
          useCanvasStore.getState().setHydrating(false);
          setLoadError(e instanceof ProjectInaccessibleError ? 'inaccessible' : 'network');
        });
    } else {
      // Normal flow — create new project
      createPromiseRef.current ??= createUntitledProject();
      createPromiseRef.current
        .then(({ id, name }) => finish(id, name))
        .catch(() => {
          createPromiseRef.current = null;
          if (!cancelled) {
            useCanvasStore.getState().setHydrating(false);
            setLoadError('network');
          }
        });
    }
    return () => {
      cancelled = true;
      void destroyCollab();
    };
  }, [queryProjectId, retryKey]);

  const handleRetry = () => setRetryKey((k) => k + 1);
  const handleCreateNew = () => {
    localStorage.removeItem(PROJECT_ID_KEY);
    setLoadError(null);
    setRetryKey((k) => k + 1);
  };

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
          ) : (
            <button
              type="button"
              onClick={handleCreateNew}
              className="px-4 h-9 rounded-lg bg-overlay-2 hover:bg-overlay-3 text-text text-sm border-0"
            >
              新建画布
            </button>
          )}
        </div>
      </div>
    );
  }

  // 等待项目就绪后才渲染
  if (!projectId) {
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
  useCanvasPersistence(projectId);

  // /execution socket 单例生命周期挂画布 page（mount ensure / unmount teardown；节点组件只 subscribe 不建连）
  useEffect(() => {
    ensureExecutionSocket(projectId);
    return () => teardownExecutionSocket();
  }, [projectId]);

  // AddNodeMenu state — shared by + button and right-click triggers
  const menuIsOpen = useMenuStore((s) => s.isOpen);
  const menuPosition = useMenuStore((s) => s.position);
  const menuClose = useMenuStore((s) => s.close);
  const triggerEl = useMenuStore((s) => s.triggerEl);
  const isHydrating = useCanvasStore((s) => s.isHydrating);
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
        {isHydrating && (
          <div
            data-testid="hydrate-overlay"
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/50"
          >
            <div className="flex flex-col items-center gap-2 text-text">
              <Spin />
              <span>画布加载中</span>
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
      // TD-4：hydrate 窗口内忽略快捷键（遮罩封指针路径，这里封键盘路径）
      if (useCanvasStore.getState().isHydrating) return;
      if (useVideoEditorStore.getState().open) return; // 视频编辑器打开期间画布快捷键全禁（spec 验收 27——Tab/Ctrl+0/Alt+Shift+F 不再开幽灵菜单/改视口）
      if (useNodeStore.getState().referenceSelect) return; // 参考选择模式禁画布快捷键（含 Tab→AddNodeMenu，spec §3.1）
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
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
