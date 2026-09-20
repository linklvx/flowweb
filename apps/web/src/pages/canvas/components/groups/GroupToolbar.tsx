// GroupToolbar.tsx — 普通组与分镜组共用容器；分镜组工具栏内容在 Task 11 扩展本组件（switch 渲染）
import { memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useViewport, useInternalNode } from '@xyflow/react';
import { TOOLBAR } from './selectionTokens';

interface Props {
  groupId: string;
  groupType: 'normal' | 'storyboard';
  collapsed: boolean;
  executing: boolean;
  onCollapse: (id: string) => void;
  onExecute: (id: string) => void;
  onUngroup: (id: string) => void;
  onConvert: (id: string, target: 'normal' | 'storyboard') => void;
  convertible?: boolean; // 默认 true；false 时禁用「转分镜组」按钮
  children?: React.ReactNode; // 分镜组专属按钮插槽（Task 11）
}

const btn = (disabled?: boolean): React.CSSProperties => ({
  background: 'none', border: 'none', color: disabled ? '#666' : '#fff',
  padding: '6px 10px', borderRadius: 6, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
});

function GroupToolbarComponent(p: Props) {
  const { x: vpX, y: vpY, zoom } = useViewport();
  const internalNode = useInternalNode(p.groupId);

  const geo = useMemo(() => {
    const w = internalNode?.measured?.width ?? internalNode?.width ?? 0;
    const h = (internalNode?.measured?.height ?? internalNode?.height ?? 0) * zoom;
    if (!internalNode || w === 0) return null;
    const abs = internalNode.internals.positionAbsolute;
    const left = (abs.x + w / 2) * zoom + vpX;
    const topAbs = abs.y * zoom + vpY;
    // 偏移 12 为屏幕常量，变换后外加不乘 zoom
    const isAbove = topAbs - TOOLBAR.offset - TOOLBAR.height > 0;
    return {
      left,
      top: isAbove ? topAbs - TOOLBAR.offset : topAbs + h + TOOLBAR.offset,
      transform: isAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
    };
  }, [internalNode, vpX, vpY, zoom]);

  if (!geo) return null;
  const portalRoot = document.getElementById('node-toolbar-portal');
  if (!portalRoot) return null;

  return createPortal(
    <div
      style={{
        position: 'absolute', left: geo.left, top: geo.top, transform: geo.transform,
        pointerEvents: 'auto', zIndex: 40,
        background: 'rgba(0,0,0,0.85)', borderRadius: 20, padding: '8px 16px', height: TOOLBAR.height,
        display: 'flex', alignItems: 'center', gap: 2, color: '#fff',
      }}
    >
      {p.groupType === 'normal' && (
        <>
          <button style={btn()} onClick={() => p.onCollapse(p.groupId)}>{p.collapsed ? '展开' : '折叠'}</button>
          <Sep />
          <button style={btn(p.executing)} disabled={p.executing} onClick={() => !p.executing && p.onExecute(p.groupId)}>▶ 整组执行</button>
          <Sep />
          <ConvertButton p={p} />
          <Sep />
          <button style={btn(p.executing)} disabled={p.executing} onClick={() => !p.executing && p.onUngroup(p.groupId)}>⧉ 解组</button>
        </>
      )}
      {p.groupType === 'storyboard' && p.children}
    </div>,
    portalRoot,
  );
}

function ConvertButton({ p }: { p: Props }) {
  const disabled = p.executing || p.convertible === false;
  return <button style={btn(disabled)} disabled={disabled} onClick={() => !disabled && p.onConvert(p.groupId, 'storyboard')} title={p.convertible === false ? '仅包含图片节点的组可转为分镜组' : undefined}>▦ 转分镜组</button>;
}

const Sep = () => <span style={{ color: 'var(--canvas-controls-icon)', padding: '0 4px' }}>│</span>;

export const GroupToolbar = memo(GroupToolbarComponent);
