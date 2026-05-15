import { ReactFlowProvider } from '@xyflow/react';
import { NodePalette } from './components/NodePalette';
import { CanvasView } from './components/CanvasView';
import { CanvasTopBar } from './components/CanvasTopBar';
import { useCanvasPersistence } from './hooks/useCanvasPersistence';
import { useSocket } from '@/hooks/useSocket';

export function CanvasPage() {
  useCanvasPersistence('default');
  useSocket('default');
  return (
    <ReactFlowProvider>
      <div className="flex h-screen bg-[#0f0f0f] relative">
        <NodePalette />
        <CanvasView projectId="default" />
        <CanvasTopBar />
      </div>
    </ReactFlowProvider>
  );
}
