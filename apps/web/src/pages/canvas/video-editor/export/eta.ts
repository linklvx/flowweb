// apps/web/src/pages/canvas/video-editor/export/eta.ts
const FIRST_SAMPLE = 29;   // 前 30 帧试编码测速外推
const ROLLING_EVERY = 500; // 每 500 帧滚动修正（跨 GOP seek 成本不同，首测偏不准）

export interface EtaTracker { observe(frameIndex: number): void; etaSec(): number | null; }

export function createEtaTracker(totalFrames: number, nowMs: () => number = () => performance.now()): EtaTracker {
  let lastFrame = -1;
  let rate = 0; // 帧/ms
  let windowStart = 0;
  let windowStartFrame = 0;
  return {
    observe(frameIndex: number): void {
      if (frameIndex <= lastFrame) return;
      if (lastFrame < 0) { windowStart = nowMs(); windowStartFrame = 0; lastFrame = frameIndex; return; }
      lastFrame = frameIndex;
      const isSample = frameIndex === FIRST_SAMPLE || frameIndex % ROLLING_EVERY === ROLLING_EVERY - 1;
      if (isSample) {
        const t = nowMs();
        rate = (frameIndex - windowStartFrame) / Math.max(1, t - windowStart);
        windowStart = t;
        windowStartFrame = frameIndex;
      }
    },
    etaSec(): number | null {
      if (rate <= 0) return null;
      return ((totalFrames - 1 - lastFrame) / rate) / 1000;
    },
  };
}
