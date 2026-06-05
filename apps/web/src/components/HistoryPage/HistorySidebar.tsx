import { useHistoryStore } from '@/stores/historyStore';

const TABS = [
  { key: 'image' as const, label: '图片历史' },
  { key: 'video' as const, label: '视频历史' },
  { key: 'audio' as const, label: '音频历史' },
];

export function HistorySidebar() {
  const activeTab = useHistoryStore((s) => s.activeTab);
  const counts = useHistoryStore((s) => s.counts);
  const setActiveTab = useHistoryStore((s) => s.setActiveTab);

  return (
    <div className="flex flex-col gap-1 p-2">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className="flex items-center justify-between rounded-lg border-0 px-3 py-2 text-left text-sm transition-colors shadow-none"
          style={{
            backgroundColor: activeTab === tab.key ? 'var(--canvas-controls-hover)' : 'transparent',
            color: 'var(--canvas-controls-text)',
          }}
          onClick={() => setActiveTab(tab.key)}
        >
          <span>{tab.label}</span>
          <span className="text-xs opacity-50">{counts[tab.key]}</span>
        </button>
      ))}
    </div>
  );
}
