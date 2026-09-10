import { useState } from 'react';
import { Input } from 'antd';
import { useWorkflowAssets } from '../hooks/useWorkflowAssets';
import { useEditorStore } from '../store/editorStore';

export function AssetPanel() {
  const { items, loading } = useWorkflowAssets();
  const [keyword, setKeyword] = useState('');
  const data = useEditorStore(s => s.data);

  const addedMediaIds = new Set(
    data ? Object.values(data.clips).map(c => (c as any).mediaId).filter(Boolean) : [],
  );
  const filtered = items.filter(i => i.originalName.includes(keyword));

  return (
    <div data-testid="asset-panel" className="w-[260px] shrink-0 border-r border-[#E5E7EB] [border-right-style:solid] bg-white flex flex-col min-h-0 box-border">
      <div className="p-2 border-b border-[#F2F3F5] [border-bottom-style:solid]">
        <Input placeholder="搜索资产" value={keyword} onChange={e => setKeyword(e.target.value)} size="small" />
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-2 py-1 text-[12px] text-[#86909C]">全集资产</div>
        {loading && <div className="px-2 text-[12px] text-[#86909C]">加载中…</div>}
        <ul className="list-none pl-0 m-0">
          {filtered.map(i => (
            <li key={i.mediaId}
              data-testid={`asset-item-${i.mediaId}`}
              draggable
              onDragStart={e => e.dataTransfer.setData('application/x-clip', JSON.stringify({
                mediaId: i.mediaId,
                sourceNodeId: i.sourceNodeId || undefined,
                mimeType: i.mimeType,
                originalName: i.originalName,
                durationSec: i.nodeDurationSec ?? (i.metadata as { durationSec?: number })?.durationSec, // 决策 6：节点配置时长优先，metadata 兜底
              }))}
              className="flex items-center gap-2 px-2 py-1.5 cursor-grab hover:bg-[#F7F8FA]">
              <div className="w-10 h-10 rounded-md bg-[#F2F3F5] shrink-0 overflow-hidden flex items-center justify-center">
                {i.thumbnailUrl
                  ? <img src={i.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  : <span className="text-[10px] text-[#86909C]">{i.kind === 'audio' ? '音' : i.kind === 'video' ? '视' : '图'}</span>}
              </div>
              <span className="text-[12px] text-[#4E5969] truncate" style={{ minWidth: 0 }}>{i.originalName}</span>
              {addedMediaIds.has(i.mediaId)
                && <span className="ml-auto text-[10px] text-[#00B42A] shrink-0">已添加</span>}
            </li>
          ))}
        </ul>
        {!loading && filtered.length === 0 && <div className="px-2 py-3 text-[12px] text-[#C9CDD4]">暂无资产</div>}
        {/* spec 全集资产 = 画布产物 + 团队素材库——团队素材分支 Plan 3（folder 接口接入后实化） */}
        <div className="px-2 py-1 mt-2 border-t border-[#F2F3F5] [border-top-style:solid] text-[12px] text-[#C9CDD4]">团队素材（Plan 3）</div>
      </div>
    </div>
  );
}
