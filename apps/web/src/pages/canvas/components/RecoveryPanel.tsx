// apps/web/src/pages/canvas/components/RecoveryPanel.tsx
// Y1c T25b B1/B4（plan :338——spec §4.5 表 B 行 v5.4 用户裁定式）：B 场景（同代拒帧恢复）逐字段
// 裁定 UI。数据层=shared DRAFT_FIELD_CHOICE_DEFAULT/resolveAdjudicatedFieldValues（冻结）+
// collab/recovery-adjudication（视图/typed 载荷构造——T25b 新建）。
//   收口 I-2：裁定「当前」侧=REST 服务端真值（fetchServerCanvas——GET /collab/doc/:pid/canvas
//   既有端点复用）。信封与 store nodes 同出一 doc 的同源空转根修：store 投影不可作 current 源
//   （spec §4.5 B 行「客户端重置到服务端状态」后裁定）；服务端读失败=重试面（禁静默 store 兜底）。
//   收口 I-3 双约束：①裁定动作（草稿值采纳/删除确认/新增导入）**全走 typed REST**
//   （importDraftEnvelope——conflictChoices=replace 承载草稿值、deletionNodeIds 承载删除确认；
//   禁 dispatchCanvasIntent/deleteNode doc 写承载——被拒 doc 本地写整帧再拒=裁定静默丢失，
//   DRAFT_ADJUDICATION_NO_AUTO_REPLAY 冻结注记）；②完成→resumeFromRecovery（resume 前走
//   resyncFull 同款重建 fresh provider——connectOnce 仅连 fresh doc，被拒帧重放面结构性根除）。
// 信封缺席档（镜像 tab/空画布）=只读告知（裁定数据源=本 tab 导出的内存副本）。
import { useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { useCanvasStore } from '@/stores/canvasStore';
import { resumeFromRecovery } from '@/stores/canvasCollabRuntime';
import { importDraftEnvelope, fetchServerCanvas } from '@/api/collabApi';
import {
  buildRecoveryAdjudicationView, buildAdjudicatedImport,
  DRAFT_FIELD_CHOICE_DEFAULT, type DraftFieldChoice, type RecoveryAdjudicationNodeRef,
} from '@/collab/recovery-adjudication';

const fmt = (v: unknown): string => {
  if (v === undefined) return '（无）';
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  try { return JSON.stringify(v); } catch { return String(v); }
};

export function RecoveryPanel() {
  const open = useCanvasStore((s) => s.recoveryPanelOpen);
  const recovery = useCanvasStore((s) => s.recoveryPending);
  const projectId = useCanvasStore((s) => s.projectId);
  const [fieldChoices, setFieldChoices] = useState<Record<string, Record<string, DraftFieldChoice>>>({});
  const [adopted, setAdopted] = useState<Set<string>>(new Set());
  const [deletions, setDeletions] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // 收口 I-2：服务端真值 current 侧（REST 读径——与本地 store 投影解耦）
  const [serverNodes, setServerNodes] = useState<readonly RecoveryAdjudicationNodeRef[] | null>(null);
  const [serverError, setServerError] = useState(false);

  const envelope = recovery?.kind === 'deny-escape' ? (recovery.envelope ?? null) : null;

  const loadServer = async (): Promise<void> => {
    if (!projectId) return;
    setServerError(false);
    try {
      const model = await fetchServerCanvas(projectId);
      setServerNodes(model.nodes as unknown as readonly RecoveryAdjudicationNodeRef[]);
    } catch {
      setServerError(true);   // 禁静默 store 兜底（同源空转复发面）——重试面承载
    }
  };

  useEffect(() => {
    if (open && envelope != null && projectId) {
      setServerNodes(null);
      void loadServer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, envelope, projectId]);

  const view = useMemo(
    () => (envelope != null && serverNodes != null ? buildRecoveryAdjudicationView(envelope, serverNodes) : null),
    [envelope, serverNodes],
  );

  if (!open || recovery?.kind !== 'deny-escape') return null;

  const close = (): void => useCanvasStore.getState().setRecoveryPanelOpen(false);

  const choose = (nodeId: string, key: string, choice: DraftFieldChoice): void => {
    setFieldChoices((prev) => ({ ...prev, [nodeId]: { ...(prev[nodeId] ?? {}), [key]: choice } }));
  };

  const confirm = async (): Promise<void> => {
    if (!view || !envelope || !serverNodes || busy) return;
    setBusy(true);
    try {
      // 收口 I-3①：裁定三面全走 typed REST 载荷（conflictChoices=replace 承载草稿值选域+
      // deletionNodeIds 承载删除确认+采纳新增随信封）——零 doc 写承载
      const built = await buildAdjudicatedImport(envelope, serverNodes, {
        adoptedIds: [...adopted],
        fieldChoices,
        deletionIds: [...deletions],
      });
      if (built) {
        const outcome = await importDraftEnvelope(projectId!, built.envelope, built.conflictChoices, built.deletionNodeIds);
        const imported = outcome.dispositions.filter((d) => d.disposition !== 'skip').length;
        const skipped = outcome.dispositions.length - imported;
        const del = outcome.deletions ? `/${outcome.deletions.applied} 项删除` : '';
        message.success(`裁定已导入服务端（${imported} 采纳/${skipped} 跳过${del}）`);
      }
      // 收口 I-3②：恢复模式出口=重建 fresh（resyncFull 同款导出→清缓存→initCollab——resumeFromRecovery 承载）
      useCanvasStore.getState().setRecoveryPanelOpen(false);
      await resumeFromRecovery();
    } catch (e) {
      message.error(`裁定导入未完成：${(e as Error).message}——可重开面板重试（未完成项不在服务端）`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="recovery-panel"
      role="dialog"
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}   // 遮罩层 inline（no-theme-utility 白名单禁令——ConfirmModal 白卡先例同源不含本文件）
    >
      <div className="flex max-h-[70vh] w-[560px] flex-col gap-3 overflow-y-auto rounded-xl border border-overlay-2 bg-overlay-1 p-5 text-text">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">草稿裁定（恢复模式）</h3>
          <button type="button" data-testid="recovery-close-btn" onClick={close} className="px-2 text-text-dim-1 hover:text-text">✕</button>
        </div>

        {envelope == null ? (
          <p className="text-sm text-text-dim-1" data-testid="recovery-no-envelope">
            本标签无草稿副本（镜像通告档/空画布）。可关闭面板后重试恢复，或以导出文件经恢复导入通道裁定。
          </p>
        ) : serverError ? (
          <div className="flex flex-col items-start gap-2 text-sm">
            <p className="text-text-dim-1" data-testid="recovery-server-error">服务端状态获取失败——裁定需以服务端现态为「当前」侧（禁以本地副本裁定）。</p>
            <button
              type="button"
              data-testid="recovery-server-retry"
              onClick={() => void loadServer()}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs text-on-accent"
            >
              重试获取服务端状态
            </button>
          </div>
        ) : view == null ? (
          <p className="text-sm text-text-dim-1" data-testid="recovery-loading">正在获取服务端状态…</p>
        ) : (
          <>
            {view.conflicts.length > 0 && (
              <section>
                <h4 className="mb-1 text-sm">修改字段（当前 vs 草稿——默认保留当前·当前侧=服务端真值）</h4>
                {view.conflicts.map((c) => {
                  const choice = fieldChoices[c.nodeId]?.[c.key] ?? DRAFT_FIELD_CHOICE_DEFAULT;
                  return (
                    <div key={`${c.nodeId}:${c.key}`} className="mb-2 rounded-lg border border-overlay-2 p-2 text-xs">
                      <div className="mb-1 text-text-dim-1">节点 {c.nodeId} · 字段 {c.key}</div>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            data-testid={`choice-${c.nodeId}-${c.key}-current`}
                            checked={choice === 'current'}
                            onChange={() => choose(c.nodeId, c.key, 'current')}
                          />
                          <span>当前：{fmt(c.currentValue)}</span>
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            data-testid={`choice-${c.nodeId}-${c.key}-draft`}
                            checked={choice === 'draft'}
                            onChange={() => choose(c.nodeId, c.key, 'draft')}
                          />
                          <span>草稿：{fmt(c.draftValue)}</span>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            {view.additions.length > 0 && (
              <section>
                <h4 className="mb-1 text-sm">新增节点（勾选导入——产物/历史/计费不恢复）</h4>
                {view.additions.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      data-testid={`adopt-${a.id}`}
                      checked={adopted.has(a.id)}
                      onChange={() => setAdopted((prev) => {
                        const next = new Set(prev);
                        if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                        return next;
                      })}
                    />
                    <span>{a.id}（{a.type}）</span>
                  </label>
                ))}
              </section>
            )}

            {view.deletions.length > 0 && (
              <section>
                <h4 className="mb-1 text-sm">删除确认（草稿中已删——勾选后经服务端导入删除）</h4>
                {view.deletions.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      data-testid={`delete-${d.id}`}
                      checked={deletions.has(d.id)}
                      onChange={() => setDeletions((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                        return next;
                      })}
                    />
                    <span>{d.id}（{d.type}）</span>
                  </label>
                ))}
              </section>
            )}

            {view.conflicts.length === 0 && view.additions.length === 0 && view.deletions.length === 0 && (
              <p className="text-sm text-text-dim-1">草稿与服务端一致——无待裁定项。</p>
            )}

            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={close} className="rounded-lg border border-overlay-2 px-3 py-1.5 text-xs hover:bg-overlay-2">稍后再说</button>
              <button
                type="button"
                data-testid="recovery-confirm-btn"
                disabled={busy}
                onClick={() => void confirm()}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs text-on-accent disabled:opacity-50"
              >
                {busy ? '应用中…' : '完成裁定并恢复连接'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
