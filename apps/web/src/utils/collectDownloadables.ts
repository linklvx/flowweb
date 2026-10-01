// apps/web/src/utils/collectDownloadables.ts
import { normalizeSelection, participation, type CanvasNodeRecord } from '@flowweb/shared';
import { isImageCompletedNode } from './imageNodeGuards';

export interface DownloadableItem { fileId: string; filename: string; type: string; }

const TYPE_LABEL: Record<string, string> = {
  imageGen: '图片', imageExtGen: '图片', multiImageGen: '图片', videoGen: '视频', audioGen: '音频',
};

const mediaNameOf = (d: Record<string, unknown>): string | undefined =>
  typeof d.mediaName === 'string' && d.mediaName ? d.mediaName : undefined;

const fallbackName = (node: CanvasNodeRecord): string =>
  `${TYPE_LABEL[node.type] ?? node.type}-${node.id.slice(-6)}`;

/** 收集集（契约 1 download）：participation('download') 闭包全展开（含 hidden）→ 逐节点提取。
 *  data 取数经注入的 ns 节点表（ns 优先——cs 陈旧探针 M8）；文件名链 data.mediaName ?? `${类型}-${id.slice(-6)}`。
 *  ns 缺项/组节点跳过：download 为只读聚合，单坏节点不炸整批。 */
export function collectDownloadables(
  csNodes: CanvasNodeRecord[],
  selectedIds: string[],
  getNsNodeMap: () => Record<string, CanvasNodeRecord>,
): DownloadableItem[] {
  const buckets = normalizeSelection(csNodes, selectedIds);
  const p = participation(buckets, 'download', csNodes);
  const nsMap = getNsNodeMap();
  const out: DownloadableItem[] = [];
  for (const id of p.ids) {
    const node = nsMap[id];
    const d = node?.data;
    if (!node || !d || node.type === 'group') continue;
    // guard 签名是 React Flow Node，但仅读 {id,type,data}——传最小结构视图桥接 CanvasNodeRecord
    const guardNode = { id: node.id, type: node.type, position: node.position, data: d };
    if (node.type === 'imageGen' || node.type === 'imageExtGen') {
      if (!isImageCompletedNode(guardNode)) continue;
      const fileId = d.fileId || d.referenceImage;
      if (typeof fileId === 'string' && fileId) {
        out.push({ fileId, filename: mediaNameOf(d) ?? fallbackName(node), type: node.type });
      }
      continue;
    }
    if (node.type === 'multiImageGen') {
      if (!isImageCompletedNode(guardNode)) continue;
      const images = Array.isArray(d.images) ? (d.images as Array<Record<string, unknown>>) : [];
      const idx = typeof d.mainImageIndex === 'number' ? d.mainImageIndex : -1;
      const main = images[idx];
      const pick = main?.status === 'success' ? main : images.find((i) => i?.status === 'success');
      if (pick && typeof pick.id === 'string' && pick.id) {
        out.push({ fileId: pick.id, filename: mediaNameOf(d) ?? fallbackName(node), type: node.type });
      }
      continue;
    }
    if ((node.type === 'videoGen' || node.type === 'audioGen') && d.status === 'done' && typeof d.fileId === 'string' && d.fileId) {
      out.push({ fileId: d.fileId, filename: mediaNameOf(d) ?? fallbackName(node), type: node.type });
    }
  }
  return out;
}
