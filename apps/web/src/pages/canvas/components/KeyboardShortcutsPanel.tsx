import React, { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type KeyDef = string | { icon: string };

interface ShortcutItem {
  label: string;
  keys: KeyDef[];
}

interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
  /** Tailwind width classes — 创作 needs more room for long key combos */
  width: string;
}

/* ---------- SVG icon components ---------- */

const ZoomInIcon = () => (
  <span className="flex shrink-0 items-center justify-center w-6 h-6 rounded-md border-[0.5px] border-overlay-3">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <g clipPath="url(#zoomin_clip)">
        <path d="M7.59985 0.667969C7.45261 0.668004 7.33325 0.787316 7.33325 0.93457V7.33789H0.932861C0.785765 7.3381 0.66626 7.45735 0.66626 7.60449V8.4043C0.66626 8.55144 0.785765 8.67069 0.932861 8.6709H7.33325V15.0684C7.33351 15.2154 7.45276 15.3349 7.59985 15.335H8.39966C8.54678 15.335 8.66601 15.2154 8.66626 15.0684V8.6709H15.0667C15.2139 8.67086 15.3333 8.55155 15.3333 8.4043V7.60449C15.3333 7.45724 15.2139 7.33793 15.0667 7.33789H8.66626V0.93457C8.66626 0.787294 8.54693 0.667969 8.39966 0.667969H7.59985Z" fill="#999" />
      </g>
      <defs>
        <clipPath id="zoomin_clip">
          <rect width="16" height="16" fill="white" transform="matrix(-1 0 0 1 16 0)" />
        </clipPath>
      </defs>
    </svg>
  </span>
);

const ZoomOutIcon = () => (
  <span className="flex shrink-0 items-center justify-center w-6 h-6 rounded-md border-[0.5px] border-overlay-3">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1.96582 7.39844C1.89218 7.39844 1.83203 7.45859 1.83203 7.53223V8.46582C1.83214 8.53937 1.89225 8.59863 1.96582 8.59863H13.5654C13.639 8.59863 13.6991 8.53937 13.6992 8.46582V7.53223C13.6992 7.45859 13.6391 7.39844 13.5654 7.39844H1.96582Z" fill="#999" />
    </svg>
  </span>
);

const TouchpadZoomIcon = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
    <path d="M12.3333 6.77778V16.8182L11.626 16.0947C10.9414 15.3946 10.0036 15 9.02447 15H8.90712C8.28401 15 7.71535 15.355 7.44167 15.9148C7.17089 16.4686 7.23552 17.1279 7.60873 17.6186L12.1461 23.5849C12.8241 24.4765 13.8799 25 15 25H16.82C20.2331 25 23 22.2331 23 18.82V16.9179C23 15.7407 22.3405 14.6628 21.2924 14.1268L15.8889 11.3636V6.77778C15.8889 5.79594 15.093 5 14.1111 5C13.1293 5 12.3333 5.79594 12.3333 6.77778Z" stroke="#999" strokeWidth="1.2" />
    <path d="M9.10811 0.999999L11 2.79487M11 2.79487L9.10811 4.58974M11 2.79487C11 2.79487 9.64921 2.53835 8.2973 2.79487C6.94539 3.05139 5.60306 3.66457 4.51351 4.84615C3.42397 6.02774 3.05275 7.3294 2.89189 8.4359C2.73103 9.54239 2.89189 11 2.89189 11M4.78378 9.20513L2.89189 11M2.89189 11L1 9.20513" stroke="#5DDCFF" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MouseZoomIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M12 6V10" stroke="#5DDCFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M19 9C19 5.13401 15.866 2 12 2C8.13401 2 5 5.13401 5 9V15C5 18.866 8.13401 22 12 22C15.866 22 19 18.866 19 15V9Z" stroke="#999" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const KeyboardPanIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M19 9C19 5.13401 15.866 2 12 2C8.13401 2 5 5.13401 5 9V15C5 18.866 8.13401 22 12 22C15.866 22 19 18.866 19 15V9Z" stroke="#999" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7 8.16667C7 5.86548 8.86548 4 11.1667 4C11.6269 4 12 4.3731 12 4.83333V11C12 11.5523 11.5523 12 11 12H8C7.44772 12 7 11.5523 7 11V8.16667Z" fill="#5DDCFF" />
  </svg>
);

const TouchpadPanIcon = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
    <g clipPath="url(#tpan_clip)">
      <path d="M23 11C23 7.13401 19.866 4 16 4C12.134 4 9 7.13401 9 11V17C9 20.866 12.134 24 16 24C19.866 24 23 20.866 23 17V11Z" stroke="#999" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 9V11" stroke="#5DDCFF" strokeOpacity="0.3" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 9V11" stroke="#5DDCFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.00024 1.00391L5.00024 9.00391" stroke="#5DDCFF" strokeLinecap="round" />
      <path d="M3.5 2L5 0.5L6.5 2" stroke="#5DDCFF" />
      <path d="M8 3.5L9.5 5.00378L8 6.5" stroke="#5DDCFF" />
      <path d="M1.99988 3.5L0.5 4.99988L1.99988 6.5" stroke="#5DDCFF" />
      <path d="M3.5 8L5.00024 9.50391L6.5 8" stroke="#5DDCFF" />
      <path d="M9.00513 4.99609L1.00513 4.99609" stroke="#5DDCFF" strokeLinecap="round" />
    </g>
    <defs>
      <clipPath id="tpan_clip">
        <rect width="28" height="28" fill="white" />
      </clipPath>
    </defs>
  </svg>
);

const MousePanIcon = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
    <path d="M15.8889 12.9979V6.77778C15.8889 5.79594 15.093 5 14.1111 5C13.1293 5 12.3333 5.79594 12.3333 6.77778V16.8182L11.626 16.0947C10.9414 15.3946 10.0036 15 9.02447 15H8.90712C8.28401 15 7.71535 15.355 7.44167 15.9148C7.17089 16.4686 7.23552 17.1279 7.60873 17.6186L12.1461 23.5849C12.8241 24.4765 13.8799 25 15 25H16.82C20.2331 25 23 22.2331 23 18.82V16.9374C23 15.75 22.3291 14.6646 21.2671 14.1336L19 13V6.52539C19 5.68294 18.3171 5 17.4746 5C16.6322 5 15.9492 5.68294 15.9492 6.52539V12.9979" stroke="#999" strokeWidth="1.2" />
    <path d="M6.00012 2.00391L6.00012 10.0039" stroke="#5DDCFF" strokeLinecap="round" />
    <path d="M4.5 3L6 1.5L7.5 3" stroke="#5DDCFF" />
    <path d="M9 4.5L10.5 6.00378L9 7.5" stroke="#5DDCFF" />
    <path d="M2.99988 4.5L1.5 5.99988L2.99988 7.5" stroke="#5DDCFF" />
    <path d="M4.5 9L6.00024 10.5039L7.5 9" stroke="#5DDCFF" />
    <path d="M10.0051 5.99609L2.00513 5.99609" stroke="#5DDCFF" strokeLinecap="round" />
  </svg>
);

const DeleteKeyIcon = () => (
  <span className="flex shrink-0 items-center justify-center w-6 h-6 rounded-md border-[0.5px] border-overlay-3">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M7.33325 5.9987L11.3333 9.9987M11.3333 5.9987L7.33325 9.9987M5.33321 3.33203C5.00194 3.33205 4.68253 3.45539 4.43721 3.67803L1.55188 7.5047C1.48303 7.56719 1.42801 7.64339 1.39035 7.72841C1.3527 7.81343 1.33325 7.90538 1.33325 7.99836C1.33325 8.09135 1.3527 8.1833 1.39035 8.26832C1.42801 8.35334 1.48303 8.42954 1.55188 8.49203L4.43721 12.3194C4.68253 12.542 5.00194 12.6653 5.33321 12.6654H13.3332C13.6868 12.6654 14.026 12.5249 14.276 12.2748C14.5261 12.0248 14.6665 11.6857 14.6665 11.332V4.66536C14.6665 4.31174 14.5261 3.9726 14.276 3.72256C14.026 3.47251 13.6868 3.33203 13.3332 3.33203H5.33321Z" stroke="#999" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>
);

/* ---------- Data ---------- */

const SECTIONS: ShortcutSection[] = [
  {
    title: '创作',
    width: 'md:w-56 lg:w-[280px]',
    items: [
      { label: '成组', keys: ['Ctrl/Alt', 'G'] },
      { label: '合并分镜组', keys: ['Ctrl', 'Alt', 'G'] },
      { label: '解组', keys: ['Ctrl/Alt', 'Shift', 'G'] },
      { label: '连线', keys: ['Ctrl', 'L'] },
      { label: '复制整组', keys: ['Ctrl', 'Shift', 'C'] },
      { label: '生成', keys: ['Ctrl', 'Enter'] },
      { label: '新建节点', keys: ['Tab'] },
      { label: '节点复制', keys: ['Alt', '拖动节点'] },
      { label: '创建副本', keys: ['Ctrl', 'Alt', '拖动'] },
      { label: '框选', keys: ['左键', '拖动空白'] },
      { label: '加选', keys: ['Shift', '点击'] },
    ],
  },
  {
    title: '缩放',
    width: 'md:w-44 lg:w-[200px]',
    items: [
      { label: '放大', keys: ['Ctrl', { icon: 'zoomIn' }] },
      { label: '缩小', keys: ['Ctrl', { icon: 'zoomOut' }] },
      { label: '适应画布', keys: ['Ctrl', '0'] },
      { label: '滚动', keys: [{ icon: 'touchpadZoom' }] },
      { label: '鼠标', keys: ['Ctrl', { icon: 'mouseZoom' }] },
    ],
  },
  {
    title: '移动画布',
    width: 'md:w-48 lg:w-[220px]',
    items: [
      { label: '键盘', keys: ['Space', { icon: 'keyboardPan' }] },
      { label: '触控板', keys: ['Space', { icon: 'touchpadPan' }] },
      { label: '鼠标', keys: [{ icon: 'mousePan' }] },
      { label: '整理画布', keys: ['Alt', 'Shift', 'F'] },
    ],
  },
  {
    title: '其他',
    width: 'md:w-40 lg:w-[180px]',
    items: [
      { label: '撤销', keys: ['Ctrl', 'Z'] },
      { label: '重做', keys: ['Ctrl', 'Shift', 'Z'] },
      { label: '删除', keys: [{ icon: 'delete' }] },
    ],
  },
];

/* ---------- Icon resolver ---------- */

const iconMap: Record<string, React.ReactNode> = {
  zoomIn: <ZoomInIcon />,
  zoomOut: <ZoomOutIcon />,
  touchpadZoom: <TouchpadZoomIcon />,
  mouseZoom: <MouseZoomIcon />,
  keyboardPan: <KeyboardPanIcon />,
  touchpadPan: <TouchpadPanIcon />,
  mousePan: <MousePanIcon />, // MousePanIcon 实际画手形拖动（非鼠标图形）——命名遗留，勿据名回改
  delete: <DeleteKeyIcon />,
};

/* ---------- Kbd key cap ---------- */

function Kbd({ children }: { children: string }) {
  return (
    <span
      className="flex h-6 min-w-6 shrink-0 items-center justify-center px-0.5 font-sans text-xs"
      style={{ borderRadius: 6, border: '0.5px solid #444' }}
    >
      {children}
    </span>
  );
}

function renderKey(key: KeyDef, idx: number): React.ReactNode {
  if (typeof key === 'string') {
    return <Kbd key={idx}>{key}</Kbd>;
  }
  return <span key={idx}>{iconMap[key.icon]}</span>;
}

/* ---------- Panel component ---------- */

export function KeyboardShortcutsPanel({ isOpen, onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      setAnimating(true);
      const raf = requestAnimationFrame(() => setAnimating(false));
      return () => cancelAnimationFrame(raf);
    } else if (visible) {
      setAnimating(true);
    }
  }, [isOpen]);

  const handleTransitionEnd = useCallback(() => {
    if (animating) {
      setVisible(false);
      setAnimating(false);
    }
  }, [animating]);

  useEffect(() => {
    if (animating && !isOpen) {
      const timer = setTimeout(() => {
        setVisible(false);
        setAnimating(false);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [animating, isOpen]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible, onClose]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none">
      <div
        ref={panelRef}
        data-panel
        onTransitionEnd={handleTransitionEnd}
        className={`pointer-events-auto relative rounded-2xl p-4 md:p-6 mx-4 mb-6 backdrop-blur-lg transition-all duration-200 ${animating ? 'translate-y-3 opacity-0' : 'translate-y-0 opacity-100'}`}
        style={{
          background: 'oklab(0.26861 0.0000122264 0.00000536442 / 0.95)',
          border: '0.444px solid #363636',
          boxShadow: 'rgba(0, 0, 0, 0.25) 0px 4px 10px 0px, rgba(0, 0, 0, 0.3) 0px 2px 4px 0px',
        }}
      >
        <header className="absolute right-3 top-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭快捷键面板"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-overlay-3"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 17.1864 17.1854" fill="currentColor" className="text-text-dim-3">
              <path d="M15.7959 0.117157C15.9521 -0.0390524 16.2051 -0.0390524 16.3613 0.117157L17.0693 0.824189C17.2254 0.980406 17.2255 1.23442 17.0693 1.39059L9.86618 8.59274L17.0693 15.7949C17.2254 15.9511 17.2255 16.2051 17.0693 16.3613L16.3613 17.0683C16.2051 17.2245 15.9521 17.2244 15.7959 17.0683L8.59274 9.86618L1.39059 17.0683C1.23442 17.2245 0.981382 17.2244 0.825165 17.0683L0.117157 16.3613C-0.0390524 16.2051 -0.0390524 15.9511 0.117157 15.7949L7.31931 8.59274L0.117157 1.39059C-0.0390524 1.23439 -0.0390524 0.980398 0.117157 0.824189L0.825165 0.117157C0.981375 -0.0390524 1.23439 -0.0390524 1.39059 0.117157L8.59274 7.31931L15.7959 0.117157Z" />
            </svg>
          </button>
        </header>
        <div className="flex max-h-[80vh] flex-col gap-0 overflow-y-auto md:max-h-none md:flex-row md:items-stretch md:gap-5 md:overflow-visible lg:gap-6">
          {SECTIONS.map((section, si) => (
            <div key={section.title} className="flex md:flex-row gap-0">
              {si > 0 && (
                <div className="hidden md:block w-px bg-overlay-2 shrink-0 self-stretch mr-4 lg:mr-6" aria-hidden="true" />
              )}
              <section className={`flex w-full min-w-0 flex-col gap-3 border-b border-overlay-2 pb-5 last:border-b-0 last:pb-0 md:shrink-0 md:border-b-0 md:pb-0 ${section.width}`}>
                <h3 className="text-sm font-medium text-[#09CAF5]">{section.title}</h3>
                <div className="flex flex-col gap-3">
                  {section.items.map((item) => (
                    <div key={item.label} className="flex w-full flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
                      <span className="text-sm text-text-dim-3 leading-snug shrink-0 pr-2">{item.label}</span>
                      <div className="flex items-center gap-2 text-sm md:shrink-0 md:justify-end">
                        {item.keys.flatMap((key, ki) => {
                          const els: React.ReactNode[] = [];
                          if (ki > 0) els.push(<span key={`sep-${item.label}-${ki}`} className="text-text-dim-2 text-sm">+</span>);
                          els.push(<span key={`k-${item.label}-${ki}`}>{renderKey(key, ki)}</span>);
                          return els;
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
