import { describe, it, expect } from 'vitest';
import { buildFfmpegArgs } from './video-trim.utils';
import { TEMP_DIR } from './video-trim.constants';
import type { VideoTrimJobData } from './video-trim.types';

function makeJobData(overrides?: Partial<VideoTrimJobData>): VideoTrimJobData {
  return {
    taskId: 'task-001',
    userId: 'user-1',
    inputPath: '/videos/source.mp4',
    outputPath: `${TEMP_DIR}task-001/output.mp4`,
    startTime: 10,
    endTime: 25,
    hasAudio: true,
    ...overrides,
  };
}

const defaultConfig = { encoder: 'libx264', preset: 'fast', crf: 23 };

describe('buildFfmpegArgs', () => {
  it('should build correct FFmpeg command with audio', () => {
    const args = buildFfmpegArgs(makeJobData(), defaultConfig);
    expect(args).toContain('-c:a');
    expect(args).toContain('aac');
    expect(args).not.toContain('-an');
  });

  it('should build correct FFmpeg command without audio', () => {
    const args = buildFfmpegArgs(makeJobData({ hasAudio: false }), defaultConfig);
    expect(args).toContain('-an');
    expect(args).not.toContain('aac');
  });

  it('should place first -ss before -i and second -ss after -i', () => {
    const args = buildFfmpegArgs(makeJobData(), defaultConfig);
    const firstSsIdx = args.indexOf('-ss');
    const iIdx = args.indexOf('-i');
    const secondSsIdx = args.indexOf('-ss', firstSsIdx + 1);

    expect(firstSsIdx).toBeGreaterThan(-1);
    expect(secondSsIdx).toBeGreaterThan(firstSsIdx);
    expect(firstSsIdx).toBeLessThan(iIdx);
    expect(secondSsIdx).toBeGreaterThan(iIdx);
  });

  it('should handle startTime < 1s correctly without negative seek', () => {
    const args = buildFfmpegArgs(makeJobData({ startTime: 0.3, endTime: 5 }), defaultConfig);
    const firstSsIdx = args.indexOf('-ss');
    // preSeek should be 0, not negative
    expect(args[firstSsIdx + 1]).toBe('0');
  });

  it('should handle startTime >= 1s with normal mixed seek', () => {
    const args = buildFfmpegArgs(makeJobData({ startTime: 5, endTime: 10 }), defaultConfig);
    const firstSsIdx = args.indexOf('-ss');
    const secondSsIdx = args.indexOf('-ss', firstSsIdx + 1);
    // preSeek = Math.max(0, 5 - 1) = 4
    expect(args[firstSsIdx + 1]).toBe('4');
    // postSeek = 5 - 4 = 1
    expect(args[secondSsIdx + 1]).toBe('1');
  });

  it('should use taskId-isolated temp directory', () => {
    const jobData = makeJobData();
    const args = buildFfmpegArgs(jobData, defaultConfig);
    // Output path should contain taskId subdirectory
    const outputIdx = args.indexOf('-y');
    expect(args[outputIdx + 1]).toContain('task-001');
  });

  it('should use config values for encoder, preset, and crf', () => {
    const args = buildFfmpegArgs(makeJobData(), {
      encoder: 'libx265',
      preset: 'medium',
      crf: 18,
    });
    expect(args).toContain('libx265');
    expect(args).toContain('medium');
    expect(args).toContain('18');
  });
});
