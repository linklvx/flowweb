// apps/web/src/pages/canvas/video-editor/components/ExportModal.tsx
// Task 19：导出弹层 Modal → Popover 重构（组件语义更名 ExportPopover，文件名不变）——
// 目的地分流（画布/本地）+ open 受控（导出中不可外部关闭）+ 产物节点补建 store 化
import { useEffect, useMemo, useRef, useState } from 'react';
import { App as AntdApp, Popover, Select, Input, Progress, Button } from 'antd';
import { useEditorStore } from '../store/editorStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { totalDuration } from '../timeline/timecode';
import { canvasSizeOf } from '../timeline/canvas-size';
import { runPrecheck, estimateSizeBytes, computeExportSize } from '../export/precheck';
import type { ExportResolution } from '@flowweb/shared';
import { detectExportCapabilities } from '../capabilities';
import { exportPrecheck } from '@/api/videoProjectApi';
import { runExportJob, pickSaveTarget, openOpfsTarget, cleanupOpfsTarget, cleanupStaleOpfsExports, ExportJobError } from '../export/client';
import { uploadExportedProduct } from '../export/upload';
import { createProductNode } from '../export/product-node';

// R2-N11/R3-4：模块级取值函数（currentXxx 前缀防 react-hooks lint 误报；?? '' 归一返回 string——可空字段直接透传 strict 下 TS2345）
const currentCanvasProjectId = () => useCanvasStore.getState().projectId ?? '';
const currentEditorProjectId = () => useEditorStore.getState().projectId ?? '';
const currentEditorProjectTitle = () => useEditorStore.getState().title ?? '';
const currentEditorSourceNodeId = () => useVideoEditorStore.getState().sourceNodeId ?? '';

// I-2：beforeunload 模块级守卫——以在飞 job 为依据安装/拆除，不随 Popover 卸载（收起编辑器后关页仍拦，对齐 R2-N12 后台完成语义）
const beforeunloadHandler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
let beforeunloadArmed = false;
const armBeforeunload = () => {
  if (beforeunloadArmed) return;
  beforeunloadArmed = true;
  window.addEventListener('beforeunload', beforeunloadHandler);
};
const disarmBeforeunload = () => {
  if (!beforeunloadArmed) return;
  beforeunloadArmed = false;
  window.removeEventListener('beforeunload', beforeunloadHandler);
};

function fmtSize(bytes: number): string {
  return bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)}GB` : `${(bytes / 1024 ** 2).toFixed(0)}MB`;
}

// R3③：产物节点发布收拢——先落 store 再建节点（createProductNode 同步返回 nodeId，抛错自然向上传，
// 无空壳 try/catch）；pendingProduct 先行登记，中途抛错/弹层收起均可经重试按钮仅补建节点（不重复上传）
const publishProduct = async (mediaId: string, title: string) => {
  useEditorStore.getState().setPendingProduct({ mediaId, title });
  createProductNode(currentEditorSourceNodeId(), currentEditorProjectId(), mediaId, title);
  useEditorStore.getState().clearPendingProduct();
};

export function ExportPopover() {
  const { message } = AntdApp.useApp(); // 批1-2：壳内上下文实例（稳定引用，startExport 闭包内直接用）
  const data = useEditorStore((s) => s.data);
  const mediaInfo = useEditorStore((s) => s.mediaInfo);
  const pendingProduct = useEditorStore((s) => s.pendingProduct);
  const [open, setOpen] = useState(false); // 受控——trigger 点击开合；导出中外部关闭被拒（spec 6.3）
  const [destination, setDestination] = useState<'canvas' | 'local'>('canvas');
  const [fileName, setFileName] = useState(''); // R10-4：初值空——open=true 时由 effect 重种
  const [resolution, setResolution] = useState<ExportResolution>('720p');
  const [caps, setCaps] = useState<{ video: boolean; audio: boolean } | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'config' | 'exporting'>('config');
  const [progress, setProgress] = useState<{ phase: 'mix' | 'encode'; ratio: number }>({ phase: 'mix', ratio: 0 });
  const [etaSec, setEtaSec] = useState<number | null>(null);
  const [fail, setFail] = useState<{ category: string; message: string } | null>(null);
  const [job, setJob] = useState<{ cancel(): void } | null>(null);
  const startingRef = useRef(false); // I-1：入口同步锁——pickSaveTarget await 窗口防重入（双击=双 Worker 双上传双配额）
  const quotaReqRef = useRef(0); // R4-10：配额预检请求序号（切档竞态守卫）
  // R5①/R19①：本次导出尝试的幂等键——ref 而非 state（不触发渲染）；声明在组件体（事件处理器内 useRef 必抛
  // Invalid hook call）。外层 finally 置 null 防跨尝试复用——复用旧 id 命中服务端幂等拿首产物 key/size：
  // 覆盖首产物 + content-length-range 钉死旧体积 → MinIO 400
  const exportReqIdRef = useRef<string | null>(null);

  const durationSec = useMemo(() => (data ? totalDuration(data) : 0), [data]);
  const sizeBytes = useMemo(() => estimateSizeBytes(canvasSizeOf(data), resolution, durationSec), [data, resolution, durationSec]);
  const precheck = useMemo(
    () => (data && caps ? runPrecheck(
      data,
      // R5-P1-6：传 id→url Record（含 undefined）——missing-media 与 missing-url 双拦截
      Object.fromEntries(Object.entries(mediaInfo).map(([id, i]) => [id, i.url])),
      caps,
    ) : null),
    [data, mediaInfo, caps],
  );

  useEffect(() => {
    if (!open) return;
    // R17-F5①：复位语句原样保留——成功路径走 setOpen(false) 不复位 phase，重开全靠此 effect；丢了它成功导出一次后 Popover 永停进度态
    setPhase('config'); setFail(null); setQuotaError(null); setProgress({ phase: 'mix', ratio: 0 }); setEtaSec(null);
    setFileName(`${currentEditorProjectTitle() || '导出'}.mp4`); // R10-4：打开时重种（与现网点击时求值语义最接近）
    // R5：补 catch——动态 import 失败（chunk 网络错）时 then 无 catch 会永 pending：按钮永久禁用且无提示
    // R9-9：首参 deps 传 undefined 走默认值——probeSize 是第二参（最坏档 1080p 探测，9:16/21:9 不失真）
    void detectExportCapabilities(undefined, computeExportSize(canvasSizeOf(data), '1080p')).then(setCaps).catch(() => setCaps({ video: false, audio: false }));
  }, [open]);

  useEffect(() => {
    if (!open || !precheck || precheck.errors.length > 0) return;
    if (!currentCanvasProjectId()) return; // R4-1：workflowId 为空不发请求（否则拿 '' 打一次 4xx）
    setQuotaError(null);
    const req = ++quotaReqRef.current; // R4-10：序号守卫——快速切档时过期响应不得覆盖最新态
    exportPrecheck(currentCanvasProjectId(), sizeBytes)
      .catch((e: Error) => { if (quotaReqRef.current === req) setQuotaError(e.message || '存储配额不足'); });
  }, [open, precheck, sizeBytes]);

  const blocked = !!precheck && (precheck.errors.length > 0 || !!quotaError);

  // R8-N7：job 失败与前置段异常共用 fail 分辙（canceled 特判 + quotaHit 分辙，原 :115-120 语义）
  const onExportFail = (err: unknown) => {
    if (err instanceof ExportJobError && err.category === 'canceled') { setPhase('config'); return; }
    const category = err instanceof ExportJobError ? err.category : 'unknown';
    // R2-后端语义：precheck 与 register 相隔数分钟，期间配额可能被他处占用 → register 400——文案特判
    const quotaHit = /存储空间不足|配额|quota/i.test((err as Error).message); // R3-3：后端实测文案为"存储空间不足"（storage-quota.service.ts:29）
    setFail({ category, message: quotaHit ? '存储配额在导出期间被占用，请清理团队存储后重试' : (err as Error).message });
    setPhase('config');
  };

  const startExport = async () => {
    if (startingRef.current) return; // I-1：await 窗口防重入
    startingRef.current = true;
    try {
      if (!data) return;
      if (!currentCanvasProjectId() || !currentEditorProjectId() || !currentEditorSourceNodeId()) {
        void message.warning('工程尚未就绪，请稍候重试'); // R4-1：静默 return 用户无感知——补提示
        return;
      } // R3-4：真值守卫（工程未就绪/上下文缺失不发单）
      setFail(null);
      // R7-N3 句柄按目的地分流：canvas → openOpfsTarget（无手势依赖不弹 picker）；local → pickSaveTarget。
      // 手势红线（spec D4）：FSA picker 仅 local 路径、点击处理器同步链内调用，链上不得插入任何 await（含 OPFS 残留扫描）
      const target = destination === 'canvas'
        ? await openOpfsTarget()
        : await pickSaveTarget(fileName, { onDegraded: () => { void message.info('未能打开保存对话框，已改用应用内中转'); } }); // R7-S2 降级提示
      if (target.kind === 'canceled') { void message.info('已取消导出，未开始编码'); return; } // P1-E：取消即中止不白跑编码
      const out = computeExportSize(canvasSizeOf(data), resolution); // R8-N10：一次定义两处消费（编码 targetSize + 上传尺寸）
      const mediaUrls: Record<string, string> = {};
      for (const [id, info] of Object.entries(mediaInfo)) if (info.url) mediaUrls[id] = info.url;
      const j = runExportJob(
        { data, resolution, mediaUrls, targetSize: out },
        { onProgress: (p, r) => setProgress({ phase: p, ratio: r }), onEta: setEtaSec },
        target.handle,
      );
      // R9-1：keepName 排除本次在用中转（否则 worker createWritable 撞并发 removeEntry → 回退 Buffer 磁盘中转静默失效）；
      // fire-and-forget——fsa/canceled 时集合内只有历史残留全清无碍
      void cleanupStaleOpfsExports(target.kind === 'opfs' ? target.handle.name : undefined);
      setJob(j); setPhase('exporting');
      armBeforeunload(); // I-2：在飞 job 期间武装（模块级——Popover 卸载不再拆守卫）
      try {
        const r = await j.promise;
        if (!r.fsa) void message.warning('已回退内存缓冲（磁盘直写不可用），本次导出占用内存较高'); // R13 决策⑥
        if (destination === 'canvas') {
          const file = r.fsa ? await target.handle.getFile() : r.blob; // R8-N5 择源——回退 Buffer 时读 blob（防 0 字节静默上传）
          const reqId = (exportReqIdRef.current ??= crypto.randomUUID()); // 首次生成；同尝试内 register 重试复用同幂等键（R19①）
          const { mediaId } = await uploadExportedProduct({ workflowId: currentCanvasProjectId(), videoProjectId: currentEditorProjectId(), resolution, durationSec, width: out.width, height: out.height, file, clientRequestId: reqId });
          await publishProduct(mediaId, currentEditorProjectTitle() || '多轨剪辑'); // R3③ 收拢 helper（建节点失败 → fail 态 + 重试仅补建）
          void message.success('导出完成，已添加到画布');
        } else if (target.kind === 'fsa' && r.fsa) {
          void message.success('导出完成，已保存到所选位置'); // worker 已直写——不得再 a.click()（两份文件）
        } else {
          // 本地 OPFS 中转读回下载 或 FSA 句柄回退 Buffer（blob 兜底下载）——都必须产出真实文件
          const file = r.fsa ? await target.handle.getFile() : r.blob;
          const url = URL.createObjectURL(file);
          const a = document.createElement('a');
          a.href = url; a.download = fileName; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 60_000); // 延迟 revoke（spec 6.2——立即 revoke 会截断下载流）
          // 本地 OPFS 路径不在此处 cleanup——a.click() fire-and-forget，removeEntry 会截断下载；残留靠下次导出扫描清（R6-B12）
        }
        setOpen(false); // 成功路径不复位 phase——重开全靠 [open] effect（R17-F5①）
      } catch (err) {
        onExportFail(err);
      } finally {
        setJob(null);
        disarmBeforeunload(); // I-2：done/error/cancel（含成功收起后）一律拆除——disarm 在 finally 而非 catch
        if (destination === 'canvas') void cleanupOpfsTarget(target); // 画布即时清理（失败亦清不完整残留；fsa=false 时清 0 字节空壳无碍）
      }
    } catch (err) {
      // R8-N7：前置段会抛——openOpfsTarget/pickSaveTarget 的 OPFS 打开在 Firefox 无痕等场景 reject，不兜则 unhandled rejection
      onExportFail(err);
    } finally { startingRef.current = false; exportReqIdRef.current = null; } // 幂等键随尝试结束作废（R16②跨尝试换新）
  };

  return (
    <Popover
      open={open}
      // 导出中仅拒「关闭」方向（next=false）：全拒会让成功关闭后的重开也被挡死（成功收起时 phase 仍为
      // exporting，等 [open] effect 复位——放行打开方向才有机会触发复位）
      onOpenChange={(next) => { if (!next && phase === 'exporting') return; setOpen(next); }}
      trigger="click" placement="bottomRight" title="导出设置" // R13 决策⑥：spec 6.3 明确要求标题
      content={
        phase === 'config' ? (
          <div className="flex flex-col gap-3 w-80" data-testid="export-config">
            <div className="grid grid-cols-[5rem_1fr] items-center gap-3">
              <span className="text-[13px] text-[var(--fw-text)]">文件名</span>
              <Input value={fileName} onChange={(e) => setFileName(e.target.value)} id="timeline-export-file-name" />
            </div>
            <div className="grid grid-cols-[5rem_1fr] items-center gap-3">
              <span className="text-[13px] text-[var(--fw-text)]">导出位置</span>
              <Select value={destination} onChange={setDestination} id="timeline-export-destination" options={[{ value: 'canvas', label: '导出到画布' }, { value: 'local', label: '下载到本地' }]} />
            </div>
            <div className="grid grid-cols-[5rem_1fr] items-center gap-3">
              <span className="text-[13px] text-[var(--fw-text)]">分辨率</span>
              <Select value={resolution} onChange={setResolution} options={[{ value: '480p', label: '480P' }, { value: '720p', label: '720P' }, { value: '1080p', label: '1080P' }]} /> {/* spec 6.3 大写文案 */}
            </div>
            <div className="grid grid-cols-[5rem_1fr] items-center gap-3">
              <span className="text-[13px] text-[var(--fw-text)]">格式</span>
              <Select value="mp4" disabled options={[{ value: 'mp4', label: 'MP4' }]} />
            </div>
            <div className="text-[12px] text-[var(--ve-text-dim)]">
              时长 {Math.round(durationSec)}s · 预计体积 {fmtSize(sizeBytes)}
              {/* R9-6/R10-3：尾段按目的地 4 态分派（画布/本地 FSA 可用/本地降级 OPFS 中转） */}
              {destination === 'canvas' ? ' · 应用内中转' : (('showSaveFilePicker' in window) ? ' · 直写所选位置' : ' · 应用内中转后下载')}
            </div>
            {precheck?.errors.map((e, i) => <div key={i} className="text-[12px] text-[#F53F3F]">✕ {e.message}</div>)}
            {quotaError && <div className="text-[12px] text-[#F53F3F]">✕ {quotaError}</div>}
            {precheck?.warnings.map((w, i) => (
              <div key={i} className="text-[12px] text-[#FF7D00]">
                ⚠ {w.message}{typeof navigator !== 'undefined' && (navigator as unknown as { deviceMemory?: number }).deviceMemory !== undefined && (navigator as unknown as { deviceMemory: number }).deviceMemory <= 4 ? '（当前设备内存较低，强烈建议 720p）' : ''}
              </div>
            ))}
            {fail && <div className="text-[12px] text-[#F53F3F]">上次导出失败（{fail.category}）：{fail.message}——可重试或降 720p</div>}
            {pendingProduct && (
              <Button data-testid="retry-product-node" onClick={() => {
                const p = useEditorStore.getState().pendingProduct;
                if (!p) return;
                void publishProduct(p.mediaId, p.title)
                  .then(() => void message.success('产物节点已补建'))
                  .catch((e: Error) => void message.error(`补建失败：${e.message}`));
              }}>重试（仅补建产物节点）</Button>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button onClick={() => setOpen(false)}>取消</Button>
              <Button type="primary" disabled={blocked || !precheck} onClick={() => void startExport()} data-testid="export-start">确认</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 w-80" data-testid="export-progress">
            <div className="text-[13px]">{progress.phase === 'mix' ? '离线混音中…' : '逐帧编码中…'}</div>
            <Progress percent={Math.round((progress.phase === 'mix' ? 0.2 : 0.2 + progress.ratio * 0.8) * 100)} status="active" strokeColor="var(--ve-accent)" />
            {etaSec != null && <div className="text-[12px] text-[var(--ve-text-dim)]">预计剩余 {etaSec > 60 ? `${Math.floor(etaSec / 60)}分${Math.round(etaSec % 60)}秒` : `${Math.round(etaSec)}秒`}</div>}
            <div className="flex justify-end"><Button danger onClick={() => job?.cancel()}>取消导出</Button></div>
          </div>
        )
      }
    >
      {/* EditorTopBar 的导出按钮整体搬入（trigger）——按钮必须带 data-testid="export-trigger" */}
      <button type="button" data-testid="export-trigger"
        className="text-[14px] text-white bg-[var(--ve-accent)] rounded-full px-4 py-1.5 border-0">
        导出
      </button>
    </Popover>
  );
}
