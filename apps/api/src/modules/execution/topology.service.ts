import { Injectable } from '@nestjs/common';

export interface UpstreamData {
  textContents: string[];
  /** 上游产物媒体身份（NodeArtifact.mediaId——Y1a T8 身份形态：URL 形态退役，
   *  presign 续签/拓扑投影滞后不再漂移 paramsHash）。 */
  imageMediaId?: string;
}

/** 上游产物媒体身份读取器（Y1a T8）：查 NodeArtifact by projectId+nodeId 槽位 → mediaId。
 *  reader 由调用方注入（upstream-media.service 实现）——本服务保持零 DB 依赖纯拓扑职责
 *  （sort/getScope 纯函数不动；产物收集的数据源经注入参数化）。
 *  downstreamNodeId（下游目标节点）：miss warn 定位上下文透传——miss 形态只在 reader 实现处可辨，
 *  warn 落实现处（T8 质评 Important：静默不注入=下游无图模式扣费需可观测），本服务恒传。 */
export type UpstreamMediaIdReader = (projectId: string, nodeId: string, downstreamNodeId: string) => Promise<string | null>;

@Injectable()
export class TopologyService {
  /** Kahn's algorithm for topological sort */
  sort(nodes: any[], edges: any[]): any[] {
    const nodeIds = new Set(nodes.map(n => n.id));
    const inDegree: Record<string, number> = {};
    const adjacency: Record<string, string[]> = {};

    for (const id of nodeIds) { inDegree[id] = 0; adjacency[id] = []; }
    for (const e of edges) {
      const s = e.source, t = e.target; // edges 单形状 source/target（R1a 收敛——双兼容读删）
      if (nodeIds.has(s) && nodeIds.has(t)) {
        adjacency[s] = adjacency[s] || [];
        adjacency[s].push(t);
        inDegree[t] = (inDegree[t] || 0) + 1;
      }
    }

    const queue = Object.entries(inDegree).filter(([, d]) => d === 0).map(([id]) => id);
    const result: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      for (const neighbor of adjacency[current] || []) {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) queue.push(neighbor);
      }
    }

    return result.map(id => nodes.find(n => n.id === id)!).filter(Boolean);
  }

  /** Get target node + all its upstream dependencies */
  getScope(nodes: any[], edges: any[], nodeId: string): any[] {
    const upstreamIds = this.getUpstreamIds(nodeId, edges);
    upstreamIds.add(nodeId);
    return nodes.filter(n => upstreamIds.has(n.id));
  }

  private getUpstreamIds(nodeId: string, edges: any[], visited = new Set<string>()): Set<string> {
    const parents = edges.filter(e => e.target === nodeId).map(e => e.source);
    for (const p of parents) {
      if (!visited.has(p)) {
        visited.add(p);
        this.getUpstreamIds(p, edges, visited);
      }
    }
    return visited;
  }

  /** Collect output data from all upstream nodes for injection into target node.
   *  Y1a T8：上游产物（imageGen/imageExtGen/videoGen）改读 NodeArtifact PG 权威（reader 注入——
   *  doc resultUrl 读源退役：拓扑投影滞后〔doc 尚无 fileId〕时 claim 取空/漂移缺口根修——
   *  PG 行 finalize 即建）；textInput 文本仍读 doc（用户输入非产物）。 */
  async collectUpstreamData(
    projectId: string, nodeId: string, nodes: any[], edges: any[], readUpstreamMediaId: UpstreamMediaIdReader,
  ): Promise<UpstreamData> {
    const upstreamEdges = edges.filter(e => e.target === nodeId);
    const textContents: string[] = [];
    let imageMediaId: string | undefined;

    for (const e of upstreamEdges) {
      const upstream = nodes.find(n => n.id === e.source);
      if (!upstream) continue;
      const data = upstream.data as any;

      if (upstream.type === 'textInput' && data?.content) {
        textContents.push(data.content);
      } else if (upstream.type === 'imageGen' || upstream.type === 'imageExtGen' || upstream.type === 'videoGen') {
        if (!imageMediaId) {
          const mediaId = await readUpstreamMediaId(projectId, upstream.id, nodeId);   // nodeId=下游目标——miss warn 定位上下文
          if (mediaId) imageMediaId = mediaId;
        }
      }
    }

    return { textContents, imageMediaId };
  }
}
