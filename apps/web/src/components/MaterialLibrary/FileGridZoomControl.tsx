import { useMaterialLibraryStore } from '../../stores/materialLibraryStore';

interface FileGridZoomControlProps {
  value?: number;
  onChange?: (size: number) => void;
}

export default function FileGridZoomControl({ value: propValue, onChange: propOnChange }: FileGridZoomControlProps = {}) {
  const storeFileGridSize = useMaterialLibraryStore((s) => s.fileGridSize);
  const storeSetFileGridSize = useMaterialLibraryStore((s) => s.setFileGridSize);

  const fileGridSize = propValue ?? storeFileGridSize;
  const setFileGridSize = propOnChange ?? storeSetFileGridSize;

  return (
    <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="range"
        min="150"
        max="300"
        step="10"
        value={fileGridSize}
        onChange={(e) => setFileGridSize(Number(e.target.value))}
        className="zoom-slider w-24"
      />
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{fileGridSize}px</span>
    </div>
  );
}
