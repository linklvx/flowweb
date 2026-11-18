import { useEffect, useMemo, useState } from 'react';
import { useNodeStore, NODE_TYPES } from '@/stores/nodeStore';
import { batchGetMedia, type BatchMediaItem } from '@/api/mediaApi';
import { resolvePrimaryMediaId } from '@flowweb/shared';

export interface AssetItem extends BatchMediaItem {
  mediaId: string;
  sourceNodeId: string; // 画布来源节点（素材库上传物为空串）
  /** 决策 6 第一优先级：节点生成配置时长（秒）——缺失时 drag payload 回落 media metadata.durationSec */
  nodeDurationSec?: number;
  kind: 'video' | 'audio' | 'image';
}

const SOURCE_TYPES = new Set([NODE_TYPES.VIDEO_GEN, NODE_TYPES.AUDIO_GEN, NODE_TYPES.IMAGE_GEN]);
const kindOf = (mime: string): AssetItem['kind'] =>
  mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image';

export function useWorkflowAssets(): { items: AssetItem[]; loading: boolean } {
  const nodes = useNodeStore((s) => s.nodes);
  // Y2 B3：资产收集改 resolvePrimaryMediaId 单源（n.data?.fileId 直读退役）
  const entries = useMemo(
    () => Object.values(nodes).filter((n: any) => {
      if (!SOURCE_TYPES.has(n.type)) return false;
      return resolvePrimaryMediaId({ type: n.type, data: (n.data ?? {}) as Record<string, unknown> }, undefined) !== '';
    }),
    [nodes],
  );
  const idsKey = useMemo(() => entries.map((e: any) => resolvePrimaryMediaId({ type: e.type, data: (e.data ?? {}) as Record<string, unknown> }, undefined) as string).sort().join(','), [entries]);
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ids = idsKey ? idsKey.split(',') : [];
    if (ids.length === 0) { setItems([]); setLoading(false); return; } // 补 setLoading——防在途请求被取消后 loading 永真（review M1）
    setLoading(true);
    batchGetMedia(ids)
      .then((rows) => {
        if (cancelled) return;
        setItems(rows.map((r) => {
          const owner = entries.find((e: any) => resolvePrimaryMediaId({ type: e.type, data: (e.data ?? {}) as Record<string, unknown> }, undefined) === r.id) as any;
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
