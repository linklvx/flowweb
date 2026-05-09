import { CloseOutlined } from '@ant-design/icons';

interface Props {
  message: string;
  linkUrl?: string;
  onClose?: () => void;
}

export function AnnouncementBanner({ message, linkUrl, onClose }: Props) {
  const content = linkUrl ? (
    <a href={linkUrl} className="text-[#e2e8f0] hover:text-[#4ade80] no-underline">
      {message}
    </a>
  ) : (
    <span className="text-[#e2e8f0]">{message}</span>
  );

  return (
    <div className="h-10 flex items-center justify-center bg-gradient-to-r from-[#1a1a2e] to-[#16213e] text-sm px-4 relative">
      {content}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute right-4 text-[#94a3b8] hover:text-white bg-transparent border-none cursor-pointer"
          aria-label="关闭通知"
        >
          <CloseOutlined />
        </button>
      )}
    </div>
  );
}
