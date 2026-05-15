import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { ReactFlowProvider } from '@xyflow/react';
import { NodePalette } from './components/NodePalette';
import { CanvasView } from './components/CanvasView';
import { CanvasTopBar } from './components/CanvasTopBar';
import { useCanvasPersistence } from './hooks/useCanvasPersistence';
import { useSocket } from '@/hooks/useSocket';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';

const PROJECT_ID_KEY = 'flowweb_projectId';

async function ensureProject(): Promise<string> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '我的画布' }),
  });
  const json = await res.json();
  if (json.code === 0 && json.data?.id) {
    localStorage.setItem(PROJECT_ID_KEY, json.data.id);
    return json.data.id;
  }
  throw new Error('Failed to create project');
}

async function loadProjectIntoStore(projectId: string) {
  const res = await fetch(`/api/projects/${projectId}`);
  const json = await res.json();
  if (json.code !== 0 || !json.data) return;
  const project = json.data;
  // Restore canvas state from DB project
  useCanvasStore.setState({
    nodes: project.nodes || [],
    edges: (project.edges || []).map((e: any) => ({
      id: e.id, source: e.sourceId || e.source, target: e.targetId || e.target,
    })),
    viewport: project.viewport || { x: 0, y: 0, zoom: 1 },
  });
  // Restore node content
  const content: Record<string, any> = {};
  for (const n of project.nodes || []) {
    content[n.id] = n.data || {};
  }
  useNodeStore.setState({ nodes: content });
}

export function CanvasPage() {
  const [searchParams] = useSearchParams();
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    const queryProjectId = searchParams.get('projectId');
    if (queryProjectId) {
      // Imported template — load project from DB into canvas store
      localStorage.setItem(PROJECT_ID_KEY, queryProjectId);
      loadProjectIntoStore(queryProjectId).then(() => setProjectId(queryProjectId));
    } else {
      // Normal flow — create new project
      ensureProject().then(setProjectId);
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
    <CanvasPageInner projectId={projectId} />
  );
}

// 内层组件仅在 projectId 就绪后挂载
function CanvasPageInner({ projectId }: { projectId: string }) {
  useCanvasPersistence(projectId);
  useSocket(projectId);

  return (
    <ReactFlowProvider>
      <div className="flex h-screen bg-[#0f0f0f] relative">
        <NodePalette />
        <CanvasView projectId={projectId} />
        <CanvasTopBar projectId={projectId} />
      </div>
    </ReactFlowProvider>
  );
}
