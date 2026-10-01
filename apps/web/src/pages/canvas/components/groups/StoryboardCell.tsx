// StoryboardCell.tsx
import { memo } from 'react';
import { useMediaUrl } from '@/hooks/useMediaUrl';

export interface CellNodeInfo { id: string; fileId?: string; status?: string; url?: string }

interface Props {
  index: number;
  info?: CellNodeInfo;
  showIndex: boolean;
  selectedCell: number | null;
  onSelectCell: (index: number | null) => void;
  onFillEmpty: (index: number) => void;
}

function StoryboardCellComponent(p: Props) {
  // 取图走项目现有 useMediaUrl 模式（P0-2）：GET /media/:fileId/url 返回 JSON { url }（预签名地址经
  // /flowai 代理改写），不是图片流，不能直接作 img src；data.mediaUrl（展开/填充时已写入）优先短路请求
  const { url: resolvedUrl, onError: onResolvedError } = useMediaUrl(p.info?.fileId ?? null);
  const imgSrc = p.info?.url ?? resolvedUrl ?? undefined;
  // 100% 填充 1fr 轨道：固定像素会被轨道 auto-min 下限撑破容器（grid 溢出组边框）
  const style: React.CSSProperties = {
    width: '100%', height: '100%', position: 'relative',
    border: p.selectedCell === p.index ? '1px solid var(--fw-text)' : 'none',
    overflow: 'hidden',
  };
  if (!p.info) {
    return (
      <div style={{ ...style, border: '1px dashed #444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button onClick={() => p.onFillEmpty(p.index)}
          style={{ background: 'none', border: 'none', color: '#666', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>+</button>
      </div>
    );
  }
  if (p.info.status === 'loading') {
    return (
      <div style={{ ...style, background: 'var(--canvas-controls-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 12 }}>
        生成中…
      </div>
    );
  }
  return (
    <div style={style} onClick={(e) => { e.stopPropagation(); p.onSelectCell(p.index); }}>
      <img src={imgSrc} alt="" loading="lazy" decoding="async"
        onError={p.info?.url ? undefined : onResolvedError}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {p.showIndex && (
        <span style={{ position: 'absolute', left: 12, bottom: 10, color: '#fff',
          fontSize: 16, fontWeight: 600, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
          {String(p.index + 1).padStart(2, '0')}
        </span>
      )}
    </div>
  );
}

export const StoryboardCell = memo(StoryboardCellComponent);
