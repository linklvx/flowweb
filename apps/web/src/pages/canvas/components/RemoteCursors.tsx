import { useEffect, useState } from 'react';
import type { AwarenessBridge, AwarenessState } from '@/collab/awareness';
import { userColor } from '@/collab/awareness';

/** 远端光标层：cursor 存流坐标，由父级 viewport 变换容器跟随缩放平移 */
export function RemoteCursors({ bridge }: { bridge: AwarenessBridge }) {
  const [states, setStates] = useState<AwarenessState[]>([]);

  useEffect(() => {
    const update = () => setStates([...bridge.getRemoteStates()]);
    update();
    return bridge.onStateChange(update);
  }, [bridge]);

  return (
    <>
      {states.filter((s) => s.cursor && s.user).map((s, i) => (
        <div
          key={i}
          data-testid={`remote-cursor-${s.user.id}`}
          style={{
            position: 'absolute',
            left: s.cursor!.x,
            top: s.cursor!.y,
            pointerEvents: 'none',
            zIndex: 30,
          }}
        >
          <svg width="14" height="18" viewBox="0 0 14 18" style={{ display: 'block' }}>
            <path d="M0 0 L14 7 L6 8 L4 18 Z" fill={userColor(s.user.id)} stroke="#111" strokeWidth="0.8" />
          </svg>
          <span
            style={{
              background: userColor(s.user.id),
              color: '#111',
              fontSize: 10,
              padding: '1px 4px',
              borderRadius: 3,
              whiteSpace: 'nowrap',
              marginLeft: 8,
            }}
          >
            {s.user.name}
          </span>
        </div>
      ))}
    </>
  );
}
