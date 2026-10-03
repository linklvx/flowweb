// apps/web/src/pages/canvas/components/groups/BatchConnectLines.tsx
// B6-2（Spec B 需求 7 前置）：+号拖线层——同 #node-toolbar-portal 屏幕空间自绘 SVG 多段线
// （每源节点右缘中点→指针当前位置，v2.2 §3.6）；命中高亮/连线语义归 B6-3。
interface Props {
  /** 源锚点（portal 屏幕坐标——右缘中点） */
  sources: Array<{ x: number; y: number }>;
  /** 指针当前位置（portal 屏幕坐标） */
  pointer: { x: number; y: number };
}

export function BatchConnectLines({ sources, pointer }: Props) {
  return (
    <svg
      data-testid="batch-connect-lines"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 41, overflow: 'visible' }}
    >
      {sources.map((s, i) => (
        <line key={i} x1={s.x} y1={s.y} x2={pointer.x} y2={pointer.y} stroke="var(--fw-accent-text)" strokeWidth={2} />
      ))}
      {/* 指示器跟随指针 */}
      <circle cx={pointer.x} cy={pointer.y} r={4} fill="var(--fw-accent-text)" />
    </svg>
  );
}
