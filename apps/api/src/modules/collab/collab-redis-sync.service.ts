import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import * as Y from 'yjs';
import { randomUUID } from 'crypto';

export const COLLAB_REDIS = 'COLLAB_REDIS_CONNECTIONS';

interface SyncRequestMsg { requestId: string; docName: string; sv: string }
interface SyncResponseMsg { requestId: string; docName: string; update: string }

@Injectable()
export class CollabRedisSync implements OnModuleDestroy {
  private sub!: Redis;
  private pub!: Redis;
  private pending = new Map<string, (update: Uint8Array) => void>();

  constructor(@Inject(COLLAB_REDIS) private readonly deps: { pub: Redis; sub: Redis }) {
    this.pub = deps.pub;
    this.sub = deps.sub;
    // 模式订阅两类频道；独立于 BullMQ 连接
    void this.sub.psubscribe('collab-sync:req:*', 'collab-sync:res:*');
    this.sub.on('pmessageBuffer', (_pat: string, ch: Buffer, msgBuf: Buffer) => {
      const chStr = ch.toString();
      if (chStr.startsWith('collab-sync:req:')) this.onRequest(JSON.parse(msgBuf.toString()) as SyncRequestMsg);
      else if (chStr.startsWith('collab-sync:res:')) this.onResponse(chStr, JSON.parse(msgBuf.toString()) as SyncResponseMsg);
    });
  }

  /** spec 2.3：加载方先订阅再发布，1s 超时兜底 */
  syncFromPeers(docName: string, doc: Y.Doc, timeoutMs = 1000): Promise<void> {
    const requestId = randomUUID();
    const sv = Buffer.from(Y.encodeStateVector(doc)).toString('base64');
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); resolve(); }, timeoutMs);
      this.pending.set(requestId, (update) => {
        clearTimeout(timer); this.pending.delete(requestId);
        Y.applyUpdate(doc, update); // origin 缺省 null——生命周期同 localStorage 恢复，不入 undo（服务端 doc 无 UndoManager）
        resolve();
      });
      void this.pub.publish(`collab-sync:req:${docName}`, JSON.stringify({ requestId, docName, sv } satisfies SyncRequestMsg));
    });
  }

  /** 仅回复本实例已打开的文档（持有最新内存态）；getDocument 由 gateway 注入，避免直接依赖造成环 */
  private async onRequest(msg: SyncRequestMsg) {
    const doc: Y.Doc | undefined = this.getDocument?.(msg.docName);
    if (!doc) return;
    const sv = new Uint8Array(Buffer.from(msg.sv, 'base64'));
    const update = Y.encodeStateAsUpdate(doc, sv); // 差异编码
    const payload: SyncResponseMsg = { requestId: msg.requestId, docName: msg.docName, update: Buffer.from(update).toString('base64') };
    void this.pub.publish(`collab-sync:res:${msg.docName}:${msg.requestId}`, JSON.stringify(payload));
  }

  /** gateway 注入：`redisSync.getDocument = (name) => this.server.hocuspocus.documents.get(name)`（Document extends Y.Doc） */
  getDocument: ((docName: string) => Y.Doc | undefined) | null = null;

  private onResponse(ch: string, msg: SyncResponseMsg) {
    const requestId = ch.split(':').pop()!;
    this.pending.get(requestId)?.(new Uint8Array(Buffer.from(msg.update, 'base64')));
  }

  handleResponseForTest(projectId: string, update: Uint8Array) {
    // 测试注入：直接模拟收到 response
    for (const [rid, cb] of this.pending) cb(update);
  }

  async onModuleDestroy() {
    await Promise.all([this.sub.quit().catch(() => {}), this.pub.quit().catch(() => {})]);
  }
}
