// GroupToolbar.tsx — 普通组与分镜组共用容器；分镜组工具栏内容在 Task 11 扩展本组件（switch 渲染）
import { memo } from 'react';

interface Props {
  groupId: string;
  groupType: 'normal' | 'storyboard';
  collapsed: boolean;
  executing: boolean;
  onCollapse: (id: string) => void;
  onExecute: (id: string) => void;
  onUngroup: (id: string) => void;
  onConvert: (id: string, target: 'normal' | 'storyboard') => void;
  children?: React.ReactNode; // 分镜组专属按钮插槽（Task 11）
}

const btn = (disabled?: boolean): React.CSSProperties => ({
  background: 'none', border: 'none', color: disabled ? '#666' : '#fff',
  padding: '6px 10px', borderRadius: 6, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
});

function GroupToolbarComponent(p: Props) {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20"
      style={{ background: 'rgba(0,0,0,0.85)', borderRadius: 20, padding: '8px 16px', height: 40,
               display: 'flex', alignItems: 'center', gap: 2, color: '#fff' }}>
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
    </div>
  );
}

function ConvertButton({ p }: { p: Props }) {
  return <button style={btn(p.executing)} disabled={p.executing} onClick={() => !p.executing && p.onConvert(p.groupId, 'storyboard')}>▦ 转分镜组</button>;
}

const Sep = () => <span style={{ color: 'rgba(255,255,255,0.1)', padding: '0 4px' }}>│</span>;

export const GroupToolbar = memo(GroupToolbarComponent);
