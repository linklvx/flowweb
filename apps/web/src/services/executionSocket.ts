import { io, type Socket } from 'socket.io-client';

/** gateway emitNodeStatus 的 payload 实形（execution.gateway.ts L21-30 实测） */
export interface NodeStatusPayload {
  nodeId: string;
  status: 'loading' | 'done' | 'error' | 'edit-result' | 'edit-failed';
  resultUrl?: string;
  fileId?: string;
  error?: string;
  credits?: { credits: number; subscriptionCredits: number; total: number };
}
export interface EditResultPayload { nodeId: string; fileId?: string; error?: string; failed: boolean; }

let socket: Socket | null = null;
let joinedProjectId: string | null = null;
const statusHandlers = new Set<(p: NodeStatusPayload) => void>();
const editResultHandlers = new Set<(p: EditResultPayload) => void>();

function joinCurrent(s: Socket): void {
  if (joinedProjectId) s.emit('join', joinedProjectId);
}

/** 全画布共享一个 /execution Socket（spec 第四节）。生命周期挂画布 page（mount ensure / unmount teardown）；
 *  节点组件只 subscribe 不建连。gateway 无 leave handler（实测）——卸载只 disconnect。 */
export function ensureExecutionSocket(projectId: string): Socket {
  if (!socket) {
    socket = io('/execution', { transports: ['websocket', 'polling'] });
    // socket.io-client 4.x Socket 级无 'reconnect' 事件（那是 Manager 事件——SocketReservedEvents 仅
    // connect/connect_error/disconnect）；重连成功必再触发 connect → joinCurrent 天然覆盖重连重 join，勿加坏监听
    socket.on('connect', () => joinCurrent(socket!));
    // 迁移前三个组件各有此诊断（收编单例时丢失）——恢复，便于排查网关未起/代理断连
    socket.on('connect_error', (err: Error) => console.warn('[executionSocket] connect_error:', err.message));
    socket.on('node:status', (data: NodeStatusPayload) => {
      // 决策 1 勘误：edit-result/edit-failed 是 status 值非事件名——统一在此分流（修复 ImageGenNode 坏监听）
      if (data.status === 'edit-result' || data.status === 'edit-failed') {
        for (const h of editResultHandlers) h({ nodeId: data.nodeId, fileId: data.fileId, error: data.error, failed: data.status === 'edit-failed' });
      }
      for (const h of statusHandlers) h(data);
      if (data.credits) window.dispatchEvent(new CustomEvent('credits:update', { detail: data.credits }));
    });
  }
  if (projectId && projectId !== joinedProjectId) {
    joinedProjectId = projectId;
    if (socket.connected) socket.emit('join', projectId);
  }
  return socket;
}

export function teardownExecutionSocket(): void {
  socket?.disconnect();
  socket = null;
  joinedProjectId = null;
}

/** 统一监听 node:status（调用方按 payload.nodeId 自行过滤——批5 删信箱后编辑器侧无订阅者，画布节点组件消费） */
export function subscribeNodeStatus(handler: (p: NodeStatusPayload) => void): () => void {
  statusHandlers.add(handler);
  return () => { statusHandlers.delete(handler); };
}

/** 图片 AI 编辑回填通道（spec 验收 28）——内部按 status 值分流 */
export function subscribeNodeEditResult(handler: (p: EditResultPayload) => void): () => void {
  editResultHandlers.add(handler);
  return () => { editResultHandlers.delete(handler); };
}
