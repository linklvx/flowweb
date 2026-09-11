// apps/web/src/pages/canvas/video-editor/timeline/placement.ts
import type { ProjectData, Track } from '../types';

export type AssetKind = 'video' | 'audio' | 'image';
export function assetKindOf(mimeType: string): AssetKind {
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'image';
}

export interface PlacementResult {
  trackId: string;
  start: number;
  createNewTrack: boolean;
  newTrackType?: Track['type'];
}

/** 动态建轨策略（spec 3.1 / D8）：取该类型第一条轨 → 起点 = 该轨 max(start+duration)（空轨 0）；无该类型轨 → 标记建轨。
 *  轨尾追加位与轨内既有片段不可能重叠，故不做重叠判定。 */
export function placeAssetInTrack(data: ProjectData, asset: { mimeType: string }): PlacementResult {
  const trackType: Track['type'] = assetKindOf(asset.mimeType) === 'audio' ? 'audio' : 'video'; // 图片归视频轨
  const track = data.tracks.find((t) => t.type === trackType);
  if (!track) return { trackId: '', start: 0, createNewTrack: true, newTrackType: trackType };
  const start = Math.max(0, ...track.clips.map((id) => {
    const c = data.clips[id];
    return c ? c.start + c.duration : 0;
  }));
  return { trackId: track.id, start, createNewTrack: false };
}
