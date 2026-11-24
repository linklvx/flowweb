// ThreadsPanel.tsx（Y4b T11——批注侧滑面板：三组互斥+清理）
// 三组优先级（spec §0 条 5）：孤儿 > 已解决（resolved && !orphan）> 进行中（其余）；进行中再按
// nodeId 分组。分组/排序由 threadsStore.threadsView$ 在投影侧算好（T10），本组件只做展示与动作
// 回调——store 接线单点在 page.tsx（T11 接缝，见 task-11-report.md 偏离登记）。
// 视觉=antd 既有组件族（spec §10 裁定 6）：侧滑面板 Drawer + 既有主题 token，不另立视觉体系。
// Y5 T8 评审 I：动作面随 canEdit 闸（只读态禁用回复/解决/重开/清理——禁"UI 可点、store 静默拒"）。
import { useState } from 'react';
import { Drawer, Button, Empty, Input } from 'antd';
import { useCanvasStore } from '@/stores/canvasStore';
import { canEdit } from '@/stores/syncStatus';

export interface ThreadCommentView {
  id: string;
  authorId: string;
  body: string;
  createdAt: number;
}

export interface ThreadViewItem {
  id: string;
  nodeId: string;
  kind: 'node' | 'text';
  resolved: boolean;
  /** kind='text' 存活锚的窗口文本摘录（≤80 UTF-16 码元，投影侧截取不回写） */
  excerpt?: string;
  createdAt: number;
  comments: ThreadCommentView[];
}

/** threadsView$ 三组互斥形状（T10 产出契约——active 按 nodeId 分组，组内 createdAt 升序） */
export interface ThreadsViewData {
  active: Array<{ nodeId: string; threads: ThreadViewItem[] }>;
  resolved: ThreadViewItem[];
  orphan: ThreadViewItem[];
}

interface Props {
  view: ThreadsViewData;
  open?: boolean;
  onCleanup: () => void;
  onAddComment: (threadId: string, body: string) => boolean;
  onSetResolved: (threadId: string, resolved: boolean) => boolean;
  onClose: () => void;
}

const sectionTitle = 'text-xs font-bold text-text-dim-1 px-1 py-2';
const groupTitle = 'text-sm font-medium text-text px-1 py-1';

/** 单条线程：标题行可点开合；展开=评论列表+回复框+解决开关（spec §3.2 功能面） */
function ThreadRow({
  thread,
  editable,
  onAddComment,
  onSetResolved,
}: {
  thread: ThreadViewItem;
  editable: boolean;
  onAddComment: Props['onAddComment'];
  onSetResolved: Props['onSetResolved'];
}) {
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState('');

  const handleReply = () => {
    if (onAddComment(thread.id, reply)) setReply('');
  };

  const first = thread.comments[0]?.body ?? '';
  return (
    <div data-testid="thread-row" className="border border-overlay-2 rounded-lg mb-2 bg-surface">
      <button
        type="button"
        className="w-full text-left px-3 py-2 bg-transparent border-0 cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="block text-sm text-text">#{thread.id}</span>
        {thread.kind === 'text' && thread.excerpt !== undefined && (
          <span className="block text-xs text-text-dim-1 mt-0.5 truncate">{thread.excerpt}</span>
        )}
        {!open && first !== '' && (
          <span className="block text-xs text-text-dim-2 mt-0.5 truncate">{first}</span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3">
          <div className="flex flex-col gap-1 mb-2">
            {thread.comments.map((c) => (
              <div key={c.id} className="text-sm text-text whitespace-pre-wrap">{c.body}</div>
            ))}
          </div>
          <Input.TextArea
            rows={2}
            maxLength={2000}
            disabled={!editable}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="回复…"
          />
          <div className="flex gap-2 mt-2">
            <Button size="small" type="primary" disabled={!editable} onClick={handleReply}>回复</Button>
            {thread.resolved ? (
              <Button size="small" disabled={!editable} onClick={() => onSetResolved(thread.id, false)}>重新打开</Button>
            ) : (
              <Button size="small" disabled={!editable} onClick={() => onSetResolved(thread.id, true)}>解决</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ThreadsPanel({ view, open = true, onCleanup, onAddComment, onSetResolved, onClose }: Props) {
  const [resolvedExpanded, setResolvedExpanded] = useState(false);
  // Y5 T8 评审 I：动作面与 threadsStore 写闸同谓词
  const editable = useCanvasStore(canEdit);
  const isEmpty = view.active.length === 0 && view.resolved.length === 0 && view.orphan.length === 0;

  return (
    <Drawer title="批注" placement="right" width={380} open={open} onClose={onClose}>
      {isEmpty ? (
        <Empty description="暂无批注" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="flex flex-col">
          {view.active.length > 0 && (
            <section data-testid="threads-group-active">
              <div className={sectionTitle}>进行中</div>
              {view.active.map(({ nodeId, threads }) => (
                <div key={nodeId} className="mb-3">
                  <div className={groupTitle}>节点 {nodeId}</div>
                  {threads.map((t) => (
                    <ThreadRow key={t.id} thread={t} editable={editable} onAddComment={onAddComment} onSetResolved={onSetResolved} />
                  ))}
                </div>
              ))}
            </section>
          )}

          {view.resolved.length > 0 && (
            <section>
              <button
                type="button"
                className={`${sectionTitle} w-full text-left bg-transparent border-0 cursor-pointer`}
                onClick={() => setResolvedExpanded((v) => !v)}
              >
                已解决 ({view.resolved.length})
              </button>
              {resolvedExpanded && (
                <div data-testid="threads-group-resolved">
                  {view.resolved.map((t) => (
                    <ThreadRow key={t.id} thread={t} editable={editable} onAddComment={onAddComment} onSetResolved={onSetResolved} />
                  ))}
                </div>
              )}
            </section>
          )}

          {view.orphan.length > 0 && (
            <section data-testid="threads-group-orphan">
              <div className="flex items-center justify-between px-1 py-2">
                <span className="flex items-center gap-2">
                  <span className="text-xs font-bold text-text-dim-1">失效</span>
                  <span
                    data-testid="threads-orphan-badge"
                    className="min-w-5 h-4 px-1 rounded-full bg-accent-danger text-on-accent text-[10px] font-bold flex items-center justify-center"
                  >
                    {view.orphan.length}
                  </span>
                </span>
                <Button size="small" danger disabled={!editable} onClick={onCleanup}>清理全部</Button>
              </div>
              {view.orphan.map((t) => (
                <ThreadRow key={t.id} thread={t} editable={editable} onAddComment={onAddComment} onSetResolved={onSetResolved} />
              ))}
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
