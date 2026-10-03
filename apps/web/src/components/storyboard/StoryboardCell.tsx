// apps/web/src/components/storyboard/StoryboardCell.tsx
// O0c-2（Spec B）：随 StoryboardGroupRenderer 自 canvas 页目录抽迁（spec v3.12：抽取组件落点=
// components/storyboard/——防 videos→canvas 深层依赖架空"零 store 依赖"红线）。
// CellNodeInfo 双通道（O0c-1/O0c-2）：主画布通道 fileId（经 useMediaUrl 现取预签名）/公开页通道
// thumbnailUrl（deriveRenderCanvas cellNodes 载荷）——组件入参同形，两通道字段同构。
import { memo } from 'react';
import { useMediaUrl } from '@/hooks/useMediaUrl';

export interface CellNodeInfo { id: string; fileId?: string; status?: string; thumbnailUrl?: string }

interface Props {
  index: number;
  info?: CellNodeInfo;
  showIndex: boolean;
  selectedCell: number | null;
  onSelectCell: (index: number | null) => void;
  /** 主画布通道注入（公开页缺省——空格不渲染 + 按钮，只读页无死交互） */
  onFillEmpty?: (index: number) => void;
}

function StoryboardCellComponent(p: Props) {
  // 取图走项目现有 useMediaUrl 模式（P0-2）：GET /media/:fileId/url 返回 JSON { url }（预签名地址经
  // /flowai 代理改写），不是图片流，不能直接作 img src；data.mediaUrl 不再写入/读取（R2b-6 写入面清零、
  // R2b-7 读点清零——遗留持久化 URL 一律无视），URL 一律经 useMediaUrl(fileId) 现取+缓存自愈。
  // 公开页通道（O0c-2）：fileId 缺席（公开 payload 泄漏红线剥除）→ thumbnailUrl 直用（无解析层）。
  const { url: resolvedUrl, onError: onResolvedError } = useMediaUrl(p.info?.fileId ?? null);
  const imgSrc = resolvedUrl ?? p.info?.thumbnailUrl;
  // 100% 填充 1fr 轨道：固定像素会被轨道 auto-min 下限撑破容器（grid 溢出组边框）
  const style: React.CSSProperties = {
    width: '100%', height: '100%', position: 'relative',
    border: p.selectedCell === p.index ? '1px solid var(--fw-text)' : 'none',
    overflow: 'hidden',
  };
  if (!p.info) {
    return (
      <div style={{ ...style, border: '1px dashed #444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {p.onFillEmpty && (
          <button onClick={() => p.onFillEmpty!(p.index)}
            style={{ background: 'none', border: 'none', color: '#666', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>+</button>
        )}
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
        onError={onResolvedError}
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
