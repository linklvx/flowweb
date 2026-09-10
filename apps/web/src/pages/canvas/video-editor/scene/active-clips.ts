import type { Clip, ProjectData } from '../types';

export interface ActiveClip { clip: Clip; trackIndex: number; }

/** t 时刻视觉活跃片段（视频/图片/字幕；音频不进视觉管线），按 renderOrder 排序：
 *  ① 视频/图片按 track 索引升序（索引小先画=底层）、同轨按 start（crossfade 前片先画，后片自然上层）；
 *  ② 字幕恒最后（视觉最上，spec 第三节 renderOrder）。
 *  hidden 轨整体剔除；区间半开 [start, start+duration)。 */
export function selectActiveClips(data: ProjectData, t: number): ActiveClip[] {
  const visual: ActiveClip[] = [];
  const subtitles: ActiveClip[] = [];
  data.tracks.forEach((track, trackIndex) => {
    if (track.hidden) return;
    for (const cid of track.clips) {
      const c = data.clips[cid];
      if (!c || c.type === 'audio') continue;
      if (t < c.start || t >= c.start + c.duration) continue;
      const entry: ActiveClip = { clip: c, trackIndex };
      if (c.type === 'subtitle') subtitles.push(entry);
      else visual.push(entry);
    }
  });
  visual.sort((a, b) => a.trackIndex - b.trackIndex || a.clip.start - b.clip.start);
  return [...visual, ...subtitles];
}
