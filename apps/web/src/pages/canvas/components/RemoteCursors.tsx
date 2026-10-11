import { useEffect, useState } from 'react';
import type { AwarenessBridge, AwarenessState } from '@/collab/awareness';
import { useCanvasStore } from '@/stores/canvasStore';

/** 远端光标层：cursor 存流坐标，由父级 viewport 变换容器跟随缩放平移
 *  Y0b-4 T12（E38）：selection 高亮层——nodeIds×store 节点几何渲染节点框 overlay（色=注入 user.color） */
export function RemoteCursors({ bridge }: { bridge: AwarenessBridge }) {
  const [states, setStates] = useState<AwarenessState[]>([]);
  const nodes = useCanvasStore((s) => s.nodes);

  useEffect(() => {
    const update = () => setStates([...bridge.getRemoteStates()]);
    update();
    return bridge.onStateChange(update);
  }, [bridge]);

  return (
    <>
      {states
        .filter((s) => s.selection?.nodeIds?.length && s.user?.id && s.user?.name)
        .flatMap((s) =>
          s.selection!.nodeIds.map((id) => {
            const n = nodes.find((x) => x.id === id);
            if (!n) return null;   // 离线残留 selection/未知节点——跳过（不高亮不抛）
            const pos = (n as any).internals?.positionAbsolute ?? n.position ?? { x: 0, y: 0 };   // 几何链先例=CanvasReferenceSelectBanner
            const w = n.width ?? (n as any).measured?.width ?? 200;   // 三档链 width 第一档（B 类屏幕空间 overlay——先例=addOutput.ts）
            const h = n.height ?? (n as any).measured?.height ?? 200;
            return (
              <div
                key={`sel-${s.user.id}-${id}`}
                data-testid={`remote-selection-${s.user.id}`}
                style={{
                  position: 'absolute',
                  left: pos.x,
                  top: pos.y,
                  width: w,
                  height: h,
                  border: `1.5px solid ${s.user.color}`,   // T7 同源：注入 color——禁 fallback 双源
                  background: 'rgba(127, 127, 127, 0.08)',
                  borderRadius: 4,
                  pointerEvents: 'none',
                  zIndex: 25,
                }}
              />
            );
          }),
        )}
      {states.filter((s) => s.cursor && s.user?.id && s.user?.name).map((s, i) => (
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
            <path d="M0 0 L14 7 L6 8 L4 18 Z" fill={s.user.color} stroke="#111" strokeWidth="0.8" />   {/* Y0b-3 T7：服务端注入 color——禁 fallback 双源 */}
          </svg>
          <span
            style={{
              background: s.user.color,
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
