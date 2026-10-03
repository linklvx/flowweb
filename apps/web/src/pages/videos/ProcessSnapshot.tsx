// ProcessSnapshot.tsx —— 零 store 依赖（§5.3 禁复用 CanvasView），只依赖 @xyflow/react + 静态数据
// O0c-2（Spec B）：第 4 渲染面换芯——原 :62-80 自建映射（abs 直透 RF+parentId 双加链）删除，改
// deriveRenderCanvas(records) 唯一产物（rel+hidden 剔除+派生帧+cellNodes 载荷——组帧≡主画布逐位）；
// 分镜组渲染复用抽取纯组件 components/storyboard（终裁 14：同一 CSS grid 布局层，否则第 4 面与主画布两套布局）。
import { useMemo } from 'react';
import { ReactFlow, Background, BackgroundVariant, Handle, Position, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { deriveRenderCanvas, type ProcessSnapshotData, type RenderNode } from '@flowweb/shared';
import { StoryboardGroupRenderer } from '@/components/storyboard/StoryboardGroupRenderer';
import type { CellNodeInfo } from '@/components/storyboard/StoryboardCell';

const TYPE_LABEL: Record<string, string> = {
  textInput: '剧本文本', imageGen: '图片生成', imageExtGen: '图片生成', videoGen: '视频生成',
  audioGen: '语音合成', multiImageGen: '分镜宫格', group: '分组', videoEdit: '视频剪辑',
};

/** 兜底尺寸表（spec v3.1 P5a）——协作持久化只存 width/height、RF dimensions 只写 measured、
 *  canvasStore.addNode 仅 textInput/videoEdit 设尺寸 → 未手动 resize 的生成类节点快照无尺寸，本表是其唯一尺寸来源（主路径非边缘兜底）。
 *  红线：RF nodeHasDimensions 为 && 判定，width/height 任一 undefined → wrapper visibility:hidden（jsdom RO no-op 下永久隐藏）→ 必须全类型穷尽 + width/height 同步兜。
 *  O0c-2 组路径双删：group 行+FALLBACK_DEFAULT 组路径删除——组帧恒 deriveRenderCanvas 派生（四模式单源
 *  deriveGroupFrame），280×120 兜底成为第二真相（spec v3.12"近死代码"O0 后变主路径）。
 *  仅测试锚点（coverage 断言），勿在别处 import。出处逐行见 spec P5a 表。 */
export const FALLBACK: Record<string, { w: number; h: number }> = {
  textInput: { w: 300, h: 300 },      // canvasStore.ts:196-199 建节点默认
  imageGen: { w: 548, h: 309 },       // 16:9 计算链实算 round(562.5)=563→round(563×548/1000)=309（ImageGenNode.test:387 钉住；:62 的 306 是非法 ratio 兜底常量非默认值）
  imageExtGen: { w: 548, h: 309 },    // ImageExtNode.tsx:6 为 ImageGenNode 直通包装，同组件同值
  videoGen: { w: 548, h: 309 },       // VideoGenNode.tsx:51-58 同款实算（快照持久化值 308 为历史 measured，差 1px 无感）
  audioGen: { w: 548, h: 280 },       // AudioGenNode.tsx:14-15 NODE_WIDTH/NODE_HEIGHT 组件常量
  multiImageGen: { w: 400, h: 300 },  // MultiImageNode.tsx:13-14 STACKED_W/H 堆叠态默认
  videoEdit: { w: 320, h: 110 },      // 结构估算：标题 ~37+工具栏 ~30+轨道区 ~40（1 轨 ≈88/3 轨 ≈110，M5 接受 88–140）
};
const FALLBACK_DEFAULT = { w: 280, h: 120 }; // 未知非组类型默认——canvasStore.ts:817/894/946/1292 `?? 280 / ?? 120` 仓内先例（组不走本兜底——O0c-2）

/** 简版节点（满框版式，R2 裁定）：缩略图铺满 wrapper + 底部半透明信息条（无缩略图同构——信息条贴底）；Handle 红线——每节点默认 target 左 / source 右（无 id） */
function SimpleNode({ data }: any) {
  const d = data as { __type: string; __label: string; content?: string; prompt?: string; thumbnailUrl?: string };
  return (
    <div className="relative w-full h-full overflow-hidden rounded-lg border border-white/15 bg-[#1e1e1e]" data-node-type={d.__type}>
      {d.thumbnailUrl && <img src={d.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />}
      <div className="absolute bottom-0 inset-x-0 bg-black/60 px-2.5 py-1.5">
        <div className="text-[11px] font-semibold text-white/80">{d.__label}</div>
        {typeof d.content === 'string' && d.content && <div className="mt-0.5 text-[11px] text-white/60 line-clamp-2">{d.content}</div>}
        {typeof d.prompt === 'string' && d.prompt && <div className="mt-0.5 text-[11px] text-white/60 line-clamp-2">{d.prompt}</div>}
      </div>
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
      className="w-full h-full min-h-[120px] rounded-xl border border-dashed border-white/25 bg-white/5">
      <div className="px-2 py-1 text-[11px] text-white/50">{String((data as any).__name ?? '')}</div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

// O0c-2：storyboard 组渲染复用抽取纯组件（宫格=组内 CSS grid，不读子 position——终裁 14）；
// cellNodes=deriveRenderCanvas 组 data 双通道载荷（公开页通道 thumbnailUrl）；Handle×2 红线同 GroupFrame（缺则组边静默丢）
function StoryboardGroupView({ id, data }: any) {
  const d = data as { cellNodes?: CellNodeInfo[]; groupType?: unknown } & Record<string, unknown>;
  return (
    <div className="relative h-full w-full">
      <StoryboardGroupRenderer id={id} data={d as any} cellNodes={d.cellNodes ?? []} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function GroupNodeView({ id, data }: any) {
  return (data as any).__groupType === 'storyboard'
    ? <StoryboardGroupView id={id} data={data} />
    : <GroupFrame data={data} />;
}
const nodeTypes = { simple: SimpleNode, group: GroupNodeView };

export function ProcessSnapshot({ snapshot }: { snapshot: ProcessSnapshotData }) {
  const { nodes, edges } = useMemo(() => {
    // O0c-2 换芯：deriveRenderCanvas 唯一写者（rel+hidden 剔除+派生帧+cellNodes）——本组件不再自建几何映射
    const derived = deriveRenderCanvas({ records: snapshot.nodes, edges: snapshot.edges });
    const seqByType: Record<string, number> = {};
    const ns: Node[] = derived.nodes.map((rn: RenderNode) => {
      const seq = (seqByType[rn.type] = (seqByType[rn.type] ?? 0) + 1);
      const isGroup = rn.type === 'group';
      // 兜底是主路径：未手动 resize 的生成类节点快照无持久化尺寸；组帧恒派生（O0c-2）——fb 仅非组查表
      const fb = isGroup ? undefined : FALLBACK[rn.type] ?? FALLBACK_DEFAULT;
      return {
        id: rn.id,
        type: isGroup ? 'group' : 'simple',
        position: rn.position,
        width: rn.width ?? fb?.w, height: rn.height ?? fb?.h,
        parentId: rn.parentId ?? undefined,
        // 白名单字段名是 groupType/name——不会自己变成 __groupType/__name，必须显式映射（漏映射则 data-group-type 恒 'normal'）
        data: isGroup
          ? { ...rn.data, __groupType: rn.data.groupType, __name: rn.data.name, __label: `${TYPE_LABEL[rn.type] ?? rn.type} ${seq}` }
          : { ...rn.data, __type: rn.type, __label: `${TYPE_LABEL[rn.type] ?? rn.type} ${seq}` },
      } as Node;
    });
    const es: Edge[] = derived.edges.map(e => ({ id: e.id, source: e.source, target: e.target }));
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
