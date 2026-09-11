// apps/web/src/pages/canvas/video-editor/components/ExportModal.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { App as AntdApp, Modal, Radio, Progress, Button } from 'antd';
import { useEditorStore } from '../store/editorStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { totalDuration } from '../timeline/timecode';
import { runPrecheck, estimateSizeBytes, type ExportResolution } from '../export/precheck';
import { detectExportCapabilities } from '../capabilities';
import { exportPrecheck } from '@/api/videoProjectApi';
import { runExportJob, pickSaveFile, ExportJobError } from '../export/client';
import { uploadExportedProduct } from '../export/upload';
import { createProductNode } from '../export/product-node';

// R2-N11/R3-4：模块级取值函数（currentXxx 前缀防 react-hooks lint 误报；?? '' 归一返回 string——可空字段直接透传 strict 下 TS2345）
const currentCanvasProjectId = () => useCanvasStore.getState().projectId ?? '';
const currentEditorProjectId = () => useEditorStore.getState().projectId ?? '';
const currentEditorProjectTitle = () => useEditorStore.getState().title ?? '';
const currentEditorSourceNodeId = () => useVideoEditorStore.getState().sourceNodeId ?? '';

// I-2：beforeunload 模块级守卫——以在飞 job 为依据安装/拆除，不随 Modal 卸载（收起编辑器后关页仍拦，对齐 R2-N12 后台完成语义）
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

export function ExportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = AntdApp.useApp(); // 批1-2：静态 message（portal body z-index 2010 被壳盖不可见）→ 壳内上下文实例（稳定引用，startExport 闭包内直接用）
  const data = useEditorStore((s) => s.data);
  const mediaInfo = useEditorStore((s) => s.mediaInfo);
  const [resolution, setResolution] = useState<ExportResolution>('720p');
  const [caps, setCaps] = useState<{ video: boolean; audio: boolean } | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'config' | 'exporting'>('config');
  const [progress, setProgress] = useState<{ phase: 'mix' | 'encode'; ratio: number }>({ phase: 'mix', ratio: 0 });
  const [etaSec, setEtaSec] = useState<number | null>(null);
  const [fail, setFail] = useState<{ category: string; message: string } | null>(null);
  const [job, setJob] = useState<{ cancel(): void } | null>(null);
  const startingRef = useRef(false); // I-1：入口同步锁——pickSaveFile await 窗口防重入（双击=双 Worker 双上传双配额）
  const quotaReqRef = useRef(0); // R4-10：配额预检请求序号（切档竞态守卫）

  const durationSec = useMemo(() => (data ? totalDuration(data) : 0), [data]);
  const sizeBytes = useMemo(() => estimateSizeBytes(resolution, durationSec), [resolution, durationSec]);
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
    setPhase('config'); setFail(null); setQuotaError(null); setProgress({ phase: 'mix', ratio: 0 }); setEtaSec(null);
    // R5：补 catch——动态 import 失败（chunk 网络错）时 then 无 catch 会永 pending：按钮永久禁用且无提示
    void detectExportCapabilities().then(setCaps).catch(() => setCaps({ video: false, audio: false }));
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

  const startExport = async () => {
    if (startingRef.current) return; // I-1：pickSaveFile await 窗口防重入
    startingRef.current = true;
    try {
      if (!data) return;
      if (!currentCanvasProjectId() || !currentEditorProjectId() || !currentEditorSourceNodeId()) {
        void message.warning('工程尚未就绪，请稍候重试'); // R4-1：静默 return 用户无感知——补提示
        return;
      } // R3-4：真值守卫（工程未就绪/上下文缺失不发单）
      setFail(null);
      const handle = await pickSaveFile(`${currentEditorProjectTitle() || '导出'}.mp4`); // 用户手势内（决策 4）
      const mediaUrls: Record<string, string> = {};
      for (const [id, info] of Object.entries(mediaInfo)) if (info.url) mediaUrls[id] = info.url;
      const j = runExportJob(
        { data, resolution, mediaUrls },
        { onProgress: (p, r) => setProgress({ phase: p, ratio: r }), onEta: setEtaSec },
        handle,
      );
      setJob(j); setPhase('exporting');
      armBeforeunload(); // I-2：在飞 job 期间武装（模块级——Modal 卸载不再拆守卫）
      try {
        const r = await j.promise;
        const file = r.fsa && handle ? await handle.getFile() : r.blob; // R3-1：按 fsa 标记择源（回退 Buffer 时读 blob，防 0 字节静默上传）
        const { mediaId } = await uploadExportedProduct({ workflowId: currentCanvasProjectId(), videoProjectId: currentEditorProjectId(), resolution, durationSec, file });
        createProductNode(currentEditorSourceNodeId(), currentEditorProjectId(), mediaId, currentEditorProjectTitle() || '多轨剪辑');
        void message.success('导出完成，已添加到画布');
        onClose();
      } catch (err) {
        if (err instanceof ExportJobError && err.category === 'canceled') { setPhase('config'); return; }
        const category = err instanceof ExportJobError ? err.category : 'unknown';
        // R2-后端语义：precheck 与 register 相隔数分钟，期间配额可能被他处占用 → register 400——文案特判
        const quotaHit = /存储空间不足|配额|quota/i.test((err as Error).message); // R3-3：后端实测文案为"存储空间不足"（storage-quota.service.ts:29）
        setFail({ category, message: quotaHit ? '存储配额在导出期间被占用，请清理团队存储后重试' : (err as Error).message });
        setPhase('config');
      } finally {
        setJob(null);
        disarmBeforeunload(); // I-2：done/error/cancel（含成功 onClose 后）一律拆除——disarm 在 finally 而非 catch
      }
    } finally { startingRef.current = false; }
  };

  return (
    <Modal
      open={open} title="导出视频" footer={null} onCancel={() => { if (phase !== 'exporting') onClose(); }}
      width={480} maskClosable={false}
    >
      {phase === 'config' && (
        <div className="flex flex-col gap-3 pt-2" data-testid="export-config">
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-[var(--ve-text)]">清晰度</span>
            <Radio.Group value={resolution} onChange={(e) => setResolution(e.target.value)} options={[{ label: '720p', value: '720p' }, { label: '1080p', value: '1080p' }]} optionType="button" buttonStyle="solid" />
          </div>
          <div className="text-[12px] text-[var(--ve-text-dim)]">
            时长 {Math.round(durationSec)}s · 预计体积 {fmtSize(sizeBytes)}{('showSaveFilePicker' in window) ? ' · 直写本地文件' : ' · 内存缓冲'}
          </div>
          {precheck?.errors.map((e, i) => <div key={i} className="text-[12px] text-[#F53F3F]">✕ {e.message}</div>)}
          {quotaError && <div className="text-[12px] text-[#F53F3F]">✕ {quotaError}</div>}
          {precheck?.warnings.map((w, i) => (
            <div key={i} className="text-[12px] text-[#FF7D00]">
              ⚠ {w.message}{typeof navigator !== 'undefined' && (navigator as unknown as { deviceMemory?: number }).deviceMemory !== undefined && (navigator as unknown as { deviceMemory: number }).deviceMemory <= 4 ? '（当前设备内存较低，强烈建议 720p）' : ''}
            </div>
          ))}
          {fail && <div className="text-[12px] text-[#F53F3F]">上次导出失败（{fail.category}）：{fail.message}——可重试或降 720p</div>}
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" disabled={blocked || !precheck} onClick={() => void startExport()} data-testid="export-start">开始导出</Button>
          </div>
        </div>
      )}
      {phase === 'exporting' && (
        <div className="flex flex-col gap-3 pt-2" data-testid="export-progress">
          <div className="text-[13px]">{progress.phase === 'mix' ? '离线混音中…' : '逐帧编码中…'}</div>
          <Progress percent={Math.round((progress.phase === 'mix' ? 0.2 : 0.2 + progress.ratio * 0.8) * 100)} status="active" strokeColor="#6C5CE7" />
          {etaSec != null && <div className="text-[12px] text-[var(--ve-text-dim)]">预计剩余 {etaSec > 60 ? `${Math.floor(etaSec / 60)}分${Math.round(etaSec % 60)}秒` : `${Math.round(etaSec)}秒`}</div>}
          <div className="flex justify-end"><Button danger onClick={() => job?.cancel()}>取消导出</Button></div>
        </div>
      )}
    </Modal>
  );
}
