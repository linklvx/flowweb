// apps/web/src/pages/canvas/components/RecoveryPanel.tsx
// Y1c T25b B1/B4（plan :338——spec §4.5 表 B 行 v5.4 用户裁定式）：B 场景（同代拒帧恢复）逐字段
// 裁定 UI。数据层=shared DRAFT_FIELD_CHOICE_DEFAULT/resolveAdjudicatedFieldValues（冻结）+
// collab/recovery-adjudication（视图/采纳信封——T25b 新建）。交互面：
//   - 修改字段逐字段「当前 vs 草稿」二选一**默认保留当前**（无 journal/base 不自动判优——
//     DRAFT_FIELD_CHOICE_DEFAULT 单源；未列字段=默认保留当前=零写）；
//   - 删除显式确认（nodeId 勾选——不自动删）；新增逐 id 确认导入（非批量勾选）；
//   - 完成动作=①草稿值字段 doc 写（updateNodeData intent）②删除确认 deleteNode ③采纳节点经
//     importDraftEnvelope REST 导入（唯一接受路径——B4 接线闭环生产调用面）④resumeFromRecovery
//     （denyTracker.recoveryComplete+supervisor.resume——恢复模式唯一出口）。
// 信封缺席档（镜像 tab/空画布）=只读告知（裁定数据源=本 tab 导出的内存副本）。
import { useMemo, useState } from 'react';
import { message } from 'antd';
import { useCanvasStore } from '@/stores/canvasStore';
import { dispatchCanvasIntent } from '@/stores/canvasIntents';
import { Origin } from '@/stores/canvasUndo';
import { resumeFromRecovery } from '@/stores/canvasCollabRuntime';
import { importDraftEnvelope } from '@/api/collabApi';
import {
  buildRecoveryAdjudicationView, buildAdoptedEnvelope, resolveAdjudicatedFieldValues,
  DRAFT_FIELD_CHOICE_DEFAULT, type DraftFieldChoice,
} from '@/collab/recovery-adjudication';

const fmt = (v: unknown): string => {
  if (v === undefined) return '（无）';
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  try { return JSON.stringify(v); } catch { return String(v); }
};

export function RecoveryPanel() {
  const open = useCanvasStore((s) => s.recoveryPanelOpen);
  const recovery = useCanvasStore((s) => s.recoveryPending);
  const nodes = useCanvasStore((s) => s.nodes);
  const projectId = useCanvasStore((s) => s.projectId);
  const [fieldChoices, setFieldChoices] = useState<Record<string, Record<string, DraftFieldChoice>>>({});
  const [adopted, setAdopted] = useState<Set<string>>(new Set());
  const [deletions, setDeletions] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const envelope = recovery?.kind === 'deny-escape' ? (recovery.envelope ?? null) : null;
  const view = useMemo(
    () => (envelope != null ? buildRecoveryAdjudicationView(envelope, nodes as never) : null),
    [envelope, nodes],
  );

  if (!open || recovery?.kind !== 'deny-escape') return null;

  const close = (): void => useCanvasStore.getState().setRecoveryPanelOpen(false);

  const choose = (nodeId: string, key: string, choice: DraftFieldChoice): void => {
    setFieldChoices((prev) => ({ ...prev, [nodeId]: { ...(prev[nodeId] ?? {}), [key]: choice } }));
  };

  const confirm = async (): Promise<void> => {
    if (!view || busy) return;
    setBusy(true);
    try {
      // ① 草稿值字段写（默认 current 零写——仅显式选 draft 的字段；resolveAdjudicatedFieldValues
      //    单源出口，默认保留当前语义由冻结函数承载）
      const adjudication = { adoptedNodeIds: [...adopted], fieldChoices, deletionConfirmations: [...deletions] };
      const resolutions = resolveAdjudicatedFieldValues(view.conflicts, adjudication);   // shared 冻结单源（默认保留当前）
      const store = useCanvasStore.getState();
      for (const r of resolutions) {
        if (r.chosen === 'draft') {
          dispatchCanvasIntent({ type: 'updateNodeData', id: r.nodeId, patch: { [r.key]: r.value } }, Origin.LocalUser);
        }
      }
      // ② 删除显式确认
      for (const id of deletions) store.deleteNode(id);
      // ③ 采纳节点经 recovery import REST（唯一接受路径）——失败不阻断已裁定字段/删除（裁定面
      //    可重开重试：fieldChoices 本地态保留至面板关）
      if (adopted.size > 0 && envelope != null && projectId) {
        const adoptedEnvelope = await buildAdoptedEnvelope(envelope, [...adopted], nodes.map((n) => (n as { id: string }).id));
        if (adoptedEnvelope) {
          const outcome = await importDraftEnvelope(projectId, adoptedEnvelope);
          message.success(`新增节点已导入（${outcome.dispositions.filter((d) => d.disposition !== 'skip').length} 采纳/${outcome.dispositions.filter((d) => d.disposition === 'skip').length} 跳过）`);
        }
      }
      // ④ 恢复模式出口（denyTracker.recoveryComplete+supervisor resume——B4 接线闭环）
      useCanvasStore.getState().setRecoveryPanelOpen(false);
      resumeFromRecovery();
    } catch (e) {
      message.error(`裁定应用未完成：${(e as Error).message}——已应用项保留，可重开面板重试`);
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

        {view == null ? (
          <p className="text-sm text-text-dim-1" data-testid="recovery-no-envelope">
            本标签无草稿副本（草稿已导出至下载文件——镜像通告档/空画布）。可关闭面板后重试恢复，或以导出文件经恢复导入通道裁定。
          </p>
        ) : (
          <>
            {view.conflicts.length > 0 && (
              <section>
                <h4 className="mb-1 text-sm">修改字段（当前 vs 草稿——默认保留当前）</h4>
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
                <h4 className="mb-1 text-sm">删除确认（草稿中已删——勾选后在服务端删除）</h4>
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
