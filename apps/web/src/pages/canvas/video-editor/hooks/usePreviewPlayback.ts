import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { audioEngine } from '../audio-engine/engine';
import { makeFrameDeps } from './playback';
import { renderFrameAt, type FrameRenderDeps } from '../renderer/render-frame';
import { canvasSizeOf } from '../timeline/canvas-size';
import { totalDuration } from '../timeline/timecode';
import type { ProjectData } from '../types';

/** canvas.width 赋值会清空画布并重置 2D 上下文——属性（PreviewPlayer）与守卫（本 hook 三处）必须同源走此函数：
 * 尺寸一致时不触碰（幂等），防 60Hz 每帧重设 + 闪黑 */
export function applyCanvasSize(canvas: HTMLCanvasElement, w: number, h: number): boolean {
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
  return false;
}

/** 播放视觉循环 + 暂停态单帧渲染（G1/决策 18）：
 *  renderLatest(deps, data, t) 统一收口两条路径（N5）：pendingRef + reqRef 请求代数——in-flight 时只记最新请求、
 *  完成后代数不一致即以最新 deps/data 补渲染一次（同 t 的 mediaInfo 变化也推进代数——遗留②保证补帧）；
 *  否则 scrubMove/拖片段 60Hz 每帧发起全帧渲染（含视频 seek），MediaEntry 串行链排队上百次。
 *  playing=true：起锚（音频由 engine.playFrom 同步起）→ rAF 每帧 engine.now() → setPlayhead → renderLatest（跳帧追赶，决策 15）。
 *  播放中 data 变化（编辑）→ 音频 playFrom **100ms 前沿去抖**重排（A4/决策 6③：transient 60Hz 下不"机器枪"）。
 *  playing=false：依赖 [playhead, data, mediaInfo] 单帧渲染——进编辑器即出 playhead 帧（非黑屏）、暂停后 seek/拖标尺即时出画、url 回填自愈补帧（遗留②）。 */
export function usePreviewPlayback(canvasRef: React.RefObject<HTMLCanvasElement | null>): void {
  const playing = useEditorStore(s => s.playing);
  const playhead = useEditorStore(s => s.playhead);
  const data = useEditorStore(s => s.data);
  const mediaInfo = useEditorStore(s => s.mediaInfo); // 遗留②：url 回填（mediaInfo 变化）触发暂停态补帧
  const size = useEditorStore((s) => canvasSizeOf(s.data)); // C 档运行时画布（引用稳定：同引用/模块常量，不随无关重渲空转）
  const pendingRef = useRef(false);
  const reqRef = useRef(0);
  const latestRef = useRef<{ deps: FrameRenderDeps; d: ProjectData; t: number } | null>(null);

  const renderLatest = (deps: FrameRenderDeps, d: ProjectData, t: number): void => {
    ++reqRef.current; // 自增值直接作废旧请求，无需具名 req 变量
    latestRef.current = { deps, d, t }; // 同 t 的 mediaInfo 变化也触发代数 +1（仅比 t 会吞同 t 补帧）
    if (pendingRef.current) return; // in-flight 去重（N5）
    const run = (): void => {
      pendingRef.current = true;
      const at = reqRef.current;
      const cur = latestRef.current!;
      renderFrameAt(cur.d, cur.t, cur.deps).catch(() => {}).finally(() => {
        pendingRef.current = false;
        if (reqRef.current !== at) run(); // 期间有新请求（含同 t）→ 以最新 deps/data 补渲（R3 §4.2 旧闭包问题随代数尾追消除）
      });
    };
    run();
  };

  // R11 登记1：canvasSize 变化（含播放中切换）重设 backing store——playing effect deps [playing, canvasRef]
  // 不含 size，播放中切比例该 effect 不重跑；独立 effect 订阅值变化即收口播放/暂停两态。
  // canvas.width 赋值清空画布：播放态由 rAF 循环下一帧重绘、暂停态由下方单帧 effect（data 已含 canvasSize）补渲。
  // 必须先于下方两 effect 声明——挂载时先重设尺寸再出首帧，防首帧被清
  useEffect(() => {
    if (canvasRef.current) applyCanvasSize(canvasRef.current, size.width, size.height);
  }, [size, canvasRef]);

  // 暂停态单帧（G1）
  useEffect(() => {
    if (playing || !data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    applyCanvasSize(canvas, size.width, size.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderLatest(makeFrameDeps(ctx), data, playhead);
  }, [playing, playhead, data, mediaInfo, canvasRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // 播放循环
  useEffect(() => {
    if (!playing) return;
    const canvas = canvasRef.current;
    const es0 = useEditorStore.getState();
    if (!canvas || !es0.data) return;
    const size0 = canvasSizeOf(es0.data); // 起播时点读最新画布（subscription size 可能与 effect 闭包错拍）
    applyCanvasSize(canvas, size0.width, size0.height);
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
