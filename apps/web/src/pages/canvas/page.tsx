import { useState, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { NodePalette } from './components/NodePalette';
import { CanvasView } from './components/CanvasView';
import { CanvasTopBar } from './components/CanvasTopBar';
import { useCanvasPersistence } from './hooks/useCanvasPersistence';
import { useSocket } from '@/hooks/useSocket';

const PROJECT_ID_KEY = 'flowweb_projectId';

async function ensureProject(): Promise<string> {
  const cached = localStorage.getItem(PROJECT_ID_KEY);
  if (cached) {
    const check = await fetch(`/api/projects/${cached}`);
    if (check.ok) {
      const json = await check.json();
      if (json.code === 0) return cached;
    }
  }
  // Create new project
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

export function CanvasPage() {
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    ensureProject().then(setProjectId);
  }, []);

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
