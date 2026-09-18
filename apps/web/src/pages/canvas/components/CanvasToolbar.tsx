import { memo } from 'react';

interface Props {
  zoom: number;
  onFitView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  snapEnabled: boolean;
  onToggleSnap: () => void;
}

const BTN = 'tb-btn flex items-center justify-center appearance-none border-0 rounded-lg transition-colors';
const BTN_BG: React.CSSProperties = { backgroundColor: 'rgb(38, 38, 38)' };
const BTN_BG_ACTIVE: React.CSSProperties = { backgroundColor: 'rgb(58, 58, 58)' };
const ICON_WRAP = 'flex items-center justify-center overflow-hidden';

function CanvasToolbarComponent({ zoom, onFitView, onZoomIn, onZoomOut, minimapOpen, onToggleMinimap, snapEnabled, onToggleSnap }: Props) {
  const pct = Math.round(zoom * 100);

  return (
    <>
      <style>{`
        [data-tooltip] {
          position: relative;
        }
        [data-tooltip]:hover::after {
          content: attr(data-tooltip);
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          padding: 4px 8px;
          border-radius: 6px;
          background: rgba(0, 0, 0, 0.85);
          color: rgb(220, 220, 220);
          font-size: 11px;
          white-space: nowrap;
          pointer-events: none;
          z-index: 100;
        }
        .tb-btn:hover {
          background-color: rgb(78, 78, 78) !important;
        }
      `}</style>
      <div
        id="canvas-toolbar"
        className="nodrag nopan absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-xl p-1.5"
        style={{
          backgroundColor: 'rgb(38, 38, 38)',
          border: '0.5px solid rgb(54, 54, 54)',
          backdropFilter: 'blur(8px)',
          boxShadow: 'rgba(0, 0, 0, 0.15) 0px 2px 5px 0px',
          userSelect: 'none',
        }}
      >
      {/* Fit view */}
      <button
        className={BTN}
        aria-label="整理画布"
        data-tooltip="适应画布"
        style={{ ...BTN_BG, width: 28, height: 28 }}
        onClick={onFitView}
      >
        <span className={ICON_WRAP} style={{ width: 14, height: 14 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" style={{ color: 'rgb(160, 160, 160)' }}>
            <g transform="translate(1 1)">
              <path d="M5.134 8.339c.87 0 1.575.704 1.575 1.574v1.575c0 .87-.705 1.575-1.575 1.575H2.509c-.87 0-1.575-.705-1.575-1.575V9.913c0-.87.705-1.574 1.575-1.574zm6.358-2.1c.87 0 1.575.705 1.575 1.575v3.674c0 .87-.705 1.575-1.575 1.575H8.867c-.87 0-1.575-.705-1.575-1.575V7.813c0-.87.706-1.575 1.575-1.575zm-9.037 3.153c-.264.027-.471.25-.471.522v1.575c0 .272.207.496.471.523l.054.003h2.625l.054-.003c.264-.027.471-.25.471-.523V9.913c0-.272-.206-.495-.471-.522l-.054-.003H2.509zm6.412-2.103c-.29 0-.525.235-.525.525v3.675l.002.054c.025.247.222.443.469.468l.054.003h2.625l.054-.003c.247-.025.443-.222.468-.469l.003-.053V7.813c0-.29-.236-.525-.525-.525zM5.134.93c.87 0 1.575.705 1.575 1.575v3.675c0 .87-.705 1.575-1.575 1.575H2.509c-.87 0-1.575-.705-1.575-1.575V2.505c0-.87.705-1.575 1.575-1.575zm-2.679 1.052c-.264.027-.471.251-.471.523v3.675l.003.054c.025.247.222.468.469.468h2.678l.054-.003c.247-.025.443-.222.469-.469l.002-.054V2.505c0-.272-.206-.494-.471-.523l-.054-.003H2.509zm9.037-1.052c.87 0 1.575.705 1.575 1.575v1.575c0 .87-.706 1.574-1.575 1.574H8.867c-.87 0-1.575-.705-1.575-1.574V2.505c0-.87.705-1.575 1.575-1.575zm-2.679 1.05c-.29 0-.525.235-.525.525v1.575l.002.054c.027.264.251.47.523.47h2.625c.272 0 .495-.206.522-.47l.003-.054V2.505c0-.29-.235-.525-.525-.525z" fill="currentColor" />
            </g>
          </svg>
        </span>
      </button>

      {/* Minimap toggle */}
      <button
        className={BTN}
        aria-label="切换小地图"
        data-tooltip="画布小地图"
        aria-pressed={minimapOpen}
        style={{ ...(minimapOpen ? BTN_BG_ACTIVE : BTN_BG), width: 28, height: 28 }}
        onClick={onToggleMinimap}
      >
        <span className={ICON_WRAP} style={{ width: 14, height: 14 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 22 22" style={{ color: 'rgb(160, 160, 160)' }}>
            <path d="M10.9 0c1.83 0 3.585.728 4.879 2.022 1.294 1.294 2.02 3.049 2.02 4.879l-.012.392a8.06 8.06 0 01-1.816 4.707H17.9c.399 0 .787.126 1.11.36.324.233.566.562.692.94l2 6 .058.218a2.46 2.46 0 01-1.661 2.873c-.2.103-.417.17-.64.196l-.225.014H1.9a2.04 2.04 0 01-.865-.21 2.05 2.05 0 01-.676-.58 2.03 2.03 0 01-.56-1.713l2.004-6 .052-.139a2.05 2.05 0 01.64-.8A1.9 1.9 0 013.9 12h1.926A8.05 8.05 0 014.013 7.294L4 6.9C4 5.07 4.727 3.315 6.02 2.021 7.315.728 9.07 0 10.9 0zM3.874 13.806l-.028.014a.16.16 0 00-.036.05l-2.004 5.999a.07.07 0 00-.004.047.06.06 0 00.018.044.08.08 0 00.035.03.13.13 0 00.046.01h18a.1.1 0 00.044-.01.08.08 0 00.036-.03.06.06 0 00.018-.044l-.004-.046-2-6a.15.15 0 00-.036-.05.18.18 0 00-.06-.018h-3.293a14.74 14.74 0 01-2.5 2.564l-.054.045a6.12 6.12 0 01-1.153.747 3.82 3.82 0 01-1.526.39 3.85 3.85 0 01-1.153-.19 6.02 6.02 0 01-1.102-.557 14.87 14.87 0 01-2.5-2.564H3.904zM10.9 1.8a5.1 5.1 0 00-3.606 1.494A5.1 5.1 0 005.8 6.9c0 1.513.826 3.176 1.951 4.707 1.085 1.477 2.354 2.707 3.1 3.379.015.009.032.015.05.015a.1.1 0 00.048-.015c.746-.672 2.016-1.901 3.101-3.379C15.174 10.076 16 8.413 16 6.9a5.1 5.1 0 00-1.494-3.606A5.1 5.1 0 0010.9 1.8zM10.9 4a2.9 2.9 0 012.9 2.9 2.9 2.9 0 01-2.9 2.9 2.9 2.9 0 01-2.9-2.9A2.9 2.9 0 0110.9 4zm0 1.8a1.1 1.1 0 00-1.1 1.1c0 .607.493 1.1 1.1 1.1s1.1-.493 1.1-1.1a1.1 1.1 0 00-1.1-1.1z" fill="currentColor" />
          </svg>
        </span>
      </button>

      {/* Snap to grid */}
      <button
        className={BTN}
        aria-label="网格吸附"
        data-tooltip="网格吸附"
        aria-pressed={snapEnabled}
        style={{ ...(snapEnabled ? BTN_BG_ACTIVE : BTN_BG), width: 28, height: 28 }}
        onClick={onToggleSnap}
      >
        <span className={ICON_WRAP} style={{ width: 14, height: 14 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" style={{ color: 'rgb(160, 160, 160)' }}>
            <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m12 15l4 4M2.352 10.648a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.029-6.029a1 1 0 1 1 3 3l-6.029 6.029a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.365-6.367A1 1 0 0 0 8.716 4.282zM5 8l4 4" />
          </svg>
        </span>
      </button>

      {/* Zoom out */}
      <button
        className={BTN}
        aria-label="缩小"
        style={{ ...BTN_BG, width: 28, height: 28 }}
        onClick={onZoomOut}
      >
        <span className={ICON_WRAP} style={{ width: 14, height: 14 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" style={{ color: 'rgb(160, 160, 160)' }}>
            <rect x="3" y="7" width="10" height="2" rx="1" fill="currentColor" />
          </svg>
        </span>
      </button>

      {/* Zoom percentage */}
      <button
        className={`${BTN} px-1 text-[13px] leading-normal`}
        aria-label="缩放选项"
        style={{ ...BTN_BG, height: 28, color: 'rgb(180, 180, 180)' }}
      >
        {pct}%
      </button>

      {/* Zoom in */}
      <button
        className={BTN}
        aria-label="放大"
        style={{ ...BTN_BG, width: 28, height: 28 }}
        onClick={onZoomIn}
      >
        <span className={ICON_WRAP} style={{ width: 14, height: 14 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 17 17" style={{ color: 'rgb(160, 160, 160)' }}>
            <path d="M8.5 0c.497 0 .9.476.9 1.063v6.537h6.538c.586 0 1.062.403 1.062.9s-.476.9-1.063.9H9.4v6.538c0 .586-.403 1.062-.9 1.062s-.9-.476-.9-1.063V9.4H1.063C.476 9.4 0 8.997 0 8.5s.476-.9 1.063-.9H7.6V1.063C7.6.476 8.003 0 8.5 0z" fill="currentColor" />
          </svg>
        </span>
      </button>

      </div>
    </>
  );
}

export const CanvasToolbar = memo(CanvasToolbarComponent);
