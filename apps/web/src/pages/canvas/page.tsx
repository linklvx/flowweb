import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { message } from 'antd';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { NodePalette } from './components/NodePalette';
import { AddNodeMenu } from './components/AddNodeMenu';
import { KeyboardShortcutsPanel } from './components/KeyboardShortcutsPanel';
import { CanvasView } from './components/CanvasView';
import MaterialLibraryModal from '@/components/MaterialLibrary/MaterialLibraryModal';
import { HistoryModal } from '@/components/HistoryPage/HistoryModal';
import { LightingModal } from './components/Lighting/LightingModal';
import { Angle3DModal } from './components/Angle3D/Angle3DModal';
import { useMenuStore } from '@/stores/menuStore';
import { CanvasTopBar } from './components/CanvasTopBar';
import { ProjectTitle } from './components/ProjectTitle';
import { useCanvasPersistence } from './hooks/useCanvasPersistence';
import { useSocket } from '@/hooks/useSocket';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { createCanvas } from '@/api/canvasApi';

const PROJECT_ID_KEY = 'flowweb_projectId';

// 空名创建：编号由后端生成，画布进入工作空间根目录
async function createUntitledProject(): Promise<{ id: string; name: string }> {
  const { projectId, name } = await createCanvas('', null);
  localStorage.setItem(PROJECT_ID_KEY, projectId);
  return { id: projectId, name };
}

const STORAGE_KEY = 'flowweb_canvas';

class ProjectInaccessibleError extends Error {}
class ProjectLoadError extends Error {}

// 脏数据防御：解析失败 = 无本地数据，并清除脏 key
function safeParseLocalNodes(key: string, isContentKey: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return isContentKey
      ? Object.keys(parsed).length > 0
      : parsed?.nodes?.length > 0;
  } catch {
    localStorage.removeItem(key);
    return false;
  }
}

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

  // DB 空守卫：写库链路未生效期间 DB 空不代表画布空，本地已有数据时不覆盖
  if (!(project.nodes?.length)) {
    const canvasHasNodes = useCanvasStore.getState().nodes.length > 0;
    const localHasNodes =
      safeParseLocalNodes(`${STORAGE_KEY}_${projectId}`, false) ||
      safeParseLocalNodes(`${STORAGE_KEY}_content_${projectId}`, true);
    if (canvasHasNodes || localHasNodes) {
      return project.name || '未命名项目';
    }
  }

  // 丢弃过期响应（effect 重跑/StrictMode）的 store 写入
  if (isCancelled?.()) return project.name || '未命名项目';

  // Restore canvas state from DB project
  useCanvasStore.setState({
    nodes: (project.nodes || []).map((n: any) => ({
      ...n,
      width: n.width ?? 300,
      height: n.height ?? 300,
    })),
    edges: (project.edges || []).map((e: any) => ({
      id: e.id, source: e.sourceId || e.source, target: e.targetId || e.target,
    })),
    viewport: project.viewport || { x: 0, y: 0, zoom: 1 },
  });
  // Restore node content as AppNode structure
  const content: Record<string, any> = {};
  for (const n of project.nodes || []) {
    content[n.id] = {
      id: n.id,
      type: n.type,
      position: n.position || { x: 0, y: 0 },
      data: n.data || {},
      width: n.width ?? 300,
      height: n.height ?? 300,
    };
  }
  useNodeStore.setState({ nodes: content });
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

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);

    // 项目切换/新建前同步清空模块级 store 残留，否则残留会骗过下方 DB 空守卫（Bug 3）
    const storedId = queryProjectId || localStorage.getItem(PROJECT_ID_KEY);
    const target = storedId ?? null;
    if (target === null || target !== lastPidRef.current) {
      useCanvasStore.setState({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
      useNodeStore.setState({ nodes: {} });
    }
    lastPidRef.current = target;

    const finish = (id: string, name: string) => {
      if (cancelled) return;
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
            createUntitledProject()
              .then(({ id, name }) => finish(id, name))
              .catch(() => setLoadError('network'));
            return;
          }
          setLoadError(e instanceof ProjectInaccessibleError ? 'inaccessible' : 'network');
        });
    } else {
      // Normal flow — create new project
      createUntitledProject()
        .then(({ id, name }) => finish(id, name))
        .catch(() => {
          if (!cancelled) setLoadError('network');
        });
    }
    return () => {
      cancelled = true;
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
      <div className="flex h-screen bg-[#0f0f0f] flex-col items-center justify-center gap-5">
        <span className="text-white/70 text-sm">
          {isInaccessible ? '画布不存在或无权访问' : '画布加载失败，请检查网络后重试'}
        </span>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleRetry}
            className="px-4 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 text-sm cursor-pointer border-0"
          >
            重试
          </button>
          {isInaccessible ? (
            <button
              type="button"
              onClick={() => navigate('/works')}
              className="px-4 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 text-sm cursor-pointer border-0"
            >
              返回工作空间
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreateNew}
              className="px-4 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 text-sm cursor-pointer border-0"
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
      <div className="flex h-screen bg-[#0f0f0f] items-center justify-center">
        <span className="text-[#555]">加载画布...</span>
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
  useSocket(projectId);

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
      <div className="h-screen bg-[#0f0f0f] relative overflow-hidden">
        <ProjectTitle projectId={projectId} projectName={projectName} onNameChange={onNameChange} />
        <NodePalette onToggleShortcuts={() => setShortcutsOpen((v) => !v)} />
        <CanvasView projectId={projectId} />
        <CanvasTopBar projectId={projectId} projectName={projectName} />
        <KeyboardShortcutsPanel isOpen={isShortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <MaterialLibraryModal />
        <HistoryModal />
        <LightingModal />
        <Angle3DModal />
        <AddNodeMenu isOpen={menuIsOpen} onClose={menuClose} triggerRef={triggerRef} position={menuPosition} />
      </div>
    </ReactFlowProvider>
  );
}

/** Global canvas keyboard shortcuts — must be inside ReactFlowProvider to use useReactFlow */
function CanvasKeyboardHandler() {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
