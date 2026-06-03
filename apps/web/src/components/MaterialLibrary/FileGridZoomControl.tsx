import { useMaterialLibraryStore } from '../../stores/materialLibraryStore';

export default function FileGridZoomControl() {
  const fileGridSize = useMaterialLibraryStore((s) => s.fileGridSize);
  const setFileGridSize = useMaterialLibraryStore((s) => s.setFileGridSize);

  return (
    <div className="flex items-center gap-2 text-sm text-gray-400">
      <span>🔍</span>
      <input
        type="range"
        min="150"
        max="300"
        step="10"
        value={fileGridSize}
        onChange={(e) => setFileGridSize(Number(e.target.value))}
        className="w-24 h-1 accent-blue-500"
      />
      <span>{fileGridSize}px</span>
    </div>
  );
}
