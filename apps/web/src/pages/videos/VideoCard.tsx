// VideoCard.tsx（D13：只有封面+时长+标题+标签）
import { Link } from 'react-router';
import type { VideoWorkListItem } from '@flowweb/shared';

const fmtDuration = (sec: number | null) => {
  if (sec == null) return null;
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export function VideoCard({ work }: { work: VideoWorkListItem }) {
  const duration = fmtDuration(work.durationSec);
  return (
    <Link to={`/videos/${work.id}`} state={{ fromList: true }} data-card className="block rounded-lg overflow-hidden border border-solid border-[var(--vw-card-border)] hover:border-[var(--vw-card-border-hover)] transition-colors bg-[var(--vw-card-bg)]">
      {/* 第七轮：补 state:{fromList:true}（C2 M4——否则关闭算法死代码）+ 改用 Task 7.3 登记的 --vw-* token（原硬编码使 token 成死变量） */}
      <div className="relative aspect-video bg-[#262626]">
        {work.coverUrl
          ? <img src={work.coverUrl} alt={work.title} className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center text-white/30 text-sm">暂无封面</div>}
        {duration && (
          <span className="absolute right-1.5 bottom-1.5 bg-black/70 text-white text-[11px] rounded px-1 py-px" data-testid="duration">
            {duration}
          </span>
        )}
      </div>
      <div className="p-2.5">
        <div className="text-[13px] font-medium text-white truncate">{work.title}</div>
        {work.tags.length > 0 && (
          <div className="mt-1.5 flex gap-1.5 flex-wrap">
            {work.tags.map(t => (
              <span key={t} className="text-[11px] px-1.5 py-px rounded bg-white/10 text-white/70">{t}</span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
