// apps/api/src/modules/media/media-probe.poller.spec.ts —— Y1a+Y1b T7 单测（纯函数面）
// int（media-probe.int.spec）承载真 PG/S3/二进制行为；此处钉 ffprobe 沙箱形态（protocol_whitelist
// 前置+timeout 常量）与退避 jitter 界——poller 实现面的参数契约。
import { describe, it, expect } from 'vitest';
import {
  buildFfprobeArgs, computeProbeBackoffMs, FFPROBE_TIMEOUT_MS, FFMPEG_PROTOCOL_WHITELIST,
  PROBE_IMAGE_BATCH, PROBE_IMAGE_LEASE_MS, PROBE_VIDEO_BATCH, PROBE_VIDEO_LEASE_MS,
  MAX_IMAGE_PIXELS, MAX_PROBE_ATTEMPTS,
} from './media-probe.poller';

describe('Y1a+Y1b T7：probe 参数契约（v10 裁决分型批）', () => {
  it('分型批参数：image 批 4/lease 180s；video batch 1/lease 5min（批 2×90s 覆盖不了下载+ffprobe）', () => {
    expect(PROBE_IMAGE_BATCH).toBe(4);
    expect(PROBE_IMAGE_LEASE_MS).toBe(180_000);
    expect(PROBE_VIDEO_BATCH).toBe(1);
    expect(PROBE_VIDEO_LEASE_MS).toBe(300_000);
    expect(MAX_IMAGE_PIXELS).toBe(40_000_000);
    expect(MAX_PROBE_ATTEMPTS).toBeGreaterThanOrEqual(3);
  });

  it('ffprobe 沙箱形态：protocol_whitelist 前置（file 起头）+timeout 15s（spec Z7 口径「ffprobe 15s+SIGKILL+protocol_whitelist」）', () => {
    expect(FFPROBE_TIMEOUT_MS).toBe(15_000);
    expect(FFMPEG_PROTOCOL_WHITELIST.startsWith('file')).toBe(true);
    const args = buildFfprobeArgs('/tmp/x.mp4');
    const wl = args.indexOf('-protocol_whitelist');
    expect(wl).toBeGreaterThanOrEqual(0);
    expect(args[wl + 1]).toBe(FFMPEG_PROTOCOL_WHITELIST);
    expect(args.indexOf('-i')).toBeGreaterThan(wl);            // 白名单在首个输入前
    expect(args).toContain('-of');
    expect(args.join(' ')).not.toMatch(/shell|;/);             // spawn 数组形态（无 shell 拼接面）
    expect(args[args.length - 1]).toBe('/tmp/x.mp4');          // 路径为末位实参（数组元素非拼接）
  });

  it('退避 jitter 界：指数基数 30s×2^(n-1) 封顶 1h，抖幅 ×[0.5,1.5]', () => {
    for (let i = 0; i < 200; i++) {
      const d1 = computeProbeBackoffMs(1);
      expect(d1).toBeGreaterThanOrEqual(15_000);
      expect(d1).toBeLessThanOrEqual(45_000);
      const d3 = computeProbeBackoffMs(3);   // base 120s → [60s,180s]
      expect(d3).toBeGreaterThanOrEqual(60_000);
      expect(d3).toBeLessThanOrEqual(180_000);
      const dMax = computeProbeBackoffMs(30);   // base 封顶 1h → [30min, 90min]
      expect(dMax).toBeGreaterThanOrEqual(1_800_000);
      expect(dMax).toBeLessThanOrEqual(5_400_000);
    }
  });
});
