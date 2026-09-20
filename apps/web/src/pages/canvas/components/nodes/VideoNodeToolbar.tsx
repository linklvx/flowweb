import { memo, useState } from 'react';
import { Dropdown } from 'antd';

interface VideoNodeToolbarProps {
  show: boolean;
  onFullscreen?: () => void;
  fullscreenTriggerRef?: React.RefObject<HTMLButtonElement>;
  onDownload?: () => void;
  onTrim?: () => void;
  onCaptureFrame?: (type: 'current' | 'first' | 'last') => void;
  capturingType?: 'current' | 'first' | 'last' | null;
  onAudioSeparate?: (type: 'vocal' | 'background' | 'split') => void;
  audioSeparatingType?: 'vocal' | 'background' | 'split' | null;
  onHD?: () => void;
  hdPanelOpen?: boolean;
  /** 产物节点（origin=video-edit）收敛：隐藏 高清/解析/截帧/音频分离，仅保留 剪辑/裁剪/下载/全屏 */
  productMode?: boolean;
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

const FrameCaptureIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
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

function VideoNodeToolbarComponent({ show, onFullscreen, fullscreenTriggerRef, onDownload, onTrim, onCaptureFrame, capturingType, onAudioSeparate, audioSeparatingType, onHD, hdPanelOpen, productMode }: VideoNodeToolbarProps) {
  const [frameCaptureOpen, setFrameCaptureOpen] = useState(false);
  const [audioSeparateOpen, setAudioSeparateOpen] = useState(false);
  const isAnyCapturing = capturingType != null;
  const isAnySeparating = audioSeparatingType != null;

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
          <button type="button" style={BTN_STYLE} onClick={onTrim}>
            <ClipIcon />
            <span>剪辑</span>
          </button>

          {/* 裁剪 */}
          <button type="button" style={BTN_STYLE}>
            <CropIcon />
            <span>裁剪</span>
          </button>

          {/* 高清/解析/截帧/音频分离 —— 产物节点收敛隐藏（productMode） */}
          {!productMode && (
            <>
          {/* 高清 */}
          <button
            type="button"
            style={{
              ...BTN_STYLE,
              ...(hdPanelOpen ? { background: 'var(--canvas-controls-hover)' } : {}),
            }}
            data-active={hdPanelOpen ? 'true' : undefined}
            onClick={onHD}
          >
            <HDIcon />
            <span>高清</span>
          </button>

          {/* 解析 */}
          <button type="button" style={BTN_STYLE}>
            <GridIcon />
            <span>解析</span>
          </button>

          {/* 视频截帧 (dropdown trigger) */}
          <Dropdown
            open={isAnyCapturing ? false : frameCaptureOpen}
            onOpenChange={(v) => { if (!isAnyCapturing) setFrameCaptureOpen(v); }}
            trigger={['click']}
            dropdownRender={() => (
              <div
                className="flex flex-col gap-0.5"
                style={{
                  minWidth: 100,
                  borderRadius: 16,
                  border: 'none',
                  background: '#2F2F2F',
                  backdropFilter: 'blur(28px)',
                  WebkitBackdropFilter: 'blur(28px)',
                  boxShadow: '0px 4px 16px rgba(0,0,0,0.16), inset 0px 0.5px 0px rgba(255,255,255,0.16)',
                  padding: '8px 4px',
                }}
              >
                {([
                  ['截取当前帧', 'current' as const],
                ] as const).map(([label, type]) => (
                  <button
                    key={label}
                    type="button"
                    className="flex w-full items-center rounded-lg px-2 py-1.5 text-[13px] leading-[20px] font-medium transition-colors hover:bg-overlay-2"
                    style={{
                      color: 'rgba(255,255,255,0.9)',
                      border: 'none',
                    }}
                    disabled={isAnyCapturing}
                    onClick={() => {
                      setFrameCaptureOpen(false);
                      onCaptureFrame?.(type);
                    }}
                  >
                    {capturingType === type ? '截取中...' : label}
                  </button>
                ))}
                <div style={{ height: 0, margin: '2px 4px', borderTop: '0.5px solid rgba(255,255,255,0.12)' }} />
                {([
                  ['截取首帧', 'first' as const],
                  ['截取尾帧', 'last' as const],
                ] as const).map(([label, type]) => (
                  <button
                    key={label}
                    type="button"
                    className="flex w-full items-center rounded-lg px-2 py-1.5 text-[13px] leading-[20px] font-medium transition-colors hover:bg-overlay-2"
                    style={{
                      color: 'rgba(255,255,255,0.9)',
                      border: 'none',
                    }}
                    disabled={isAnyCapturing}
                    onClick={() => {
                      setFrameCaptureOpen(false);
                      onCaptureFrame?.(type);
                    }}
                  >
                    {capturingType === type ? '截取中...' : label}
                  </button>
                ))}
              </div>
            )}
          >
            <span style={{ display: 'inline-flex' }}>
              <button type="button" style={BTN_STYLE} aria-label="视频截帧">
                <FrameCaptureIcon />
                <span>视频截帧</span>
                <span style={{ opacity: 0.6, display: 'flex', alignItems: 'center' }}>
                  <ChevronDownIcon />
                </span>
              </button>
            </span>
          </Dropdown>

          {/* 音频分离 (dropdown trigger) */}
          <Dropdown
            open={isAnySeparating ? false : audioSeparateOpen}
            onOpenChange={(v) => { if (!isAnySeparating) setAudioSeparateOpen(v); }}
            trigger={['click']}
            dropdownRender={() => (
              <div
                className="flex flex-col gap-0.5"
                style={{
                  minWidth: 100,
                  borderRadius: 16,
                  border: 'none',
                  background: '#2F2F2F',
                  backdropFilter: 'blur(28px)',
                  WebkitBackdropFilter: 'blur(28px)',
                  boxShadow: '0px 4px 16px rgba(0,0,0,0.16), inset 0px 0.5px 0px rgba(255,255,255,0.16)',
                  padding: '8px 4px',
                }}
              >
                {([
                  ['音视频分离', 'split' as const],
                ] as const).map(([label, type]) => (
                  <button
                    key={label}
                    type="button"
                    className="flex w-full items-center rounded-lg px-2 py-1.5 text-[13px] leading-[20px] font-medium transition-colors hover:bg-overlay-2"
                    style={{
                      color: 'rgba(255,255,255,0.9)',
                      border: 'none',
                    }}
                    disabled={isAnySeparating}
                    onClick={() => {
                      setAudioSeparateOpen(false);
                      onAudioSeparate?.(type);
                    }}
                  >
                    {audioSeparatingType === type ? '分离中...' : label}
                  </button>
                ))}
                <div style={{ height: 0, margin: '2px 4px', borderTop: '0.5px solid rgba(255,255,255,0.12)' }} />
                {([
                  ['仅保留人声', 'vocal' as const, '即将上线'],
                  ['仅保留背景音', 'background' as const, '即将上线'],
                ] as const).map(([label, _type, tooltip]) => (
                  <button
                    key={label}
                    type="button"
                    className="flex w-full items-center rounded-lg px-2 py-1.5 text-[13px] leading-[20px] font-medium transition-colors"
                    style={{ color: 'rgba(255,255,255,0.35)', border: 'none', cursor: 'not-allowed' }}
                    disabled
                    title={tooltip}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          >
            <span style={{ display: 'inline-flex' }}>
              <button type="button" style={BTN_STYLE} aria-label="音频分离">
                <AudioSeparateIcon />
                <span>音频分离</span>
                <span style={{ opacity: 0.6, display: 'flex', alignItems: 'center' }}>
                  <ChevronDownIcon />
                </span>
              </button>
            </span>
          </Dropdown>
            </>
          )}

          {/* Divider */}
          <div style={DIVIDER_STYLE} />

          {/* 下载 (icon only) */}
          <button type="button" style={ICON_ONLY_BTN_STYLE} aria-label="下载" onClick={onDownload}>
            <DownloadIcon />
          </button>

          {/* 全屏 (icon only) */}
          <button type="button" ref={fullscreenTriggerRef} style={ICON_ONLY_BTN_STYLE} aria-label="全屏" onClick={onFullscreen}>
            <ExpandIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

export const VideoNodeToolbar = memo(VideoNodeToolbarComponent);
