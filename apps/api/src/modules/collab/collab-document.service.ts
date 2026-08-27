import { Injectable, Inject } from '@nestjs/common';
import * as Y from 'yjs';
import { CollabGateway } from './collab.gateway';

@Injectable()
export class CollabDocumentService {
  constructor(@Inject(CollabGateway) private readonly gateway: CollabGateway) {}

  /** Q1 单实例铁律：业务服务端写 doc 一律走 Hocuspocus 直连；try/finally disconnect 保证 unload flush（S7） */
  async withDoc<T>(projectId: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T> {
    const connection = await this.gateway.server.hocuspocus.openDirectConnection(`project:${projectId}`);
    try {
      let result: T;
      await connection.transact(async (doc: Y.Doc) => {
        result = await fn(doc);
      });
      return result!;
    } finally {
      await connection.disconnect();
    }
  }

  /** doc → plain nodes/edges（形状对齐原 CanvasNode/CanvasEdge include 结果） */
  async readCanvas(projectId: string): Promise<{ nodes: any[]; edges: any[] }> {
    return this.withDoc(projectId, (doc) => {
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
    });
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
