import { Injectable } from '@nestjs/common';

export interface UpstreamData {
  textContents: string[];
  imageUrl?: string;
}

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

  /** Collect output data from all upstream nodes for injection into target node */
  collectUpstreamData(nodeId: string, nodes: any[], edges: any[]): UpstreamData {
    const upstreamEdges = edges.filter(e => e.target === nodeId);
    const textContents: string[] = [];
    let imageUrl: string | undefined;

    for (const e of upstreamEdges) {
      const upstream = nodes.find(n => n.id === e.source);
      if (!upstream) continue;
      const data = upstream.data as any;

      if (upstream.type === 'textInput' && data?.content) {
        textContents.push(data.content);
      } else if ((upstream.type === 'imageGen' || upstream.type === 'imageExtGen' || upstream.type === 'videoGen') && data?.resultUrl) {
        if (!imageUrl) imageUrl = data.resultUrl;
      }
    }

    return { textContents, imageUrl };
  }
}
