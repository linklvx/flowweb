import { memo } from 'react';

interface VideoNodeToolbarProps {
  show: boolean;
}

// ── Original SVG icons ─────────────────────────────────

const ClipIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="7" r="3" />
    <circle cx="17" cy="17" r="3" />
    <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
    <line x1="15.5" y1="12" x2="20" y2="16.5" />
  </svg>
);

const CropIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2v14a2 2 0 0 0 2 2h14" />
    <path d="M18 22V8a2 2 0 0 0-2-2H2" />
  </svg>
);

const HDIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <text x="12" y="15" fontSize="7.5" fontWeight="bold" textAnchor="middle" fill="currentColor" stroke="none">HD</text>
  </svg>
);

const GridIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="8" height="8" rx="1" />
    <rect x="13" y="3" width="8" height="8" rx="1" />
    <rect x="3" y="13" width="8" height="8" rx="1" />
    <rect x="13" y="13" width="8" height="8" rx="1" />
  </svg>
);

const RemoveSubtitlesIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="5" y1="5" x2="19" y2="19" />
    <path d="M8 10h6" />
    <path d="M8 14h8" />
  </svg>
);

const AudioSeparateIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="16" width="3" height="4" rx="0.5" />
    <rect x="7" y="12" width="3" height="8" rx="0.5" />
    <rect x="12" y="8" width="3" height="12" rx="0.5" />
    <rect x="17" y="5" width="3" height="15" rx="0.5" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    <path d="M7 11l5 5 5-5" />
    <path d="M12 3v13" />
  </svg>
);

const ExpandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 3h6v6" />
    <path d="M9 21H3v-6" />
    <path d="M21 3l-7 7" />
    <path d="M3 21l7-7" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="none">
    <path d="M4.35 5.82L8 9.47l3.65-3.65a.5.5 0 0 1 .7.7l-4 4a.5.5 0 0 1-.7 0l-4-4a.5.5 0 0 1 .7-.7z" fill="currentColor" />
  </svg>
);

// ── Styles ──────────────────────────────────────────────

const TOOLBAR_STYLE: React.CSSProperties = {
  padding: '4px',
  borderRadius: '12px',
  border: '0.5px solid var(--canvas-controls-border)',
  background: 'var(--canvas-controls-bg)',
  boxShadow: 'var(--canvas-shadow-dropdown)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
};

const BTN_STYLE: React.CSSProperties = {
  color: 'var(--canvas-controls-text)',
  height: 32,
  padding: '8px 12px',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  fontSize: 13,
  lineHeight: '20px',
  whiteSpace: 'nowrap',
  transition: 'background-color 150ms',
};

const ICON_ONLY_BTN_STYLE: React.CSSProperties = {
  ...BTN_STYLE,
  width: 32,
  minWidth: 32,
  padding: 0,
  flexShrink: 0,
};

const DIVIDER_STYLE: React.CSSProperties = {
  width: 0,
  height: 20,
  margin: '0 4px',
  borderLeft: '0.5px solid var(--canvas-controls-border)',
};

function VideoNodeToolbarComponent({ show }: VideoNodeToolbarProps) {
  if (!show) return null;

  return (
    <div
      className="nodrag nopan"
      style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(100% + 32px)',
        zIndex: 20,
      }}
    >
      <div className="flex w-max items-center">
        <div className="flex items-center justify-center gap-1" style={TOOLBAR_STYLE}>
          {/* 剪辑 */}
          <button type="button" style={BTN_STYLE}>
            <ClipIcon />
            <span>剪辑</span>
          </button>

          {/* 裁剪 */}
          <button type="button" style={BTN_STYLE}>
            <CropIcon />
            <span>裁剪</span>
          </button>

          {/* 高清 */}
          <button type="button" style={BTN_STYLE}>
            <HDIcon />
            <span>高清</span>
          </button>

          {/* 解析 */}
          <button type="button" style={BTN_STYLE}>
            <GridIcon />
            <span>解析</span>
          </button>

          {/* 智能去字幕 (dropdown trigger) */}
          <span style={{ display: 'inline-flex' }}>
            <button type="button" style={BTN_STYLE} aria-label="智能去字幕">
              <RemoveSubtitlesIcon />
              <span>智能去字幕</span>
              <span style={{ opacity: 0.6, display: 'flex', alignItems: 'center' }}>
                <ChevronDownIcon />
              </span>
            </button>
          </span>

          {/* 音频分离 (dropdown trigger) */}
          <button type="button" style={BTN_STYLE} aria-label="音频分离">
            <AudioSeparateIcon />
            <span>音频分离</span>
            <span style={{ opacity: 0.6, display: 'flex', alignItems: 'center' }}>
              <ChevronDownIcon />
            </span>
          </button>

          {/* Divider */}
          <div style={DIVIDER_STYLE} />

          {/* 下载 (icon only) */}
          <button type="button" style={ICON_ONLY_BTN_STYLE} aria-label="下载">
            <DownloadIcon />
          </button>

          {/* 全屏 (icon only) */}
          <button type="button" style={ICON_ONLY_BTN_STYLE} aria-label="全屏">
            <ExpandIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

export const VideoNodeToolbar = memo(VideoNodeToolbarComponent);
