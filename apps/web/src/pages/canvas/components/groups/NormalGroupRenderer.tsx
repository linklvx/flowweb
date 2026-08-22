// NormalGroupRenderer.tsx
import { memo } from 'react';
import type { GroupNodeData } from '@/types/group';

interface Props { data: GroupNodeData; selected: boolean }

function NormalGroupRendererComponent({ data, selected }: Props) {
  if (data.collapsed) {
    return (
      <div
        style={{
          width: 200, height: 64, borderRadius: 8,
          border: `1px solid ${selected ? '#4ade80' : '#4a4a4a'}`,
          background: 'rgba(26,26,26,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#999999', fontSize: 13,
        }}
      >
        {data.name ?? '分组'}
      </div>
    );
  }
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        style={{
          position: 'absolute', inset: 0, borderRadius: 8,
          border: `1px solid ${selected ? '#4ade80' : '#4a4a4a'}`,
          background: 'rgba(26,26,26,0.6)', pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute', top: -10, left: 8, padding: '0 6px',
          background: '#0a0a0a', color: '#999999', fontSize: 12, whiteSpace: 'nowrap',
        }}
      >
        {data.name ?? '分组'}
      </div>
    </div>
  );
}
export const NormalGroupRenderer = memo(NormalGroupRendererComponent);
