import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { audioEngine } from '../audio-engine/engine';
import { makeFrameDeps } from './playback';
import { renderFrameAt, type FrameRenderDeps } from '../renderer/render-frame';
import { CANVAS_W, CANVAS_H } from '../renderer/canvas-renderer';
import { totalDuration } from '../timeline/timecode';
import type { ProjectData } from '../types';

/** 播放视觉循环 + 暂停态单帧渲染（G1/决策 18）：
 *  renderLatest(deps, data, t) 统一收口两条路径（N5）：pendingRef + latestTRef——in-flight 时只记最新 t、
 *  完成后补渲染一次；否则 scrubMove/拖片段 60Hz 每帧发起全帧渲染（含视频 seek），MediaEntry 串行链排队上百次。
 *  playing=true：起锚（音频由 engine.playFrom 同步起）→ rAF 每帧 engine.now() → setPlayhead → renderLatest（跳帧追赶，决策 15）。
 *  播放中 data 变化（编辑）→ 音频 playFrom **100ms 前沿去抖**重排（A4/决策 6③：transient 60Hz 下不"机器枪"）。
 *  playing=false：依赖 [playhead, data] 单帧渲染——进编辑器即出 playhead 帧（非黑屏）、暂停后 seek/拖标尺即时出画。 */
export function usePreviewPlayback(canvasRef: React.RefObject<HTMLCanvasElement | null>): void {
  const playing = useEditorStore(s => s.playing);
  const playhead = useEditorStore(s => s.playhead);
  const data = useEditorStore(s => s.data);
  const pendingRef = useRef(false);
  const latestTRef = useRef(0);

  const renderLatest = (deps: FrameRenderDeps, d: ProjectData, t: number): void => {
    latestTRef.current = t;
    if (pendingRef.current) return; // in-flight 去重（N5）
    const run = (tt: number): void => {
      pendingRef.current = true;
      renderFrameAt(d, tt, deps).catch(() => {}).finally(() => {
        pendingRef.current = false;
        // R3 §4.2 登记：尾追闭包的 d/deps 是发起那次渲染的（非最新 data）——播放中编辑/暂停拖拽期间可能
        // 以"旧 data + 新 t"补渲一帧，下一 tick/effect 触发自愈（低危，接受）
        if (latestTRef.current !== tt) run(latestTRef.current); // 期间有更新 → 补渲染最新
      });
    };
    run(t);
  };

  // 暂停态单帧（G1）
  useEffect(() => {
    if (playing || !data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    if (canvas.width !== CANVAS_W) { canvas.width = CANVAS_W; canvas.height = CANVAS_H; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderLatest(makeFrameDeps(ctx), data, playhead);
  }, [playing, playhead, data, canvasRef]);

  // 播放循环
  useEffect(() => {
    if (!playing) return;
    const canvas = canvasRef.current;
    const es0 = useEditorStore.getState();
    if (!canvas || !es0.data) return;
    if (canvas.width !== CANVAS_W) { canvas.width = CANVAS_W; canvas.height = CANVAS_H; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const deps = makeFrameDeps(ctx);
    audioEngine.playFrom(es0.data, es0.playhead); // 时钟锚定 + 音频调度
    let raf = 0;
    const tick = () => {
      const s = useEditorStore.getState();
      if (!s.playing || !s.data) return;
      const t = audioEngine.now();
      s.setPlayhead(t);
      const total = totalDuration(s.data);
      if (total > 0 && t >= total) { audioEngine.stop(); s.setPlaying(false); return; }
      renderLatest(deps, s.data, t); // N5：in-flight 去重（跳帧追赶，决策 15）
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // A4/决策 6③：播放中编辑（拖片段 transient 60Hz）重排 100ms 前沿去抖——停止变化后重排一次
    let rescheduleTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useEditorStore.subscribe((s, prev) => {
      if (s.data !== prev.data && s.playing && audioEngine.hasPcm()) {
        if (rescheduleTimer != null) clearTimeout(rescheduleTimer);
        rescheduleTimer = setTimeout(() => {
          rescheduleTimer = null;
          const st = useEditorStore.getState();
          if (st.playing && st.data) audioEngine.playFrom(st.data, audioEngine.now());
        }, 100);
      }
    });
    return () => {
      unsub();
      if (rescheduleTimer != null) clearTimeout(rescheduleTimer);
      cancelAnimationFrame(raf);
      audioEngine.stop();
    };
  }, [playing, canvasRef]);
}
