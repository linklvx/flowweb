import { ReactFlowProvider } from '@xyflow/react';
import { NodePalette } from './components/NodePalette';
import { CanvasView } from './components/CanvasView';

export function CanvasPage() {
  return (
    <ReactFlowProvider>
      <div className="flex h-screen bg-[#0f0f0f]">
        <NodePalette />
        <CanvasView projectId="default" />
      </div>
    </ReactFlowProvider>
  );
}
