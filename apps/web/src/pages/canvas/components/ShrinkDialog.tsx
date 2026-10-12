// apps/web/src/pages/canvas/components/ShrinkDialog.tsx
// Y0b-4 T11：瘦身对话框——节点列表按 data JSON utf8 字节降序（大头优先）+勾选 deleteNodeIds
// /纯重新校准（recalibrate）/重建画布历史（vacuum——仅 residue>50%×limit 亮出+二次确认告知
// 全端刷新）。发起端善后：ok 档 undoManager.clear（远端删除不在 trackedOrigins——只清发起端）
// +localDocBytes 重置 watermark；对端经 doc-status 权威覆盖校准（不清 undo）。
import { useMemo, useState } from 'react';
import { Modal, message } from 'antd';
import { useCanvasStore } from '@/stores/canvasStore';
import { getUndoManager } from '@/stores/canvasUndo';
import { safeReload, getActiveCacheKey } from '@/stores/canvasCollabRuntime';
import { shrink, vacuum, type ShrinkBody, type ShrinkOutcome } from '@/api/collabApi';

/** 残留超限占比阈值（vacuum 入口亮出判据——spec §4.4：residue>50%×limit 才值得全端重建） */
const VACUUM_RESIDUE_RATIO = 0.5;
/** vacuum 成功后本端刷新延时（让用户看到结果提示；WS 活跃端另有 4410 close→runtime reload 双保险） */
const VACUUM_RELOAD_MS = 1_000;

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

/** shrink 三档（+noop）结果处理——返回是否关闭对话框 */
function handleShrinkOutcome(r: ShrinkOutcome): boolean {
  if ('stillOver' in r) {
    // 影子预演仍超限（服务端实测）——bytes=预演后总字节（非超出量），引导导出，对话框保持打开（可继续勾选/换出口）
    message.warning(`瘦身后仍达 ${Math.max(1, Math.round(r.bytes / 1024))}KB（上限 ${Math.max(1, Math.round(r.limit / 1024))}KB），请导出到新项目`);
    return false;
  }
  if (typeof r.watermark === 'number') {
    useCanvasStore.getState().applyQuotaWatermark(r.watermark);   // 服务端真值重置基线（T13 收口 store 单写者——组件面禁直调 setState，lint-gate C）
  }
  if (r.result === 'ok') {
    getUndoManager()?.clear();                 // 发起端撤销栈锚已删内容——失效清空（对端不清）
    message.success('已瘦身，撤销历史已重置');
  } else if (r.result === 'recalibrated') {
    message.success('已重新校准');
  } else {
    message.info('画布无需瘦身');
  }
  return true;
}

export function ShrinkDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const nodes = useCanvasStore((s) => s.nodes);
  const quotaResidueBytes = useCanvasStore((s) => s.quotaResidueBytes);
  const quotaLimitBytes = useCanvasStore((s) => s.quotaLimitBytes);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  /** 按 data JSON utf8 字节降序——瘦身收益大头在前。未 open 零算（大文档全节点 stringify
   *  5-15ms 是拖动每 tick 的白耗——挂载期间 nodes 每变皆重算，rows 仅 open 时被消费） */
  const rows = useMemo(
    () => {
      if (!open) return [];
      return nodes
        .map((n) => ({ id: n.id, type: String(n.type ?? ''), bytes: utf8Bytes(JSON.stringify(n.data ?? {})) }))
        .sort((a, b) => b.bytes - a.bytes);
    },
    [nodes, open],
  );

  const vacuumAvailable = quotaLimitBytes > 0 && quotaResidueBytes != null
    && quotaResidueBytes > quotaLimitBytes * VACUUM_RESIDUE_RATIO;

  const submitShrink = async (body: ShrinkBody) => {
    setSubmitting(true);
    try {
      const r = await shrink(projectId, body);
      if (handleShrinkOutcome(r)) { setSelected(new Set()); onClose(); }
    } catch {
      message.error('瘦身失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const onVacuum = () => {
    Modal.confirm({
      title: '重建画布历史',
      content: '将刷新所有在线成员，确认重建？',
      onOk: async () => {
        try {
          const r = await vacuum(projectId);
          if (r.result === 'ok') {
            message.success('已重建画布历史，即将刷新');
            onClose();
            // Y0b-5 T6 改道 safeReload('generation')——发起端善后统一走导出（标注旧代）→reload
            // 固定次序；未同步编辑在盘时落导出对话框不直接刷新。
            // T6 质量修复 M1/M2：key+tag 调度时刻快照传入（与 consumeGenerationJump/4410 对称——
            // 缺 key=purge 跳过；执行窗口内 session/store 可能已换,执行时不读现刻）
            const generationCacheKey = getActiveCacheKey();
            const generationTag = useCanvasStore.getState().pendingGenerationReload;
            setTimeout(() => safeReload('generation', { generationCacheKey, generationTag }), VACUUM_RELOAD_MS);
          } else {
            // skip-low-residue/中止三档/意外——DB 零变更，无需刷新
            message.warning(r.result === 'skip-low-residue' ? '残留不足，无需重建' : '暂不可重建，请稍后重试');
          }
        } catch {
          message.error('重建失败，请稍后重试');
        }
      },
    });
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="画布瘦身"
      width={480}
      footer={[
        vacuumAvailable && (
          <button key="vacuum" type="button" data-testid="shrink-vacuum-btn" onClick={onVacuum}
            className="mr-auto px-3 h-8 rounded-lg text-xs border bg-overlay-3 hover:bg-overlay-2 text-text border-overlay-2">
            重建画布历史（清理残留）
          </button>
        ),
        <button key="recal" type="button" data-testid="shrink-recalibrate-btn" disabled={submitting}
          onClick={() => void submitShrink({ recalibrate: true })}
          className="px-3 h-8 rounded-lg text-xs border bg-overlay-3 hover:bg-overlay-2 text-text border-overlay-2 disabled:opacity-50">
          纯重新校准
        </button>,
        <button key="submit" type="button" data-testid="shrink-submit-btn" disabled={submitting || selected.size === 0}
          onClick={() => void submitShrink({ deleteNodeIds: [...selected] })}
          // Y0b-4 T13 lint 收口（T11 遗留）：danger 主按钮迁 inline style（ConfirmModal 同款先例——
          // 类串 text-white 在 no-theme-utility 拦截面；--fw-accent-danger 双值 token+hover 深值=浅档值）
          className="px-3 h-8 rounded-lg text-xs border border-transparent disabled:opacity-50"
          style={{ backgroundColor: 'var(--fw-accent-danger)', color: '#fff' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#dc2626'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--fw-accent-danger)'; }}>
          删除所选并瘦身
        </button>,
      ].filter(Boolean)}
    >
      <div className="max-h-72 overflow-y-auto flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.id} data-testid={`shrink-row-${r.id}`}
            className="flex items-center gap-2 px-2 h-9 rounded-lg bg-overlay-2 text-xs text-text">
            <input
              type="checkbox"
              data-testid={`shrink-check-${r.id}`}
              checked={selected.has(r.id)}
              onChange={() => toggle(r.id)}
            />
            <span className="flex-1 truncate">{r.id} · {r.type} · {r.bytes}B</span>
          </div>
        ))}
        {rows.length === 0 && <div className="text-xs text-text-dim-1 px-2 py-4">画布无节点</div>}
      </div>
    </Modal>
  );
}
