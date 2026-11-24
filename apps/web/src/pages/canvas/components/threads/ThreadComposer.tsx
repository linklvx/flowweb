// ThreadComposer.tsx（Y4b T11——批注评论输入框；node/text 两形态）
// 入口 A（node 形态）：右键菜单「批注」→ nodeId+textarea；入口 B（text 形态）：文本选区浮标
// → 预填锚点（base64 RelativePosition 两串）→ 提交。
// 视觉=antd 既有组件族（spec §10 裁定 6：不另立视觉体系）——Modal+Input.TextArea 门户到 body，
// 不受画布缩放影响。
// 写动作以 onSubmit 注入（threadsStore.createThread 接线单点在 page.tsx——写路径仍只在页面层：
// 入口 A/B 分处 CanvasView/TextInputNode，只经 THREADS_COMPOSE_EVENT 请求开窗）。
// Y5 T8 评审 I：提交面随 canEdit 闸（只读订阅——禁"UI 可点、store 静默拒"）；onSubmit 返 false 时短提示。
// 评审 III：false 提示两分支——提交时 !canEdit=只读/未就绪文案，其余=通用输入错误文案
//（createThread 也因空 body/锚缺失等用户可纠正输入返 false；不复制 store 内部原因分类）。
import { useState } from 'react';
import { Modal, Input, Button, message } from 'antd';
import { useCanvasStore } from '@/stores/canvasStore';
import { canEdit } from '@/stores/syncStatus';

/** createThread 入参形状（T10 契约：kind='text' 时两锚必传） */
export interface ThreadCreateInput {
  nodeId: string;
  kind: 'node' | 'text';
  anchorStart?: string;
  anchorEnd?: string;
  body: string;
}

/** 入口 A/B → 页面级 composer 的开窗请求（无 store 依赖的接缝——detail=除 body 外的 createThread 入参） */
export interface ThreadComposeRequest {
  nodeId: string;
  kind: 'node' | 'text';
  anchorStart?: string;
  anchorEnd?: string;
}
export const THREADS_COMPOSE_EVENT = 'threads:compose';

/** 入口侧辅助：请求打开 composer（node 形态=只传 nodeId；text 形态=带两锚） */
export function requestThreadCompose(req: ThreadComposeRequest): void {
  window.dispatchEvent(new CustomEvent<ThreadComposeRequest>(THREADS_COMPOSE_EVENT, { detail: req }));
}

interface Props {
  input: ThreadCreateInput;
  /** 返回 true=已写入（关窗）；false=拒（同步假/谓词拒——保持开窗让用户修正） */
  onSubmit: (input: ThreadCreateInput) => boolean;
  onClose: () => void;
}

export function ThreadComposer({ input, onSubmit, onClose }: Props) {
  const [body, setBody] = useState('');
  // Y5 T8 评审 I：与 threadsStore 写闸同谓词（canEdit）——只读/未就绪态禁用提交，禁静默丢
  const editable = useCanvasStore(canEdit);

  const handleSubmit = () => {
    // 写入成功即关窗（Props.onSubmit 契约：true=已写入→关窗；false=保持开窗让用户修正）
    if (onSubmit({ ...input, body })) { onClose(); return; }
    // 评审 III 两分支：提交时谓词仍拒=权限/同步面；否则=输入面（空 body/锚缺失等，非本组件分类）
    message.warning(
      canEdit(useCanvasStore.getState())
        ? '批注内容不能为空'
        : '批注未写入：当前为只读会话或同步未就绪',
    );
  };

  return (
    <Modal
      open
      title={input.kind === 'text' ? '批注选中文本' : '批注节点'}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="submit" type="primary" disabled={!editable} onClick={handleSubmit}>提交</Button>,
      ]}
    >
      <Input.TextArea
        autoFocus
        rows={4}
        maxLength={2000}
        disabled={!editable}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="输入批注内容…"
      />
    </Modal>
  );
}
