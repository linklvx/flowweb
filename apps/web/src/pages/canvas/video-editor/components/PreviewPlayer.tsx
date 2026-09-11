import { useRef } from 'react';
import { App as AntdApp, Slider, Tooltip } from 'antd';
import { DeleteOutlined, RedoOutlined, ScissorOutlined, UndoOutlined } from '@ant-design/icons';
import { useEditorStore } from '../store/editorStore';
import { usePreviewPlayback } from '../hooks/usePreviewPlayback';
import { togglePlayback, seekPlayback } from '../hooks/playback'; // R3 五-5：stopPlayback 未使用（停止走 togglePlayback 的 playing 分支），删导入
import { audioEngine } from '../audio-engine/engine';
import { formatShortTime, totalDuration } from '../timeline/timecode';
import { watchShadowJob } from '../hooks/shadowJob';
import { regenerateNode } from '@/api/videoProjectApi';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';

export function PreviewPlayer() {
  const { message, modal } = AntdApp.useApp(); // 批1-2：静态 Modal.confirm/message（portal body z-index 2010 被壳盖不可见）→ 壳内上下文实例
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  usePreviewPlayback(canvasRef);
  const playing = useEditorStore(s => s.playing);
  const preparing = useEditorStore(s => s.preparing);
  const playhead = useEditorStore(s => s.playhead);
  const data = useEditorStore(s => s.data);
  const pxPerSec = useEditorStore(s => s.pxPerSec);
  const setPxPerSec = useEditorStore(s => s.setPxPerSec);
  const selectedClipId = useEditorStore(s => s.selectedClipId);
  const shadowBusy = useEditorStore(s => Object.keys(s.shadowJobs).length > 0);
  const nodes = useNodeStore(s => s.nodes); // 左面板可读整个 nodeStore（编辑器挂画布根层——spec §二 挂载结构）
  const total = data ? totalDuration(data) : 0;

  // 添加字幕（本地——spec §4 表）
  const onAddSubtitle = () => {
    if (!data) return;
    const trackId = data.tracks.find((t) => t.type === 'subtitle')?.id
      ?? useEditorStore.getState().addTrack('subtitle'); // 现码 addTrack 返回新轨 id（editorStore:391-399）
    useEditorStore.getState().addSubtitleClip(trackId, playhead);
  };
  // 片段重拍（生成音频恒置灰见 JSX——决策 3 登记偏离：后端无 callAudioGen 执行分支）
  const selectedClip = selectedClipId ? data?.clips[selectedClipId] : undefined;
  const retakeSource = selectedClip && 'sourceNodeId' in selectedClip
    ? nodes[selectedClip.sourceNodeId as string] : undefined;
  // R4-7：排除产物节点（type 同为 videoGen，但 origin='video-edit' 无 prompt/model）——后端 regenerate 只校验类型
  // （video-project.service.ts:87-88），放行会空 prompt 触发一次真实生成/莫名失败；产物节点是终点不参与重拍（验收 13 口径）
  const canRetake = retakeSource?.type === 'videoGen'
    && (retakeSource.data as { origin?: string } | undefined)?.origin !== 'video-edit'; // 仅真实视频分支（spec §4）——imageGen 源/产物节点置灰
  const onRetake = () => {
    if (!retakeSource) return;
    modal.confirm({
      title: '片段重拍', content: '将消耗团队积分，确认重新生成该片段的视频？',
      onOk: async () => {
        try {
          const workflowId = useCanvasStore.getState().projectId;
          if (!workflowId) return;
          const { shadowNodeId, result } = await regenerateNode({ workflowId, sourceNodeId: retakeSource.id, kind: 'video' });
          // R6-P2-1：result 透传——早失败（扣费失败/参数错）在 HTTP 往返内已 emit error（订阅错过），靠 initial 立即反馈
          void watchShadowJob(shadowNodeId, 'video', { name: `${(retakeSource.data as { label?: string })?.label ?? '重拍'}` }, result, { success: message.success, error: message.error }); // notify：生成完成/失败 toast 落壳内
        } catch (err) {
          void message.error(`重拍请求失败：${(err as Error).message}`); // R7-P3：HTTP 4xx/网络错——antd confirm onOk reject 只停 loading 无任何提示
        }
      },
    });
  };

  return (
    <div className="h-full flex-1 min-h-0 flex flex-col bg-[var(--ve-bg)]">
      {/* 16:9 预览区 */}
      <div ref={containerRef} className="flex-1 min-h-0 flex items-center justify-center p-3">
        {/* 偏离登记：计划 JSX 笔误——canvas 缺 ref={canvasRef}，hook 拿不到画布致播放循环/单帧渲染全失效（G1 用例红揭示），按计划目标语义补上 */}
        <canvas ref={canvasRef} data-testid="preview-canvas" width={1920} height={1080}
          className="bg-black max-w-full max-h-full" style={{ aspectRatio: '16 / 9', width: '100%' }}
          onClick={(e) => { // 点击画布 seek（点击位置→时间）
            const rect = e.currentTarget.getBoundingClientRect();
            seekPlayback(((e.clientX - rect.left) / rect.width) * total);
          }} />
      </div>
      {/* 控制条（spec 第四节：播放/时间码/撤销/重做/分割/删除 + 音量/全屏/缩放滑杆） */}
      <div data-testid="preview-control-bar"
        className="h-11 shrink-0 flex items-center gap-2 px-3 bg-[var(--ve-panel)] border-t border-[var(--ve-border)] [border-top-style:solid] box-border">
        <button type="button" data-testid="preview-play-btn" disabled={preparing}
          onClick={() => { void togglePlayback(); }}
          className="text-[16px] text-[var(--ve-text)] bg-transparent border-0 cursor-pointer px-2 disabled:opacity-50">
          {preparing ? '…' : playing ? '⏸' : '▶'}
        </button>
        <span className="text-[12px] text-[var(--ve-text)] tabular-nums">
          {formatShortTime(playhead)}
          <span className="text-[var(--ve-text-dim)]"> / {formatShortTime(total)}</span>
        </span>
        <span className="text-[var(--ve-text-dim)] mx-1">|</span>
        <button type="button" aria-label="撤销" title="撤销 Ctrl+Z" onClick={() => useEditorStore.getState().undo()}
          className="text-[15px] text-[var(--ve-text)] bg-transparent border-0 cursor-pointer px-1.5 hover:text-white"><UndoOutlined /></button>
        <button type="button" aria-label="重做" title="重做 Ctrl+Shift+Z" onClick={() => useEditorStore.getState().redo()}
          className="text-[15px] text-[var(--ve-text)] bg-transparent border-0 cursor-pointer px-1.5 hover:text-white"><RedoOutlined /></button>
        <button type="button" aria-label="分割" title="分割 S（在播放头处）"
          onClick={() => { const es = useEditorStore.getState(); if (es.selectedClipId) es.splitClip(es.selectedClipId, es.playhead); }}
          className="text-[15px] text-[var(--ve-text)] bg-transparent border-0 cursor-pointer px-1.5 hover:text-white"><ScissorOutlined /></button>
        <button type="button" aria-label="删除" title="删除 Delete"
          onClick={() => { const es = useEditorStore.getState(); if (es.selectedClipId) es.removeClip(es.selectedClipId); }}
          className="text-[15px] text-[var(--ve-text)] bg-transparent border-0 cursor-pointer px-1.5 hover:text-white"><DeleteOutlined /></button>
        <div className="flex items-center gap-2 ml-2 pl-2 border-l border-[var(--ve-border)]" style={{ borderLeftStyle: 'solid' }}>
          <button type="button" className="text-[12px] text-[var(--ve-accent)] bg-transparent border-0 cursor-pointer px-0" onClick={onAddSubtitle}>添加字幕</button>
          {/* R4-8：Chromium 不对 disabled 表单控件派发 mouse 事件——Tooltip 直接包 disabled 按钮无 hover（antd FAQ 同款），
              内包 <span className="inline-block"> 承接 mouseenter（验收 17 的 Tooltip 文案核对依赖此结构） */}
          <Tooltip title="音频生成暂未接入，待供应商接入后开放">
            <span className="inline-block">
              <button type="button" disabled className="text-[12px] text-[var(--ve-accent)] bg-transparent border-0 px-0 disabled:opacity-40" data-testid="gen-audio-btn">生成音频</button>
            </span>
          </Tooltip>
          <Tooltip title={canRetake ? '将消耗团队积分' : '选中带源视频片段后可重拍'}>
            <span className="inline-block">
              <button type="button" disabled={!canRetake || shadowBusy} className="text-[12px] text-[var(--ve-accent)] bg-transparent border-0 px-0 disabled:opacity-40" onClick={onRetake}>片段重拍</button>
            </span>
          </Tooltip>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Tooltip title="音量">
            {/* 偏离登记：antd 5.22.5 Slider 吞 data-testid（不透传根 div）——计划预授权最小适配：包裹 span 承载 testid */}
            <span data-testid="volume-slider" className="inline-flex">
              <Slider className="w-20" min={0} max={100} defaultValue={100}
                onChange={(v) => audioEngine.setMasterVolume((v as number) / 100)} />
            </span>
          </Tooltip>
          <button type="button" title="全屏"
            onClick={() => { const el = containerRef.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.(); }}
            className="text-[14px] text-[var(--ve-text)] bg-transparent border-0 cursor-pointer px-1.5">⛶</button>
          <Tooltip title="时间轴缩放">
            <span data-testid="zoom-slider" className="inline-flex">
              <Slider className="w-24" min={10} max={500} value={pxPerSec}
                onChange={(v) => setPxPerSec(v as number)} />
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
