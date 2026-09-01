import { PetalIcon } from './FolderStackPreview';

const FALLBACK = 'linear-gradient(#CCCCCC 0%, #939E9E 100%)';

// 参考设计像素：left/top/w/h/rotate/z（72x48 容器内三张小卡错位旋转）
const CARDS = [
  { left: 12.8, top: 15.87, width: 19.56, height: 26.08, rotate: -15, z: 1 },
  { left: 25.6, top: 8.8, width: 20, height: 26.4, rotate: 0, z: 2 },
  { left: 40.4, top: 10.87, width: 19.56, height: 26.08, rotate: 15, z: 3 },
];

interface FolderListPreviewProps {
  thumbnails: string[]; // 合法 CSS background 值
}

export function FolderListPreview({ thumbnails }: FolderListPreviewProps) {
  return (
    <div
      className="relative overflow-hidden rounded-lg shrink-0"
      style={{ width: 72, height: 48, background: 'linear-gradient(136deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 100%), rgb(26, 30, 32)' }}
    >
      {CARDS.map((c, i) => (
        <div
          key={i}
          data-testid="stack-card"
          className="absolute"
          style={{
            left: c.left, top: c.top, width: c.width, height: c.height, zIndex: c.z,
            transform: `rotate(${c.rotate}deg)`, transformOrigin: 'left top',
            borderRadius: 4, overflow: 'hidden',
            outline: '1px solid rgba(204,204,204,0.4)',
            boxShadow: '-2px -1px 10.5px rgba(0,0,0,0.4)',
            background: thumbnails[i] ?? FALLBACK,
          }}
        >
          <div className="absolute left-1 top-1"><PetalIcon size={8} /></div>
        </div>
      ))}
    </div>
  );
}
