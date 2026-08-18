// components/CreateFolderCard.tsx
import { FolderAddOutlined } from '@ant-design/icons';

export function CreateFolderCard({ onClick }: { onClick: () => void }) {
  return (
    <div
      role="button"
      aria-label="新建文件夹"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className="rounded-2xl border border-dashed border-white/20 hover:border-white/40 bg-transparent hover:bg-white/5 transition-colors p-2 cursor-pointer"
    >
      <div className="w-full rounded-xl flex flex-col items-center justify-center gap-3 bg-white/5" style={{ aspectRatio: '4 / 3' }}>
        <FolderAddOutlined style={{ fontSize: 32, color: 'rgba(255,255,255,0.6)' }} />
        <span className="text-sm text-white/80">新建文件夹</span>
      </div>
      <div className="px-1 pt-2 pb-2 h-[52px]" aria-hidden="true" />
    </div>
  );
}
