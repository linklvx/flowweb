// apps/web/src/pages/canvas/video-editor/hooks/shadowJob.ts
import { message } from 'antd';
import { useEditorStore } from '../store/editorStore';
import { subscribeNodeStatus } from '@/services/executionSocket';
import { readNodeFileIdFromDoc } from '@/stores/canvasCollabRuntime';
import { removeShadowNode } from '@/api/videoProjectApi';
import { batchGetMedia } from '@/api/mediaApi';
import { useCanvasStore } from '@/stores/canvasStore';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

/** A1 影子状态机（决策 2 + R5-P1-4）：判完成唯一依据 = ydoc 影子节点 fileId 轮询，**进入即启动**（立即首探 + 2s 间隔、120s 超时）。
 *  R5-P1-4 勘误：regenerate 的 HTTP 响应晚于 execute 内首次 done（execution.service.ts:157-159）——事后订阅必错过首个 done；
 *  download job 失败/卡住时无第二次 done，纯等 done 会永挂。故 socket 仅贡献 **error 提前失败**，done 不再消费。
 *  成功/失败均 removeShadow 回流。 */
export async function watchShadowJob(
  shadowNodeId: string,
  kind: 'video' | 'audio',
  hint: { name: string; durationSec?: number },
  initial?: { success: boolean; errors?: string[] }, // R6-P2-1：regenerate HTTP 响应自带的 execute 结果——success=false 时立即失败（error 事件在订阅前已 emit，错过即 120s 干等）
): Promise<void> {
  useEditorStore.getState().startShadowJob(shadowNodeId, kind);
  useEditorStore.getState().updateShadowJob(shadowNodeId, { status: 'downloading' });
  try {
    if (initial && initial.success === false) throw new Error(initial.errors?.[0] || '生成失败');
    const fileId = await pollFileId(shadowNodeId);
    // 补 url/name/duration（batch 单查，mediaId=uuid）
    let name = hint.name; let durationSec = hint.durationSec; let url: string | undefined; let mimeType: string | undefined;
    try {
      const rows = await batchGetMedia([fileId]);
      const row = rows[0];
      if (row) {
        url = row.url;
        name = row.originalName || name;
        mimeType = row.mimeType; // P1-7：拖拽落轨按 mimeType 判 kind——缺失音频产物拖不进音频轨
        durationSec = (row.metadata as { durationSec?: number } | undefined)?.durationSec ?? durationSec;
      }
    } catch { /* 详情失败不阻断入库——url 后续 AssetPanel 刷新再补 */ }
    // R4-6：kind 兜底 mimeType——batch 失败是被显式容忍的路径，缺失会让条目 draggable=false 且无提示
    // （静默不可拖）；kind 是权威来源（watchShadowJob 入参），不重犯 N10 的音频错标 video（kind=audio 时给 audio/*）
    if (!mimeType) mimeType = kind === 'audio' ? 'audio/mpeg' : 'video/mp4';
    useEditorStore.getState().addGeneratedMedia(fileId, { name, durationSec, ...(url ? { url } : {}), mimeType });
    void message.success(kind === 'audio' ? '音频生成完成，已入资产面板' : '视频生成完成，已入资产面板');
  } catch (err) {
    useEditorStore.getState().updateShadowJob(shadowNodeId, { status: 'error', error: String((err as Error).message ?? err) });
    void message.error(`生成失败：${(err as Error).message ?? '未知错误'}`);
  } finally {
    const workflowId = useCanvasStore.getState().projectId;
    if (workflowId) void removeShadowNode(workflowId, shadowNodeId).catch(() => { /* 删除失败留影子，__ephemeral 全局排除不扣费 */ });
    useEditorStore.getState().removeShadowJob(shadowNodeId);
  }
}

/** doc 轮询（完成判据）+ socket error 提前失败（race，共用 settled 防双结算）。done 不消费（R5-P1-4）。 */
function pollFileId(shadowNodeId: string): Promise<string> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let off: () => void = () => {}; // R6-P3：占位先行——finish 与 off 互相引用，避免闭包前向引用可读性陷阱
    const finish = (fn: () => void) => { if (settled) return; settled = true; off(); if (timer) clearTimeout(timer); fn(); };
    off = subscribeNodeStatus((p) => {
      if (p.nodeId !== shadowNodeId || p.status !== 'error' || settled) return;
      finish(() => reject(new Error(p.error || '生成失败')));
    });
    const tick = () => {
      if (settled) return;
      const fid = readNodeFileIdFromDoc(shadowNodeId);
      if (fid) return finish(() => resolve(fid));
      if (Date.now() - start > POLL_TIMEOUT_MS) return finish(() => reject(new Error('产物下载超时（120s）')));
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
  });
}
