// ProcessSnapshot.tsx —— 零 store 依赖（§5.3 禁复用 CanvasView），只依赖 @xyflow/react + 静态数据
import { useMemo } from 'react';
import { ReactFlow, Background, BackgroundVariant, Handle, Position, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ProcessSnapshotData, SnapshotNode } from '@flowweb/shared';

const TYPE_LABEL: Record<string, string> = {
  textInput: '剧本文本', imageGen: '图片生成', imageExtGen: '图片生成', videoGen: '视频生成',
  audioGen: '语音合成', multiImageGen: '分镜宫格', group: '分组', videoEdit: '视频剪辑',
};

/** 简版节点：类型图标+类型名+序号+白名单文本；Handle 红线——每节点默认 target 左 / source 右（无 id） */
function SimpleNode({ data, selected }: any) {
  const d = data as { __type: string; __label: string; content?: string; prompt?: string; thumbnailUrl?: string };
  return (
    <div className="w-[160px] rounded-lg border border-white/15 bg-[#1e1e1e] px-2.5 py-2 box-border" data-node-type={d.__type}>
      <div className="text-[11px] font-semibold text-white/80">{d.__label}</div>
      {d.thumbnailUrl && <img src={d.thumbnailUrl} alt="" className="mt-1 w-full aspect-video object-cover rounded" loading="lazy" />}
      {typeof d.content === 'string' && d.content && <div className="mt-1 text-[11px] text-white/60 line-clamp-3">{d.content}</div>}
      {typeof d.prompt === 'string' && d.prompt && <div className="mt-1 text-[11px] text-white/60 line-clamp-3">{d.prompt}</div>}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

// 第六轮（C2 Task 9.1 定案落地）：group **不走 RF 内置 group 类型**——内置 GroupNode 渲染 null、无 Handle，
// handles===nodes×2 断言必红且连组边静默消失。自定义 GroupFrame 注册覆盖（v12 允许）。
function GroupFrame({ data }: any) {
  return (
    <div data-group-type={String((data as any).__groupType ?? 'normal')}
      className="w-full h-full min-h-[120px] rounded-xl border border-dashed border-white/25 bg-white/5 box-border">
      <div className="px-2 py-1 text-[11px] text-white/50">{String((data as any).__name ?? '')}</div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { simple: SimpleNode, group: GroupFrame };

export function ProcessSnapshot({ snapshot }: { snapshot: ProcessSnapshotData }) {
  const { nodes, edges } = useMemo(() => {
    const seqByType: Record<string, number> = {};
    const ns: Node[] = snapshot.nodes.map((n: SnapshotNode) => {
      const seq = (seqByType[n.type] = (seqByType[n.type] ?? 0) + 1);
      const isGroup = n.type === 'group';
      return {
        id: n.id,
        type: isGroup ? 'group' : 'simple',
        position: n.position,
        width: n.width, height: n.height,
        parentId: n.parentId ?? undefined,
        // 白名单字段名是 groupType/name——不会自己变成 __groupType/__name，必须显式映射（漏映射则 data-group-type 恒 'normal'）
        data: isGroup
          ? { __groupType: n.data.groupType, __name: n.data.name, __label: `${TYPE_LABEL[n.type] ?? n.type} ${seq}` }
          : { ...n.data, __type: n.type, __label: `${TYPE_LABEL[n.type] ?? n.type} ${seq}` },
      } as Node;
    });
    const es: Edge[] = snapshot.edges.map(e => ({ id: e.id, source: e.source, target: e.target }));
    return { nodes: ns, edges: es };
  }, [snapshot]);

  return (
    <div className="h-full w-full" data-testid="process-snapshot">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
        panOnDrag zoomOnScroll fitView fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#3a3a3a" />
      </ReactFlow>
    </div>
  );
}
