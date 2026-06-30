import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { NodePalette } from './components/NodePalette';
import { KeyboardShortcutsPanel } from './components/KeyboardShortcutsPanel';
import { CanvasView } from './components/CanvasView';
import MaterialLibraryModal from '@/components/MaterialLibrary/MaterialLibraryModal';
import { HistoryModal } from '@/components/HistoryPage/HistoryModal';
import { LightingModal } from './components/Lighting/LightingModal';
import { Angle3DModal } from './components/Angle3D/Angle3DModal';
import { CanvasTopBar } from './components/CanvasTopBar';
import { ProjectTitle } from './components/ProjectTitle';
import { useCanvasPersistence } from './hooks/useCanvasPersistence';
import { useSocket } from '@/hooks/useSocket';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { useMenuStore } from '@/stores/menuStore';

const PROJECT_ID_KEY = 'flowweb_projectId';

async function ensureProject(): Promise<{ id: string; name: string }> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '未命名项目' }),
  });
  const json = await res.json();
  if (json.code === 0 && json.data?.id) {
    localStorage.setItem(PROJECT_ID_KEY, json.data.id);
    return { id: json.data.id, name: json.data.name || '未命名项目' };
  }
  throw new Error('Failed to create project');
}

async function loadProjectIntoStore(projectId: string): Promise<string> {
  const res = await fetch(`/api/projects/${projectId}`);
  const json = await res.json();
  if (json.code !== 0 || !json.data) return '未命名项目';
  const project = json.data;
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
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('未命名项目');

  useEffect(() => {
    const queryProjectId = searchParams.get('projectId');
    if (queryProjectId) {
      // Imported template — load project from DB into canvas store
      localStorage.setItem(PROJECT_ID_KEY, queryProjectId);
      loadProjectIntoStore(queryProjectId).then((name) => {
        setProjectId(queryProjectId);
        setProjectName(name);
      });
    } else {
      // Normal flow — create new project
      ensureProject().then(({ id, name }) => {
        setProjectId(id);
        setProjectName(name);
      });
    }
  }, [searchParams]);

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

  // Abort all in-progress split tasks when leaving canvas page
  useEffect(() => {
    return () => {
      const state = useCanvasStore.getState();
      const map = state?.splitAbortMap;
      if (map) {
        for (const ac of Object.values(map)) {
          ac.abort();
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
        useMenuStore.getState().open();
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
