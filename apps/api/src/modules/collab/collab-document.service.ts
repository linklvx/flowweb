import { Injectable, Inject, Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { CollabGateway } from './collab.gateway';
import { svSatisfied } from './sv.util';
import { svWaitTimeoutTotal } from './sv-wait.metrics';

@Injectable()
export class CollabDocumentService {
  private readonly logger = new Logger(CollabDocumentService.name);

  constructor(@Inject(CollabGateway) private readonly gateway: CollabGateway) {}

  /** Q1 单实例铁律：业务服务端写 doc 一律走 Hocuspocus 直连；try/finally disconnect 保证 unload flush（S7） */
  async withDoc<T>(projectId: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T> {
    const connection = await this.gateway.server.hocuspocus.openDirectConnection(`project:${projectId}`);
    try {
      let result: T;
      let pending: Promise<void> | undefined;
      await connection.transact((doc: Y.Doc) => {
        // transact 不 await 异步回调（hocuspocus 4.6.0 DirectConnection.transact 同步调用且不 await）：
        // 同步 fn 原样在事务内完成；异步 fn 捕获其 Promise 在事务外 await——
        // 否则回调挂起时即返回 undefined 且 finally 提前拆直连（readCanvas SV 等待路径依赖此语义）
        const r = fn(doc);
        if (r instanceof Promise) pending = r.then((v) => { result = v; });
        else result = r;
      });
      if (pending) await pending;
      return result!;
    } finally {
      await connection.disconnect();
    }
  }

  /** doc → plain nodes/edges（形状对齐原 CanvasNode/CanvasEdge include 结果）；sv 提供时等待 server doc 追上（超时降级不抛错，spec 3.1） */
  async readCanvas(projectId: string, sv?: Uint8Array, timeoutMs = 3000): Promise<{ nodes: any[]; edges: any[] }> {
    return this.withDoc(projectId, async (doc) => {
      if (sv && !svSatisfied(Y.encodeStateVector(doc), sv)) {
        const ok = await this.waitForSV(doc, sv, timeoutMs);
        if (!ok) {
          this.logger.warn(`SV wait timeout projectId=${projectId}`);
          svWaitTimeoutTotal.inc();
        }
      }
      return this.readDocCanvas(doc);
    });
  }

  private waitForSV(doc: Y.Doc, sv: Uint8Array, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const check = () => svSatisfied(Y.encodeStateVector(doc), sv);
      const onUpdate = () => { if (check()) { cleanup(); resolve(true); } };
      const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); doc.off('update', onUpdate); };
      doc.on('update', onUpdate);
      if (check()) { cleanup(); resolve(true); } // 注册后立即检查——函数自洽，不依赖外层守卫时序
    });
  }

  /** 原 readCanvas 内的读取逻辑抽为纯函数（供复用） */
  private readDocCanvas(doc: Y.Doc): { nodes: any[]; edges: any[] } {
    const nodes = [...doc.getMap('nodes').entries()].map(([id, v]) => {
      const m = v as Y.Map<any>;
      return {
        id,
        type: m.get('type'),
        parentId: m.get('parentId') ?? null,
        width: m.get('width') ?? null,
        height: m.get('height') ?? null,
        position: m.get('position')?.toJSON(),
        data: m.get('data')?.toJSON(),
      };
    });
    const edges = [...doc.getMap('edges').entries()].map(([id, v]) => {
      const m = v as Y.Map<any>;
      return { id, sourceId: m.get('source'), targetId: m.get('target') };
    });
    return { nodes, edges };
  }

  /** 服务端写节点 data 字段（逐键写入，禁止整块替换） */
  async writeNodeData(projectId: string, nodeId: string, patch: Record<string, unknown>) {
    await this.withDoc(projectId, (doc) => {
      const nodeMap = doc.getMap('nodes').get(nodeId);
      if (!(nodeMap instanceof Y.Map)) return;
      let dataMap = nodeMap.get('data');
      if (!(dataMap instanceof Y.Map)) {
        dataMap = new Y.Map();
        nodeMap.set('data', dataMap);
      }
      for (const [k, v] of Object.entries(patch)) dataMap.set(k, v);
    });
  }
}
