import { memo, useState, useRef, useCallback } from 'react';
import { Dropdown } from 'antd';

interface VideoHDPanelProps {
  nodeId: string;
  fileId?: string;
}

// ── Inline SVG icons ────────────────────────────────────

const ModelIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
    <path d="M7.99805 1.38477C8.49805 2.90621 9.3705 4.29349 10.5166 5.44238L10.5186 5.44336C11.5081 6.43013 12.6771 7.21841 13.9629 7.76562C14.1629 7.8518 14.3664 7.9289 14.5713 8.00195C13.0514 8.54303 11.6655 9.4153 10.5176 10.5605L10.5166 10.5615C9.372 11.7102 8.5006 13.0963 7.95902 14.6162C7.41764 13.0958 6.54621 11.7095 5.40043 10.5615L5.39941 10.5605L5.13578 10.3066C4.04059 9.2858 2.74911 8.50275 1.34281 8.00195C2.86333 7.45997 4.25032 6.58857 5.39941 5.44336L5.40043 5.44238C6.54587 4.29322 7.41678 2.90579 7.95802 1.38477H7.99805Z" stroke="currentColor" strokeWidth="1.33" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="none" className="shrink-0">
    <path d="M4.35 5.82L8 9.47l3.65-3.65a.5.5 0 0 1 .7.7l-4 4a.5.5 0 0 1-.7 0l-4-4a.5.5 0 0 1 .7-.7z" fill="currentColor" />
  </svg>
);

const SubmitArrowIcon = () => (
  <svg width="12" height="12" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8.29289 0.292893C8.68342 -0.0976311 9.31658 -0.0976311 9.70711 0.292893L17.7071 8.29289C18.0976 8.68342 18.0976 9.31658 17.7071 9.70711C17.3166 10.0976 16.6834 10.0976 16.2929 9.70711L10 3.41421V17C10 17.5523 9.55229 18 9 18C8.44772 18 8 17.5523 8 17V3.41421L1.70711 9.70711C1.31658 10.0976 0.683418 10.0976 0.292893 9.70711C-0.0976311 9.31658 -0.0976311 8.68342 0.292893 8.29289L8.29289 0.292893Z" fill="currentColor" />
  </svg>
);

// ── Dropdown menu styles ─────────────────────────────────

const MENU_STYLE: React.CSSProperties = {
  minWidth: 100,
  borderRadius: 16,
  border: 'none',
  background: '#2F2F2F',
  backdropFilter: 'blur(28px)',
  WebkitBackdropFilter: 'blur(28px)',
  boxShadow: '0px 4px 16px rgba(0,0,0,0.16), inset 0px 0.5px 0px rgba(255,255,255,0.16)',
  padding: '8px 4px',
};

const MENU_ITEM_STYLE: React.CSSProperties = {
  color: 'rgba(255,255,255,0.9)',
  border: 'none',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 500,
  width: '100%',
  textAlign: 'left' as const,
  padding: '6px 8px',
  borderRadius: 8,
  display: 'block',
};

const TRIGGER_STYLE: React.CSSProperties = {
  display: 'flex',
  height: 32,
  flex: 1,
  alignItems: 'center',
  justifyContent: 'space-between',
  overflow: 'hidden',
  borderRadius: 8,
  border: '0.5px solid var(--canvas-controls-border)',
  padding: '4px 8px',
  cursor: 'pointer',
  color: 'var(--canvas-controls-text)',
  fontSize: 13,
  lineHeight: '20px',
};

// ── Constants ────────────────────────────────────────────

const MODELS = [{ id: 'huoshan', name: 'HuoShan-画质增强' }];
const RESOLUTIONS = ['1080P', '2K', '4K'];
const FPS_OPTIONS = ['自适应(原帧数)', '30fps', '60fps', '90fps', '120fps'];

function VideoHDPanelComponent({ nodeId: _nodeId, fileId }: VideoHDPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [selectedResolution, setSelectedResolution] = useState(RESOLUTIONS[0]);
  const [selectedFps, setSelectedFps] = useState(FPS_OPTIONS[0]);

  const getPopupContainer = useCallback(() => panelRef.current!, []);

  const modelName = MODELS.find((m) => m.id === selectedModel)?.name;

  return (
    <div ref={panelRef} data-testid="hd-panel-root" className="nodrag nopan" style={{ transition: 'transform,opacity', transitionDuration: '150ms' }}>
      <div
        className="relative flex w-full flex-col gap-3 overflow-hidden rounded-xl"
        style={{
          background: 'var(--canvas-controls-bg)',
          border: '0.5px solid var(--canvas-controls-border)',
          boxShadow: '0px 4px 10px 0px rgba(0,0,0,0.12)',
          padding: '12px 8px 8px',
        }}
      >
        {/* Title */}
        <div className="px-2">
          <span className="text-sm font-medium" style={{ color: 'var(--canvas-controls-text)' }}>视频高清</span>
        </div>

        <div className="flex flex-col gap-2">
          {/* Model select */}
          <div className="flex h-8 items-center gap-4">
            <div className="flex w-[120px] shrink-0 items-center gap-1 px-2">
              <span className="text-[13px]" style={{ color: '#e2e8f0' }}>模型选择</span>
            </div>
            <Dropdown
              getPopupContainer={getPopupContainer}
              trigger={['click']}
              placement="top"
              dropdownRender={() => (
                <div style={MENU_STYLE}>
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      style={MENU_ITEM_STYLE}
                      className="transition-colors hover:bg-white/10"
                      onClick={() => setSelectedModel(m.id)}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              )}
            >
              <button type="button" data-testid="hd-model-trigger" style={TRIGGER_STYLE} className="transition-colors hover:bg-white/10">
                <div className="flex min-w-0 items-center gap-2">
                  <ModelIcon />
                  <span className="truncate text-[13px]" style={{ color: 'var(--canvas-controls-text)' }}>{modelName}</span>
                </div>
                <ChevronDownIcon />
              </button>
            </Dropdown>
          </div>

          {/* Resolution select */}
          <div className="flex h-8 items-center gap-4">
            <div className="flex w-[120px] shrink-0 items-center gap-1 px-2">
              <span className="text-[13px]" style={{ color: '#e2e8f0' }}>分辨率</span>
            </div>
            <Dropdown
              getPopupContainer={getPopupContainer}
              trigger={['click']}
              placement="top"
              dropdownRender={() => (
                <div style={MENU_STYLE}>
                  {RESOLUTIONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      style={MENU_ITEM_STYLE}
                      className="transition-colors hover:bg-white/10"
                      onClick={() => setSelectedResolution(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
            >
              <button type="button" data-testid="hd-resolution-trigger" style={TRIGGER_STYLE} className="transition-colors hover:bg-white/10">
                <span className="truncate text-[13px]" style={{ color: 'var(--canvas-controls-text)' }}>{selectedResolution}</span>
                <ChevronDownIcon />
              </button>
            </Dropdown>
          </div>

          {/* Frame rate select */}
          <div className="flex h-8 items-center gap-4">
            <div className="flex w-[120px] shrink-0 items-center gap-1 px-2">
              <span className="text-[13px]" style={{ color: '#e2e8f0' }}>帧率</span>
            </div>
            <Dropdown
              getPopupContainer={getPopupContainer}
              trigger={['click']}
              placement="top"
              dropdownRender={() => (
                <div style={MENU_STYLE}>
                  {FPS_OPTIONS.map((fps) => (
                    <button
                      key={fps}
                      type="button"
                      style={MENU_ITEM_STYLE}
                      className="transition-colors hover:bg-white/10"
                      onClick={() => setSelectedFps(fps)}
                    >
                      {fps}
                    </button>
                  ))}
                </div>
              )}
            >
              <button type="button" data-testid="hd-fps-trigger" style={TRIGGER_STYLE} className="transition-colors hover:bg-white/10">
                <span className="truncate text-[13px]" style={{ color: 'var(--canvas-controls-text)' }}>{selectedFps}</span>
                <ChevronDownIcon />
              </button>
            </Dropdown>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end">
          <div className="flex h-8 items-center gap-2" style={{ color: '#999' }}>
            <span className="flex shrink-0 items-center gap-[2px]">
              <svg width="10" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g transform="translate(2.2857 0) scale(0.933347)">
                  <path d="M6.79577 0.652118C7.72979 -0.427779 8.49498 -0.136386 8.49498 1.30348V7.47438H11.0956C12.2734 7.47448 12.6016 8.21128 11.8192 9.1111L5.44909 16.491C4.51536 17.5703 3.74914 17.2787 3.74889 15.8396V9.66872H1.14928C-0.0287394 9.66872 -0.356821 8.9309 0.425648 8.03102L6.79577 0.652118Z" fill="currentColor" />
                </g>
              </svg>
              <span className="min-w-5 text-center text-[12px] font-normal leading-[15px]">11</span>
            </span>
            <button
              type="button"
              data-testid="hd-submit-btn"
              disabled={!fileId}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#3a3a3a] transition-[filter,opacity] hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ border: 'none' }}
              onClick={(e) => e.stopPropagation()}
            >
              <span style={{ color: '#999' }}><SubmitArrowIcon /></span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const VideoHDPanel = memo(VideoHDPanelComponent);
