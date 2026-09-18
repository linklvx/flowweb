import { CloseOutlined } from '@ant-design/icons';
import { useAnnouncementStore } from '@/stores/announcementStore';

export function AnnouncementBar() {
  const announcement = useAnnouncementStore(s => s.announcement);
  const dismiss = useAnnouncementStore(s => s.dismiss);

  if (!announcement) return null;
  const { message, linkText, linkUrl, bgColor, textColor } = announcement;

  return (
    <div className="sticky top-0 z-40 p-2 bg-bg">
      <div
        data-testid="announcement-bar"
        className="h-12 rounded-lg px-12 flex items-center justify-center gap-3 relative cursor-pointer"
        style={{ backgroundColor: bgColor, color: textColor }}
        onClick={() => { if (linkUrl) window.open(linkUrl, '_blank', 'noopener noreferrer'); }}
      >
        <span className="text-sm font-medium leading-[22px] truncate">{message}</span>
        {linkText && linkUrl && (
          <button
            data-testid="announcement-link-btn"
            onClick={(e) => {
              e.stopPropagation();
              window.open(linkUrl, '_blank', 'noopener noreferrer');
            }}
            className="shrink-0 rounded-full border hover:bg-overlay-2 text-[13px] leading-none px-3 py-1"
            style={{ color: textColor, borderColor: 'rgba(255,255,255,0.5)' }}
          >
            {linkText}
          </button>
        )}
        <button
          aria-label="关闭公告"
          data-testid="announcement-close-btn"
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
          className="absolute right-3 w-6 h-6 rounded-full hover:bg-overlay-2 flex items-center justify-center text-text-dim-3 hover:text-text transition-colors"
        >
          <CloseOutlined className="text-sm" />
        </button>
      </div>
    </div>
  );
}
