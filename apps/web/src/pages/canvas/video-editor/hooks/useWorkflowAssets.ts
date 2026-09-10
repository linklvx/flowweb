import { useEffect, useMemo, useState } from 'react';
import { useNodeStore } from '@/stores/nodeStore';
import { batchGetMedia, type BatchMediaItem } from '@/api/mediaApi';

export interface AssetItem extends BatchMediaItem {
  mediaId: string;
  sourceNodeId: string; // 画布来源节点（素材库上传物为空串）
  /** 决策 6 第一优先级：节点生成配置时长（秒）——缺失时 drag payload 回落 media metadata.durationSec */
  nodeDurationSec?: number;
  kind: 'video' | 'audio' | 'image';
}

const SOURCE_TYPES = new Set(['videoGen', 'audioGen', 'imageGen']);
const kindOf = (mime: string): AssetItem['kind'] =>
  mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image';

export function useWorkflowAssets(): { items: AssetItem[]; loading: boolean } {
  const nodes = useNodeStore((s) => s.nodes);
  const entries = useMemo(
    () => Object.values(nodes).filter((n: any) => SOURCE_TYPES.has(n.type) && n.data?.fileId),
    [nodes],
  );
  const idsKey = useMemo(() => entries.map((e: any) => e.data.fileId as string).sort().join(','), [entries]);
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ids = idsKey ? idsKey.split(',') : [];
    if (ids.length === 0) { setItems([]); return; }
    setLoading(true);
    batchGetMedia(ids)
      .then((rows) => {
        if (cancelled) return;
        setItems(rows.map((r) => {
          const owner = entries.find((e: any) => e.data.fileId === r.id) as any;
          return {
            ...r, mediaId: r.id, sourceNodeId: owner?.id ?? '', kind: kindOf(r.mimeType),
            nodeDurationSec: typeof owner?.data?.duration === 'number' ? owner.data.duration : undefined, // 决策 6 第一优先级
          };
        }));
      })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [idsKey]);

  return { items, loading };
}
