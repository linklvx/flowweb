// components/CreateCanvasCard.tsx
import { PlusOutlined } from '@ant-design/icons';

export function CreateCanvasCard({ onClick }: { onClick: () => void }) {
  return (
    <div
      role="button"
      aria-label="新建画布"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className="rounded-2xl border border-dashed border-overlay-3 hover:border-white/40 bg-transparent hover:bg-overlay-1 transition-colors p-2 h-full"
    >
      <div className="h-full w-full rounded-xl flex flex-col items-center justify-center gap-3 bg-overlay-1" style={{ aspectRatio: '4 / 3' }}>
        <PlusOutlined style={{ fontSize: 32, color: 'rgba(255,255,255,0.6)' }} />
        <span className="text-sm text-text">新建画布</span>
      </div>
    </div>
  );
}
