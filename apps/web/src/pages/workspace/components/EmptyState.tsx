// components/EmptyState.tsx
import type { ReactNode } from 'react';
import { Button } from 'antd';
import { FolderOpenOutlined, SearchOutlined, CloudUploadOutlined, RocketOutlined } from '@ant-design/icons';

type Variant = 'empty-folder' | 'no-results' | 'error' | 'empty-root';

const CONFIG: Record<Variant, { icon: ReactNode; title: string; hint: string; action: string }> = {
  'empty-folder': { icon: <FolderOpenOutlined />, title: '文件夹还是空的', hint: '在当前文件夹创建你的下一个画布', action: '新建画布' },
  'no-results': { icon: <SearchOutlined />, title: '未找到匹配项', hint: '换个关键词试试', action: '清除搜索' },
  error: { icon: <CloudUploadOutlined />, title: '加载失败', hint: '网络异常，请重试', action: '重试' },
  'empty-root': { icon: <RocketOutlined />, title: '开始创建你的第一个画布', hint: '或先建一个文件夹来归类画布', action: '新建画布' },
};

export function EmptyState({ variant, onAction }: { variant: Variant; onAction: () => void }) {
  const cfg = CONFIG[variant];
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3" data-testid={`empty-state-${variant}`}>
      <span className="text-5xl text-white/30">{cfg.icon}</span>
      <p className="text-sm text-white/90 m-0">{cfg.title}</p>
      <p className="text-xs text-white/50 m-0">{cfg.hint}</p>
      <Button type="primary" onClick={onAction}>{cfg.action}</Button>
    </div>
  );
}
