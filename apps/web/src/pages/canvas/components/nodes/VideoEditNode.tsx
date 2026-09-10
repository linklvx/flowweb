// apps/web/src/pages/canvas/components/nodes/VideoEditNode.tsx
import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { NodeHandle } from './NodeHandle';

function VideoEditNodeComponent({ id, selected }: NodeProps) {
  return (
    <div className="relative canvas-node" data-testid={`video-edit-node-${id}`}>
      <div
        className="bg-white rounded-lg overflow-hidden box-border"
        style={{
          width: 316,
          border: '1px solid #E5E7EB',
          margin: 2,
          ...(selected ? { border: '1px solid #6C5CE7', boxShadow: '0 0 0 3px rgba(108,92,231,0.25)' } : {}),
        }}
      >
        <NodeHandle type="target" testId="video-edit-target" />
        <div className="px-3 py-2 text-[14px] font-medium text-[#1F2329]">多轨道剪辑</div>
        <NodeHandle type="source" testId="video-edit-source" />
      </div>
    </div>
  );
}

export const VideoEditNode = memo(VideoEditNodeComponent);
