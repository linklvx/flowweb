interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
}

const EXAMPLES = ['柔和的金色阳光透过窗户洒入', '霓虹灯管从侧面打亮主体边缘'];

export function PromptInput({ value, onChange }: PromptInputProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-text-dim-3">自定义提示词</label>
      <textarea
        className="w-[272px] h-20 bg-overlay-1 border border-overlay-2 rounded-lg px-3 py-2 text-sm text-text placeholder-text-dim-2 resize-none focus:outline-none focus:border-overlay-3"
        placeholder="描述你想要的光照效果..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="flex gap-1.5 flex-wrap">
        {EXAMPLES.map((text) => (
          <button
            key={text}
            type="button"
            className="text-xs px-2 py-1 rounded bg-overlay-1 text-text-dim-3 hover:bg-overlay-2 hover:text-text transition-colors truncate max-w-full border-0 shadow-none outline-none"
            onClick={() => onChange(text)}
            title={text}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
