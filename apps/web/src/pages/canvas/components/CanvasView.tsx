import { memo, useCallback, useMemo, useRef, useState, useEffect, type DragEvent } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, MiniMap,
  useReactFlow, SelectionMode,
  type Connection, type FinalConnectionState, type SnapGrid,
  type NodeTypes, type OnNodesChange, type OnEdgesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Modal } from 'antd';
import { useCanvasStore } from '@/stores/canvasStore';
import { useTheme } from '@/stores/themeStore';
import { getAwareness } from '@/stores/canvasCollabRuntime';
import { RemoteCursors } from './RemoteCursors';
import { useAuth } from '@/components/AuthProvider';
import { useNodeStore, type ImageItem } from '@/stores/nodeStore';
import { selectIsLocked } from '@/stores/canvasLock';
import { useMenuStore } from '@/stores/menuStore';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { useMaterialLibraryStore } from '@/stores/materialLibraryStore';
import { useTrackCanvasPointerShift } from '@/hooks/useTrackCanvasPointerShift';
import { useMarqueeSelectionGuard } from '@/hooks/useMarqueeSelectionGuard';
import { useDragGestureGuard } from '@/hooks/useDragGestureGuard';
import { executeGroupNodes } from '@/api/executionApi';
import { canExecute } from '@/stores/syncStatus';
import { getMediaUrl } from '@/api/mediaApi';
import { isImageCompletedNode } from '@/utils/imageNodeGuards';
import { resolveStoryboardConfig } from '@/utils/storyboardConfig';
import { collectDownloadables } from '@/utils/collectDownloadables';
import { runBatchDownload } from '@/utils/batchDownload';
import type { CanvasNodeRecord } from '@flowweb/shared';
import { clientPoint, decideHandleMenu, absoluteRectsOf } from '@/utils/handleMenu';
import { decideReferencePick } from './referenceSelect';
import { TextInputNode } from './nodes/TextInputNode';
import { ImageGenNode } from './nodes/ImageGenNode';
import { ImageExtNode } from './nodes/ImageExtNode';
import { VideoGenNode } from './nodes/VideoGenNode';
import { AudioGenNode } from './nodes/AudioGenNode';
import { MultiImageNode } from './nodes/MultiImageNode';
import { VideoEditNode } from './nodes/VideoEditNode';
import { MAX_REFERENCE_IMAGES } from './nodes/prompt-input/types';
import { GroupNode } from './groups/GroupNode';
import { ConnectionLine } from './edges/ConnectionLine';
import { CanvasToolbar } from './CanvasToolbar';
import { CanvasReferenceSelectBanner } from './CanvasReferenceSelectBanner';
import { SelectionBoxOverlay } from './groups/SelectionBoxOverlay';
import { AddOutputHandle } from './groups/AddOutputHandle';
import { resolveAddOutputTarget, addOutputFrameFlow, addOutputHitZoneFlow, decideBatchGestureEnd, type BatchConnectGestureEnd } from './groups/addOutput';
import { canEdit } from '@/stores/syncStatus';
import { StoryboardTitlesLayer } from './groups/StoryboardTitlesLayer';
import { GroupToolbar } from './groups/GroupToolbar';
import { GroupContextMenu } from './groups/GroupContextMenu';
import { ConfirmModal } from './ConfirmModal';
import { AspectRatioDropdown } from './groups/AspectRatioDropdown';
import { GridSizeDropdown } from './groups/GridSizeDropdown';
import { StitchButton } from './groups/StitchButton';
import type { StoryboardConfig } from '@/types/group';

export const nodeTypes: NodeTypes = {
  textInput: TextInputNode,
  imageGen: ImageGenNode,
  imageExtGen: ImageExtNode,
  videoGen: VideoGenNode,
  audioGen: AudioGenNode,
  multiImageGen: MultiImageNode,
  videoEdit: VideoEditNode,
  group: GroupNode,
} as any;

const edgeTypes: any = {
  default: ConnectionLine,
};

// panOnDrag 不在 StoreUpdater fieldsToTrack（react:186-248，不写库）；真实代价在 ZoomPane 的
// update effect（react:1337-1377，deps 含 panOnDrag）——每帧重渲染链（defaultViewport 每帧新对象
// → GraphView memo 失效 → FlowRenderer 重建 children → effect 重跑 → update() 重建 wheel/start
// 处理器）。常量使引用稳定 → effect 不再每帧重跑。禁 [1,2]：数组含 2 时右键成为平移按钮且
// onContextMenu 直接 preventDefault+return，右键菜单路径彻底失效（spec §3.1）。
const PAN_ON_DRAG_MIDDLE = [1];
// snapGrid 在 fieldsToTrack 且原为内联——本文件真正每帧写 store 的是它，一并 hoist。
// 必须显式 tuple 标注：hoist 丢上下文类型后 [20,20] 退化为 number[] → strict TS2322；
// as const/Object.freeze 与可变 tuple 不兼容，禁用。勿原地改写（会 store.setState 进库共享引用）。
const SNAP_GRID: SnapGrid = [20, 20];

interface Props {
  projectId: string;
}

/** awareness 变化驱动的远端光标层（非响应式桥 → 计数器强制渲染） */
function RemoteCursorsLive() {
  const [, force] = useState(0);
  const bridge = getAwareness()!;
  useEffect(() => bridge.onStateChange(() => force((v) => v + 1)), [bridge]);
  return <RemoteCursors bridge={bridge} />;
}

function CanvasViewComponent(_props: Props) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow();
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [groupContextMenu, setGroupContextMenu] = useState<{ groupId: string; x: number; y: number } | null>(null);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const viewport = useCanvasStore((s) => s.viewport);
  // 编辑器打开期间禁用 xyflow 的 Delete/Backspace 删节点（与 Shell nokey 双保险，spec 验收 27）
  const editorOpen = useVideoEditorStore((s) => s.open);
  const authUser = (useAuth() as { user?: { id: string; name: string } } | null)?.user;

  // presence：本地用户 + 光标 50ms 节流上报（流坐标）
  useEffect(() => {
    const bridge = getAwareness();
    if (!bridge || !authUser) return;
    bridge.setLocalUser({ id: authUser.id, name: authUser.name });
  }, [authUser]);

  const lastCursorReport = useRef(0);
  const handlePresencePointerMove = useCallback((e: React.MouseEvent) => {
    const bridge = getAwareness();
    if (!bridge) return;
    const now = performance.now();
    if (now - lastCursorReport.current < 50) return;
    lastCursorReport.current = now;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const flow = screenToFlowPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    bridge.setCursor({ x: flow.x, y: flow.y });
  }, [screenToFlowPosition]);
  const projectId = useCanvasStore((s) => s.projectId);
  // Y0b-2 T7：canExecute 硬态（组执行按钮禁用判据——断连/只读/冻结禁执行）
  const canExec = useCanvasStore(canExecute);
  // 锁定=编辑中或 transform 调整中（spec §3 根因修）——selectIsLocked 单源（Spec B editMode
  // 分片：原订阅式/命令式双定义合并，同源 nodeStore.selectIsLocked；语义限定本地视图态，不进 doc）。
  // 与 useGroupKeyboard「模式中」口径对齐（编辑与 transform 互斥，nodeStore.ts:383）。
  // 不修则 transform 期框选第一帧 resetSelectedElements 反选调整中节点 → TransformToolbar 中途消失。
  const isLocked = useNodeStore(selectIsLocked);
  const referenceSelect = useNodeStore((s) => s.referenceSelect);
  const inRefSelect = referenceSelect !== null;
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const updateViewport = useCanvasStore((s) => s.updateViewport);
  const addNode = useCanvasStore((s) => s.addNode);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const lastPointerShiftKey = useCanvasStore((s) => s.lastPointerShiftKey);
  const marqueeSelecting = useCanvasStore((s) => s.marqueeSelecting);
  useTrackCanvasPointerShift(reactFlowWrapper);
  useMarqueeSelectionGuard();
  // B4'-1（Spec B）拖动手势基建：常驻指针监听（键控集合/自愈两道/capture 抑制）+pointerdown
  // 缓存 id（wrapper capture——onNodeDragStart={begin} 以缓存为起始 pointerId）
  const dragGuard = useDragGestureGuard();
  const beginDragGesture = useCanvasStore((s) => s.beginDragGesture);
  // 只读门禁（spec §3.1 8）：canEdit 订阅式消费（viewer 拖动禁用——行为变更随 B4'-1 落地）
  const editable = useCanvasStore(canEdit);
  // B4'-1：onNodeDragStart 单接 begin（第三参 nodes→draggingIds——O0b-3 定案）
  const onNodeDragStart = useCallback(
    (_e: React.MouseEvent, _node: any, nodes: any[]) => beginDragGesture(nodes, dragGuard.pointerIdRef.current),
    [beginDragGesture, dragGuard],
  );
  const toggleCollapse = useCanvasStore((s) => s.toggleCollapse);
  // O0b-5 viewer 折叠本地 override（终裁 58⑥）：GroupToolbar 折叠/展开按钮态读有效折叠态
  const localCollapsed = useCanvasStore((s) => s.localCollapsed);
  const ungroup = useCanvasStore((s) => s.ungroup);
  const convertGroup = useCanvasStore((s) => s.convertGroup);
  const addImageToStoryboardCell = useCanvasStore((s) => s.addImageToStoryboardCell);

  // 素材库「应用到画布」：监听 pendingMediaFile 创建节点或填充分镜格
  useEffect(() => {
    const unsub = useCanvasStore.subscribe((state, prevState) => {
      const file = state.pendingMediaFile;
      const prevFile = prevState.pendingMediaFile;
      const fillCell = state.pendingFillCell;
      if (!file || file === prevFile || !reactFlowWrapper.current) return;

      try {
        // 如果有 pending fill cell，填充分镜格
        if (fillCell) {
          addImageToStoryboardCell(fillCell.groupId, fillCell.cellIndex, file.id);
          useCanvasStore.setState({ pendingFillCell: null });
          return;
        }

        // 否则创建新节点
        const bounds = reactFlowWrapper.current.getBoundingClientRect();
        const centerClientX = bounds.left + bounds.width / 2;
        const centerClientY = bounds.top + bounds.height / 2;

        let position = screenToFlowPosition({
          x: centerClientX,
          y: centerClientY,
        });

        const NODE_DEFAULT_WIDTH = 320;
        const NODE_DEFAULT_HEIGHT = 240;
        position = {
          x: position.x - NODE_DEFAULT_WIDTH / 2,
          y: position.y - NODE_DEFAULT_HEIGHT / 2,
        };

        const isVideo = file.mimeType?.startsWith('video/');
        const nodeType = isVideo ? 'video' : 'image';
        const nodeData = {
          fileId: file.id,
          status: 'done',
          mediaName: file.originalName,
          thumbnailUrl: file.thumbnailUrl,
        };

        addNode(nodeType, position, nodeData);
      } catch (err) {
        console.error('[CanvasView] addMediaNode failed:', err);
      } finally {
        useCanvasStore.setState({ pendingMediaFile: null });
      }
    });

    return () => {
      unsub();
      useCanvasStore.setState({ pendingMediaFile: null, pendingFillCell: null });
    };
  }, [screenToFlowPosition, addNode, addImageToStoryboardCell]);

  // 监听 fill-cell 事件，打开素材库
  useEffect(() => {
    const handleFillCell = (e: Event) => {
      const ce = e as CustomEvent<{ groupId: string; index: number }>;
      const { groupId, index } = ce.detail;
      useCanvasStore.getState().requestFillStoryboardCell(groupId, index);
      useMaterialLibraryStore.getState().open();
    };
    window.addEventListener('storyboard:fill-cell', handleFillCell);
    // 素材库关闭且未消费选图（选图路径先设 pendingMediaFile 再 close）→ 清残留的填充意图
    const unsubLib = useMaterialLibraryStore.subscribe((state, prevState) => {
      if (prevState.isOpen && !state.isOpen) {
        const cs = useCanvasStore.getState();
        if (cs.pendingFillCell && !cs.pendingMediaFile) {
          useCanvasStore.setState({ pendingFillCell: null });
        }
      }
    });
    return () => {
      window.removeEventListener('storyboard:fill-cell', handleFillCell);
      unsubLib();
    };
  }, []);

  const handleReferencePick = useCallback(async (sourceNodeId: string, targetNode: any) => {
    const store = useNodeStore.getState();
    const source = store.nodes[sourceNodeId];
    // AppNode.data 是严格联合（TextNodeData 无 allImages）——断言到拾取所需形状（仓内 CanvasView 既有 data 断言先例）
    const currentImages = (source?.data as { allImages?: ImageItem[] } | undefined)?.allImages ?? [];
    const decision = decideReferencePick(sourceNodeId, targetNode, currentImages.map((i: { id: string }) => i.id), MAX_REFERENCE_IMAGES);
    if (decision.kind === 'ignore') return;
    if (decision.kind === 'full') {
      store.flashReferenceNotice(`最多 ${MAX_REFERENCE_IMAGES} 张参考图`);
      return;
    }
    try {
      const { url } = await getMediaUrl(decision.fileId); // presign（spec §3.3；ImageItem.url 本就是 presign 结果）
      const name = (targetNode?.data?.mediaName as string) || '参考图';
      const latest = (useNodeStore.getState().nodes[sourceNodeId]?.data as { allImages?: ImageItem[] } | undefined)?.allImages ?? [];
      if (latest.some((i) => i.id === decision.fileId)) return; // 双击/连点同图：presign 窗口内第二次点击在此复检去重（写回同步，关闭同用户竞态）
      useNodeStore.getState().updatePromptImages(sourceNodeId, [
        ...latest,
        { id: decision.fileId, url, name, status: 'success' as const },
      ]);
    } catch {
      // presign 失败该次忽略（spec §3.3）
    }
  }, []);

  const onNodeClick = useCallback((_event: any, node: any) => {
    const ns = useNodeStore.getState();
    // 画布参考选择模式（spec §3.3/D25）：elementsSelectable=false 已保发起节点选中，此处只做拾取
    if (ns.referenceSelect) {
      void handleReferencePick(ns.referenceSelect.sourceNodeId, node);
      return;
    }
    if (ns.activeEditNodeId && ns.activeEditNodeId !== node.id) {
      ns.triggerCancelEdit();
    } else if (ns.activeTransformNodeId && ns.activeTransformNodeId !== node.id) {
      ns.triggerCancelTransform();
    } else if (!ns.activeEditNodeId && !ns.activeTransformNodeId) {
      selectNode(node.id);
    }
  }, [selectNode, handleReferencePick]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: any) => {
    if (node.type === 'group') {
      event.preventDefault();
      setGroupContextMenu({ groupId: node.id, x: event.clientX, y: event.clientY });
    }
  }, []);

  const closeGroupContextMenu = useCallback(() => {
    setGroupContextMenu(null);
  }, []);

  // 2d-6：右键「重命名」→ store 瞬态信号 → NormalGroupRenderer 消费进编辑态（与双击共享）
  const handleGroupMenuRename = useCallback((groupId: string) => {
    useCanvasStore.getState().requestGroupRename(groupId);
  }, []);

  const onPaneClick = useCallback(() => {
    closeGroupContextMenu();
    const ns = useNodeStore.getState();
    if (ns.activeEditNodeId) {
      if (!ns.getEditOverlayDragging()) {
        ns.triggerCancelEdit();
      }
    } else if (ns.activeTransformNodeId) {
      ns.triggerCancelTransform();
    } else {
      selectNode(null);
    }
  }, [selectNode, closeGroupContextMenu]);

  // ── handle 拖拽弹菜单（spec 2026-09-26-image-node-panel-redesign §3.3）──
  // 起点经 ref 写入：onConnectEnd 同 tick 读取，避免闭包旧值
  const handleDragStartRef = useRef<{ x: number; y: number; nodeId: string; handleType: string } | null>(null);
  const reconnectingRef = useRef(false);

  const onConnectStart = useCallback((event: MouseEvent | TouchEvent, params: { nodeId: string | null; handleId: string | null; handleType: string | null }) => {
    const p = clientPoint(event);
    handleDragStartRef.current = {
      x: p.x,
      y: p.y,
      nodeId: params.nodeId ?? '',
      handleType: params.handleType ?? '',
    };
  }, []);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    // 重连标志必须在 onConnectEnd 开头复位（spec §3.3 守卫 0：事件序 onReconnectStart→onConnectStart→…→此处）
    const wasReconnecting = reconnectingRef.current;
    reconnectingRef.current = false;
    const dragStart = handleDragStartRef.current;
    handleDragStartRef.current = null;
    if (wasReconnecting || !dragStart) return;

    const p = clientPoint(event);
    const flowPoint = screenToFlowPosition(p);
    const csState = useCanvasStore.getState();
    const nodes = csState.nodes;
    const node = nodes.find((n) => n.id === dragStart.nodeId);
    // isLocked 命令式消费点（原"双定义第二处"，spec §3）：selectIsLocked 单源取当前快照——
    // 与订阅式同口径（编辑中或 transform 调整中），喂 decideHandleMenu——
    // 只改订阅式漏此处会「画布锁了 handle 菜单没锁」。
    const isLockedNow = selectIsLocked(useNodeStore.getState());
    // B6-2（Spec B 撞车①c）：+号命中区（流坐标）——与 AddOutputHandle 渲染同源
    // （resolveAddOutputTarget 单源：canEdit/marquee/折叠/分镜全口径）；源 handle 拖线落+号 ⇒ 零菜单。
    const plusTarget = resolveAddOutputTarget(csState.nodes, {
      marqueeSelecting: csState.marqueeSelecting,
      canEdit: canEdit(csState),
      localCollapsed: csState.localCollapsed,
    });
    const plusFrame = plusTarget ? addOutputFrameFlow(csState.nodes, plusTarget) : null;
    const plusZones = plusFrame ? [addOutputHitZoneFlow(plusFrame, csState.viewport.zoom)] : [];

    const decision = decideHandleMenu({
      reconnecting: wasReconnecting,
      isValid: state?.isValid ?? null,
      toHandle: state?.toHandle ?? null,
      toNode: state?.toNode ?? null,
      nodeType: node?.type,
      isLocked: isLockedNow,
      dragDistancePx: Math.hypot(p.x - dragStart.x, p.y - dragStart.y),
      flowPoint,
      rects: absoluteRectsOf(nodes),
      plusZones,
      nodeId: dragStart.nodeId,
      side: dragStart.handleType === 'target' ? 'target' : 'source',
      clientX: p.x,
      clientY: p.y,
    });
    if (decision.kind === 'open') {
      useMenuStore.getState().openHandleMenu(decision.payload);
    }
  }, [screenToFlowPosition]);

  const onReconnectStart = useCallback(() => { reconnectingRef.current = true; }, []);
  // 双保险复位：Esc 取消重连走 cancelConnection、不触发 onConnectEnd（spec §3.3）；正常结束时紧随其后的重复复位无副作用
  const onReconnectEnd = useCallback(() => { reconnectingRef.current = false; }, []);

  // ── B6-3（Spec B 需求 7）：+号手势终态接线 ──
  // 命中节点=batchConnect（N 条边单 transact）；点击/拖线落空（含 hidden——resolveBatchDropTarget
  // 排除=落空同语义）=建点+连线菜单（拍板②——HandleAddNodeMenu:82-92 同手势先例）。
  const onBatchGestureEnd = useCallback((end: BatchConnectGestureEnd) => {
    const decision = decideBatchGestureEnd(end, screenToFlowPosition);
    if (decision.kind === 'connect') {
      useCanvasStore.getState().batchConnect(decision.sourceIds, decision.targetId);
      return;
    }
    useMenuStore.getState().openBatchMenu({
      x: decision.client.x,
      y: decision.client.y,
      flowPoint: decision.flow,
      sourceIds: decision.sourceIds,
    });
  }, [screenToFlowPosition]);

  const onPaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      useMenuStore.getState().open({ x: event.clientX, y: event.clientY });
    },
    [],
  );

  // 框选拖拽期 UI 抑制信号（spec §5-1）：onSelectionStart 触发点在 resetSelectedElements 与首次
  // triggerNodeChanges 之前的同一同步体——标志必然先于选中态变化落入同一 React 批次。
  const onSelectionStart = useCallback(() => {
    useCanvasStore.setState({ marqueeSelecting: true });
  }, []);
  const onSelectionEnd = useCallback(() => {
    useCanvasStore.setState((s) => (s.marqueeSelecting ? { marqueeSelecting: false } : s));
  }, []);

  // 锁定态中键特例闸门（spec §3 六修）：system:2824 的 node/edge 中键放行先于 !panOnDrag/nopan
  // 一切判定（含 :2846 nopan——nopan 对该路径不可达，非可替代修法）；capture 先于 renderer 的
  // d3 冒泡 listener，stopPropagation 使锁定态中键手势无法启动。副作用：事件在 React root capture
  // 内被止后不再到达 root 下任何合成处理器（含 MiniMap/portal 内中键 mousedown）——锁定态中键
  // 本无合法语义，无害。非锁定中键平移（合法路径）不受影响。
  const handleWrapperMouseDownCapture = useCallback((e: React.MouseEvent) => {
    if (isLocked && e.button === 1) e.stopPropagation();
  }, [isLocked]);

  const isValidConnection = useCallback((connection: Connection) => {
    // No self-connections
    if (connection.source === connection.target) return false;
    return true;
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow');
      if (!type || !reactFlowWrapper.current) return;
      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      addNode(type, { x: position.x - 125, y: position.y - 30 });
    },
    [addNode, screenToFlowPosition]
  );

  // Ctrl/Cmd+wheel 守卫（spec §5-3）：缩放步进已删——xyflow 内建 Ctrl 缩放是唯一 writer（双 writer
  // 双倍缩放从根消除）。守卫真实价值=①覆盖 #node-toolbar-portal（.react-flow 兄弟节点，d3 wheel
  // 挂 renderer 上不可见）②防御性兜底；范围收窄到画布内（wrapper 外恢复浏览器整页缩放）。
  // preventDefault 不阻断 d3（d3 不查 defaultPrevented），守卫不损伤库内缩放。
  // 锁定态口径：删除原 if (isLocked) return 后，锁定态 Ctrl+滚轮=仅 d3 旁路一次缩放
  // （zoomScroll = zoomActivationKeyPressed || zoomOnScroll 覆盖 false，§7 登记旁路）——
  // 与今天锁定态行为一致（今天 d3 一次 + JS 步进被 isLocked 挡 = 一次），非缺陷、无回归。
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (reactFlowWrapper.current?.contains(e.target as Node)) e.preventDefault();
    };
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => document.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  const handleFitView = useCallback(() => {
    fitView({ duration: 300, padding: 0.2 });
  }, [fitView]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    useMenuStore.getState().updateMousePos({ x: e.clientX, y: e.clientY });
  }, []);

  // B5'-2（Spec B 终裁 38①/24/17）：单一路由 handleDragRelease——旧拖入组路由一条链（stop 提交+
  // 旧落组判定[utils/groupDrop 模块已整删]）整链删除，冻结帧+交叠面积裁决与位置提交（commitIntents
  // 构造单源）全部收进 store action；RF 顺序注记：尾批（dragging:false）先于本回调落 session 内
  // 零告警；session 清后 heal 再触发=no-op（B5'-1 同款）。
  const handleDragRelease = useCanvasStore((s) => s.handleDragRelease);

  // 选中组节点时显示 GroupToolbar；多选（≥2）、Shift 加选意图或框选拖拽中不显示（spec §5-1 消费点 2）
  const selectedGroup = useMemo(() => {
    let count = 0;
    for (const n of nodes) {
      if (!n.selected) continue;
      count++;
      if (count > 1) return undefined;
    }
    return count === 1 && !lastPointerShiftKey && !marqueeSelecting
      ? nodes.find((n) => n.type === 'group' && n.selected)
      : undefined;
  }, [nodes, lastPointerShiftKey, marqueeSelecting]);

  // 计算组是否可转为分镜组：仅当普通组且子节点全部是完成图片节点时
  const isConvertible = useMemo(() => {
    if (!selectedGroup) return true;
    const gd = selectedGroup.data as any;
    if (gd.groupType === 'storyboard') return true;
    const children = nodes.filter((n) => n.parentId === selectedGroup.id);
    // 默认 convertible=true（T7 测试不传 prop）；仅当明确不满足时置 false
    return children.length === 0 || children.every(isImageCompletedNode);
  }, [selectedGroup, nodes]);

  // 计算组内是否有节点正在执行（响应式订阅）
  const groupExecuting = useCanvasStore((s) =>
    selectedGroup ? s.nodes.filter((n) => n.parentId === selectedGroup.id).some((n) => n.id in s.nodeProcessMap) : false
  );

  // C8 D2：colorMode 跟随全局主题翻转（CanvasView 是 colorMode 源头、唯一 useTheme 例外——节点/面板组件禁 useTheme，spec §11.1）
  const { mode } = useTheme();

  return (
    <div
      ref={reactFlowWrapper}
      className="w-full h-full overflow-hidden"
      onMouseMove={handleMouseMove}
      onMouseDownCapture={handleWrapperMouseDownCapture}
      onPointerDownCapture={dragGuard.onPointerDownCapture}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange as OnNodesChange}
        onEdgesChange={onEdgesChange as OnEdgesChange}
        onConnect={onConnect as any}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        isValidConnection={isValidConnection as any}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={viewport}
        onViewportChange={updateViewport}
        onMouseMove={handlePresencePointerMove}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onSelectionStart={onSelectionStart}
        onSelectionEnd={onSelectionEnd}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={handleDragRelease}
        deleteKeyCode={isLocked || editorOpen || inRefSelect ? [] : ['Backspace', 'Delete']}
        multiSelectionKeyCode="Shift"
        minZoom={0.2}
        maxZoom={3}
        fitView={false}
        zoomOnScroll={!isLocked}
        panOnDrag={isLocked ? false : inRefSelect ? true : PAN_ON_DRAG_MIDDLE}
        selectionOnDrag={!isLocked}
        selectionMode={SelectionMode.Partial}
        panActivationKeyCode={isLocked ? null : 'Space'}
        zoomOnDoubleClick={!isLocked}
        nodesDraggable={inRefSelect ? false : !isLocked && editable}
        nodesFocusable={!isLocked}
        elementsSelectable={inRefSelect ? false : !isLocked}
        snapToGrid={snapEnabled}
        snapGrid={SNAP_GRID}
        noWheelClassName="nowheel"
        proOptions={{ hideAttribution: true }}
        className="bg-[var(--canvas-board-bg)]"
        // C8 D2：colorMode 跟随主题翻转（深浅档各挂 .dark/.light 运行时类驱动 xyflow 皮肤变量；与 .light 令牌岛撞名风险由镜像断言守卫——wrapper 主题类恰一个且等于 html 类）；对齐 ProcessSnapshot
        colorMode={mode}
      >
        {/* bgColor="transparent"：钉死 .react-flow__background 底色（dark 皮肤默认会给 #141414 染灰整块板面，与修复前 transparent 不一致） */}
        <Background variant={BackgroundVariant.Dots} color="var(--canvas-board-dot)" gap={16} size={1} bgColor="transparent" />
        {minimapOpen && (
  <MiniMap
    style={{
      width: 160,
      height: 120,
      // C8 D3-board：底/边双值化（深档 50→38/70→51 可见变暗——minimapOpen 默认 false 采集态不渲染，adjudications 登记）
      backgroundColor: 'var(--canvas-controls-bg)',
      border: '0.5px solid var(--canvas-controls-border)',
      borderRadius: '8px',
    }}
    // nodeColor 落 SVG 属性禁 var()——JS 分支取色（深 160 字面不变零 diff；浅 #6b7280 与 controls-icon 浅值同源）
    nodeColor={() => (mode === 'dark' ? 'rgb(160, 160, 160)' : 'rgb(107, 114, 128)')}
    maskColor="rgba(0, 0, 0, 0.35)"
  />
)}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {getAwareness() && <RemoteCursorsLive />}
        </div>
        <CanvasToolbar
          zoom={viewport.zoom}
          onFitView={handleFitView}
          onZoomIn={() => zoomIn({ duration: 100 })}
          onZoomOut={() => zoomOut({ duration: 100 })}
          minimapOpen={minimapOpen}
          onToggleMinimap={() => setMinimapOpen((v) => !v)}
          snapEnabled={snapEnabled}
          onToggleSnap={() => setSnapEnabled((v) => !v)}
        />
        <CanvasReferenceSelectBanner />
        <SelectionBoxOverlay />
        {/* B6-2（Spec B 需求 6）：+号输出按钮——多选框/普通组批量连线入口（B6-3 手势语义经 onGestureEnd 接线） */}
        <AddOutputHandle onGestureEnd={onBatchGestureEnd} />
        <StoryboardTitlesLayer />
        {selectedGroup && (() => {
          const gd = selectedGroup.data as any;
          const groupType = gd.groupType ?? 'normal';
          const cfg = resolveStoryboardConfig(gd);

          const noOp = () => {};

          const handleUngroup = () => {
            ungroup(selectedGroup.id);
          };

          const handleConvert = (target: 'normal' | 'storyboard') => {
            convertGroup(selectedGroup.id, target);
          };

          if (groupType === 'storyboard') {
            const confirmClear = () => {
              Modal.confirm({
                title: '清空分镜组',
                content: '将删除组内全部图片节点，此操作不可恢复',
                okButtonProps: { danger: true },
                onOk: () => {
                  useCanvasStore.getState().clearStoryboard(selectedGroup.id);
                },
              });
            };

            const updateStoryboardConfig = (patch: Partial<StoryboardConfig>) => {
              useCanvasStore.getState().updateStoryboardConfig(selectedGroup.id, patch);
            };

            const resizeStoryboardGrid = (rows: number, cols: number) => {
              useCanvasStore.getState().resizeStoryboardGrid(selectedGroup.id, rows, cols);
            };

            // 工具条行分隔（§4.3 与 GroupToolbar normal 分支 Sep 同规格）
            const toolbarSep = <span style={{ color: 'var(--canvas-controls-icon)', padding: '0 4px' }}>│</span>;

            // 批量下载（2d-7 需求 8：收集集=分镜组闭包即 cells 节点 fileId）——GroupToolbar normal 分支
            // 同款双侧最小视图桥；点击时读 ns 非订阅（无 aria-disabled 反应式需求，空集静默不触发）
            const handleStoryboardBatchDownload = () => {
              const nsRecords: Record<string, CanvasNodeRecord> = {};
              for (const [id, n] of Object.entries(useNodeStore.getState().nodes)) {
                nsRecords[id] = { id: n.id, type: n.type, position: { x: 0, y: 0 }, data: n.data as unknown as Record<string, unknown> };
              }
              const items = collectDownloadables(
                nodes.map((n) => ({ id: n.id, type: n.type!, parentId: n.parentId, position: n.position, data: n.data })),
                [selectedGroup.id],
                () => nsRecords,
              );
              if (items.length === 0) return;
              void runBatchDownload(items);
            };

            const indexBtn = (enabled: boolean): React.CSSProperties => ({
              background: enabled ? 'rgba(74,222,128,0.15)' : 'none',
              border: 'none',
              color: enabled ? 'var(--fw-accent-text)' : 'var(--fw-text-dim-3)', // C8 D3-board：两分支主题化（浅档白字白底不可见；accent 深值字节等值）
              fontWeight: enabled ? 600 : 'normal',
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: 13,
              cursor: 'pointer',
            });

            const btn = (disabled?: boolean): React.CSSProperties => ({
              background: 'none', border: 'none', color: disabled ? '#666' : '#fff',
              padding: '6px 10px', borderRadius: 6, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
            });

            return (
              <GroupToolbar
                groupId={selectedGroup.id}
                groupType="storyboard"
                executing={groupExecuting}
                onExecute={noOp}
                onUngroup={handleUngroup}
                onConvert={(id, target) => convertGroup(id, target)}
              >
                <AspectRatioDropdown
                  value={cfg.aspectRatio}
                  onChange={(v) => updateStoryboardConfig({ aspectRatio: v })}
                  executing={groupExecuting}
                />
                <GridSizeDropdown
                  rows={cfg.gridRows}
                  cols={cfg.gridCols}
                  onChange={(r, c) => resizeStoryboardGrid(r, c)}
                  executing={groupExecuting}
                />
                {toolbarSep}
                <StitchButton
                  groupId={selectedGroup.id}
                  resolution={cfg.stitchResolution}
                  onResolutionChange={(v) => updateStoryboardConfig({ stitchResolution: v })}
                  running={false}
                />
                <button
                  style={indexBtn(cfg.showIndex)}
                  onClick={() => updateStoryboardConfig({ showIndex: !cfg.showIndex })}
                >
                  № 序号
                </button>
                <button style={btn(false)} onClick={confirmClear}>
                  🗑 清空
                </button>
                <button
                  style={btn(groupExecuting)} disabled={groupExecuting}
                  onClick={() => !groupExecuting && handleConvert('normal')}
                >
                  转普通组
                </button>
                {toolbarSep}
                <button style={btn(false)} onClick={handleStoryboardBatchDownload}>
                  批量下载
                </button>
                <button
                  style={btn(groupExecuting)} disabled={groupExecuting}
                  onClick={() => !groupExecuting && handleUngroup()}
                >
                  ⧉ 解组
                </button>
              </GroupToolbar>
            );
          }

          // normal group
          return (
            <GroupToolbar
              groupId={selectedGroup.id}
              groupType="normal"
              collapsed={localCollapsed[selectedGroup.id] ?? !!gd.collapsed}
              executing={groupExecuting}
              canExecute={canExec}
              onCollapse={toggleCollapse}
              onExecute={async (groupId) => {
                const childIds = nodes.filter((n) => n.parentId === groupId).map((n) => n.id);
                if (childIds.length > 0 && projectId && canExec) {
                  void executeGroupNodes(projectId, childIds);
                }
              }}
              onUngroup={handleUngroup}
              onConvert={(id, target) => convertGroup(id, target)}
              convertible={isConvertible}
            />
          );
        })()}
      </ReactFlow>
      {/* 工具条 Portal 挂载点：最高层级，不拦截鼠标事件 */}
      <div
        id="node-toolbar-portal"
        className="absolute inset-0 pointer-events-none z-50"
      />
      <ConfirmModal />
      {groupContextMenu && (
        <GroupContextMenu
          groupId={groupContextMenu.groupId}
          x={groupContextMenu.x}
          y={groupContextMenu.y}
          onRename={handleGroupMenuRename}
          onClose={closeGroupContextMenu}
        />
      )}
    </div>
  );
}

export const CanvasView = memo(CanvasViewComponent);
