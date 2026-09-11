import { describe, it, expect } from 'vitest';
import { createDefaultProjectData } from './video-project';

describe('createDefaultProjectData', () => {
  it('初始仅 1 条空视频轨（其余轨道随素材动态创建——spec 勘误③）', () => {
    const d = createDefaultProjectData();
    expect(d.tracks).toHaveLength(1);
    expect(d.tracks[0].type).toBe('video');
    expect(d.tracks[0].clips).toEqual([]);
  });
});
