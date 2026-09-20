import { memo, useState, useEffect, useRef } from 'react';
import { useNodeStore, isImageNode, type ImageNodeData } from '@/stores/nodeStore';

interface ModelInfo {
  id: string; name: string;
}

interface Props {
  nodeId: string;
  editMode?: 'erase' | 'redraw';
  onGenerate?: () => void;
  isProcessing?: boolean;
  // redraw-specific
  prompt?: string;
  onPromptChange?: (value: string) => void;
  strength?: number;
  onStrengthChange?: (value: number) => void;
}

const RATIO_OPTIONS = [
  { label: '1:1', w: 12, h: 12 },
  { label: '9:16', w: 9, h: 16 },
  { label: '16:9', w: 16, h: 9 },
  { label: '3:4', w: 9, h: 12 },
  { label: '4:3', w: 12, h: 9 },
  { label: '3:2', w: 12, h: 8 },
  { label: '2:3', w: 9, h: 12 },
];

const RESOLUTION_OPTIONS = ['2K', '4K'];
const COUNT_OPTIONS = [1, 2, 3, 4];

const BAR_BG = 'var(--canvas-controls-bg)';
const BAR_BORDER = 'var(--canvas-controls-border)';
const TEXT_COLOR = 'var(--canvas-controls-text)';
const MUTED_COLOR = 'rgb(163, 163, 163)';

function RatioIcon({ ratio }: { ratio: string }) {
  const found = RATIO_OPTIONS.find((o) => o.label === ratio);
  const w = found?.w ?? 12;
  const h = found?.h ?? 12;
  const max = Math.max(w, h);
  const scale = 12 / max;
  const rw = Math.round(w * scale);
  const rh = Math.round(h * scale);
  const x = (16 - rw) / 2;
  const y = (16 - rh) / 2;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <rect x={x} y={y} width={rw} height={rh} rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M4 6.4L8 10.4L12 6.4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EraseBottomToolbarComponent({ nodeId, editMode, onGenerate, isProcessing, prompt, onPromptChange, strength, onStrengthChange }: Props) {
  const node = useNodeStore((s) => s.nodes[nodeId]);
  const updateConfig = useNodeStore((s) => s.updateConfig);
  const nodeData = (isImageNode(node) ? node.data : undefined) as ImageNodeData | undefined;

  const model = nodeData?.model ?? 'sdxl';
  const ratio = nodeData?.ratio ?? '16:9';
  const resolution = nodeData?.resolution ?? '2K';

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [creditCost, setCreditCost] = useState(0);
  const [modelOpen, setModelOpen] = useState(false);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [resOpen, setResOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [generateCount, setGenerateCount] = useState(1);

  // Refs for dropdown wrappers (trigger + panel) to detect outside clicks
  const modelWrapperRef = useRef<HTMLDivElement>(null);
  const ratioWrapperRef = useRef<HTMLDivElement>(null);
  const resWrapperRef = useRef<HTMLDivElement>(null);
  const countWrapperRef = useRef<HTMLDivElement>(null);

  // Load models
  useEffect(() => {
    fetch('/api/node-types/image/models')
      .then(r => r.json())
      .then(json => {
        if (json.code === 0) setModels(json.data);
      })
      .catch(() => {});
  }, []);

  // Calculate credits
  useEffect(() => {
    if (!model) return;
    fetch(`/api/pricing/calculate?modelId=${model}`)
      .then(r => r.json())
      .then(json => { if (json.code === 0) setCreditCost(json.data); })
      .catch(() => { setCreditCost(0); });
  }, [model]);

  // Close dropdowns on outside click — excludes clicks on trigger buttons or panels
  useEffect(() => {
    if (!modelOpen && !ratioOpen && !resOpen && !countOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (modelOpen && modelWrapperRef.current && !modelWrapperRef.current.contains(target)) setModelOpen(false);
      if (ratioOpen && ratioWrapperRef.current && !ratioWrapperRef.current.contains(target)) setRatioOpen(false);
      if (resOpen && resWrapperRef.current && !resWrapperRef.current.contains(target)) setResOpen(false);
      if (countOpen && countWrapperRef.current && !countWrapperRef.current.contains(target)) setCountOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelOpen, ratioOpen, resOpen, countOpen]);

  const selectedModel = models.find(m => m.id === model);
  const totalCredits = creditCost * generateCount;

  const btnClass =
    'h-8 rounded-lg py-1 pl-3 pr-2 flex items-center justify-center gap-1 hover:bg-overlay-2 active:bg-overlay-2 text-[13px] leading-normal transition-colors border-0';

  // Dropdown opens upward (bottom-full mb-1)
  const dropdownPanel =
    'absolute bottom-full left-0 mb-1 rounded-lg p-1 border z-50 min-w-full';
  const dropdownItem =
    'h-8 rounded-lg py-1 px-3 flex items-center text-[13px] hover:bg-overlay-2 whitespace-nowrap w-full border-0';

  const isRedraw = editMode === 'redraw';

  return (
    <div
      className="flex flex-col gap-2 rounded-xl p-2 shadow-md"
      style={{
        width: isRedraw ? 480 : 420,
        backgroundColor: BAR_BG,
        border: `0.444px solid ${BAR_BORDER}`,
        color: TEXT_COLOR,
      }}
    >
      {isRedraw && (
        <>
          <div className="flex items-center gap-1">
            <span style={{ color: MUTED_COLOR, fontSize: 11, whiteSpace: 'nowrap' }}>强度</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={strength ?? 50}
              onChange={(e) => onStrengthChange?.(parseInt(e.target.value))}
              disabled={isProcessing}
              style={{ flex: 1 }}
            />
            <span style={{ color: TEXT_COLOR, fontSize: 11, minWidth: 20, textAlign: 'right' }}>{strength ?? 50}</span>
          </div>
          <textarea
            placeholder="描述你希望生成的内容"
            value={prompt ?? ''}
            onChange={(e) => onPromptChange?.(e.target.value)}
            disabled={isProcessing}
            rows={2}
            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid transparent', backgroundColor: 'rgb(28,28,28)', color: '#ccc', fontSize: 12, width: '100%', resize: 'none', boxSizing: 'border-box', outline: 'none' }}
          />
        </>
      )}
      <div className="flex items-start gap-1">
        {/* Left section: Model + Ratio */}
        <div className="flex min-h-8 flex-1 items-center gap-1">
          {/* Model dropdown */}
          <div ref={modelWrapperRef} className="relative">
            <button
              type="button"
              className={btnClass}
              style={{ color: TEXT_COLOR }}
              onClick={() => setModelOpen(!modelOpen)}
              disabled={isProcessing}
            >
              <span className="whitespace-nowrap">{selectedModel?.name ?? model}</span>
              <ChevronDown />
            </button>
            {modelOpen && (
              <div className={dropdownPanel} style={{ backgroundColor: BAR_BG, borderColor: BAR_BORDER }}>
                {models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={dropdownItem}
                    style={{
                      color: m.id === model ? TEXT_COLOR : MUTED_COLOR,
                      backgroundColor: m.id === model ? 'var(--fw-overlay-2)' : 'transparent',
                      border: 0,
                    }}
                    onClick={() => {
                      updateConfig(nodeId, { model: m.id } as any);
                      setModelOpen(false);
                    }}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Ratio dropdown */}
          <div ref={ratioWrapperRef} className="relative">
            <button
              type="button"
              className={btnClass}
              style={{ color: TEXT_COLOR }}
              onClick={() => setRatioOpen(!ratioOpen)}
              disabled={isProcessing}
            >
              <span className="shrink-0">
                <RatioIcon ratio={ratio} />
              </span>
              <span className="whitespace-nowrap">{ratio}</span>
              <ChevronDown />
            </button>
            {ratioOpen && (
              <div className={dropdownPanel} style={{ backgroundColor: BAR_BG, borderColor: BAR_BORDER }}>
                {RATIO_OPTIONS.map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    className={dropdownItem}
                    style={{
                      color: r.label === ratio ? TEXT_COLOR : MUTED_COLOR,
                      backgroundColor: r.label === ratio ? 'var(--fw-overlay-2)' : 'transparent',
                      border: 0,
                    }}
                    onClick={() => {
                      updateConfig(nodeId, { ratio: r.label } as any);
                      setRatioOpen(false);
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Right section: Resolution + Count + Credits + Generate */}
        <div className="flex items-start gap-2">
          {/* Resolution dropdown */}
          <div ref={resWrapperRef} className="relative">
            <button
              type="button"
              className={btnClass}
              style={{ color: TEXT_COLOR }}
              onClick={() => setResOpen(!resOpen)}
              disabled={isProcessing}
            >
              <span className="whitespace-nowrap">{resolution}</span>
              <ChevronDown />
            </button>
            {resOpen && (
              <div className={dropdownPanel} style={{ backgroundColor: BAR_BG, borderColor: BAR_BORDER }}>
                {RESOLUTION_OPTIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={dropdownItem}
                    style={{
                      color: r === resolution ? TEXT_COLOR : MUTED_COLOR,
                      backgroundColor: r === resolution ? 'var(--fw-overlay-2)' : 'transparent',
                      border: 0,
                    }}
                    onClick={() => {
                      updateConfig(nodeId, { resolution: r } as any);
                      setResOpen(false);
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Count dropdown */}
          <div ref={countWrapperRef} className="relative">
            <button
              type="button"
              className={btnClass}
              style={{ color: TEXT_COLOR }}
              onClick={() => setCountOpen(!countOpen)}
              disabled={isProcessing}
            >
              <span className="whitespace-nowrap">{generateCount}张</span>
              <ChevronDown />
            </button>
            {countOpen && (
              <div className={dropdownPanel} style={{ backgroundColor: BAR_BG, borderColor: BAR_BORDER }}>
                {COUNT_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={dropdownItem}
                    style={{
                      color: n === generateCount ? TEXT_COLOR : MUTED_COLOR,
                      backgroundColor: n === generateCount ? 'var(--fw-overlay-2)' : 'transparent',
                      border: 0,
                    }}
                    onClick={() => {
                      setGenerateCount(n);
                      setCountOpen(false);
                    }}
                  >
                    {n}张
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Credits + Generate */}
          <div className="flex h-8 min-w-16 items-center gap-2" style={{ color: MUTED_COLOR }}>
            <span className="flex shrink-0 items-center gap-[2px]">
              <svg width="10" height="14" viewBox="0 0 16 24" fill="none" className="shrink-0" style={{ width: 10, height: 14 }}>
                <path d="M8.67352 4.08105C9.60755 3.00116 10.3727 3.29255 10.3727 4.73242V10.9033H12.9733C14.1511 10.9034 14.4794 11.6402 13.697 12.54L7.32684 19.9199C6.39312 20.9992 5.6269 20.7076 5.62665 19.2686V13.0977H3.02704C1.84902 13.0977 1.52094 12.3598 2.30341 11.46L8.67352 4.08105Z" fill="currentColor" />
              </svg>
              <span className="min-w-[13px] text-center text-[12px] font-normal leading-[15px]" style={{ color: MUTED_COLOR }}>
                {totalCredits}
              </span>
            </span>
            <button
              type="button"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg shadow-sm transition-[filter,opacity] hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 border-0"
              style={{ backgroundColor: 'white', color: 'rgb(23, 23, 23)' }}
              disabled={isProcessing}
              onClick={onGenerate}
            >
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                <path d="M8.29289 0.292893C8.68342 -0.0976311 9.31658 -0.0976311 9.70711 0.292893L17.7071 8.29289C18.0976 8.68342 18.0976 9.31658 17.7071 9.70711C17.3166 10.0976 16.6834 10.0976 16.2929 9.70711L10 3.41421V17C10 17.5523 9.55229 18 9 18C8.44772 18 8 17.5523 8 17V3.41421L1.70711 9.70711C1.31658 10.0976 0.683418 10.0976 0.292893 9.70711C-0.0976311 9.31658 -0.0976311 8.68342 0.292893 8.29289L8.29289 0.292893Z" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const EraseBottomToolbar = memo(EraseBottomToolbarComponent);
