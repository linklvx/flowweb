import { useRef, useEffect } from 'react';
import { App as AntdApp, Slider, Tooltip } from 'antd';
import { DeleteOutlined, RedoOutlined, ScissorOutlined, UndoOutlined } from '@ant-design/icons';
import { useEditorStore } from '../store/editorStore';
import { usePreviewPlayback } from '../hooks/usePreviewPlayback';
import { togglePlayback, seekPlayback } from '../hooks/playback'; // R3 五-5：stopPlayback 未使用（停止走 togglePlayback 的 playing 分支），删导入
import { audioEngine } from '../audio-engine/engine';
import { formatShortTime, totalDuration } from '../timeline/timecode';
import { regenerateNode } from '@/api/videoProjectApi';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { selectExecStatus, selectExecEntry } from '@/stores/execStatusView';
import { gestureToken, storedToken, rotateToken } from '@/utils/regen-token';

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
  const sourceNodeId = selectedClip && 'sourceNodeId' in selectedClip
    ? selectedClip.sourceNodeId as string | undefined : undefined;
  const retakeSource = sourceNodeId ? nodes[sourceNodeId] : undefined;
  // 批5 删信箱：重拍在途判据改 exec 合并视图（真实节点 loading——execute 写 exec map → 投影/对齐，影子 shadowJobs 随信箱删除）
  const retakeBusy = useNodeStore(s => sourceNodeId != null && selectExecStatus(s, sourceNodeId) === 'loading');
  // Y0b-2 T6（Z79）：重拍=恒手势 token（retakeId 语义重定位）；轮换判据单源=源节点 doc 投影
  //（done/EXHAUSTED ⇒ 丢弃 held——下一击=新手势；error 可 rearm ⇒ 保留 held 免费重试）
  const retakeEntry = useNodeStore(s => sourceNodeId != null ? selectExecEntry(s, sourceNodeId) : undefined);
  useEffect(() => {
    if (sourceNodeId && (retakeEntry?.status === 'done' || (retakeEntry?.status === 'error' && retakeEntry.rearmable === false))) {
      const pid = useCanvasStore.getState().projectId;
      if (pid) rotateToken(pid, sourceNodeId);
    }
  }, [retakeEntry?.status, retakeEntry?.rearmable, sourceNodeId]);
  // R4-7：排除产物节点（type 同为 videoGen，但 origin='video-edit' 无 prompt/model）——后端 regenerate 只校验类型
  // （video-project.service.ts），放行会空 prompt 触发一次真实生成/莫名失败；产物节点是终点不参与重拍（验收 13 口径）
  const canRetake = retakeSource?.type === 'videoGen'
    && (retakeSource.data as { origin?: string } | undefined)?.origin !== 'video-edit'; // 仅真实视频分支（spec §4）——imageGen 源/产物节点置灰
  const onRetake = () => {
    if (!retakeSource) return;
    modal.confirm({
      title: '片段重拍', content: '将消耗团队积分，确认重新生成该片段的视频？',
      onOk: async () => {
        const workflowId = useCanvasStore.getState().projectId;
        if (!workflowId) return;
        // Y0b-2 T6（Z79）：重拍=恒手势——held 优先（error 后同 token 重试=免费 rearm，跨刷新存活），
        // 无 held 铸造新 token（新重拍照常扣费）；retakeId DTO 字段名保持（语义=手势 token）
        const retakeId = storedToken(workflowId, retakeSource.id) ?? gestureToken(workflowId, retakeSource.id);
        try {
          const { result } = await regenerateNode({ workflowId, sourceNodeId: retakeSource.id, kind: 'video', retakeId });
          // 批5-1：返回体含 execute 结果——早失败（校验/扣费）在 HTTP 往返内已 emit+写 exec map（订阅必错过），直读 result 反馈
          // Y0b-2 T5/T6（Z95）：errors 结构化 {nodeId,status,error,errorCode?}——EXHAUSTED 轮换（同 token rearm 自锁根堵）
          if (result && result.success === false) {
            const e0 = result.errors?.[0];
            if (e0?.errorCode === 'INTENT_EXHAUSTED') {
              rotateToken(workflowId, retakeSource.id);
              void message.warning('重试次数已用尽，请重新发起重拍');
            } else {
              void message.error(`重拍失败：${e0?.error ?? e0?.nodeId ?? '未知错误'}`);
            }
          } // 成功/在飞：完成态由真实节点 exec 投影对齐（busy 解除）——done 后轮换 useEffect 单源处理
        } catch (err) {
          // Y0b-2 T6：EXHAUSTED（HTTP 409 同步路径）轮换；其余保留 held（同 token 重试=免费 rearm 不双扣）
          const errorCode = (err as { errorCode?: string }).errorCode;
          if (errorCode === 'INTENT_EXHAUSTED') {
            rotateToken(workflowId, retakeSource.id);
            void message.warning('重试次数已用尽，请重新发起重拍');
          } else {
            void message.error(`重拍请求失败：${(err as Error).message}`); // R7-P3：HTTP 4xx/网络错——antd confirm onOk reject 只停 loading 无任何提示
          }
        }
      },
    });
  };

  return (
    <div className="h-full flex-1 min-h-0 flex flex-col bg-[var(--ve-preview-base)]">
      {/* 16:9 预览区 */}
      <div ref={containerRef} className="flex-1 min-h-0 flex items-center justify-center p-3">
        {/* 偏离登记：计划 JSX 笔误——canvas 缺 ref={canvasRef}，hook 拿不到画布致播放循环/单帧渲染全失效（G1 用例红揭示），按计划目标语义补上 */}
        {/* spec 4.1：删内联 width:100%/aspectRatio——替换元素靠 max-w-full max-h-full + 内在尺寸自动 contain 保比例（非 16:9 素材不变形）；
            width/height 属性 1920/1080 与重置守卫同源（usePreviewPlayback 的 applyCanvasSize / CANVAS_W·CANVAS_H） */}
        <canvas ref={canvasRef} data-testid="preview-canvas" width={1920} height={1080}
          className="bg-black max-w-full max-h-full"
          onClick={(e) => { // 点击画布 seek（点击位置→时间）
            const rect = e.currentTarget.getBoundingClientRect();
            seekPlayback(((e.clientX - rect.left) / rect.width) * total);
          }} />
      </div>
      {/* 控制条（spec 第四节：播放/时间码/撤销/重做/分割/删除 + 音量/全屏/缩放滑杆） */}
      <div data-testid="preview-control-bar"
        className="h-11 shrink-0 flex items-center gap-2 px-3 bg-[var(--fw-surface-dim)] border-t border-[var(--ve-border)]">
        <button type="button" data-testid="preview-play-btn" disabled={preparing}
          onClick={() => { void togglePlayback(); }}
          className="text-[16px] text-[var(--fw-text)] border-0 px-2 disabled:opacity-50">
          {preparing ? '…' : playing ? '⏸' : '▶'}
        </button>
        <span className="text-[12px] text-[var(--fw-text)] tabular-nums">
          {formatShortTime(playhead)}
          <span className="text-[var(--ve-text-dim)]"> / {formatShortTime(total)}</span>
        </span>
        <span className="text-[var(--ve-text-dim)] mx-1">|</span>
        <button type="button" aria-label="撤销" title="撤销 Ctrl+Z" onClick={() => useEditorStore.getState().undo()}
          className="text-[15px] text-[var(--fw-text)] border-0 px-1.5 hover:text-text-strong"><UndoOutlined /></button>
        <button type="button" aria-label="重做" title="重做 Ctrl+Shift+Z" onClick={() => useEditorStore.getState().redo()}
          className="text-[15px] text-[var(--fw-text)] border-0 px-1.5 hover:text-text-strong"><RedoOutlined /></button>
        <button type="button" aria-label="分割" title="分割 S（在播放头处）"
          onClick={() => { const es = useEditorStore.getState(); if (es.selectedClipId) es.splitClip(es.selectedClipId, es.playhead); }}
          className="text-[15px] text-[var(--fw-text)] border-0 px-1.5 hover:text-text-strong"><ScissorOutlined /></button>
        <button type="button" aria-label="删除" title="删除 Delete"
          onClick={() => { const es = useEditorStore.getState(); if (es.selectedClipId) es.removeClip(es.selectedClipId); }}
          className="text-[15px] text-[var(--fw-text)] border-0 px-1.5 hover:text-text-strong"><DeleteOutlined /></button>
        <div className="flex items-center gap-2 ml-2 pl-2 border-l border-[var(--ve-border)]">
          <button type="button" className="text-[12px] text-[var(--ve-accent-text)] border-0 px-0" onClick={onAddSubtitle}>添加字幕</button>
          {/* R4-8：Chromium 不对 disabled 表单控件派发 mouse 事件——Tooltip 直接包 disabled 按钮无 hover（antd FAQ 同款），
              内包 <span className="inline-block"> 承接 mouseenter（验收 17 的 Tooltip 文案核对依赖此结构） */}
          <Tooltip title="音频生成暂未接入，待供应商接入后开放">
            <span className="inline-block">
              <button type="button" disabled className="text-[12px] text-[var(--ve-accent-text)] border-0 px-0 disabled:opacity-40" data-testid="gen-audio-btn">生成音频</button>
            </span>
          </Tooltip>
          <Tooltip title={canRetake ? '将消耗团队积分' : '选中带源视频片段后可重拍'}>
            <span className="inline-block">
              <button type="button" disabled={!canRetake || retakeBusy} className="text-[12px] text-[var(--ve-accent-text)] border-0 px-0 disabled:opacity-40" onClick={onRetake}>片段重拍</button>
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
            className="text-[14px] text-[var(--fw-text)] border-0 px-1.5">⛶</button>
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
