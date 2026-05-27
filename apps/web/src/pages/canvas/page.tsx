import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { ReactFlowProvider } from '@xyflow/react';
import { NodePalette } from './components/NodePalette';
import { CanvasView } from './components/CanvasView';
import { CanvasTopBar } from './components/CanvasTopBar';
import { ProjectTitle } from './components/ProjectTitle';
import { useCanvasPersistence } from './hooks/useCanvasPersistence';
import { useSocket } from '@/hooks/useSocket';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';

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

  return (
    <ReactFlowProvider>
      <div className="h-screen bg-[#0f0f0f] relative">
        <ProjectTitle projectId={projectId} projectName={projectName} onNameChange={onNameChange} />
        <NodePalette />
        <CanvasView projectId={projectId} />
        <CanvasTopBar projectId={projectId} projectName={projectName} />
      </div>
    </ReactFlowProvider>
  );
}
