import { useState, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { NodePalette } from './components/NodePalette';
import { CanvasView } from './components/CanvasView';
import { CanvasTopBar } from './components/CanvasTopBar';
import { useCanvasPersistence } from './hooks/useCanvasPersistence';
import { useSocket } from '@/hooks/useSocket';

const PROJECT_ID_KEY = 'flowweb_projectId';

async function ensureProject(projectId: string): Promise<string> {
  // Check if project exists in DB
  const check = await fetch(`/api/projects/${projectId}`);
  if (check.ok) {
    const json = await check.json();
    if (json.code === 0) return projectId;
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
  return projectId; // fallback
}

export function CanvasPage() {
  const [projectId, setProjectId] = useState(() => localStorage.getItem(PROJECT_ID_KEY) || 'default');

  useEffect(() => {
    ensureProject(projectId).then(setProjectId);
  }, []);

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
