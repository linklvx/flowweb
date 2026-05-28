import { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  label: string;
  keys: string[];
}

interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
}

const SECTIONS: ShortcutSection[] = [
  {
    title: '创作',
    items: [
      { label: '成组', keys: ['Ctrl', 'G'] },
      { label: '合并分镜组', keys: ['Ctrl', 'Alt', 'G'] },
      { label: '解组', keys: ['Ctrl', 'Shift', 'G'] },
      { label: '连线', keys: ['Ctrl', 'L'] },
      { label: '复制整组', keys: ['Ctrl', 'Shift', 'C'] },
      { label: '生成', keys: ['Ctrl', 'Enter'] },
      { label: '新建节点', keys: ['Tab'] },
      { label: '节点复制', keys: ['Alt', '拖动节点'] },
      { label: '创建副本', keys: ['Ctrl', 'Alt', '拖动'] },
    ],
  },
  {
    title: '缩放',
    items: [
      { label: '放大', keys: ['Ctrl', '+'] },
      { label: '缩小', keys: ['Ctrl', '-'] },
      { label: '适应画布', keys: ['Ctrl', '0'] },
      { label: '触控板', keys: ['双指捏合'] },
      { label: '鼠标', keys: ['Ctrl', '滚轮'] },
    ],
  },
  {
    title: '移动画布',
    items: [
      { label: '键盘', keys: ['Space', '拖动'] },
      { label: '触控板', keys: ['双指拖动'] },
      { label: '鼠标', keys: ['中键拖动'] },
      { label: '整理画布', keys: ['Alt', 'Shift', 'F'] },
    ],
  },
  {
    title: '其他',
    items: [
      { label: '撤销', keys: ['Ctrl', 'Z'] },
      { label: '重做', keys: ['Ctrl', 'Shift', 'Z'] },
      { label: '删除', keys: ['⌫'] },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  if (children === '+' || children === '-' || children === '⌫') {
    return (
      <span className="flex shrink-0 items-center justify-center w-7 h-7 rounded-lg border border-[#444] text-sm">
        {children}
      </span>
    );
  }
  return (
    <span className="flex h-7 min-w-7 shrink-0 items-center justify-center px-1.5 font-sans text-sm rounded-lg border-[0.5px] border-[#444]">
      {children}
    </span>
  );
}

export function KeyboardShortcutsPanel({ isOpen, onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      requestAnimationFrame(() => setClosing(false));
    } else if (visible) {
      setClosing(true);
    }
  }, [isOpen]);

  const handleTransitionEnd = useCallback(() => {
    if (closing) {
      setVisible(false);
      setClosing(false);
    }
  }, [closing]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none">
      <div
        ref={panelRef}
        data-panel
        onTransitionEnd={handleTransitionEnd}
        className={`pointer-events-auto relative box-border rounded-2xl p-5 mx-4 mb-6 max-w-[960px] w-auto backdrop-blur-xl transition-all duration-200 ${closing ? 'translate-y-3 opacity-0' : 'translate-y-0 opacity-100'}`}
        style={{
          background: 'rgba(38, 38, 38, 0.96)',
          border: '0.5px solid #363636',
          boxShadow: '0px 4px 20px rgba(0, 0, 0, 0.4), 0px 2px 8px rgba(0, 0, 0, 0.3)',
        }}
      >
        <header className="absolute right-3 top-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭快捷键面板"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[#3a3a3a]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 17.1864 17.1854" fill="currentColor" className="text-[#999]">
              <path d="M15.7959 0.117157C15.9521 -0.0390524 16.2051 -0.0390524 16.3613 0.117157L17.0693 0.824189C17.2254 0.980406 17.2255 1.23442 17.0693 1.39059L9.86618 8.59274L17.0693 15.7949C17.2254 15.9511 17.2255 16.2051 17.0693 16.3613L16.3613 17.0683C16.2051 17.2245 15.9521 17.2244 15.7959 17.0683L8.59274 9.86618L1.39059 17.0683C1.23442 17.2245 0.981382 17.2244 0.825165 17.0683L0.117157 16.3613C-0.0390524 16.2051 -0.0390524 15.9511 0.117157 15.7949L7.31931 8.59274L0.117157 1.39059C-0.0390524 1.23439 -0.0390524 0.980398 0.117157 0.824189L0.825165 0.117157C0.981375 -0.0390524 1.23439 -0.0390524 1.39059 0.117157L8.59274 7.31931L15.7959 0.117157Z" />
            </svg>
          </button>
        </header>
        <div className="flex flex-col gap-4 md:flex-row md:gap-5 lg:gap-6 md:items-stretch max-h-[80vh] overflow-y-auto">
          {SECTIONS.map((section, si) => (
            <div key={section.title} className="flex md:flex-row gap-0">
              {si > 0 && <div className="hidden md:block w-px bg-[#363636] shrink-0 self-stretch mr-4 lg:mr-6" aria-hidden="true" />}
              <section className="flex w-full min-w-0 flex-col gap-2 md:w-[160px] lg:w-[190px] shrink-0">
                <h3 className="text-sm font-medium text-[#09CAF5]">{section.title}</h3>
                <div className="flex flex-col gap-2">
                  {section.items.map((item) => (
                    <div key={item.label} className="flex w-full items-center justify-between gap-3">
                      <span className="text-sm text-[#bbb] leading-snug">{item.label}</span>
                      <div className="flex flex-wrap items-center justify-end gap-1.5 text-sm shrink-0">
                        {item.keys.map((key, ki) => (
                          <span key={ki}>
                            {ki > 0 && <span className="text-[#888] text-xs mr-1">+</span>}
                            <Kbd>{key}</Kbd>
                          </span>
                        ))}
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
