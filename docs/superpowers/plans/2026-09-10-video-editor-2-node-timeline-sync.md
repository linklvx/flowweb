# 视频剪辑器 Plan 2/4：VideoEditNode 全链路注册 + timeline 纯函数 TDD + 时间轴 UI + 连线同步 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 视频剪辑节点成为画布一等公民（接管 composite 死入口），落地 timeline 全部纯函数（公式/吸附/重叠/时间码/历史/连线对账）、normalized 编辑器 store、多轨时间轴 UI、自动连线 origin 隔离（syncAutoEdgesToDoc + 订阅跳前缀 + onRemote shadow- 短路）。

**Architecture:** spec v3.6（docs/superpowers/specs/video-editor.md）附录 B 阶段 2+3+4。前端 monorepo apps/web（React18 + TS strict + zustand4 + antd5 + Tailwind preflight:false + @xyflow/react + Yjs/Hocuspocus 协作）。timeline 纯函数为 TDD 主战场（帧整数真相/浮点纪律/可测性红线——组件只绑 pointer 事件）；编辑器数据走 Prisma PATCH 通道不进画布 Yjs store；auto 边是唯一进 Yjs 的剪辑器痕迹，独立 origin（AutoEdge）隔离撤销栈。

**Tech Stack:** 既有栈零新依赖（mediabunny 等已装，本 plan 不用）；Plan 1 后端 8 端点已就绪。

> **R1 轮审核修订（2026-09-10）**：采纳 P0-3（吸附等距用例重写）/P0-4 部分（Task 6 mk() 类型修复 + Task 17 补 tsc -b——vitest esbuild 不查类型）/P1-1（canvasStore.test 补 vi.mock）/P1-2（isShadowOnlyEvents 测试改 hit 末值 + 事件形状固化用例，删"以测试为准"免责）/P1-3（跨轨拖动落地实现 + 键盘挂载点定死 TimelinePanel）/P2-2（团队素材占位 + drop handler 归属上提）/P2-3（deleteTransformNode 登记）。**驳回**：P0-1 修法（Δ=-100 时 duration=10-(-100)=110 随左拉增大，非审核算的 -90——负 duration 在 Δ>0 侧且 maxDelta 已防；审核 Math.max(sourceLimit, MIN_FRAME_SEC-duration) 会错误限制 sourceStart 富余片段的左拉）；P0-2 判定（实现与测试是同一浮点表达式位级相等，toBe 必过；仍改 toBeCloseTo 作防御）；P0-4 的 Task 3/5 两处（vc() 已显式标注返回类型；canPlaceAt 参数在签名上下文约束下自动收窄——均不报错）；P2-1（spec v3.6 附录 B 明文"不是扩展现有 union——新增类型自律"，union 不动是 spec 定案）。**审核引出的相邻真修复**：trimLeftGuard 补 `-start` 时间轴 0 点下界（start+Δ ≥ 0 原无约束，顺带封住无源片 sourceLimit=-Infinity 的无限左拉缺口）。
>
> **R2 轮审核修订（2026-09-10，R1 四条驳回复核全部维持）**：采纳 P0-A（handleClipDrop 的 assets 悬空引用消除——dragStart payload 自带 originalName/durationSec，TimelinePanel 零 assets 依赖零双请求，Files 补 TimelinePanel.tsx）/P1-A（TrackRow 三 prop 传递正文化——原注释式传递下"字幕轨 ➕"用例必红）/P1-B（restoreAllMocks 收口 afterEach + window 监听常驻 useEffect 化含卸载清理——收起/切工程不泄漏）/P1-C 前半（tsc -b 前移 Task 1 Step 8 首验）/P2-1（无源片左拉 -Infinity 边界回归用例）。**驳回** P1-C 后半（"本会话无 preview_* 工具"——审核沙箱与执行会话是两个环境，执行会话工具清单确含 preview_* 组；措辞已改为"执行会话具备 + 缺失时降级"消除歧义）。**本轮自修**：`Math.max(-100, -0)` 返回 `-0` 而 vitest toBe 是 Object.is 语义（-0 ≠ 0）——R1 新增的 `toBe(0)` 用例改 `toBeCloseTo(0, 10)`。
>
> **R3 轮审核修订（2026-09-10，R2 五项半采纳全部复核为真采纳，无阻塞项）**：P0-A 修复的根因收口——修复只落散文未落实现块与断言。采纳 P3-1（AssetPanel 主实现块 onDragStart 同步 5 字段 payload，散文段去重、主实现块为唯一权威版本）/P3-2（drop 用例 payload 补 originalName/durationSec + duration=8 与 mediaInfo toMatchObject 两条断言——P0-A 由此获得锁力）/P3-3（TimelinePanel import 增量块 + `useEditorKeyboard()` 可粘贴实现行 + onDropClip 显式 `undefined /* Task 16 接通 */`）/P2×3（trimLeftGuard 的 minDelta `-0` 归一 `+0`；DragState 快照 `startPxPerSec`——拖拽全程固定比例尺，消除 useEffect([]) 闭包旧值；TrackRow 无效占位 div 删除，改轨道体 `minWidth` 对齐标尺——原占位是 absolute 不撑宽，真问题是超宽片段被滚动区裁掉）。
>
> **R4 轮审核修订（2026-09-10，R3 六项复核全部真采纳）**：采纳 P1-1 方案 A（决策 6 第一优先级补齐代码路径——AssetItem.nodeDurationSec 承载节点 data.duration，payload 取 `nodeDurationSec ?? metadata.durationSec`；测试向量节点 5s/素材 metadata 8s 双值分解——原 duration:8 与 durationSec:8 同值巧合掩盖优先级缺失；修法机制修正：dragStart 用例锁优先级解析、drop 用例锁消费契约，两侧独立回归可定位）。P2-1（Task 15 useEffect 块移至两监听函数定义之后——运行期无 TDZ 风险，防执行者误判自作重排）/ P2-2（overlap.ts intervalsOverlap 死代码删除——canPlaceAt 内联求交返回重叠量非布尔，helper 语义不可复用只能删）/ P2-3（Task 14 TimelinePanel 删未用 dur 与 totalDuration/timeToPx 孤儿 import——R3 删占位 div 后遗留；onWheel 锚定注释改 Plan 3；顺带补 Task 15 import 增量块 view-scale 五函数 + CLIP_BLOCK_MIN_PX + Clip 类型，Task 16 增量相应收敛为 quantizeTime）。

**测试命令：** `pnpm -C apps/web test`（vitest run + tsc）；单文件 `pnpm -C apps/web exec vitest run src/stores/canvasStore.test.ts`

> **执行期修订（subagent-driven 执行中，quality review 回写）**：Task 1 quality review 两项 Important 采纳——(1) canvasStore `videoEdit → width:320` 分支补单测（照 textInput width=300 先例，canvasStore.test.ts）；(2) VideoEditNode 选中态从紫边 `#6C5CE7` 对齐既有节点统一灰 ring（`border transparent + boxShadow 0 0 0 3px #9CA3AF`——兄弟节点 VideoGenNode/AudioGenNode/MultiImageNode 同构，spec 未规定节点本体选中色，同一画布同一交互语义必须视觉一致；Task 1 空壳与 Task 10 完整版代码块均已同步）。Task 17 验收表增"新建节点落点无偏移"项。
>
> **Task 3 执行期修正（2026-09-10，计划测试向量笔误 + 量化强化，控制器 node 验算批准）**：(a) quantizeTime(0.1+0.2,30) 期望 0.1→0.3（输入≈0.3s=9 帧，0.1 是 3 帧笔误）；(b) sourceTime 0.5× 档期望 2.5→3（公式 2+(3-1)*0.5）；(c) 100 次不漂移用例初始 duration 100→5（100 时终值 96.67 断言 50/FPS 必红）；(d) applyTrimLeft/Right 从"仅量化 Δ"升级为"成片时间结果每步量化回帧网格"（50 次累加 1/30 漂至 …685≠50/30，帧整数红线强制；sourceStart 保持连续浮点）；(e) -0 用例 toBeCloseTo→toBe(0)（R3 归一化落地后 toBeCloseTo 失去锁力，变异验证 toBe(0) 在删除归一化时必红——quality review I1）；(f) splitClipAt keyframes 访问 as any（SubtitleClip 无 keyframes 字段——shared 类型实形）。四轮审核均未抓到 (a)(b)(c)——数值验算须逐条执行，结构审查不可替代。M 级登记：splitClipAt 不校验切点范围（Task 9 store 侧已有 1 帧两侧校验承担）；前片 keyframes 未克隆（history JSON 深拷已隔离别名）。
>
> **Task 5 执行期修正（2026-09-10，quality review I1 语义级修复）**：canPlaceAt 从"只看被放置片 transitionIn"重写为 **后片单侧 allowed**（spec 重叠规则原文：转场由后片 start 较大者的 transitionIn crossfade 单侧表达）——原实现有误放行（前片带 crossfade 与无转场后片重叠入库 → Plan 3 将渲染无转场双曝光）与误拒绝（对手后片带 crossfade 的合法前片靠近被弹开）双向缺陷，quality review 实证脚本确认。第 6 参更名 placedClip（形状不变，Task 9 moveClip 传 clip 对象兼容）。补测：后片视角重写 crossfade 用例 + 前片误放行/误拒绝双向 + I1 原始场景锁断言 + 自排除/左扫分支 + effOut 保留正路径 + audio 早退（13→19 用例）。附带：crossfadePredecessor audio/subtitle 早退窄化消除一处 as any。**Task 9 契约登记**：canPlaceAt 无 start≥0 下界（findNearestFreeStart 仅 left 侧守卫）——editorStore 调用方负责 clamp（Task 15 拖拽 Math.max(0, snapped.time) / Task 16 drop Math.max(0, pxToTime) 已承担）。

**本 plan 边界（不做，留 Plan 3/4）：** 预览播放/主时钟/audio-engine/scene 纯函数（Plan 3）；右面板四态/转场关键帧编辑 UI/变速 UI/真波形数据（Plan 3，本 plan 落 store 与纯函数基础）；节点本体迷你播放（Plan 3，按钮 disabled 占位）；导出/产物节点上画布/socket 单例迁移/AI 三按钮（Plan 4）。

**关键决策（写代码前必读）：**

1. **nodeTypeMap 不加 composite 映射**——AddNodeMenu 菜单项 type 直接改 `videoEdit`（canvasStore.addNode L171 `nodeTypeMap[type] || type` 透传）；开发期无存量 composite 节点（无用户数据，不做兼容）。
2. **autoEdgeId 三函数放 `stores/autoEdgeIds.ts`**（零依赖纯函数）——协作桥（stores/）与编辑器（pages/canvas/video-editor/）共用，避免 stores→pages 反向依赖；依赖 ProjectData 的对账逻辑（planAutoEdgeOps/ensureAutoEdges）才放 pages/canvas/video-editor/timeline/auto-edges.ts。
3. **syncAutoEdgesToDoc 导出签名为 `(d: Y.Doc) => void`**——spec"无参"指无需 editNodeId 业务参数（id 自编码）；显式传 doc 为可测性（模块级 doc 单例无法注入）。幂等全量对账：store 侧 auto 边为期望态，doc 补齐增删。
4. **onRemote shadow- 短路抽纯函数 `isShadowOnlyEvents(events, nodesMap)`**——机制认知直接引用 Plan 1 Task 9 固化结论：Yjs transaction.origin 不跨网络传输（update 二进制不含 origin），跨网判据必须用节点 id 前缀 `shadow-`；本任务为 spec 步骤 8 的"影子 origin onRemote 短路"**前移**（桥层改造一次到位，Plan 4 A1 直接消费，理由：与本 plan 订阅分流改造同文件同机制，拆开会造成 canvasCollabRuntime 两轮改动回归面翻倍）。
5. **编辑器历史模式**：非 transient 操作（增删片/分割/轨道/更新）自动 push 前态快照；拖拽/trim 的 rAF 高频修改走 `beginTransient()/transient setter/endTransient()`——pointerup 时一次 push（spec 第五节事务性）。历史快照 JSON 深拷（对齐 Plan 1 A1 克隆口径，structuredClone 对非常规值可能抛 DataCloneError）。编辑器 commit 点调 `stopCapturing()`（防画布 500ms 合并窗错误并栈）。
6. **素材时长来源**：节点 data.duration（生成时配置）优先 → media metadata.durationSec 兜底 → 都无则 5s 默认且 trim 右缘不设限（guard 用 Infinity）。链路载体（R4 审核 P1-1：第一优先级必须有代码路径，不可只停在决策文字）：useWorkflowAssets 产出 `AssetItem.nodeDurationSec`（读 owner 节点 data.duration）→ AssetPanel dragStart payload `durationSec: nodeDurationSec ?? metadata.durationSec` → drop 侧 setMediaInfo → addClip 消费。写入 editorStore.mediaInfo，资产面板加载时填充。
7. **时间轴工具行**（撤销/重做/分割/删除）放时间轴面板顶部——spec 第四节控制条属中上预览区（Plan 3 出现后按 spec 布局整合），Plan 2 先保证数据操作可用。
8. **title 决策**：upsert 传固定 `'多轨剪辑'`（一期无节点名字段可取、不做重命名）。

---

## 文件结构总览

```
apps/web/src/
├── stores/
│   ├── autoEdgeIds.ts                    # [新建] autoEdgeId/autoOutEdgeId/isAutoEdgeId（Task 8）
│   ├── videoEditorStore.ts               # [新建] 编辑器 open 态（Task 2）
│   ├── canvasStore.ts                    # [改] addNode width:320 / addEdge 可选 id / removeEdge / onConnect 判重（Task 1/8）
│   ├── canvasUndo.ts                     # [改] Origin 扩 AutoEdge（Task 13）
│   └── canvasCollabRuntime.ts            # [改] 订阅跳 auto 前缀/syncAutoEdgesToDoc/onRemote shadow 短路（Task 13）
├── api/
│   ├── videoProjectApi.ts                # [新建] upsert/getByNode/patch（Task 12）
│   └── mediaApi.ts                       # [改] +batchGetMedia（Task 16）
├── hooks/useGroupKeyboard.ts             # [改] isGroupEditContext 加编辑器 open 早退（Task 11）
├── components/BaseFullscreenModal.tsx    # [改] +closeOnBackdrop 开关（Task 11）
├── pages/canvas/
│   ├── page.tsx                          # [改] 挂载 VideoEditorShell（Task 11）
│   ├── components/CanvasView.tsx         # [改] nodeTypes 注册（Task 1）
│   ├── components/AddNodeMenu.tsx        # [改] composite → videoEdit（Task 1）
│   ├── components/nodes/VideoEditNode.tsx# [新建] 剪辑节点本体（Task 1 空壳 → Task 10 完整）
│   └── video-editor/
│       ├── types.ts                      # [改] +Clip union/VideoEditNodeData（Task 1）
│       ├── capabilities.ts               # [新建] WebCodecs 能力检测（Task 2）
│       ├── timeline/
│       │   ├── clip-math.ts              # 帧量化/变速/trim/分割公式（Task 3）
│       │   ├── view-scale.ts             # 像素↔秒/吸附/命中（Task 4）
│       │   ├── overlap.ts                # 同轨重叠/crossfade 状态机/放置（Task 5）
│       │   ├── timecode.ts               # HH:MM:SS:FF/M:SS/totalDuration（Task 6）
│       │   ├── waveform.ts               # peaksFromAudioBuffer（Task 6）
│       │   ├── history.ts                # 历史栈（Task 7）
│       │   └── auto-edges.ts             # planAutoEdgeOps/ensureAutoEdges（Task 8）
│       ├── store/editorStore.ts          # normalized store + undo/redo（Task 9）
│       ├── persist/autosave.ts           # 防抖/单飞/三态/重试/离线/flush（Task 12）
│       ├── hooks/useEditorKeyboard.ts    # 编辑器内 Delete/Ctrl+Z/空格（Task 15）
│       └── components/
│           ├── VideoEditorShell.tsx      # 全屏外壳 + 布局（Task 11）
│           ├── EditorTopBar.tsx          # 顶栏三态（Task 12）
│           ├── AssetPanel.tsx            # 左面板资产库（Task 16）
│           ├── PreviewPlaceholder.tsx    # 预览占位（Task 11）
│           └── timeline/
│               ├── TimelinePanel.tsx     # 静态渲染（Task 14）+ 交互（Task 15）
│               ├── TimelineRuler.tsx
│               ├── TrackRow.tsx
│               └── ClipBlock.tsx
```

---

### Task 1: videoEdit 类型全链路注册 + VideoEditNode 空壳 + ydoc 往返实测

spec 附录 B"新类型全链路注册清单"逐项落地。执行白名单后端两处已在 Plan 1 Task 8 完成（isExecutableNode），本 plan 无后端改动。

**Files:**
- Modify: `apps/web/src/pages/canvas/components/AddNodeMenu.tsx:95`（菜单项改写）
- Modify: `apps/web/src/pages/canvas/components/AddNodeMenu.test.tsx:65,107-113`（用例同步）
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx:22-48`（import + nodeTypes）
- Modify: `apps/web/src/stores/canvasStore.ts:183-186`（addNode width:320）
- Create: `apps/web/src/pages/canvas/components/nodes/VideoEditNode.tsx`（空壳，Task 10 完整化）
- Modify: `apps/web/src/pages/canvas/video-editor/types.ts`（+Clip union/VideoEditNodeData）
- Test: `apps/web/src/collab/ydocBuilder.test.ts`（+videoEdit 往返用例）

- [ ] **Step 1: AddNodeMenu 菜单项改写（接管 composite 死入口）**

[AddNodeMenu.tsx](apps/web/src/pages/canvas/components/AddNodeMenu.tsx) L95 整行替换：

```tsx
  { type: 'videoEdit', label: '多轨道剪辑', desc: '多轨剪辑视频/音频/字幕', icon: <CompositeIcon /> },
```

（badge: 'Beta' 移除。）同时删除 L197 的 TODO 注释行 `// TODO: 后端支持 videoComposite 类型后改为 item.type 直接映射`（已直接映射）。

- [ ] **Step 2: AddNodeMenu.test.tsx 用例同步改写**

L65 `expect(screen.getByText('视频合成')).toBeInTheDocument();` 改为：

```tsx
    expect(screen.getByText('多轨道剪辑')).toBeInTheDocument();
```

L107-113 composite 用例整体替换为：

```tsx
  it('calls addNode with "videoEdit" when clicking video-edit menu item', () => {
    const onClose = vi.fn();
    render(<AddNodeMenu isOpen={true} onClose={onClose} triggerRef={{ current: null }} />);
    fireEvent.click(screen.getByText('多轨道剪辑'));
    expect(mockAddNode).toHaveBeenCalledWith('videoEdit', expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });
```

（菜单总数仍 8 项：7 节点 + 1 上传，既有 `menuItems.length === 8` 计数用例不需改。）

- [ ] **Step 3: video-editor/types.ts 补 Clip union 与节点 data 类型**

```ts
// apps/web/src/pages/canvas/video-editor/types.ts（在既有 re-export 之后追加）
export * from '@flowweb/shared';
import type { VideoClip, ImageClip, AudioClip, SubtitleClip } from '@flowweb/shared';

/** 四类片段联合——timeline 纯函数/store 的统一操作对象 */
export type Clip = VideoClip | ImageClip | AudioClip | SubtitleClip;

/** 剪辑节点自身 data（一期基本为空——工程数据在 VideoProject 表，节点 id 先于工程存在） */
export interface VideoEditNodeData {
  title?: string;
  [key: string]: unknown;
}
```

> **R1 审核 P2-1 登记（union 不动是 spec 定案）**：spec v3.6 附录 B 原文"新增 VideoEditNodeData 类型并在节点内收敛（nodeStore 无集中 NodeData 联合……是新增类型自律，**不是扩展现有 union**）"——VideoEditNodeData 收敛在 video-editor/types.ts 供组件自律使用，nodeStore.ts L171 的 NodeData 联合**刻意不加成员**（组件普遍 as any 现状下加 union 无编译收益，反增维护面）。

- [ ] **Step 4: VideoEditNode 空壳组件（最小组件，保证 nodeTypes 注册即可渲染）**

```tsx
// apps/web/src/pages/canvas/components/nodes/VideoEditNode.tsx
import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { NodeHandle } from './NodeHandle';

function VideoEditNodeComponent({ id, selected }: NodeProps) {
  return (
    <div className="relative canvas-node" data-testid={`video-edit-node-${id}`}>
      <div
        className="bg-white rounded-lg overflow-hidden box-border"
        style={{
          width: 316,
          border: '1px solid #E5E7EB',
          margin: 2,
          ...(selected ? { border: '1px solid transparent', boxShadow: '0 0 0 3px #9CA3AF' } : {}),
        }}
      >
        <NodeHandle type="target" testId="video-edit-target" />
        <div className="px-3 py-2 text-[14px] font-medium text-[#1F2329]">多轨道剪辑</div>
        <NodeHandle type="source" testId="video-edit-source" />
      </div>
    </div>
  );
}

export const VideoEditNode = memo(VideoEditNodeComponent);
```

- [ ] **Step 5: CanvasView 注册 nodeTypes**

[CanvasView.tsx](apps/web/src/pages/canvas/components/CanvasView.tsx)：import 区（L22-28 附近）加 `import { VideoEditNode } from './nodes/VideoEditNode';`；nodeTypes 对象（L40-48）加一行 `videoEdit: VideoEditNode,`（`as any` 断言保持不动）。

- [ ] **Step 6: canvasStore.addNode 显式 width:320**

[canvasStore.ts](apps/web/src/stores/canvasStore.ts) L183-186 的 `if (resolvedType === 'textInput') {...}` 块之后追加：

```ts
    if (resolvedType === 'videoEdit') {
      node.width = 320; // spec：产物位置 fallback 链（measured→width→300）会落到 300 导致首渲染偏移
    }
```

- [ ] **Step 7: ydocBuilder 往返测试（新类型刷新还原保障，注册清单要求项）**

[ydocBuilder.test.ts](apps/web/src/collab/ydocBuilder.test.ts) 文件末尾追加 describe（沿用该文件既有 `new Y.Doc() + fillDoc + readCanvasFromDoc` 模式）：

```ts
describe('videoEdit 新类型往返（刷新还原保障）', () => {
  it('fillDoc → readCanvasFromDoc 逐键还原（type/width/position/data）', () => {
    const doc = new Y.Doc();
    fillDoc(doc, [{
      id: 'n1', type: 'videoEdit', parentId: null,
      position: { x: 100, y: 200 }, width: 320, height: null,
      data: { title: '工程' },
    } as any], []);
    const r = readCanvasFromDoc(doc);
    const n = r.nodes.find((x: any) => x.id === 'n1') as any;
    expect(n.type).toBe('videoEdit');
    expect(n.width).toBe(320);
    expect(n.parentId).toBeNull();
    expect(n.position).toEqual({ x: 100, y: 200 });
    expect(n.data).toEqual({ title: '工程' });
  });
  it('videoEdit 节点 + auto 边跨 doc 传播（协作可见性）', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    fillDoc(a, [{ id: 'n1', type: 'videoEdit', parentId: null, position: { x: 0, y: 0 }, data: {} } as any],
      [{ id: 'auto:n1:src1', source: 'src1', target: 'n1' }]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const rb = readCanvasFromDoc(b);
    expect(rb.nodes.find((x: any) => x.id === 'n1')?.type).toBe('videoEdit');
    expect(rb.edges.find((e: any) => e.id === 'auto:n1:src1')).toMatchObject({ source: 'src1', target: 'n1' });
  });
});
```

- [ ] **Step 8: 跑测试 + 提交（含 tsc 前移首验——R2 审核 P1-C：命令可用性第 1 个任务就暴露，别攒到 Task 17）**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/components/AddNodeMenu.test.tsx src/collab/ydocBuilder.test.ts
# 预期: 全 PASS（含改写后的 videoEdit 用例与新增往返 2 例）
pnpm -C apps/web exec tsc -b
# 预期: 0 error（与 build 脚本同命令；此后每个 task 收尾均跑——vitest esbuild 不查类型）
pnpm -C apps/web test
# 预期: 全绿（nodeTypes 注册不破既有画布测试）
git add apps/web/src && git commit -m "feat(video-editor): videoEdit 全链路注册——接管 composite 死入口/width 320/ydoc 往返实测（TDD）"
```

---

### Task 2: capabilities 能力检测 + videoEditorStore

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/capabilities.ts`
- Create: `apps/web/src/stores/videoEditorStore.ts`
- Test: `apps/web/src/pages/canvas/video-editor/capabilities.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/capabilities.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { detectVideoEditorCapabilities } from './capabilities';

describe('detectVideoEditorCapabilities（编辑入口分层检测：解码器三件）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('VideoDecoder+AudioDecoder+OffscreenCanvas 全有 → canPreview true', () => {
    vi.stubGlobal('VideoDecoder', function () {});
    vi.stubGlobal('AudioDecoder', function () {});
    vi.stubGlobal('OffscreenCanvas', function () {});
    expect(detectVideoEditorCapabilities().canPreview).toBe(true);
  });
  it('缺 VideoDecoder → false', () => {
    vi.stubGlobal('AudioDecoder', function () {});
    vi.stubGlobal('OffscreenCanvas', function () {});
    expect(detectVideoEditorCapabilities().canPreview).toBe(false);
  });
  it('缺 OffscreenCanvas → false', () => {
    vi.stubGlobal('VideoDecoder', function () {});
    vi.stubGlobal('AudioDecoder', function () {});
    expect(detectVideoEditorCapabilities().canPreview).toBe(false);
  });
});
```

- [ ] **Step 2: 确认失败（Cannot find module）→ Step 3: 实现**

```ts
// apps/web/src/pages/canvas/video-editor/capabilities.ts
export interface VideoEditorCapabilities {
  /** 预览依赖解码器三件（spec 边界护栏：编辑入口检测；VideoEncoder/AAC 属导出弹层，Plan 4） */
  canPreview: boolean;
}

export function detectVideoEditorCapabilities(): VideoEditorCapabilities {
  const g = globalThis as Record<string, unknown>;
  const canPreview = typeof g.VideoDecoder === 'function'
    && typeof g.AudioDecoder === 'function'
    && typeof g.OffscreenCanvas === 'function';
  return { canPreview };
}
```

```ts
// apps/web/src/stores/videoEditorStore.ts
import { create } from 'zustand';

/** 编辑器 open 态放 stores/（spec：避免 hooks→pages 反向依赖；isGroupEditContext/Shell/节点三处消费） */
interface VideoEditorState {
  open: boolean;
  sourceNodeId: string | null;
  /** close 版本号：VideoEditNode 据此 refetch 工程缩略（编辑器保存后节点本体刷新） */
  closedAt: number;
  openEditor: (sourceNodeId: string) => void;
  close: () => void;
}

export const useVideoEditorStore = create<VideoEditorState>((set) => ({
  open: false,
  sourceNodeId: null,
  closedAt: 0,
  openEditor: (sourceNodeId) => set({ open: true, sourceNodeId }),
  close: () => set((s) => ({ open: false, closedAt: s.closedAt + 1 })),
}));
```

- [ ] **Step 4: 跑测试 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/capabilities.test.ts
# 预期: 3 PASS
git add apps/web/src && git commit -m "feat(video-editor): 能力检测三件 + videoEditorStore open 态（TDD）"
```

---

### Task 3: timeline 纯函数——clip-math（帧量化/变速/trim/分割公式）

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/timeline/clip-math.ts`
- Test: `apps/web/src/pages/canvas/video-editor/timeline/clip-math.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/clip-math.test.ts
import { describe, it, expect } from 'vitest';
import {
  FPS, secondsToFrame, frameToSeconds, quantizeTime,
  sourceTime, trimLeftGuard, trimRightGuard, clampDelta,
  applyTrimLeft, applyTrimRight, splitClipAt,
} from './clip-math';
import type { VideoClip } from '../types';

const vc = (over: Partial<VideoClip> = {}): VideoClip => ({
  id: 'c1', trackId: 't1', type: 'video', start: 0, duration: 10,
  sourceStart: 2, mediaId: 'm1', playbackSpeed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
  ...over,
});

describe('帧量化（帧整数为唯一真相）', () => {
  it('secondsToFrame 四舍五入 / frameToSeconds 精确除法', () => {
    expect(secondsToFrame(1.0166, 30)).toBe(30); // 0.5 帧进位
    expect(secondsToFrame(2, 30)).toBe(60);
    expect(frameToSeconds(45, 30)).toBe(1.5);
  });
  it('quantizeTime 消除浮点尾差', () => {
    const noisy = 0.1 + 0.2;
    expect(quantizeTime(noisy, 30)).toBe(0.3); // 9 帧精确 0.3（执行期修正：计划原值 0.1 系 3 帧笔误——0.1+0.2≈0.3s）
  });
});

describe('sourceTime 变速公式', () => {
  it('1×/0.5×/2× 三档', () => {
    const base = { sourceStart: 2, start: 1 } as const;
    expect(sourceTime(vc({ ...base, playbackSpeed: 1, duration: 10 }), 3)).toBe(4);
    expect(sourceTime(vc({ ...base, playbackSpeed: 0.5 }), 3)).toBe(3); // 执行期修正：2+(3-1)*0.5=3（计划原值 2.5 违反自身公式）
    expect(sourceTime(vc({ ...base, playbackSpeed: 2 }), 3)).toBe(6);
  });
});

describe('trim guard（素材边界约束）', () => {
  it('左缘左拉不得越过素材 0 点（素材约束更紧时由它决定）', () => {
    const g = trimLeftGuard(vc({ sourceStart: 1, playbackSpeed: 1, start: 10 }), 100);
    expect(g.minDelta).toBe(-1); // max(-1, -10)——素材约束生效
  });
  it('左缘至少留 1 帧', () => {
    expect(trimLeftGuard(vc(), 100).maxDelta).toBeCloseTo(10 - 1 / FPS, 10);
  });
  it('左拉下界取素材 0 点与时间轴 0 点的交（start 约束更紧时由它兜底）', () => {
    // sourceStart=100 富余（源约束 -100 放行），start=5 → 时间轴 0 点约束 -5 生效
    const g = trimLeftGuard(vc({ sourceStart: 100, duration: 10, start: 5 }), 200);
    expect(g.minDelta).toBe(-5);
    const r = applyTrimLeft(vc({ sourceStart: 100, duration: 10, start: 5 }), -5);
    expect(r.start).toBe(0);          // 不越过时间轴原点
    expect(r.duration).toBe(15);      // duration 随左拉增大（左拉侧永不为负——R1 审核 P0-1 反例方向修正）
    expect(r.sourceStart).toBe(95);
  });
  it('start=0 的片段左拉下界为 0 且 -0 已归一（时间轴原点恒 0，start 不为负）', () => {
    const g = trimLeftGuard(vc({ sourceStart: 100, duration: 10, start: 0 }), 200);
    // -0 归一锁：实现将 minDelta === 0 归一为 +0；toBe 是 Object.is 语义（-0 ≠ 0）——
    // 删除归一化则 Math.max(-100, -0) 产 -0 本用例必红（执行期修正：R2 的 toBeCloseTo 在归一化落地后失去锁力）
    expect(g.minDelta).toBe(0);
  });
  it('字幕/图片片（sourceLimit=-Infinity）左拉由时间轴 0 点兜底（R2 审核 P2-1：原实现对无源片 clampDelta 形同虚设）', () => {
    const sub = { id: 's1', trackId: 'tv', type: 'subtitle', start: 2, duration: 3, text: 'x', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 } } as any;
    expect(trimLeftGuard(sub, Infinity).minDelta).toBe(-2); // max(-Infinity, -2)——有限下界，不再无限左拉
  });
  it('右缘不超素材时长（0.5× 换算）', () => {
    const g = trimRightGuard(vc({ sourceStart: 2, duration: 10, playbackSpeed: 0.5 }), 30);
    expect(g.maxDelta).toBeCloseTo((30 - 2) / 0.5 - 10, 5);
  });
  it('clampDelta 夹取', () => {
    expect(clampDelta({ minDelta: -1, maxDelta: 5 }, -9)).toBe(-1);
    expect(clampDelta({ minDelta: -1, maxDelta: 5 }, 9)).toBe(5);
  });
  it('素材时长 Infinity → 右缘不设限（时长未知兜底）', () => {
    expect(trimRightGuard(vc(), Infinity).maxDelta).toBe(Infinity);
  });
});

describe('applyTrim（量化成片时间，源时间连续浮点）', () => {
  it('左缘：start/duration 量化，sourceStart += Δ*speed', () => {
    const r = applyTrimLeft(vc({ start: 1, duration: 8, sourceStart: 2, playbackSpeed: 2 }), 0.5);
    expect(r.start).toBe(1.5);
    expect(r.duration).toBe(7.5);
    expect(r.sourceStart).toBe(3);
  });
  it('右缘：sourceStart 不动', () => {
    const r = applyTrimRight(vc({ start: 1, duration: 8, sourceStart: 2 }), -0.5);
    expect(r.duration).toBe(7.5);
    expect(r.sourceStart).toBe(2);
  });
  it('反复 trim 100 次不漂移/无缝隙（浮点纪律 TDD）', () => {
    let c = vc({ start: 0, duration: 5, sourceStart: 0, playbackSpeed: 1 }); // 执行期修正：duration 5 时 100 帧修剪后 start=duration=50/FPS（计划原值 100 终值 96.67 必红）
    for (let i = 0; i < 50; i++) c = applyTrimLeft(c, 1 / FPS);
    for (let i = 0; i < 50; i++) c = applyTrimRight(c, -1 / FPS);
    expect(c.start).toBeCloseTo(50 / FPS, 10);
    expect(c.duration).toBeCloseTo(50 / FPS, 10);
    expect(c.start).toBe(quantizeTime(c.start));
    expect(c.duration).toBe(quantizeTime(c.duration));
  });
});

describe('splitClipAt（播放头分割，spec 第三节公式）', () => {
  it('前片 [start,cut]、后片 sourceStart/duration/start 按公式', () => {
    const c = vc({ start: 1, duration: 8, sourceStart: 2, playbackSpeed: 2 });
    const { front, back } = splitClipAt(c, 3, 'c2');
    expect(front.duration).toBe(2);
    expect(back.start).toBe(3);
    expect(back.duration).toBe(6);
    expect(back.sourceStart).toBe(2 + (3 - 1) * 2);
  });
  it('分割后 sourceTime 连续（无缝）', () => {
    const c = vc({ start: 1, duration: 8, sourceStart: 2, playbackSpeed: 0.5 });
    const { front, back } = splitClipAt(c, 4, 'c2');
    const t = 4; // 切点
    expect(sourceTime(front, t)).toBeCloseTo(sourceTime(back, t), 10);
  });
  it('转场语义：前片清 transitionOut、后片清 transitionIn（配对交给状态机重配）', () => {
    const c = vc({ transitionIn: { type: 'crossfade', duration: 0.5 }, transitionOut: { type: 'fadeOut', duration: 0.5 } });
    const { front, back } = splitClipAt(c, 2, 'c2');
    expect(front.transitionIn?.type).toBe('crossfade');
    expect(front.transitionOut).toBeUndefined();
    expect(back.transitionIn).toBeUndefined();
    expect(back.transitionOut?.type).toBe('fadeOut');
  });
  it('关键帧按局部时间分配：前片留 t<=cut-local，后片移位', () => {
    const c = vc({
      keyframes: [
        { id: 'k1', t: 1, property: 'opacity', value: 0.5, easing: 'linear' },
        { id: 'k2', t: 5, property: 'opacity', value: 1, easing: 'linear' },
      ],
    });
    const { front, back } = splitClipAt(c, 3, 'c2');
    expect(front.keyframes.map(k => k.id)).toEqual(['k1']);
    expect(back.keyframes).toEqual([{ id: 'k2', t: 2, property: 'opacity', value: 1, easing: 'linear' }]);
  });
  it('image/subtitle 分支：无 sourceStart 仅分割时长', () => {
    const img = { id: 'i1', trackId: 't1', type: 'image', start: 0, duration: 6, mediaId: 'm2',
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } as const;
    const { front, back } = splitClipAt(img as any, 2, 'i2');
    expect(front.duration).toBe(2);
    expect(back.duration).toBe(4);
    expect((back as any).sourceStart).toBeUndefined();
  });
});
```

- [ ] **Step 2: 确认失败 → Step 3: 实现**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/clip-math.ts
import type { Clip } from '../types';

export const FPS = 30;
export const MIN_FRAME_SEC = 1 / FPS;

export function secondsToFrame(t: number, fps = FPS): number {
  return Math.round(t * fps);
}
export function frameToSeconds(frame: number, fps = FPS): number {
  return frame / fps;
}
/** 成片时间量化到帧网格——唯一真相是帧整数；源 sourceStart/sourceTime 保持连续浮点交 decoder nearest sample */
export function quantizeTime(t: number, fps = FPS): number {
  return frameToSeconds(secondsToFrame(t, fps), fps);
}

/** 有源片段（video/audio 共有 sourceStart + playbackSpeed） */
export type TimedClip = Extract<Clip, { sourceStart: unknown }>;
const isTimed = (c: Clip): c is TimedClip => c.type === 'video' || c.type === 'audio';

/** sourceTime(clip, t) = sourceStart + (t - start) * playbackSpeed */
export function sourceTime(clip: TimedClip, t: number): number {
  return clip.sourceStart + (t - clip.start) * clip.playbackSpeed;
}

export interface TrimGuard { minDelta: number; maxDelta: number; }

export function trimLeftGuard(clip: Clip, _mediaDuration: number): TrimGuard {
  const sourceLimit = isTimed(clip) ? -clip.sourceStart / clip.playbackSpeed : -Infinity;
  // 左拉（Δ<0）双下界取交：素材 0 点（sourceStart ≥ 0）+ 时间轴 0 点（start ≥ 0）。
  // duration = duration - Δ 随左拉增大，左拉侧无帧下界问题（负 duration 在 Δ>0 侧，由 maxDelta 防）。
  // -0 归一 +0：start=0 时 Math.max(-100, -0) 产 -0，Object.is/JSON.stringify/Math.sign 场景露馅（R3 审核 P2）
  const minDelta = Math.max(sourceLimit, -clip.start);
  return {
    minDelta: minDelta === 0 ? 0 : minDelta,
    maxDelta: clip.duration - MIN_FRAME_SEC,
  };
}

export function trimRightGuard(clip: Clip, mediaDuration: number): TrimGuard {
  const max = isTimed(clip)
    ? (mediaDuration - clip.sourceStart) / clip.playbackSpeed - clip.duration
    : Infinity - clip.duration; // image/subtitle 无素材上限（Infinity 兜底同效）
  return { minDelta: MIN_FRAME_SEC - clip.duration, maxDelta: isFinite(max) ? max : Infinity };
}

export function clampDelta(g: TrimGuard, delta: number): number {
  return Math.min(Math.max(delta, g.minDelta), g.maxDelta);
}

/** 左缘 trim：start += Δ；duration -= Δ；sourceStart += Δ * playbackSpeed。
 *  成片时间结果（start/duration）量化回帧网格——spec 红线：帧整数为唯一真相，反复 trim 累加浮点尾差必须被每步消除；
 *  sourceStart 保持连续浮点（执行期修正：仅量化 Δ 时 50 次累加 1/30 漂至 1.6666666666666685 ≠ 50/30） */
export function applyTrimLeft(clip: Clip, delta: number): Clip {
  const d = quantizeTime(delta);
  const start = quantizeTime(clip.start + d);
  const duration = quantizeTime(clip.duration - d);
  if (isTimed(clip)) {
    return { ...clip, start, duration, sourceStart: clip.sourceStart + d * clip.playbackSpeed };
  }
  return { ...clip, start, duration };
}

/** 右缘 trim：不改 sourceStart（成片 duration 同样量化回帧网格） */
export function applyTrimRight(clip: Clip, delta: number): Clip {
  const d = quantizeTime(delta);
  return { ...clip, duration: quantizeTime(clip.duration + d) };
}

/** 分割（spec 公式）：后片.sourceStart = 前.sourceStart + (cut - 前.start) * speed；转场/关键帧按语义重分配 */
export function splitClipAt(clip: Clip, cutPoint: number, backId: string): { front: Clip; back: Clip } {
  const cut = quantizeTime(cutPoint);
  const localCut = cut - clip.start;
  const front: Clip = { ...clip, duration: localCut, transitionOut: undefined } as Clip;
  const backBase: any = {
    ...clip,
    id: backId,
    start: cut,
    duration: clip.start + clip.duration - cut,
    transitionIn: undefined,
  };
  if (isTimed(clip)) backBase.sourceStart = clip.sourceStart + localCut * clip.playbackSpeed;
  // SubtitleClip 无 keyframes 字段（shared 类型实形）——as any 绕联合访问，运行时 ?? [] 兜底
  backBase.keyframes = ((clip as any).keyframes ?? [])
    .filter((k: any) => k.t > localCut)
    .map((k: any) => ({ ...k, t: k.t - localCut }));
  (front as any).keyframes = ((clip as any).keyframes ?? []).filter((k: any) => k.t <= localCut);
  return { front, back: backBase as Clip };
}
```

- [ ] **Step 4: 跑测试通过 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/timeline/clip-math.test.ts
# 预期: 全 PASS（含 100 次不漂移/分割连续性/转场语义/关键帧分配）
git add apps/web/src/pages/canvas/video-editor/timeline && git commit -m "feat(video-editor): clip-math 纯函数——帧量化/变速/trim/分割公式 + 100 次不漂移（TDD）"
```

---

### Task 4: timeline 纯函数——view-scale（像素↔秒换算 + 8px 吸附 + 命中）

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/timeline/view-scale.ts`
- Test: `apps/web/src/pages/canvas/video-editor/timeline/view-scale.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/view-scale.test.ts
import { describe, it, expect } from 'vitest';
import {
  timeToPx, pxToTime, snapThresholdSec, collectSnapPoints, snapTime, edgeHitTest, anchorZoomScroll,
} from './view-scale';
import type { Clip } from '../types';

const clip = (id: string, start: number, duration: number): Clip => ({
  id, trackId: 't1', type: 'video', start, duration, sourceStart: 0, mediaId: 'm',
  playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});

describe('像素↔秒换算', () => {
  it('互逆', () => {
    expect(timeToPx(2.5, 80)).toBe(200);
    expect(pxToTime(200, 80)).toBe(2.5);
  });
});

describe('吸附（8px 阈值随 px/s 变化）', () => {
  it('阈值秒 = 8 / pxPerSec 多档', () => {
    expect(snapThresholdSec(50)).toBeCloseTo(0.16);
    expect(snapThresholdSec(100)).toBeCloseTo(0.08);
    expect(snapThresholdSec(200)).toBeCloseTo(0.04);
  });
  it('命中片段边缘吸附', () => {
    const pts = collectSnapPoints('me', [clip('a', 2, 3)], 0); // 边缘 2、5
    const r = snapTime(2.05, pts, 100); // 距 2 为 0.05s < 0.08
    expect(r.time).toBe(2);
    expect(r.snapped?.kind).toBe('clip-start');
  });
  it('不命中返回原值', () => {
    const pts = collectSnapPoints('me', [clip('a', 2, 3)], 0);
    const r = snapTime(4, pts, 100); // 距 2/5 均 1s+ > 0.08；整秒 4 距 0——整秒命中！
    expect(r.snapped?.kind).toBe('whole-second');
    expect(r.time).toBe(4);
  });
  it('整秒刻度独立命中（无显式点时）', () => {
    const pts = collectSnapPoints('me', [clip('a', 0.1, 0.1)], 0.3);
    const r = snapTime(0.99, pts, 100); // 距 1s 为 0.01 < 0.08
    expect(r.time).toBe(1);
    expect(r.snapped?.kind).toBe('whole-second');
  });
  it('排除自身片段边缘', () => {
    const pts = collectSnapPoints('me', [clip('me', 2, 3)], 0);
    expect(pts.some(p => p.kind === 'clip-start' && p.time === 2)).toBe(false);
  });
  it('播放头是吸附点', () => {
    const pts = collectSnapPoints('me', [], 7);
    const r = snapTime(7.05, pts, 100);
    expect(r.snapped?.kind).toBe('playhead');
  });
  it('等距 tie（显式点与整秒同点）：显式点胜出', () => {
    const pts = collectSnapPoints('me', [clip('a', 0, 3)], 0); // 显式点 0/3
    const r = snapTime(3, pts, 100); // clip-end 3 与整秒 3 同点同距 0
    expect(r.snapped?.kind).toBe('clip-end');
  });
  it('整秒更近时独立胜出（证明整秒是独立档，非仅显式兜底）', () => {
    const pts = collectSnapPoints('me', [clip('a', 2, 3)], 0); // 显式点 2/5
    const r = snapTime(3.05, pts, 100); // 距整秒 3 为 0.05 < 0.08；距显式点 2/5 均 > 1
    expect(r.time).toBe(3);
    expect(r.snapped?.kind).toBe('whole-second');
  });
});

describe('边缘命中（trim 拖拽判定）', () => {
  it('6px 内命中左/右缘，中间为移动', () => {
    expect(edgeHitTest(2, 100)).toBe('left');
    expect(edgeHitTest(97, 100)).toBe('right');
    expect(edgeHitTest(50, 100)).toBe(null);
  });
});

describe('缩放锚定（Ctrl+滚轮以播放头为中心）', () => {
  it('保持锚点视口位置不变', () => {
    // 播放头 10s 在视口 x=300（viewportW 800, scrollLeft 500, pxPerSec 80）
    const r = anchorZoomScroll({ scrollLeft: 500, anchorTime: 10, oldPxPerSec: 80, newPxPerSec: 160, viewportW: 800 });
    expect(r.scrollLeft).toBe(10 * 160 - 300); // 锚点仍距视口左 300px
  });
});
```

- [ ] **Step 2: 确认失败 → Step 3: 实现**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/view-scale.ts
import type { Clip } from '../types';

export const SNAP_THRESHOLD_PX = 8;
export const EDGE_HIT_PX = 6;

export function timeToPx(t: number, pxPerSec: number): number {
  return t * pxPerSec;
}
export function pxToTime(px: number, pxPerSec: number): number {
  return px / pxPerSec;
}
export function snapThresholdSec(pxPerSec: number): number {
  return SNAP_THRESHOLD_PX / pxPerSec;
}

export type SnapKind = 'clip-start' | 'clip-end' | 'playhead' | 'whole-second';
export interface SnapPoint { time: number; kind: SnapKind; }
export interface SnapResult { time: number; snapped: SnapPoint | null; }

export function collectSnapPoints(excludeClipId: string | undefined, clips: Clip[], playhead: number): SnapPoint[] {
  const pts: SnapPoint[] = [];
  for (const c of clips) {
    if (c.id === excludeClipId) continue;
    pts.push({ time: c.start, kind: 'clip-start' });
    pts.push({ time: c.start + c.duration, kind: 'clip-end' });
  }
  pts.push({ time: playhead, kind: 'playhead' });
  return pts;
}

/** 最近点吸附：显式点（片段边缘/播放头）与整秒刻度合并判定，取更近者；无命中返回原值。
 *  tie-break：显式点先求值 + 严格小于（d < bestDist）才替换——等距时显式点胜出（固化为测试） */
export function snapTime(targetSec: number, points: SnapPoint[], pxPerSec: number): SnapResult {
  const threshold = snapThresholdSec(pxPerSec);
  let best: SnapPoint | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const d = Math.abs(p.time - targetSec);
    if (d <= threshold && d < bestDist) { best = p; bestDist = d; }
  }
  const whole = Math.round(targetSec);
  const dWhole = Math.abs(whole - targetSec);
  if (dWhole <= threshold && dWhole < bestDist) {
    return { time: whole, snapped: { time: whole, kind: 'whole-second' } };
  }
  if (best) return { time: best.time, snapped: best };
  return { time: targetSec, snapped: null };
}

/** trim 边缘命中：offsetX 距片段左/右缘 6px 内 */
export function edgeHitTest(offsetX: number, widthPx: number): 'left' | 'right' | null {
  if (offsetX <= EDGE_HIT_PX) return 'left';
  if (widthPx - offsetX <= EDGE_HIT_PX) return 'right';
  return null;
}

/** Ctrl+滚轮缩放锚定：新 scrollLeft 使 anchorTime 在视口中的位置保持不变 */
export function anchorZoomScroll(input: {
  scrollLeft: number; anchorTime: number; oldPxPerSec: number; newPxPerSec: number; viewportW: number;
}): { scrollLeft: number } {
  const anchorOffset = input.anchorTime * input.oldPxPerSec - input.scrollLeft; // 锚点距视口左的距离
  return { scrollLeft: Math.max(0, input.anchorTime * input.newPxPerSec - anchorOffset) };
}
```

- [ ] **Step 4: 跑测试通过 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/timeline/view-scale.test.ts
git add apps/web/src/pages/canvas/video-editor/timeline && git commit -m "feat(video-editor): view-scale 纯函数——像素换算/8px 吸附/边缘命中/缩放锚定（TDD）"
```

---

### Task 5: timeline 纯函数——overlap（同轨重叠判定 + crossfade 边界状态机 + 放置）

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/timeline/overlap.ts`
- Test: `apps/web/src/pages/canvas/video-editor/timeline/overlap.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/overlap.test.ts
import { describe, it, expect } from 'vitest';
import type { ProjectData, VideoClip } from '../types';
import { clipsOnTrack, crossfadePredecessor, effectiveTransitions, canPlaceAt, findNearestFreeStart } from './overlap';

const vclip = (id: string, start: number, duration: number, over: Partial<VideoClip> = {}): VideoClip => ({
  id, trackId: 'tv', type: 'video', start, duration, sourceStart: 0, mediaId: 'm',
  playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [], ...over,
});
const data = (clips: VideoClip[], trackId = 'tv'): ProjectData => ({
  version: 1, fps: 30,
  tracks: [{ id: trackId, type: 'video', name: '视频', muted: false, hidden: false, clips: clips.map(c => c.id) }],
  clips: Object.fromEntries(clips.map(c => [c.id, c])),
});

describe('clipsOnTrack（按 start 有序）', () => {
  it('乱序存入有序取出', () => {
    const d = data([vclip('b', 5, 2), vclip('a', 0, 3), vclip('c', 2, 1)]);
    expect(clipsOnTrack(d, 'tv').map(c => c.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('crossfade 边界状态机（spec 第三节）', () => {
  it('前片缺失 → transitionIn crossfade 退化为 fadeIn', () => {
    const d = data([vclip('solo', 0, 5, { transitionIn: { type: 'crossfade', duration: 0.5 } })]);
    const eff = effectiveTransitions(d, 'solo');
    expect(eff.in?.type).toBe('fadeIn');
    expect(eff.overlap).toBe(0);
  });
  it('前片被移走（start 更大）→ 退化', () => {
    const d = data([
      vclip('a', 0, 3),
      vclip('b', 5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
    ]);
    // b 的前邻 a 结束于 3，b 从 5 开始——无重叠区，overlap 归零但配对存在
    const eff = effectiveTransitions(d, 'b');
    expect(eff.in?.type).toBe('crossfade');
    expect(eff.overlap).toBe(0);
  });
  it('正常 overlap：overlap = 前片 end - 后片 start', () => {
    const d = data([
      vclip('a', 0, 3),
      vclip('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
    ]);
    const eff = effectiveTransitions(d, 'b');
    expect(eff.overlap).toBe(0.5);
  });
  it('前片 transitionOut 与后片 crossfade 冲突 → crossfade 优先（前片 effOut null）', () => {
    const d = data([
      vclip('a', 0, 3, { transitionOut: { type: 'toBlack', duration: 1 } }),
      vclip('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
    ]);
    expect(effectiveTransitions(d, 'a').out).toBeNull();
    expect(effectiveTransitions(d, 'b').in?.type).toBe('crossfade');
  });
  it('分割重配对：split 后后半以原前半为新前片', () => {
    const d = data([
      vclip('a', 0, 3),
      vclip('b1', 4, 1.5),
      vclip('b2', 5.5, 1.5, { transitionIn: { type: 'crossfade', duration: 0.4 } }),
    ]);
    expect(crossfadePredecessor(d, d.clips['b2'] as VideoClip)?.id).toBe('b1');
    expect(effectiveTransitions(d, 'b2').in?.type).toBe('crossfade');
  });
  it('跨轨相邻不触发转场（前邻只查同轨）', () => {
    const d: ProjectData = {
      version: 1, fps: 30,
      tracks: [
        { id: 't1', type: 'video', name: 'V1', muted: false, hidden: false, clips: ['a'] },
        { id: 't2', type: 'video', name: 'V2', muted: false, hidden: false, clips: ['b'] },
      ],
      clips: {
        a: vclip('a', 0, 3),
        b: vclip('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
      },
    };
    (d.clips.b as VideoClip).trackId = 't2';
    expect(crossfadePredecessor(d, d.clips.b as VideoClip)).toBeNull();
    expect(effectiveTransitions(d, 'b').in?.type).toBe('fadeIn'); // 跨轨重叠无转场
  });
  it('字幕片无转场', () => {
    const d = data([]);
    d.clips['s1'] = { id: 's1', trackId: 'tv', type: 'subtitle', start: 0, duration: 2, text: 'x', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 } };
    d.tracks[0].clips.push('s1');
    expect(effectiveTransitions(d, 's1')).toEqual({ in: null, out: null, overlap: 0 });
  });
  it('effOut 保留正路径：后片无 crossfade 时前片 transitionOut 原样保留', () => {
    const d = data([
      vclip('a', 0, 3, { transitionOut: { type: 'toBlack', duration: 1 } }),
      vclip('b', 3.5, 2.5),
    ]);
    expect(effectiveTransitions(d, 'a').out?.type).toBe('toBlack');
  });
  it('audio 片早退无转场（与 subtitle 同路径）', () => {
    const d = data([]);
    d.clips['au1'] = { id: 'au1', trackId: 'tv', type: 'audio', start: 0, duration: 2, sourceStart: 0, mediaId: 'ma', volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [] } as any;
    d.tracks[0].clips.push('au1');
    expect(effectiveTransitions(d, 'au1')).toEqual({ in: null, out: null, overlap: 0 });
  });
});

describe('canPlaceAt / findNearestFreeStart（同轨禁重叠、跨轨自由）', () => {
  const base = data([vclip('a', 0, 3), vclip('b', 5, 3)]);
  it('同轨空位可放', () => {
    expect(canPlaceAt(base, 'me', 3, 'tv', 1.5)).toBe(true);
  });
  it('同轨重叠拒绝', () => {
    expect(canPlaceAt(base, 'me', 1, 'tv', 1.5)).toBe(false);
  });
  it('crossfade：被放置片为后片，与前片重叠 ≤ duration 允许、超过拒绝（spec 后片单侧表达）', () => {
    // me [2.6,4.6) 为 a [0,3) 的后片：重叠 0.4 ≤ 0.5 允许；[2.4,4.4) 重叠 0.6 > 0.5 拒绝（执行期 I1 修正：原用例与 b 重叠方向写反）
    expect(canPlaceAt(base, 'me', 2.6, 'tv', 2, { transitionIn: { type: 'crossfade', duration: 0.5 } })).toBe(true);
    expect(canPlaceAt(base, 'me', 2.4, 'tv', 2, { transitionIn: { type: 'crossfade', duration: 0.5 } })).toBe(false);
  });
  it('被放置片为前片：allowed 由既有后片决定，对手无 crossfade 则拒绝（修复误放行）', () => {
    // me [4.2,5.2) 与 b [5,8) 重叠 0.2——me 是前片，b 无 crossfade → 无转场依据的重叠拒绝
    expect(canPlaceAt(base, 'me', 4.2, 'tv', 1)).toBe(false);
    // I1 原始场景锁：placedClip 带 crossfade 但它是前片（对手 b 无 crossfade）→ 依旧拒绝
    expect(canPlaceAt(base, 'me', 4.2, 'tv', 1, { transitionIn: { type: 'crossfade', duration: 0.5 } })).toBe(false);
  });
  it('被放置片为前片：既有后片带 crossfade 时重叠 ≤ 其 duration 允许（修复误拒绝）', () => {
    const withCf = data([vclip('a', 0, 3), vclip('b', 5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } })]);
    // 前片 x [4.7,5.4) 与 b 重叠 0.4 ≤ 0.5（allowed 取 b 的 crossfade）→ 允许
    expect(canPlaceAt(withCf, 'x', 4.7, 'tv', 0.7)).toBe(true);
  });
  it('移动既有片到空位：自排除分支（clipId 已在轨上）', () => {
    expect(canPlaceAt(base, 'a', 3.5, 'tv', 1)).toBe(true); // a 移到 [3.5,4.5) 空位
    expect(canPlaceAt(base, 'a', 0, 'tv', 3)).toBe(true);   // 原位重放
  });
  it('跨轨自由重叠', () => {
    const two: ProjectData = {
      ...base,
      tracks: [...base.tracks, { id: 't2', type: 'video', name: 'V2', muted: false, hidden: false, clips: [] }],
    };
    expect(canPlaceAt(two, 'me', 1, 't2', 5)).toBe(true);
  });
  it('冲突吸附最近空位（帧网格扫描）', () => {
    const s = findNearestFreeStart(base, 'me', 1, 'tv', 1.5); // 1 与 a(0-3) 冲突
    expect(canPlaceAt(base, 'me', s, 'tv', 1.5)).toBe(true);
    expect(s).toBe(3); // 右侧最近空位起点（a 结束于 3，b 从 5 开始，1.5 宽放得下）
  });
  it('冲突吸附最近空位：左侧命中分支', () => {
    // desired 4.9 dur 1：右扫越走越深撞 b [5,8)，左扫到 4.0 时 [4,5) 与 a/b 均无重叠 → 返回 4
    const s = findNearestFreeStart(base, 'me', 4.9, 'tv', 1);
    expect(s).toBe(4);
  });
});
```

- [ ] **Step 2: 确认失败 → Step 3: 实现**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/overlap.ts
import type { Clip, ProjectData, Transition } from '../types';
import { quantizeTime, MIN_FRAME_SEC } from './clip-math';

export function clipsOnTrack(data: ProjectData, trackId: string): Clip[] {
  const t = data.tracks.find(t => t.id === trackId);
  if (!t) return [];
  return t.clips.map(id => data.clips[id]).filter(Boolean).sort((a, b) => a.start - b.start);
}

/** crossfade 前片：同轨相邻、start 更小者中最近的一个 */
export function crossfadePredecessor(data: ProjectData, clip: Clip): Clip | null {
  if (clip.type === 'audio' || clip.type === 'subtitle') return null; // audio/字幕无转场——窄化联合消除 as any
  if (clip.transitionIn?.type !== 'crossfade') return null;
  const prev = clipsOnTrack(data, clip.trackId).filter(c => c.start < clip.start && c.id !== clip.id);
  return prev.length ? prev[prev.length - 1] : null;
}

export interface EffectiveTransitions { in: Transition | null; out: Transition | null; overlap: number; }

/** 有效转场（crossfade 边界状态机，渲染/导出消费有效值而非原始数据） */
export function effectiveTransitions(data: ProjectData, clipId: string): EffectiveTransitions {
  const clip = data.clips[clipId];
  if (!clip || clip.type === 'subtitle' || clip.type === 'audio') {
    return { in: null, out: null, overlap: 0 };
  }
  let effIn: Transition | null = clip.transitionIn ?? null;
  let overlap = 0;
  if (clip.transitionIn?.type === 'crossfade') {
    const prev = crossfadePredecessor(data, clip);
    if (!prev) {
      effIn = { type: 'fadeIn', duration: clip.transitionIn.duration }; // 前片缺失/被移走 → 退化
    } else {
      overlap = Math.max(0, prev.start + prev.duration - clip.start); // 实际重叠区
    }
  }
  let effOut: Transition | null = clip.transitionOut ?? null;
  if (effOut) {
    const next = clipsOnTrack(data, clip.trackId).find(c => c.start >= clip.start && c.id !== clip.id);
    if (next && next.transitionIn?.type === 'crossfade' && crossfadePredecessor(data, next)?.id === clip.id) {
      effOut = null; // crossfade 优先：前片独立出转场被吞并
    }
  }
  return { in: effIn, out: effOut, overlap };
}

/** 同轨放置校验：禁重叠除 crossfade overlap（仅同轨；跨轨自由——图层叠加是多轨核心）。
 *  spec 第三节（重叠规则）：转场由后片（start 较大者）的 transitionIn crossfade 单侧表达——
 *  allowed 逐对取 later 片的 crossfade duration（被放置片为后片时取 placedClip，为前片时取已入库对手片）。
 *  执行期修正（Task 5 quality review I1）：原"只看被放置片 transitionIn"有误放行（前片带 crossfade 与
 *  无转场后片重叠入库）与误拒绝（对手后片带 crossfade 的合法前片靠近被弹开）双向缺陷 */
export function canPlaceAt(
  data: ProjectData, clipId: string, start: number, trackId: string, duration: number,
  placedClip?: { transitionIn?: Transition },
): boolean {
  for (const c of clipsOnTrack(data, trackId)) {
    if (c.id === clipId) continue;
    const overlap = Math.min(start + duration, c.start + c.duration) - Math.max(start, c.start);
    if (overlap <= 1e-9) continue;
    const laterIn: Transition | undefined = start > c.start ? placedClip?.transitionIn : (c as any).transitionIn;
    const allowed = laterIn?.type === 'crossfade' ? laterIn.duration : 0;
    if (overlap > allowed + 1e-9) return false;
  }
  return true;
}

/** 冲突吸附最近空位：desired 起向两侧帧网格扫描，返回第一个可放 start */
export function findNearestFreeStart(
  data: ProjectData, clipId: string, desiredStart: number, trackId: string, duration: number,
  clipTransition?: { transitionIn?: Transition },
): number {
  const step = quantizeTime(MIN_FRAME_SEC);
  for (let offset = 0; offset <= 24 * 3600; offset += step) {
    const right = quantizeTime(desiredStart + offset);
    if (canPlaceAt(data, clipId, right, trackId, duration, clipTransition)) return right;
    if (offset === 0) continue;
    const left = quantizeTime(desiredStart - offset);
    if (left >= 0 && canPlaceAt(data, clipId, left, trackId, duration, clipTransition)) return left;
  }
  return quantizeTime(desiredStart); // 兜底：理论不可达（时间轴无限长）
}
```

- [ ] **Step 4: 跑测试通过 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/timeline/overlap.test.ts
git add apps/web/src/pages/canvas/video-editor/timeline && git commit -m "feat(video-editor): overlap 纯函数——同轨禁重叠/crossfade 状态机/最近空位吸附（TDD）"
```

---

### Task 6: timeline 纯函数——timecode（HH:MM:SS:FF / M:SS / totalDuration）+ waveform（peaksFromAudioBuffer）

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/timeline/timecode.ts`
- Create: `apps/web/src/pages/canvas/video-editor/timeline/waveform.ts`
- Test: `apps/web/src/pages/canvas/video-editor/timeline/timecode.test.ts` + `waveform.test.ts`

- [ ] **Step 1: 写失败测试（timecode）**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/timecode.test.ts
import { describe, it, expect } from 'vitest';
import { formatTimecode, formatShortTime, totalDuration } from './timecode';
import type { ProjectData, VideoClip } from '../types';

describe('formatTimecode（HH:MM:SS:FF，30fps 非丢帧——片段块显示）', () => {
  it('零点', () => { expect(formatTimecode(0)).toBe('00:00:00:00'); });
  it('1h2m3s4f', () => { expect(formatTimecode(3600 + 120 + 3 + 4 / 30)).toBe('01:02:03:04'); });
  it('29 帧不进位', () => { expect(formatTimecode(29 / 30)).toBe('00:00:00:29'); });
  it('30 帧进秒', () => { expect(formatTimecode(1)).toBe('00:00:01:00'); });
});

describe('formatShortTime（M:SS——节点本体简略显示，与片段块精度注明不同）', () => {
  it('M:SS', () => {
    expect(formatShortTime(0)).toBe('0:00');
    expect(formatShortTime(65.4)).toBe('1:05');
    expect(formatShortTime(600)).toBe('10:00');
  });
});

describe('totalDuration（原点恒 0，总长 = max(end)；overlap 不重复计时天然成立）', () => {
  // 夹具显式标注 VideoClip——Object.fromEntries 泛型 T 从 entries 推断，
  // 内联字面量的 type 会被拓宽为 string 导致 tsc 报错（R1 审核 P0-4，vitest esbuild 不查类型但 build tsc -b 会）
  const mk = (clips: { start: number; duration: number }[]): ProjectData => {
    const entries = clips.map((c, i) => {
      const v: VideoClip = {
        id: `c${i}`, trackId: 't', type: 'video', start: c.start, duration: c.duration,
        sourceStart: 0, mediaId: 'm', playbackSpeed: 1,
        transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
      };
      return [`c${i}`, v] as const;
    });
    return {
      version: 1, fps: 30,
      tracks: [{ id: 't', type: 'video', name: 'V', muted: false, hidden: false, clips: entries.map(([id]) => id) }],
      clips: Object.fromEntries(entries),
    };
  };
  it('空工程 0', () => { expect(totalDuration(mk([]))).toBe(0); });
  it('max(end)——片段不从 0 开始时前导为黑场计入成片', () => {
    expect(totalDuration(mk([{ start: 2, duration: 3 }, { start: 0, duration: 1 }]))).toBe(5);
  });
});
```

- [ ] **Step 2: 写失败测试（waveform）**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/waveform.test.ts
import { describe, it, expect } from 'vitest';
import { peaksFromAudioBuffer, type PeakSource } from './waveform';

const mockBuffer = (samples: Float32Array, sampleRate = 48000): PeakSource => ({
  sampleRate, length: samples.length, getChannelData: () => samples,
});

describe('peaksFromAudioBuffer（从 AudioBuffer 抽固定数量峰值——useWaveformPeaks 解耦纯函数化）', () => {
  it('正弦波峰值接近 1', () => {
    const sr = 48000;
    const pcm = new Float32Array(sr); // 1 秒 440Hz
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(2 * Math.PI * 440 * (i / sr));
    const peaks = peaksFromAudioBuffer(mockBuffer(pcm), 50);
    expect(peaks).toHaveLength(50);
    for (const p of peaks) expect(p).toBeGreaterThan(0.9); // 每桶含完整周期
  });
  it('静音全 0', () => {
    const peaks = peaksFromAudioBuffer(mockBuffer(new Float32Array(4800)), 10);
    expect(peaks.every(p => p === 0)).toBe(true);
  });
  it('count 桶均分全长', () => {
    const pcm = new Float32Array(1000).fill(0.5);
    const peaks = peaksFromAudioBuffer(mockBuffer(pcm), 4);
    expect(peaks).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
  it('空数据返回 []', () => {
    expect(peaksFromAudioBuffer(mockBuffer(new Float32Array(0)), 10)).toEqual([]);
  });
});
```

- [ ] **Step 3: 确认失败 → 实现**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/timecode.ts
import type { ProjectData } from '../types';
import { FPS } from './clip-math';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** HH:MM:SS:FF（30fps 非丢帧）——时间轴片段块"名称 · 源时间码"用 */
export function formatTimecode(t: number, fps = FPS): string {
  const totalFrames = Math.round(t * fps);
  const f = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

/** M:SS——剪辑节点本体简略显示 */
export function formatShortTime(t: number): string {
  const totalSeconds = Math.floor(t);
  return `${Math.floor(totalSeconds / 60)}:${pad(totalSeconds % 60)}`;
}

/** 总长 = max(clip.end)；原点恒 0——片段不从 0 开始时前导为黑场并计入成片 */
export function totalDuration(data: ProjectData): number {
  let max = 0;
  for (const c of Object.values(data.clips)) max = Math.max(max, c.start + c.duration);
  return max;
}
```

```ts
// apps/web/src/pages/canvas/video-editor/timeline/waveform.ts
/** 最小结构接口——jsdom 无 AudioBuffer，测试造 mock；真数据由 audio-engine（Plan 3）解码供给 */
export interface PeakSource {
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/** 分桶取绝对峰值；峰值按 mediaId 缓存（spec 第五节——不为每片段 new wavesurfer 实例） */
export function peaksFromAudioBuffer(buffer: PeakSource, count: number, channel = 0): number[] {
  if (count <= 0) return [];
  const data = buffer.getChannelData(channel);
  if (data.length === 0) return [];
  const bucket = data.length / count;
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.min(data.length, Math.floor((i + 1) * bucket));
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
  }
  return peaks;
}
```

- [ ] **Step 4: 跑测试通过 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/timeline/timecode.test.ts src/pages/canvas/video-editor/timeline/waveform.test.ts
git add apps/web/src/pages/canvas/video-editor/timeline && git commit -m "feat(video-editor): timecode/totalDuration/peaksFromAudioBuffer 纯函数（TDD）"
```

---

### Task 7: timeline 纯函数——history 历史栈

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/timeline/history.ts`
- Test: `apps/web/src/pages/canvas/video-editor/timeline/history.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/history.test.ts
import { describe, it, expect } from 'vitest';
import { createHistory, pushHistory, undoHistory, redoHistory } from './history';
import type { ProjectData } from '../types';

const snap = (v: number): ProjectData => ({
  version: 1, fps: 30, tracks: [], clips: {},
  ...( { __v: v } as any), // 测试标记字段——克隆隔离断言用
});
const readV = (d: ProjectData) => (d as any).__v as number;

describe('历史栈（快照结构化克隆/上限 50/事务语义）', () => {
  it('push → undo → redo 往返', () => {
    let h = createHistory<ProjectData>();
    let cur = snap(1);
    h = pushHistory(h, cur); cur = snap(2);
    const u = undoHistory(h, cur)!;
    expect(readV(u.state)).toBe(1);
    const r = redoHistory(u.history, u.state)!;
    expect(readV(r.state)).toBe(2);
  });
  it('快照克隆隔离——push 后修改原对象不影响栈内', () => {
    let h = createHistory<ProjectData>();
    const original = snap(1);
    h = pushHistory(h, original);
    (original as any).__v = 999; // 引用仍可变
    const u = undoHistory(h, snap(2))!;
    expect(readV(u.state)).toBe(1); // 栈内快照未被污染
  });
  it('上限 50：超过丢最老', () => {
    let h = createHistory<ProjectData>(50);
    for (let i = 0; i < 55; i++) h = pushHistory(h, snap(i));
    expect(h.past.length).toBe(50);
    let cur = snap(999);
    for (let i = 0; i < 50; i++) { const u = undoHistory(h, cur)!; cur = u.state; h = u.history; }
    expect(readV(cur)).toBe(4); // 55 次 push 的最老是第 5 次（index 4）
  });
  it('新操作清空 redo 栈', () => {
    let h = createHistory<ProjectData>();
    const s1 = snap(1);
    h = pushHistory(h, s1);
    const u = undoHistory(h, snap(2))!;
    const h2 = pushHistory(u.history, u.state);
    expect(h2.future).toHaveLength(0);
  });
  it('空栈 undo/redo 返回 null', () => {
    const h = createHistory<ProjectData>();
    expect(undoHistory(h, snap(1))).toBeNull();
    expect(redoHistory(h, snap(1))).toBeNull();
  });
});
```

- [ ] **Step 2: 确认失败 → Step 3: 实现**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/history.ts

export interface History<T> {
  past: T[];
  future: T[];
  limit: number;
}

export function createHistory<T>(limit = 50): History<T> {
  return { past: [], future: [], limit };
}

/** 入栈前 JSON 深拷（禁持引用；structuredClone 对历史 data 非常规值可能抛 DataCloneError——Plan 1 A1 口径） */
export function pushHistory<T>(h: History<T>, snapshot: T): History<T> {
  const clone = JSON.parse(JSON.stringify(snapshot));
  const past = [...h.past, clone];
  if (past.length > h.limit) past.shift();
  return { ...h, past, future: [] }; // 新操作清 redo
}

export function undoHistory<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (h.past.length === 0) return null;
  const past = [...h.past];
  const prev = past.pop()!;
  return { history: { ...h, past, future: [current, ...h.future] }, state: prev };
}

export function redoHistory<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (h.future.length === 0) return null;
  const [next, ...future] = h.future;
  return { history: { ...h, past: [...h.past, current], future }, state: next };
}
```

- [ ] **Step 4: 跑测试通过 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/timeline/history.test.ts
git add apps/web/src/pages/canvas/video-editor/timeline && git commit -m "feat(video-editor): history 历史栈纯函数——克隆隔离/50 上限/redo 清空（TDD）"
```

---

### Task 8: autoEdgeIds + canvasStore 边原语小改 + planAutoEdgeOps/ensureAutoEdges

spec 第二节连线同步的两条独立任务之一（addEdge 小改）；origin 隔离在 Task 13。

**Files:**
- Create: `apps/web/src/stores/autoEdgeIds.ts`
- Modify: `apps/web/src/stores/canvasStore.ts:102,451-456,569-573`（addEdge 可选 id / removeEdge / onConnect 判重）
- Create: `apps/web/src/pages/canvas/video-editor/timeline/auto-edges.ts`
- Test: `apps/web/src/stores/autoEdgeIds.test.ts` + `canvasStore.test.ts` 增用例 + `auto-edges.test.ts`

- [ ] **Step 1: 写失败测试（autoEdgeIds）**

```ts
// apps/web/src/stores/autoEdgeIds.test.ts
import { describe, it, expect } from 'vitest';
import { autoEdgeId, autoOutEdgeId, isAutoEdgeId } from './autoEdgeIds';

describe('自动边确定性 id（身份只依赖 id，不依赖会丢失的 edge.data）', () => {
  it('autoEdgeId/autoOutEdgeId 派生', () => {
    expect(autoEdgeId('edit1', 'src1')).toBe('auto:edit1:src1');
    expect(autoOutEdgeId('edit1', 'prod1')).toBe('auto-out:edit1:prod1');
  });
  it('isAutoEdgeId 双前缀识别', () => {
    expect(isAutoEdgeId('auto:edit1:src1')).toBe(true);
    expect(isAutoEdgeId('auto-out:edit1:prod1')).toBe(true);
    expect(isAutoEdgeId('edge_123')).toBe(false);
  });
});
```

- [ ] **Step 2: 写失败测试（canvasStore 边原语，追加到既有 canvasStore.test.ts）**

```ts
// apps/web/src/stores/canvasStore.test.ts 文件末尾追加（沿用该文件 setState 重置 + getState 驱动模式）
describe('边原语（自动连线支持：addEdge 可选 id / removeEdge / onConnect 判重）', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null });
  });
  it('addEdge 带 deterministicId 幂等：同 id 已存在 no-op 返回同 id', () => {
    const cs = useCanvasStore.getState();
    const id1 = cs.addEdge('a', 'b', undefined, undefined, 'auto:e1:s1');
    const id2 = cs.addEdge('a', 'b', undefined, undefined, 'auto:e1:s1');
    expect(id1).toBe('auto:e1:s1');
    expect(id2).toBe('auto:e1:s1');
    expect(useCanvasStore.getState().edges.filter(e => e.id === 'auto:e1:s1')).toHaveLength(1); // 防 React Flow 双 key
  });
  it('removeEdge 按 id 删除', () => {
    const cs = useCanvasStore.getState();
    cs.addEdge('a', 'b', undefined, undefined, 'auto:e1:s1');
    cs.removeEdge('auto:e1:s1');
    expect(useCanvasStore.getState().edges).toHaveLength(0);
  });
  it('onConnect 同源判重：已存在同 source+target 边则跳过', () => {
    const cs = useCanvasStore.getState();
    cs.onConnect({ source: 'a', target: 'b' } as any);
    cs.onConnect({ source: 'a', target: 'b' } as any);
    expect(useCanvasStore.getState().edges.filter(e => e.source === 'a' && e.target === 'b')).toHaveLength(1);
  });
});
```

- [ ] **Step 3: 写失败测试（planAutoEdgeOps 对账纯函数——spec 测试矩阵）**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/auto-edges.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { planAutoEdgeOps, ensureAutoEdges } from './auto-edges';
import { autoEdgeId } from '@/stores/autoEdgeIds';
import type { ProjectData } from '../types';
import { useCanvasStore } from '@/stores/canvasStore';

const dataWith = (sourceNodeIds: (string | undefined)[]): ProjectData => ({
  version: 1, fps: 30,
  tracks: [{ id: 'tv', type: 'video', name: 'V', muted: false, hidden: false, clips: sourceNodeIds.map((_, i) => `c${i}`) }],
  clips: Object.fromEntries(sourceNodeIds.map((sn, i) => [`c${i}`, {
    id: `c${i}`, trackId: 'tv', type: 'video', start: 0, duration: 3, sourceStart: 0, mediaId: `m${i}`,
    ...(sn ? { sourceNodeId: sn } : {}), playbackSpeed: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
  }])),
});

describe('planAutoEdgeOps（spec 定稿对账算法）', () => {
  const E = 'edit1';
  it('加带源片段 → 建边', () => {
    const ops = planAutoEdgeOps(dataWith(['s1']), [], E);
    expect(ops.toAdd).toEqual([{ id: autoEdgeId(E, 's1'), source: 's1', target: E }]);
    expect(ops.toRemove).toEqual([]);
  });
  it('同源多片只一边', () => {
    const d = dataWith(['s1', 's1']);
    const ops = planAutoEdgeOps(d, [{ id: autoEdgeId(E, 's1'), source: 's1', target: E }], E);
    expect(ops.toAdd).toHaveLength(0); // 已有，不重复
  });
  it('删全部该源片段 → 删边', () => {
    const ops = planAutoEdgeOps(dataWith(['s2']), [{ id: autoEdgeId(E, 's1'), source: 's1', target: E }]);
    expect(ops.toRemove).toEqual([autoEdgeId(E, 's1')]);
  });
  it('素材库来源（无 sourceNodeId）不建边', () => {
    const ops = planAutoEdgeOps(dataWith([undefined]), [], E);
    expect(ops.toAdd).toHaveLength(0);
  });
  it('手动边（无 auto: 前缀）永不自动删', () => {
    const manual = { id: 'edge_1', source: 's1', target: E };
    const ops = planAutoEdgeOps(dataWith([]), [manual]);
    expect(ops.toRemove).toHaveLength(0);
  });
  it('字幕片不建边（type subtitle 排除）', () => {
    const d = dataWith([]);
    d.clips['sub'] = { id: 'sub', trackId: 'tv', type: 'subtitle', start: 0, duration: 2, text: 'x', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 }, sourceNodeId: 's9' } as any;
    d.tracks[0].clips.push('sub');
    const ops = planAutoEdgeOps(d, [], E);
    expect(ops.toAdd).toHaveLength(0);
  });
});

describe('ensureAutoEdges（store 落地，幂等）', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null });
  });
  it('建边 → 再跑一遍无新增（幂等）', () => {
    ensureAutoEdges('edit1', dataWith(['s1', 's2']));
    expect(useCanvasStore.getState().edges).toHaveLength(2);
    ensureAutoEdges('edit1', dataWith(['s1', 's2']));
    expect(useCanvasStore.getState().edges).toHaveLength(2);
  });
  it('移除源后删边', () => {
    ensureAutoEdges('edit1', dataWith(['s1']));
    ensureAutoEdges('edit1', dataWith([]));
    expect(useCanvasStore.getState().edges).toHaveLength(0);
  });
});
```

- [ ] **Step 4: 确认失败 → Step 5: 实现**

```ts
// apps/web/src/stores/autoEdgeIds.ts
/** 自动边确定性 id——身份只依赖节点 id（协作桥仅持久化 edge 的 {id,source,target}，data 刷新即丢） */

export function autoEdgeId(editNodeId: string, sourceNodeId: string): string {
  return `auto:${editNodeId}:${sourceNodeId}`;
}

export function autoOutEdgeId(editNodeId: string, productNodeId: string): string {
  return `auto-out:${editNodeId}:${productNodeId}`;
}

/** 订阅路径与 syncAutoEdgesToDoc 的分流判据 */
export function isAutoEdgeId(id: string): boolean {
  return id.startsWith('auto:') || id.startsWith('auto-out:');
}
```

[canvasStore.ts](apps/web/src/stores/canvasStore.ts) 三处修改——接口区（L102 附近）：

```ts
  addEdge: (source: string, target: string, sourceHandle?: string, targetHandle?: string, deterministicId?: string) => string;
  removeEdge: (id: string) => void;
```

实现区 L451-456 替换：

```ts
  addEdge: (source, target, sourceHandle, targetHandle, deterministicId) => {
    const id = deterministicId ?? getId('edge');
    // 确定性建边幂等：同 id 已存在 no-op（防 React Flow 双 key）
    if (get().edges.some(e => e.id === id)) return id;
    const edge: Edge = { id, source, target, type: 'default', sourceHandle, targetHandle };
    set((s) => ({ edges: [...s.edges, edge] }));
    return id;
  },

  removeEdge: (id) => {
    set((s) => ({ edges: s.edges.filter(e => e.id !== id) }));
  },
```

onConnect（L569-573）替换：

```ts
  onConnect: (connection) => {
    // 同源判重（spec 第二节顺手项：现状缺口非本功能引入，同一对节点重复拖线不再叠边）
    if (get().edges.some(e => e.source === connection.source && e.target === connection.target)) return;
    const id = getId('edge');
    const edge: Edge = { id, ...connection };
    set((s) => ({ edges: [...s.edges, edge] }));
  },
```

```ts
// apps/web/src/pages/canvas/video-editor/timeline/auto-edges.ts
import type { ProjectData } from '../types';
import { autoEdgeId } from '@/stores/autoEdgeIds';
import { useCanvasStore } from '@/stores/canvasStore';

export interface AutoEdgeOp {
  toAdd: { id: string; source: string; target: string }[];
  toRemove: string[];
}

/** 纯函数对账（spec 定稿算法）：expected = 时间轴引用的源节点集合；mine = target 指向本剪辑节点的 auto: 边；补缺删余。手动边（无前缀）不碰 */
export function planAutoEdgeOps(
  data: ProjectData,
  edges: { id: string; source: string; target: string }[],
  editNodeId: string,
): AutoEdgeOp {
  const expected = new Set(
    Object.values(data.clips)
      .filter(c => c.type !== 'subtitle' && c.sourceNodeId)
      .map(c => c.sourceNodeId!),
  );
  const mine = edges.filter(e => e.target === editNodeId && e.id.startsWith('auto:'));
  const have = new Set(mine.map(e => e.source));
  const toAdd: AutoEdgeOp['toAdd'] = [];
  for (const src of expected) {
    if (!have.has(src)) toAdd.push({ id: autoEdgeId(editNodeId, src), source: src, target: editNodeId });
  }
  const toRemove = mine.filter(e => !expected.has(e.source)).map(e => e.id);
  return { toAdd, toRemove };
}

/** store 落地（编辑器每次片段增删 commit 后调用；幂等——addEdge 同 id no-op） */
export function ensureAutoEdges(sourceNodeId: string, data: ProjectData): void {
  const cs = useCanvasStore.getState();
  const ops = planAutoEdgeOps(data, cs.edges, sourceNodeId);
  for (const a of ops.toAdd) cs.addEdge(a.source, a.target, undefined, undefined, a.id);
  for (const r of ops.toRemove) cs.removeEdge(r);
}
```

- [ ] **Step 6: 跑测试 + 提交**

```bash
pnpm -C apps/web exec vitest run src/stores/autoEdgeIds.test.ts src/stores/canvasStore.test.ts src/pages/canvas/video-editor/timeline/auto-edges.test.ts
pnpm -C apps/web test
# 预期: 全绿（addEdge 签名扩展不破既有调用——可选参数）
git add apps/web/src && git commit -m "feat(video-editor): autoEdgeIds 确定性 id + canvasStore 边原语（可选 id/removeEdge/判重）+ 对账纯函数（TDD）"
```

---

### Task 9: editorStore normalized + transient 历史 + undo/redo + stopCapturing

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/store/editorStore.ts`
- Test: `apps/web/src/pages/canvas/video-editor/store/editorStore.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/store/editorStore.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/stores/canvasUndo', () => ({ stopCapturing: vi.fn() }));
vi.mock('../timeline/auto-edges', () => ({ ensureAutoEdges: vi.fn() }));

import { useEditorStore } from './editorStore';
import { createDefaultProjectData, type ProjectData } from '../types';
import { stopCapturing } from '@/stores/canvasUndo';
import { ensureAutoEdges } from '../timeline/auto-edges';

const proj = (data?: ProjectData) => ({
  id: 'p1', sourceNodeId: 'edit1', updatedAt: '2026-09-10T00:00:00Z',
  data: data ?? createDefaultProjectData(),
});

describe('editorStore（normalized + transient 历史）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.getState().reset();
  });

  it('loadProject → ready，data/baseUpdatedAt 就位', () => {
    useEditorStore.getState().loadProject(proj());
    const s = useEditorStore.getState();
    expect(s.status).toBe('ready');
    expect(s.projectId).toBe('p1');
    expect(s.baseUpdatedAt).toBe('2026-09-10T00:00:00Z');
  });

  it('addClip 视频片：duration 取 mediaInfo，track.clips 按 start 有序，push 前态历史', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: '素材A', durationSec: 8 });
    const trackId = useEditorStore.getState().data!.tracks[0].id;
    const id = useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', sourceNodeId: 's1', trackId, start: 2 });
    expect(id).toBeTruthy();
    const d = useEditorStore.getState().data!;
    expect(d.clips[id!].duration).toBe(8);
    expect(d.tracks[0].clips).toEqual([id]);
    expect(useEditorStore.getState().history.past).toHaveLength(1);
    expect(ensureAutoEdges).toHaveBeenCalled();
  });

  it('addClip 同轨冲突自动吸附最近空位', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 }); // 占 0-3
    useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', trackId, start: 1 }); // 冲突 → 吸附 3
    const d = useEditorStore.getState().data!;
    const second = d.tracks[0].clips.map(id => d.clips[id]).sort((a, b) => a.start - b.start)[1];
    expect(second.start).toBe(3);
  });

  it('addClip 图片默认 5s；素材时长未知兜底 5s 且不阻塞', () => {
    useEditorStore.getState().loadProject(proj());
    const trackId = useEditorStore.getState().data!.tracks[0].id;
    const id = useEditorStore.getState().addClip({ type: 'image', mediaId: 'img1', trackId, start: 0 });
    expect(useEditorStore.getState().data!.clips[id!].duration).toBe(5);
  });

  it('addSubtitleClip：3s + 默认文本', () => {
    useEditorStore.getState().loadProject(proj());
    const subTrack = useEditorStore.getState().data!.tracks.find(t => t.type === 'subtitle')!;
    const id = useEditorStore.getState().addSubtitleClip(subTrack.id, 1);
    const c = useEditorStore.getState().data!.clips[id] as any;
    expect(c.type).toBe('subtitle');
    expect(c.duration).toBe(3);
    expect(c.text).toBe('新字幕');
  });

  it('transient 拖动：begin → move×N 不入栈 → end 一次入栈', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!;
    const historyDepthAfterAdd = useEditorStore.getState().history.past.length; // 1

    useEditorStore.getState().beginTransient();
    for (let i = 1; i <= 3; i++) {
      useEditorStore.getState().moveClip(id, i, undefined, { transient: true });
    }
    expect(useEditorStore.getState().history.past.length).toBe(historyDepthAfterAdd); // rAF 不入栈
    const changed = useEditorStore.getState().endTransient();
    expect(changed).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(historyDepthAfterAdd + 1); // pointerup 一次
    expect(stopCapturing).toHaveBeenCalled(); // 断画布 500ms 合并窗
    expect(useEditorStore.getState().data!.clips[id].start).toBe(3);
  });

  it('undo/redo：数据还原 + clip 集合回滚触发 ensureAutoEdges', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', sourceNodeId: 's1', trackId, start: 0 })!;
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(0); // 片没了
    expect(ensureAutoEdges).toHaveBeenCalled(); // 边跟随回滚（spec 验收 4）
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().data!.tracks[0].clips).toEqual([id]);
  });

  it('splitClip：两片 + 撤销还原一片', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 10 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!;
    const backId = useEditorStore.getState().splitClip(id, 4);
    expect(backId).toBeTruthy();
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().data!.tracks[0].clips).toEqual([id]);
  });

  it('removeClip + removeTrack 连片段删', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 });
    const before = useEditorStore.getState().data!.tracks.length;
    useEditorStore.getState().removeTrack(trackId);
    const d = useEditorStore.getState().data!;
    expect(d.tracks).toHaveLength(before - 1);
    expect(Object.keys(d.clips)).toHaveLength(0); // 片段一起删
  });

  it('addTrack 新轨追加；toggleTrack 切换', () => {
    useEditorStore.getState().loadProject(proj());
    const before = useEditorStore.getState().data!.tracks.length;
    const id = useEditorStore.getState().addTrack('audio');
    expect(useEditorStore.getState().data!.tracks).toHaveLength(before + 1);
    useEditorStore.getState().toggleTrack(id, 'muted');
    expect(useEditorStore.getState().data!.tracks.find(t => t.id === id)!.muted).toBe(true);
  });

  it('trimClip：guard 夹取 + 非 transient 入栈', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 10 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!;
    useEditorStore.getState().trimClip(id, 'right', 999); // 超素材时长 → 夹到 10
    expect(useEditorStore.getState().data!.clips[id].duration).toBe(10);
  });

  it('undo 后 selectedClipId 清理（快照里 clip 可能没了）', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!;
    useEditorStore.getState().selectClip(id);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().selectedClipId).toBeNull();
  });
});
```

- [ ] **Step 2: 确认失败 → Step 3: 实现**

```ts
// apps/web/src/pages/canvas/video-editor/store/editorStore.ts
import { create } from 'zustand';
import type { Clip, ProjectData, Track, VideoClip, ImageClip, AudioClip, SubtitleClip } from '../types';
import { genId } from '../types';
import { createHistory, pushHistory, undoHistory, redoHistory, type History } from '../timeline/history';
import {
  quantizeTime, trimLeftGuard, trimRightGuard, clampDelta,
  applyTrimLeft, applyTrimRight, splitClipAt,
} from '../timeline/clip-math';
import { canPlaceAt, findNearestFreeStart } from '../timeline/overlap';
import { ensureAutoEdges } from '../timeline/auto-edges';
import { stopCapturing } from '@/stores/canvasUndo';

export type EditorStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SaveState = 'saved' | 'saving' | 'error';

export interface MediaInfo { name: string; durationSec: number | undefined; }

export interface AddClipInput {
  type: 'video' | 'image' | 'audio';
  mediaId: string;
  sourceNodeId?: string;
  trackId: string;
  start: number;
}

interface EditorState {
  projectId: string | null;
  sourceNodeId: string | null;
  baseUpdatedAt: string | null;
  data: ProjectData | null;
  status: EditorStatus;
  loadError: string | null;
  saveState: SaveState;
  selectedClipId: string | null;
  playhead: number;
  pxPerSec: number;
  mediaInfo: Record<string, MediaInfo>;
  history: History<ProjectData>;
  pendingSnapshot: ProjectData | null;

  loadProject(p: { id: string; sourceNodeId: string; updatedAt: string; data: ProjectData }): void;
  setLoadError(msg: string): void;
  reset(): void;
  setSaveState(s: SaveState): void;
  setBaseUpdatedAt(t: string): void;
  setPlayhead(t: number): void;
  setPxPerSec(v: number): void;
  selectClip(id: string | null): void;
  setMediaInfo(mediaId: string, info: MediaInfo): void;

  addClip(input: AddClipInput): string | null;
  addSubtitleClip(trackId: string, start: number, text?: string): string;
  moveClip(clipId: string, start: number, trackId?: string, opts?: { transient?: boolean }): boolean;
  trimClip(clipId: string, edge: 'left' | 'right', deltaSec: number, opts?: { transient?: boolean }): boolean;
  splitClip(clipId: string, at: number): string | null;
  removeClip(clipId: string): void;
  updateClip(clipId: string, patch: Record<string, unknown>): void;
  addTrack(type: Track['type']): string;
  removeTrack(trackId: string): void;
  toggleTrack(trackId: string, key: 'muted' | 'hidden'): void;

  beginTransient(): void;
  endTransient(): boolean;
  undo(): void;
  redo(): void;
}

const sortTrackClips = (data: ProjectData): ProjectData => ({
  ...data,
  tracks: data.tracks.map(t => ({
    ...t,
    clips: [...t.clips].sort((a, b) => (data.clips[a]?.start ?? 0) - (data.clips[b]?.start ?? 0)),
  })),
});

/** clip 增删后统一尾部动作：边对账 + 断画布合并窗 */
const afterStructuralChange = (sourceNodeId: string, data: ProjectData) => {
  ensureAutoEdges(sourceNodeId, data);
  stopCapturing();
};

export const useEditorStore = create<EditorState>()((set, get) => {
  /** 非 transient 结构变更：push 前态 → mutate → 尾部动作 */
  const commit = (mutate: (data: ProjectData) => ProjectData, opts?: { structural?: boolean }) => {
    const s = get();
    if (!s.data || s.status !== 'ready') return;
    const prev = s.data;
    let next = mutate(prev);
    next = sortTrackClips(next);
    set({ data: next, history: pushHistory(s.history, prev) });
    if (opts?.structural !== false && s.sourceNodeId) afterStructuralChange(s.sourceNodeId, next);
  };

  /** transient 变更（拖拽 rAF 级）：只改 data 不入栈（begin/endTransient 配对收口） */
  const transient = (mutate: (data: ProjectData) => ProjectData) => {
    const s = get();
    if (!s.data) return;
    set({ data: sortTrackClips(mutate(s.data)) });
  };

  return {
    projectId: null,
    sourceNodeId: null,
    baseUpdatedAt: null,
    data: null,
    status: 'idle',
    loadError: null,
    saveState: 'saved',
    selectedClipId: null,
    playhead: 0,
    pxPerSec: 80,
    mediaInfo: {},
    history: createHistory<ProjectData>(),
    pendingSnapshot: null,

    loadProject: (p) => set({
      projectId: p.id, sourceNodeId: p.sourceNodeId, baseUpdatedAt: p.updatedAt,
      data: p.data, status: 'ready', loadError: null,
      history: createHistory<ProjectData>(), pendingSnapshot: null,
      selectedClipId: null, playhead: 0,
    }),
    setLoadError: (msg) => set({ status: 'error', loadError: msg }),
    reset: () => set({
      projectId: null, sourceNodeId: null, baseUpdatedAt: null, data: null,
      status: 'idle', loadError: null, saveState: 'saved', selectedClipId: null,
      playhead: 0, pxPerSec: 80, mediaInfo: {},
      history: createHistory<ProjectData>(), pendingSnapshot: null,
    }),
    setSaveState: (v) => set({ saveState: v }),
    setBaseUpdatedAt: (t) => set({ baseUpdatedAt: t }),
    setPlayhead: (t) => set({ playhead: Math.max(0, quantizeTime(t)) }),
    setPxPerSec: (v) => set({ pxPerSec: Math.min(500, Math.max(10, v)) }),
    selectClip: (id) => set({ selectedClipId: id }),
    setMediaInfo: (mediaId, info) => set((s) => ({ mediaInfo: { ...s.mediaInfo, [mediaId]: info } })),

    addClip: (input) => {
      const s = get();
      if (!s.data || s.status !== 'ready') return null;
      const duration = input.type === 'image'
        ? 5
        : s.mediaInfo[input.mediaId]?.durationSec ?? 5; // 决策 6：未知兜底 5s
      const start = quantizeTime(input.start);
      let placed = start;
      if (!canPlaceAt(s.data, undefined, start, input.trackId, duration)) {
        placed = findNearestFreeStart(s.data, undefined, start, input.trackId, duration); // 冲突吸附最近空位
      }
      const id = genId('clip');
      const base = { id, trackId: input.trackId, start: placed, duration, mediaId: input.mediaId, ...(input.sourceNodeId ? { sourceNodeId: input.sourceNodeId } : {}) };
      const clip: Clip = input.type === 'video'
        ? { ...base, type: 'video', sourceStart: 0, playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } as VideoClip
        : input.type === 'image'
          ? { ...base, type: 'image', transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } as ImageClip
          : { ...base, type: 'audio', sourceStart: 0, volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [] } as AudioClip;
      commit((d) => ({
        ...d,
        clips: { ...d.clips, [id]: clip },
        tracks: d.tracks.map(t => t.id === input.trackId ? { ...t, clips: [...t.clips, id] } : t),
      }));
      return id;
    },

    addSubtitleClip: (trackId, start, text = '新字幕') => {
      const s = get();
      const id = genId('clip');
      const clip: SubtitleClip = {
        id, trackId, type: 'subtitle', start: quantizeTime(start), duration: 3,
        text, visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 },
      };
      commit((d) => ({
        ...d,
        clips: { ...d.clips, [id]: clip },
        tracks: d.tracks.map(t => t.id === trackId ? { ...t, clips: [...t.clips, id] } : t),
      }));
      return id;
    },

    moveClip: (clipId, start, trackId, opts) => {
      const s = get();
      if (!s.data) return false;
      const clip = s.data.clips[clipId];
      if (!clip) return false;
      const targetTrack = trackId ?? clip.trackId;
      const ns = quantizeTime(start);
      // 同类型跨轨（图片在视频轨）；同轨冲突吸附最近空位
      const placed = canPlaceAt(s.data, clipId, ns, targetTrack, clip.duration, clip)
        ? ns
        : findNearestFreeStart(s.data, clipId, ns, targetTrack, clip.duration, clip);
      const mutate = (d: ProjectData): ProjectData => {
        const c = d.clips[clipId];
        return {
          ...d,
          clips: { ...d.clips, [clipId]: { ...c, start: placed, trackId: targetTrack } },
          tracks: d.tracks.map(t => {
            if (t.id === c.trackId && t.id !== targetTrack) return { ...t, clips: t.clips.filter(x => x !== clipId) };
            if (t.id === targetTrack && t.id !== c.trackId) return { ...t, clips: [...t.clips, clipId] };
            return t;
          }),
        };
      };
      if (opts?.transient) transient(mutate);
      else commit(mutate, { structural: false }); // move 不改源集合，无需 ensureAutoEdges
      return true;
    },

    trimClip: (clipId, edge, deltaSec, opts) => {
      const s = get();
      if (!s.data) return false;
      const clip = s.data.clips[clipId];
      if (!clip) return false;
      const mediaDuration = s.mediaInfo[clip.mediaId]?.durationSec ?? Infinity;
      const guard = edge === 'left' ? trimLeftGuard(clip, mediaDuration) : trimRightGuard(clip, mediaDuration);
      const d = clampDelta(guard, deltaSec);
      const mutate = (data: ProjectData): ProjectData => {
        const c = data.clips[clipId];
        const next = edge === 'left' ? applyTrimLeft(c, d) : applyTrimRight(c, d);
        // trim 左缘可能造成同轨重叠（缩时长的左移不会，保护性再校验）
        return { ...data, clips: { ...data.clips, [clipId]: next } };
      };
      if (opts?.transient) transient(mutate);
      else commit(mutate, { structural: false });
      return true;
    },

    splitClip: (clipId, at) => {
      const s = get();
      if (!s.data) return null;
      const clip = s.data.clips[clipId];
      if (!clip) return null;
      const cut = quantizeTime(at);
      if (cut <= clip.start + 1 / 30 || cut >= clip.start + clip.duration - 1 / 30) return null; // 至少 1 帧两侧
      const backId = genId('clip');
      commit((d) => {
        const { front, back } = splitClipAt(d.clips[clipId], cut, backId);
        return {
          ...d,
          clips: { ...d.clips, [clipId]: front, [backId]: back },
          tracks: d.tracks.map(t => t.id === clip.trackId
            ? { ...t, clips: [...t.clips, backId] }
            : t),
        };
      });
      return backId;
    },

    removeClip: (clipId) => {
      const s = get();
      if (!s.data) return;
      const clip = s.data.clips[clipId];
      if (!clip) return;
      commit((d) => {
        const clips = { ...d.clips };
        delete clips[clipId];
        return {
          ...d,
          clips,
          tracks: d.tracks.map(t => t.id === clip.trackId ? { ...t, clips: t.clips.filter(x => x !== clipId) } : t),
        };
      });
      if (s.selectedClipId === clipId) set({ selectedClipId: null });
    },

    updateClip: (clipId, patch) => {
      commit((d) => ({
        ...d,
        clips: { ...d.clips, [clipId]: { ...d.clips[clipId], ...patch } as Clip },
      }), { structural: false });
    },

    addTrack: (type) => {
      const id = genId('track');
      const count = get().data?.tracks.filter(t => t.type === type).length ?? 0;
      commit((d) => ({
        ...d,
        tracks: [...d.tracks, { id, type, name: `${type === 'video' ? '视频' : type === 'audio' ? '音频' : '字幕'}${count + 1}`, muted: false, hidden: false, clips: [] }],
      }), { structural: false });
      return id;
    },

    removeTrack: (trackId) => {
      commit((d) => {
        const clips = { ...d.clips };
        for (const cid of d.tracks.find(t => t.id === trackId)?.clips ?? []) delete clips[cid];
        return { ...d, clips, tracks: d.tracks.filter(t => t.id !== trackId) };
      });
    },

    toggleTrack: (trackId, key) => {
      commit((d) => ({
        ...d,
        tracks: d.tracks.map(t => t.id === trackId ? { ...t, [key]: !t[key] } : t),
      }), { structural: false });
    },

    beginTransient: () => {
      const s = get();
      set({ pendingSnapshot: s.data });
    },

    endTransient: () => {
      const s = get();
      if (!s.pendingSnapshot || !s.data) return false;
      const changed = s.pendingSnapshot !== s.data;
      if (changed) {
        set({ history: pushHistory(s.history, s.pendingSnapshot), pendingSnapshot: null });
        stopCapturing(); // 拖拽 commit 断画布合并窗
      } else {
        set({ pendingSnapshot: null });
      }
      return changed;
    },

    undo: () => {
      const s = get();
      if (!s.data) return;
      const r = undoHistory(s.history, s.data);
      if (!r) return;
      set({ data: r.state, history: r.history, selectedClipId: null });
      if (s.sourceNodeId) afterStructuralChange(s.sourceNodeId, r.state); // 边跟随回滚
    },

    redo: () => {
      const s = get();
      if (!s.data) return;
      const r = redoHistory(s.history, s.data);
      if (!r) return;
      set({ data: r.state, history: r.history, selectedClipId: null });
      if (s.sourceNodeId) afterStructuralChange(s.sourceNodeId, r.state);
    },
  };
});
```

- [ ] **Step 4: 跑测试通过 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/store/editorStore.test.ts
# 预期: 12 PASS
git add apps/web/src/pages/canvas/video-editor && git commit -m "feat(video-editor): editorStore normalized——transient 历史/undo-redo 边回滚/冲突吸附空位（TDD）"
```

---

### Task 10: VideoEditNode 本体 UI 完整版

spec 第二节节点本体 UI 全项。播放/暂停按钮 disabled 占位（Plan 3 renderer 激活）；工程数据 GET by-node + closedAt 版本号 refetch。

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoEditNode.tsx`（Task 1 空壳 → 完整版）
- Test: `apps/web/src/pages/canvas/components/nodes/VideoEditNode.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/src/pages/canvas/components/nodes/VideoEditNode.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VideoEditNode } from './VideoEditNode';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { getProjectByNode } from '@/api/videoProjectApi';
import type { ProjectData } from '@/pages/canvas/video-editor/types';

vi.mock('@/api/videoProjectApi', () => ({
  getProjectByNode: vi.fn(),
}));

// NodeProps 必填字段多——测试只传组件消费的三项，统一 as any
const props = (id = 'n1') => ({ id, selected: false, dragging: false }) as any;

const mkData = (): ProjectData => ({
  version: 1, fps: 30,
  tracks: [{ id: 'tv', type: 'video', name: '视频', muted: false, hidden: false, clips: ['c1'] }],
  clips: { c1: { id: 'c1', trackId: 'tv', type: 'video', start: 0, duration: 3, sourceStart: 0, mediaId: 'm1', playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } },
});

describe('VideoEditNode 本体', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('VideoDecoder', function () {});
    vi.stubGlobal('AudioDecoder', function () {});
    vi.stubGlobal('OffscreenCanvas', function () {});
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('工程不存在 → 空态"+ 添加素材"，无执行按钮', async () => {
    (getProjectByNode as any).mockResolvedValue(null);
    render(<VideoEditNode {...props()} />);
    await waitFor(() => expect(screen.getByText('+ 添加素材')).toBeInTheDocument());
    expect(screen.queryByText('执行')).not.toBeInTheDocument();
  });

  it('有工程 → 渲染片段色块 + 时间码 M:SS', async () => {
    (getProjectByNode as any).mockResolvedValue({ id: 'p1', data: mkData() });
    render(<VideoEditNode {...props()} />);
    await waitFor(() => expect(screen.getByTestId('node-clip-c1')).toBeInTheDocument());
    expect(screen.getByText('0:03')).toBeInTheDocument(); // 总长 3s
  });

  it('全屏编辑 → videoEditorStore.openEditor(id)', async () => {
    (getProjectByNode as any).mockResolvedValue(null);
    render(<VideoEditNode {...props()} />);
    await waitFor(() => expect(screen.getByText('+ 添加素材')).toBeInTheDocument());
    fireEvent.click(screen.getByText('⤢ 全屏编辑'));
    expect(useVideoEditorStore.getState()).toMatchObject({ open: true, sourceNodeId: 'n1' });
  });

  it('能力不满足 → 全屏编辑置灰不可点', async () => {
    vi.unstubAllGlobals(); // 三件全缺
    (getProjectByNode as any).mockResolvedValue(null);
    render(<VideoEditNode {...props()} />);
    await waitFor(() => expect(screen.getByText('+ 添加素材')).toBeInTheDocument());
    const btn = screen.getByText('⤢ 全屏编辑').closest('button')!;
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(useVideoEditorStore.getState().open).toBe(false);
  });

  it('closedAt 递增且 sourceNodeId 匹配 → refetch 工程缩略', async () => {
    (getProjectByNode as any).mockResolvedValue(null);
    render(<VideoEditNode {...props()} />);
    await waitFor(() => expect(getProjectByNode).toHaveBeenCalledTimes(1));
    useVideoEditorStore.setState({ closedAt: 1, sourceNodeId: 'n1' }); // 编辑器在本节点上关闭
    await waitFor(() => expect(getProjectByNode).toHaveBeenCalledTimes(2));
  });

  it('左右 Handle 渲染（单 target/source）', async () => {
    (getProjectByNode as any).mockResolvedValue(null);
    render(<VideoEditNode {...props()} />);
    await waitFor(() => expect(screen.getByText('+ 添加素材')).toBeInTheDocument());
    expect(document.querySelector('[data-testid="video-edit-target"]')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="video-edit-source"]')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 确认失败 → Step 3: 实现完整版组件**

```tsx
// apps/web/src/pages/canvas/video-editor/components 内不重复；节点本体完整替换 Task 1 空壳
// apps/web/src/pages/canvas/components/nodes/VideoEditNode.tsx
import { memo, useEffect, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Tooltip } from 'antd';
import { NodeHandle } from './NodeHandle';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { detectVideoEditorCapabilities } from '@/pages/canvas/video-editor/capabilities';
import { formatShortTime, totalDuration } from '@/pages/canvas/video-editor/timeline/timecode';
import { getProjectByNode } from '@/api/videoProjectApi';
import type { ProjectData } from '@/pages/canvas/video-editor/types';

const TRACK_COLORS: Record<string, string> = { video: '#6C5CE7', image: '#6C5CE7', audio: '#95DE64', subtitle: '#FFD666' };

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="1" y="1" width="5" height="5" rx="1" stroke="#6C5CE7" strokeWidth="1.2" />
      <rect x="8" y="1" width="5" height="5" rx="1" stroke="#6C5CE7" strokeWidth="1.2" />
      <rect x="1" y="8" width="5" height="5" rx="1" stroke="#6C5CE7" strokeWidth="1.2" />
      <rect x="8" y="8" width="5" height="5" rx="1" stroke="#6C5CE7" strokeWidth="1.2" />
    </svg>
  );
}

function VideoEditNodeComponent({ id, selected }: NodeProps) {
  const openEditor = useVideoEditorStore((s) => s.openEditor);
  const closedAt = useVideoEditorStore((s) => s.closedAt);
  const closedSource = useVideoEditorStore((s) => s.sourceNodeId);
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [canPreview] = useState(detectVideoEditorCapabilities);

  useEffect(() => {
    let cancelled = false;
    getProjectByNode(id)
      .then((p) => { if (!cancelled) setProjectData(p?.data ?? null); })
      .catch(() => { if (!cancelled) setProjectData(null); });
    return () => { cancelled = true; };
    // closedAt 递增且匹配本节点 → 编辑器关闭后刷新缩略
  }, [id, closedAt, closedSource]);

  const dur = projectData ? totalDuration(projectData) : 0;
  const ratio = dur > 0 ? 288 / dur : 0; // 缩略区有效宽 288（316 - padding）

  return (
    <div className="relative canvas-node" data-testid={`video-edit-node-${id}`}>
      <div
        className="bg-white rounded-lg overflow-hidden box-border"
        style={{
          width: 316,
          border: '1px solid #E5E7EB',
          margin: 2,
          ...(selected ? { border: '1px solid transparent', boxShadow: '0 0 0 3px #9CA3AF' } : {}),
        }}
      >
        <NodeHandle type="target" testId="video-edit-target" />
        {/* 标题栏 */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#F0F0F0] [border-bottom-style:solid]">
          <GridIcon />
          <span className="text-[14px] font-medium text-[#1F2329]">多轨道剪辑</span>
        </div>
        {/* 工具栏：播放占位（Plan 3）+ 简略时间码 + 全屏编辑 */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <button type="button" disabled title="播放（预览能力 Plan 3 开放）"
            className="text-[12px] text-[#86909C] bg-transparent border-0 cursor-not-allowed px-1">▶</button>
          <span className="text-[12px] text-[#86909C]">{formatShortTime(0)} / {formatShortTime(dur)}</span>
          <Tooltip title={canPreview ? '' : '当前浏览器不支持 WebCodecs，请使用最新版 Chrome/Edge'}>
            <button
              type="button"
              className="ml-auto text-[12px] text-[#6C5CE7] bg-transparent border-0 px-1 py-0.5 cursor-pointer disabled:text-[#C9CDD4] disabled:cursor-not-allowed"
              disabled={!canPreview}
              onClick={() => openEditor(id)}
            >
              ⤢ 全屏编辑
            </button>
          </Tooltip>
        </div>
        {/* 轨道区只读缩略：片段色块（thumbnail 拼贴 Plan 3 接，色块先行）+ 播放头位置 */}
        <div className="px-3 pb-3 flex flex-col gap-1" data-testid="node-track-thumb">
          {projectData && projectData.tracks.length > 0 ? (
            projectData.tracks.map((t) => (
              <div key={t.id} className="relative h-[6px] rounded-sm bg-[#F2F3F5] overflow-hidden" data-testid={`node-track-${t.id}`}>
                {t.clips.map((cid) => {
                  const c = projectData.clips[cid];
                  if (!c) return null;
                  return (
                    <div key={cid} data-testid={`node-clip-${cid}`}
                      className="absolute top-0 bottom-0 rounded-sm"
                      style={{ left: c.start * ratio, width: Math.max(2, c.duration * ratio), background: TRACK_COLORS[c.type] ?? '#6C5CE7' }} />
                  );
                })}
              </div>
            ))
          ) : (
            <div className="h-[28px] rounded-md border border-dashed border-[#E5E7EB] [border-top-style:dashed] flex items-center justify-center">
              <span className="text-[12px] text-[#86909C]">+ 添加素材</span>
            </div>
          )}
        </div>
        <NodeHandle type="source" testId="video-edit-source" />
      </div>
    </div>
  );
}

export const VideoEditNode = memo(VideoEditNodeComponent);
```

- [ ] **Step 4: 跑测试 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/components/nodes/VideoEditNode.test.tsx
git add apps/web/src && git commit -m "feat(video-editor): VideoEditNode 本体——只读缩略/空态/能力检测置灰/全屏编辑入口（TDD）"
```

---

### Task 11: BaseFullscreenModal closeOnBackdrop + VideoEditorShell 骨架 + page 挂载 + 快捷键隔离

**Files:**
- Modify: `apps/web/src/components/BaseFullscreenModal.tsx`（+closeOnBackdrop 开关）
- Test: `apps/web/src/components/BaseFullscreenModal.test.tsx`（新建）
- Create: `apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.tsx` + `PreviewPlaceholder.tsx`
- Modify: `apps/web/src/hooks/useGroupKeyboard.ts:8`（isGroupEditContext 早退）
- Modify: `apps/web/src/pages/canvas/page.tsx:295-299`（挂载 Shell）
- Test: `apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.test.tsx` + `useGroupKeyboard` 增用例（并入 Shell 测试文件）

- [ ] **Step 1: 写失败测试（BaseFullscreenModal 开关）**

```tsx
// apps/web/src/components/BaseFullscreenModal.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { BaseFullscreenModal } from './BaseFullscreenModal';

describe('BaseFullscreenModal closeOnBackdrop 开关', () => {
  it('默认 true：点遮罩关闭（既有行为保持）', () => {
    const onClose = vi.fn();
    render(<BaseFullscreenModal open onClose={onClose} label="测试"><div /></BaseFullscreenModal>);
    fireEvent.click(screen.getByRole('dialog').parentElement!); // dialog 的父级即遮罩层
    expect(onClose).toHaveBeenCalled();
  });
  it('closeOnBackdrop=false：点遮罩不关闭（视频编辑器场景）', () => {
    const onClose = vi.fn();
    render(<BaseFullscreenModal open onClose={onClose} label="测试" closeOnBackdrop={false}><div /></BaseFullscreenModal>);
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 确认失败 → 实现 closeOnBackdrop**

[BaseFullscreenModal.tsx](apps/web/src/components/BaseFullscreenModal.tsx)：props 接口加 `closeOnBackdrop?: boolean;`（默认 true 保持现状），解构参数加 `closeOnBackdrop = true`，遮罩层 div（L65-71）的 onClick 改为：

```tsx
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
```

- [ ] **Step 3: 写失败测试（Shell + 快捷键隔离）**

```tsx
// apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoEditorShell } from './VideoEditorShell';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { isGroupEditContext } from '@/hooks/useGroupKeyboard';

describe('VideoEditorShell', () => {
  beforeEach(() => {
    useVideoEditorStore.setState({ open: false, sourceNodeId: null, closedAt: 0 });
  });
  it('open=false 不渲染；open 后渲染全屏壳与占位区', () => {
    const { rerender } = render(<VideoEditorShell />);
    expect(screen.queryByTestId('video-editor-shell')).not.toBeInTheDocument();
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    rerender(<VideoEditorShell />);
    expect(screen.getByTestId('video-editor-shell')).toBeInTheDocument();
    expect(screen.getByTestId('preview-placeholder')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-panel')).toBeInTheDocument();
  });
  it('点遮罩不关闭（closeOnBackdrop=false 透传）', () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    fireEvent.click(screen.getByTestId('video-editor-shell').parentElement!.parentElement!);
    expect(useVideoEditorStore.getState().open).toBe(true);
  });
  it('收起按钮 → close', () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    render(<VideoEditorShell />);
    fireEvent.click(screen.getByText('收起'));
    expect(useVideoEditorStore.getState().open).toBe(false);
  });
  it('编辑器 open 时 isGroupEditContext 恒 true（画布快捷键早退，spec 验收 27）', () => {
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'n1' });
    expect(isGroupEditContext(document.body)).toBe(true);
    useVideoEditorStore.setState({ open: false });
    expect(isGroupEditContext(document.body)).toBe(false);
  });
});
```

- [ ] **Step 4: 确认失败 → Step 5: 实现 Shell + 占位 + 挂载 + isGroupEditContext**

```tsx
// apps/web/src/pages/canvas/video-editor/components/PreviewPlaceholder.tsx
export function PreviewPlaceholder() {
  return (
    <div data-testid="preview-placeholder"
      className="flex-1 min-h-0 flex items-center justify-center bg-[#F7F8FA]">
      <span className="text-[14px] text-[#86909C]">预览播放器（Plan 3）</span>
    </div>
  );
}
```

```tsx
// apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.tsx
import { BaseFullscreenModal } from '@/components/BaseFullscreenModal';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { EditorTopBar } from './EditorTopBar';        // Task 12 实现，本 task 先建最小占位（见 Step 5 注）
import { PreviewPlaceholder } from './PreviewPlaceholder';
import { TimelinePanel } from './timeline/TimelinePanel'; // Task 14 实现，本 task 先建最小占位

export function VideoEditorShell() {
  const open = useVideoEditorStore((s) => s.open);
  const close = useVideoEditorStore((s) => s.close);
  if (!open) return null;
  return (
    <BaseFullscreenModal open={open} onClose={close} label="多轨剪辑" closeOnBackdrop={false}>
      <div data-testid="video-editor-shell"
        className="fixed inset-0 bg-[#F7F8FA] flex flex-col box-border">
        <EditorTopBar />
        <div className="flex flex-1 min-h-0">
          {/* 左面板（Task 16 实化） */}
          <div className="w-[260px] border-r border-[#E5E7EB] [border-right-style:solid] bg-white"
            data-testid="asset-panel-placeholder">
            <span className="text-[12px] text-[#86909C] p-3 inline-block">资产库（Task 16）</span>
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            <PreviewPlaceholder />
            <TimelinePanel />
          </div>
          {/* 右面板（Plan 3 四态） */}
          <div className="w-[280px] border-l border-[#E5E7EB] [border-left-style:solid] bg-white">
            <span className="text-[12px] text-[#86909C] p-3 inline-block">属性面板（Plan 3）</span>
          </div>
        </div>
      </div>
    </BaseFullscreenModal>
  );
}
```

> **Step 5 注（占位组件先行）**：本 task 同步创建两个最小占位避免 import 断裂，后续 task 替换实现——`EditorTopBar.tsx`（`export function EditorTopBar() { return <div data-testid="editor-top-bar" className="h-12 flex items-center px-4 bg-white border-b border-[#E5E7EB] [border-bottom-style:solid]"><span className="text-[15px] font-medium text-[#1F2329]">多轨剪辑</span></div>; }`）；`timeline/TimelinePanel.tsx`（`export function TimelinePanel() { return <div data-testid="timeline-panel" className="h-[280px] border-t border-[#E5E7EB] [border-top-style:solid] bg-white" />; }`）。

[useGroupKeyboard.ts](apps/web/src/hooks/useGroupKeyboard.ts) L8-9 开头插入（import 区加 `import { useVideoEditorStore } from '@/stores/videoEditorStore';`）：

```ts
export function isGroupEditContext(target: HTMLElement | null): boolean {
  // 视频编辑器打开期间画布快捷键禁用（spec 第五节；document keydown 是冒泡阶段，捕获层 stopPropagation 挡不住，此处为现成早退点）
  if (useVideoEditorStore.getState().open) return true;
  const ns = useNodeStore.getState();
```

[page.tsx](apps/web/src/pages/canvas/page.tsx)：import 区加 `import { VideoEditorShell } from './video-editor/components/VideoEditorShell';`；`<ReactFlowProvider>` 内 L295-298 的 modal 群（`MaterialLibraryModal` 等）之后平级追加一行：

```tsx
        <VideoEditorShell />
```

（React 树挂画布根层保证画布不卸载、左面板可读整个 nodeStore；DOM 层经 BaseFullscreenModal 的 createPortal 挂 document.body——spec 挂载结构节。）

- [ ] **Step 6: 跑测试 + 提交**

```bash
pnpm -C apps/web exec vitest run src/components/BaseFullscreenModal.test.tsx src/pages/canvas/video-editor/components/VideoEditorShell.test.tsx
pnpm -C apps/web test
# 预期: 全绿（isGroupEditContext 变更不破既有快捷键测试）
git add apps/web/src && git commit -m "feat(video-editor): 全屏外壳——closeOnBackdrop 开关/画布根层挂载/快捷键隔离早退（TDD）"
```

---

### Task 12: videoProjectApi + 工程加载时序 + autosave persist + 顶栏三态

**Files:**
- Create: `apps/web/src/api/videoProjectApi.ts`
- Create: `apps/web/src/pages/canvas/video-editor/persist/autosave.ts`
- Modify: `apps/web/src/pages/canvas/video-editor/components/EditorTopBar.tsx`（占位 → 实现）
- Modify: `apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.tsx`（加载时序 + autosave 接线）
- Modify: `apps/web/src/stores/canvasStore.ts:203`（deleteNode 对 videoEdit 级联删工程——spec 生命周期规则）
- Test: `autosave.test.ts` + `canvasStore.test.ts` 增用例

- [ ] **Step 1: 实现 api client（纯透传，无独立测试——apiFetch 惯例）**

```ts
// apps/web/src/api/videoProjectApi.ts
import { apiFetch } from './client';

export interface VideoProjectDto {
  id: string;
  sourceNodeId: string;
  workflowId: string;
  title: string;
  data: import('@flowweb/shared').ProjectData;
  updatedAt: string;
}

/** 首次全屏编辑 upsert by sourceNodeId（幂等防双击；update 分支亦返回全量） */
export function upsertProject(input: { workflowId: string; sourceNodeId: string; title: string }): Promise<VideoProjectDto> {
  return apiFetch('/video-projects', { method: 'POST', body: JSON.stringify(input) });
}

export async function getProjectByNode(sourceNodeId: string): Promise<VideoProjectDto | null> {
  try {
    return await apiFetch(`/video-projects/by-node/${sourceNodeId}`);
  } catch (e: any) {
    if (e?.status === 404) return null; // 工程不存在=空态（添加节点不建工程）
    throw e;
  }
}

export function patchProject(id: string, body: { data: unknown; baseUpdatedAt: string }): Promise<VideoProjectDto> {
  return apiFetch(`/video-projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
```

（若 apiFetch 抛错未附 status：读 `apps/web/src/api/client.ts` 实际实现把 404 判断对齐其错误形状——`instanceof Error && (e as any).status === 404` 或 message 匹配，以现码为准。）

- [ ] **Step 2: 写失败测试（autosave——spec 第三节自动保存全部规则）**

```ts
// apps/web/src/pages/canvas/video-editor/persist/autosave.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAutosaveController, type AutosaveDeps } from './autosave';

const mkDeps = (over: Partial<AutosaveDeps> = {}): AutosaveDeps & { patch: any } => {
  const state = { data: { v: 1 }, baseUpdatedAt: 't0' };
  const deps: any = {
    getProjectId: () => 'p1',
    patch: vi.fn().mockResolvedValue({ updatedAt: 't1' }),
    getData: () => ({ ...state }),
    onSaved: (t: string) => { state.baseUpdatedAt = t; },
    onStateChange: vi.fn(),
    onConflict: vi.fn(),
    isConnected: () => true,
    ...over,
  };
  return deps;
};

describe('autosave（1.5s 防抖 + PATCH 单飞 latest-wins + 乐观锁回填 + 重试 + 离线 + flush）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('防抖：1.5s 内多次 notify 只一次 PATCH', async () => {
    const deps = mkDeps();
    const c = createAutosaveController(deps);
    c.notifyChange(); c.notifyChange(); c.notifyChange();
    expect(deps.patch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(deps.patch).toHaveBeenCalledTimes(1);
    expect(deps.patch).toHaveBeenCalledWith('p1', { data: { v: 1 }, baseUpdatedAt: 't0' }); // projectId 取 deps.getProjectId
    c.dispose();
  });

  it('单飞：PATCH 进行中有新改动 → 完成后 latest-wins 排队补一发', async () => {
    let resolveFirst: (v: any) => void = () => {};
    const deps = mkDeps({ patch: vi.fn()
      .mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }))
      .mockResolvedValueOnce({ updatedAt: 't2' }) });
    const c = createAutosaveController(deps);
    c.notifyChange();
    await vi.advanceTimersByTimeAsync(1500); // 第一发发出（pending）
    let dataV = 1;
    deps.getData = () => ({ data: { v: ++dataV }, baseUpdatedAt: 't1' });
    c.notifyChange(); // 进行中改动 → 排队
    await vi.advanceTimersByTimeAsync(1500); // 防抖到期但 inFlight → 不发第二发
    expect(deps.patch).toHaveBeenCalledTimes(1);
    resolveFirst({ updatedAt: 't1' });
    await vi.advanceTimersByTimeAsync(0);   // 完成后补发 latest-wins
    expect(deps.patch).toHaveBeenCalledTimes(2);
    expect(deps.patch).toHaveBeenLastCalledWith('p1', { data: { v: 2 }, baseUpdatedAt: 't1' });
    c.dispose();
  });

  it('updatedAt 回填（onSaved）+ saved 状态', async () => {
    const deps = mkDeps();
    const c = createAutosaveController(deps);
    c.notifyChange();
    await vi.advanceTimersByTimeAsync(1500);
    expect(deps.onSaved).toHaveBeenCalledWith('t1');
    expect(deps.onStateChange).toHaveBeenCalledWith('saving');
    expect(deps.onStateChange).toHaveBeenLastCalledWith('saved');
    c.dispose();
  });

  it('409 → onConflict 且停止自动保存（不自打自冲突）', async () => {
    const err = Object.assign(new Error('conflict'), { status: 409 });
    const deps = mkDeps({ patch: vi.fn().mockRejectedValue(err) });
    const c = createAutosaveController(deps);
    c.notifyChange();
    await vi.advanceTimersByTimeAsync(1500);
    expect(deps.onConflict).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(deps.patch).toHaveBeenCalledTimes(1); // 不重试
    c.dispose();
  });

  it('失败指数退避 1s/4s/16s 自动重试 3 次，期间状态点保持 error', async () => {
    const deps = mkDeps({ patch: vi.fn().mockRejectedValue(new Error('network')) });
    const c = createAutosaveController(deps);
    c.notifyChange();
    await vi.advanceTimersByTimeAsync(1500);
    expect(deps.onStateChange).toHaveBeenLastCalledWith('error');
    await vi.advanceTimersByTimeAsync(1000);  // 第 1 次重试
    expect(deps.patch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);  // 第 2 次
    expect(deps.patch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(16000); // 第 3 次
    expect(deps.patch).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60000); // 3 次后停止
    expect(deps.patch).toHaveBeenCalledTimes(4);
    c.dispose();
  });

  it('离线暂停：connected 前不发；notifyConnected 立即 flush', async () => {
    const deps = mkDeps({ isConnected: () => false });
    const c = createAutosaveController(deps);
    c.notifyChange();
    await vi.advanceTimersByTimeAsync(10000);
    expect(deps.patch).not.toHaveBeenCalled();
    deps.isConnected = () => true;
    c.notifyConnected();
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.patch).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it('flush：立即发 + await 排空（收起时序）', async () => {
    const deps = mkDeps();
    const c = createAutosaveController(deps);
    c.notifyChange();
    const p = c.flush();
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(deps.patch).toHaveBeenCalledTimes(1);
    c.dispose();
  });
});
```

- [ ] **Step 3: 确认失败 → 实现 autosave controller**

```ts
// apps/web/src/pages/canvas/video-editor/persist/autosave.ts

export const AUTOSAVE_DEBOUNCE_MS = 1500;
const RETRY_DELAYS_MS = [1000, 4000, 16000];

export interface AutosaveDeps {
  getProjectId: () => string;
  patch: (id: string, body: { data: unknown; baseUpdatedAt: string }) => Promise<{ updatedAt: string }>;
  getData: () => { data: unknown; baseUpdatedAt: string };
  onSaved: (updatedAt: string) => void;
  onStateChange: (s: 'saving' | 'saved' | 'error') => void;
  onConflict: () => void;
  isConnected: () => boolean;
}

export interface AutosaveController {
  notifyChange(): void;
  /** 协作连接恢复 connected 时调用：有待存数据立即补发 */
  notifyConnected(): void;
  /** 收起/ESC 用：立即执行排队保存并 await 排空 */
  flush(): Promise<void>;
  dispose(): void;
}

export function createAutosaveController(deps: AutosaveDeps): AutosaveController {
  let dirty = false;
  let inFlight = false;
  let queued = false;
  let retryCount = 0;
  let disposed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const clearDebounce = () => {
    if (debounceTimer != null) { clearTimeout(debounceTimer); debounceTimer = null; }
  };

  const doSave = async (): Promise<void> => {
    if (inFlight || disposed) { queued = true; return; }
    if (!deps.isConnected()) return; // 离线暂停——notifyConnected 恢复
    inFlight = true;
    dirty = false;
    deps.onStateChange('saving');
    const body = deps.getData();
    try {
      const r = await deps.patch(deps.getProjectId(), body);
      deps.onSaved(r.updatedAt); // 回填 baseUpdatedAt
      deps.onStateChange('saved');
      retryCount = 0;
    } catch (e: any) {
      if (e?.status === 409) {
        deps.onConflict(); // 他处修改：停止自动保存（半自动恢复留给用户）
        dirty = false;
        deps.onStateChange('error');
      } else if (retryCount < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[retryCount++];
        deps.onStateChange('error'); // 重试期间状态点保持红
        debounceTimer = setTimeout(() => { debounceTimer = null; void doSave(); }, delay);
      } else {
        deps.onStateChange('error'); // 3 次退避后停（红点可手动重试 = flush）
      }
    } finally {
      inFlight = false;
    }
    if ((queued || dirty) && !disposed && debounceTimer == null) {
      queued = false;
      void doSave(); // latest-wins：排队改动用最新 data 补发
    }
  };

  return {
    notifyChange: () => {
      if (disposed) return;
      dirty = true;
      clearDebounce();
      debounceTimer = setTimeout(() => { debounceTimer = null; void doSave(); }, AUTOSAVE_DEBOUNCE_MS);
    },
    notifyConnected: () => {
      if (disposed) return;
      if (dirty || queued) { clearDebounce(); void doSave(); }
    },
    flush: async () => {
      if (disposed) return;
      clearDebounce();
      if (dirty || queued) await doSave();
      while (inFlight) await new Promise(r => setTimeout(r, 10)); // await 排空（fake timers 下 flush 已同步路径覆盖主流程）
    },
    dispose: () => {
      disposed = true;
      clearDebounce();
    },
  };
}
```

- [ ] **Step 4: EditorTopBar 实现（三态状态点 + 收起 + 导出占位）**

```tsx
// apps/web/src/pages/canvas/video-editor/components/EditorTopBar.tsx（替换 Task 11 占位）
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { useEditorStore } from '../store/editorStore';

const SAVE_DOT: Record<string, { color: string; title: string }> = {
  saved: { color: '#00B42A', title: '已保存' },
  saving: { color: '#86909C', title: '保存中…' },
  error: { color: '#F53F3F', title: '保存失败，点击重试' },
};

export function EditorTopBar({ onManualRetry }: { onManualRetry?: () => void }) {
  const close = useVideoEditorStore((s) => s.close);
  const saveState = useEditorStore((s) => s.saveState);
  const dot = SAVE_DOT[saveState];
  return (
    <div data-testid="editor-top-bar"
      className="h-12 flex items-center gap-4 px-4 bg-white border-b border-[#E5E7EB] [border-bottom-style:solid] box-border">
      <span className="text-[15px] font-medium text-[#1F2329]">多轨剪辑</span>
      <button type="button" title={dot.title} onClick={onManualRetry}
        className="w-2.5 h-2.5 rounded-full border-0 cursor-pointer"
        style={{ background: dot.color }} data-testid="save-state-dot" />
      <span className="text-[12px] text-[#86909C]">16:9</span>
      <div className="ml-auto flex items-center gap-3">
        <button type="button" disabled title="导出（Plan 4 开放）"
          className="text-[14px] text-white bg-[#1F2329] rounded-full px-4 py-1.5 border-0 cursor-not-allowed opacity-50">
          导出
        </button>
        <button type="button" onClick={close}
          className="text-[14px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-2 py-1">
          收起
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Shell 接线（加载时序 + autosave 集成 + flush 后关闭）**

[VideoEditorShell.tsx](apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.tsx) 顶部逻辑替换为（布局 JSX 保持 Task 11 形状，`EditorTopBar` 传 `onManualRetry`）：

```tsx
import { useEffect, useRef } from 'react';
import { message } from 'antd';
import { BaseFullscreenModal } from '@/components/BaseFullscreenModal';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useEditorStore } from '../store/editorStore';
import { createAutosaveController, type AutosaveController } from '../persist/autosave';
import { upsertProject } from '@/api/videoProjectApi';
import { EditorTopBar } from './EditorTopBar';
import { PreviewPlaceholder } from './PreviewPlaceholder';
import { TimelinePanel } from './timeline/TimelinePanel';

export function VideoEditorShell() {
  const open = useVideoEditorStore((s) => s.open);
  const sourceNodeId = useVideoEditorStore((s) => s.sourceNodeId);
  const close = useVideoEditorStore((s) => s.close);
  const editorStatus = useEditorStore((s) => s.status);
  const loadError = useEditorStore((s) => s.loadError);
  const autosaveRef = useRef<AutosaveController | null>(null);

  // 入口时序：open → reset + loading → POST upsert → loadProject（未返回前空态加载占位+禁编辑由 status 驱动）
  useEffect(() => {
    if (!open || !sourceNodeId) return;
    let cancelled = false;
    const es = useEditorStore.getState();
    es.reset();
    useEditorStore.setState({ status: 'loading' });
    upsertProject({ workflowId: useCanvasStore.getState().projectId!, sourceNodeId, title: '多轨剪辑' })
      .then((p) => { if (!cancelled) useEditorStore.getState().loadProject(p); })
      .catch((e: Error) => { if (!cancelled) useEditorStore.getState().setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [open, sourceNodeId]);

  // autosave 生命周期：open 时创建 + data 订阅 + connStatus 恢复补发；关闭时 flush 排空后 dispose
  useEffect(() => {
    if (!open || !sourceNodeId) return;
    const ctrl = createAutosaveController({
      getProjectId: () => useEditorStore.getState().projectId!,
      patch: (id, body) => patchProject(id, body),
      getData: () => {
        const s = useEditorStore.getState();
        return { data: s.data, baseUpdatedAt: s.baseUpdatedAt! };
      },
      onSaved: (t) => useEditorStore.getState().setBaseUpdatedAt(t),
      onStateChange: (s) => useEditorStore.getState().setSaveState(s),
      onConflict: () => message.warning('工程已在其他窗口修改，自动保存已暂停'),
      isConnected: () => useCanvasStore.getState().connStatus === 'connected',
    });
    autosaveRef.current = ctrl;
    const unsubData = useEditorStore.subscribe((s, prev) => {
      if (s.data !== prev.data && s.status === 'ready') ctrl.notifyChange();
    });
    let wasConnected = useCanvasStore.getState().connStatus === 'connected';
    const unsubConn = useCanvasStore.subscribe((s, prev) => {
      const nowConn = s.connStatus === 'connected';
      if (nowConn && !wasConnected) ctrl.notifyConnected();
      wasConnected = nowConn;
    });
    return () => { unsubData(); unsubConn(); ctrl.dispose(); autosaveRef.current = null; };
  }, [open, sourceNodeId]);

  // 关闭 = flush 排空后 close（spec：收起 flush 走同一队列并 await 排空再关；ESC 同路径）
  const handleClose = () => {
    const ctrl = autosaveRef.current;
    if (ctrl) { void ctrl.flush().catch(() => {}).finally(() => close()); }
    else close();
  };

  if (!open) return null;
  return (
    <BaseFullscreenModal open={open} onClose={handleClose} label="多轨剪辑" closeOnBackdrop={false}>
      {/* …布局 JSX 同 Task 11，EditorTopBar 改 <EditorTopBar onManualRetry={() => { void autosaveRef.current?.flush(); }} />，
           中列在 loading/error 时渲染占位（TimelinePanel 内部已按 status 分支，此处不重复）… */}
    </BaseFullscreenModal>
  );
}
```

（`patchProject` 从 `@/api/videoProjectApi` import；loading/error 分支渲染放 TimelinePanel 内部统一处理，Shell 保持骨架。）

- [ ] **Step 5.5: 删除剪辑节点级联删工程（spec 生命周期规则第 1 条——防无入口孤儿）**

[videoProjectApi.ts](apps/web/src/api/videoProjectApi.ts) 追加：

```ts
/** 删除剪辑节点时 fire-and-forget 调用（仅删工程记录，引用 Media 不动） */
export function deleteProjectByNode(sourceNodeId: string): Promise<void> {
  return apiFetch(`/video-projects/by-node/${sourceNodeId}`, { method: 'DELETE' });
}
```

[canvasStore.ts](apps/web/src/stores/canvasStore.ts) deleteNode（L203 起）在 `const state = get();` 之后、结构 set 之前插入（顶部 import 区加 `import { deleteProjectByNode } from '@/api/videoProjectApi';`）：

```ts
    // videoEdit 节点：级联删除 VideoProject（fire-and-forget——失败上报不阻塞画布删除；边由下方 edges.filter 级联清除）
    if (state.nodes.find((n) => n.id === id)?.type === 'videoEdit') {
      deleteProjectByNode(id).catch((err) => {
        console.error('[video-editor] delete project failed:', err); // 静默孤儿无法排查——失败必须留痕（项目暂无 Sentry 接入，console.error 先行）
      });
    }
```

[canvasStore.test.ts](apps/web/src/stores/canvasStore.test.ts) 顶部（import 区之后）**显式加 mock**——该文件现状无任何 vi.mock，动态 import 拿到真模块、`vi.mocked().mockResolvedValue` 运行时会抛 TypeError（R1 审核 P1-1）；vi.mock 提升语义也要求静态配套：

```ts
// canvasStore.test.ts 顶部追加
import { deleteProjectByNode } from '@/api/videoProjectApi';
vi.mock('@/api/videoProjectApi', () => ({ deleteProjectByNode: vi.fn().mockResolvedValue(undefined) }));
```

文件末尾追加用例（静态 import 引用）：

```ts
describe('deleteNode videoEdit 级联删工程', () => {
  it('删除 videoEdit 节点触发 deleteProjectByNode（fire-and-forget）', () => {
    useCanvasStore.setState({
      nodes: [{ id: 'e1', type: 'videoEdit', position: { x: 0, y: 0 }, data: {} } as any],
      edges: [],
      selectedId: null,
    });
    useCanvasStore.getState().deleteNode('e1');
    expect(vi.mocked(deleteProjectByNode)).toHaveBeenCalledWith('e1');
  });
});
```

> 依赖边核验（审核已确认）：canvasStore → videoProjectApi → client（client.ts 零 import）→ 无环；canvasStore → api/mediaApi 是既有先例（L14），同层新增无碍。deleteTransformNode（L237-250）同样级联删边但不含 videoEdit 分支——videoEdit 不走 transform 流程，现状无影响，登记不改（R1 审核 P2-3）。

- [ ] **Step 6: 跑测试 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/persist/autosave.test.ts src/pages/canvas/video-editor/components/VideoEditorShell.test.tsx
git add apps/web/src && git commit -m "feat(video-editor): 工程加载时序 + autosave 单飞/重试/离线/flush + 顶栏三态（TDD）"
```

---

### Task 13: 协作桥 origin 隔离——syncAutoEdgesToDoc + 订阅跳前缀 + onRemote shadow- 短路

spec 第二节连线同步规则第 3 条 + v3.6 R8 P0-A2 定稿。机制认知引用 Plan 1 Task 9：**Yjs transaction.origin 不跨网络传输**——本地事务（本任务的 AutoEdge）origin 在本地 UndoManager 可见（隔离生效的机制基础）；远端事务（A1 影子）origin 不可见（短路判据必须用 `shadow-` id 前缀）。

**Files:**
- Modify: `apps/web/src/stores/canvasUndo.ts:5-7`（Origin 扩 AutoEdge）
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（syncStoreToDoc 跳前缀 + syncAutoEdgesToDoc + bindBridge 调用点 + onRemote 短路）
- Test: `apps/web/src/stores/canvasUndo.test.ts` 增用例 + 新建 `apps/web/src/stores/canvasCollabRuntime.auto-edge.test.ts`

- [ ] **Step 1: 写失败测试（canvasUndo——AutoEdge 不入栈）**

[canvasUndo.test.ts](apps/web/src/stores/canvasUndo.test.ts) 既有"local-user 入栈；server/null 不入栈"用例旁追加：

```ts
it('auto-edge origin 不入撤销栈（跨撤销栈隔离——spec 验收 20）', () => {
  const doc = new Y.Doc();
  const um = attachUndoManager(doc);
  doc.transact(() => { doc.getMap('edges').set('auto:e1:s1', new Y.Map()); }, Origin.AutoEdge);
  expect(um.undoStack.length).toBe(0);
  detachUndoManager();
});
```

（import 区把 `Origin` 解构补齐；若既有用例已有同构断言结构，跟随其 setup 模式。）

- [ ] **Step 2: 写失败测试（桥层 auto 边对账 + 影子短路）**

```ts
// apps/web/src/stores/canvasCollabRuntime.auto-edge.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { attachUndoManager, detachUndoManager, Origin } from './canvasUndo';
import { syncAutoEdgesToDoc, isShadowOnlyEvents } from './canvasCollabRuntime';
import { autoEdgeId } from './autoEdgeIds';

describe('syncAutoEdgesToDoc（无业务参数幂等全量对账）', () => {
  let doc: Y.Doc; let um: Y.UndoManager;
  beforeEach(() => {
    doc = new Y.Doc();
    um = attachUndoManager(doc);
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null });
  });
  afterEach(() => detachUndoManager());

  it('store 新增 auto 边 → doc 建边且 origin=AutoEdge', () => {
    const cs = useCanvasStore.getState();
    cs.addEdge('s1', 'edit1', undefined, undefined, autoEdgeId('edit1', 's1'));
    syncAutoEdgesToDoc(doc);
    const e = doc.getMap('edges').get(autoEdgeId('edit1', 's1')) as Y.Map<any>;
    expect(e).toBeInstanceOf(Y.Map);
    expect(e.get('source')).toBe('s1');
    expect(e.get('target')).toBe('edit1');
    expect(um.undoStack.length).toBe(0); // AutoEdge 不入栈
  });

  it('store 删除（删节点级联）→ doc 边消失（孤儿 auto 边封堵，spec 验收 29）', () => {
    const cs = useCanvasStore.getState();
    cs.addEdge('s1', 'edit1', undefined, undefined, autoEdgeId('edit1', 's1'));
    syncAutoEdgesToDoc(doc);
    useCanvasStore.setState({ edges: [] }); // deleteNode 级联等价
    syncAutoEdgesToDoc(doc);
    expect(doc.getMap('edges').get(autoEdgeId('edit1', 's1'))).toBeUndefined();
  });

  it('幂等：连续两次对账 undoStack 不增长（spec 验收 26）', () => {
    const cs = useCanvasStore.getState();
    cs.addEdge('s1', 'edit1', undefined, undefined, autoEdgeId('edit1', 's1'));
    syncAutoEdgesToDoc(doc);
    const n = um.undoStack.length;
    syncAutoEdgesToDoc(doc);
    syncAutoEdgesToDoc(doc);
    expect(um.undoStack.length).toBe(n);
  });

  it('手动边（无前缀）不被对账触碰', () => {
    doc.getMap('edges').set('edge_1', (() => { const m = new Y.Map(); m.set('source', 'a'); m.set('target', 'b'); return m; })());
    syncAutoEdgesToDoc(doc);
    expect(doc.getMap('edges').get('edge_1')).toBeDefined(); // 未被删
  });

  it('doc 侧多余的 auto 边（远端残留）被清', () => {
    doc.transact(() => {
      const m = new Y.Map(); m.set('source', 'old'); m.set('target', 'x');
      doc.getMap('edges').set('auto:x:old', m);
    }, Origin.LocalUser);
    syncAutoEdgesToDoc(doc);
    expect(doc.getMap('edges').get('auto:x:old')).toBeUndefined();
  });
});

describe('isShadowOnlyEvents（A1 影子事务短路判定——id 前缀，origin 不过网）', () => {
  it('事件形状固化：nodes map 顶层 set 产生 path=[] 且 target=nodesMap 的事件（实现判定的基础事实，防 yjs 行为漂移）', () => {
    const client = new Y.Doc();
    const nodesMap = client.getMap('nodes');
    let shape: { pathLen: number; isTargetNodesMap: boolean } | null = null;
    nodesMap.observeDeep((es) => {
      for (const ev of es as any[]) {
        shape = { pathLen: ev.path.length, isTargetNodesMap: ev.target === nodesMap };
      }
    });
    client.transact(() => { nodesMap.set('x', new Y.Map()); }, 'network');
    expect(shape).toEqual({ pathLen: 0, isTargetNodesMap: true });
  });

  it('仅影子节点 insert → true（不触发 applyDocToStore 全量重建）', () => {
    const server = new Y.Doc();
    const client = new Y.Doc();
    server.on('update', (u) => Y.applyUpdate(client, u, 'network'));
    let hit = false; // hit 末值模式——不依赖 observeDeep 单事务派发几条事件（R1 审核 P1-2）
    client.getMap('nodes').observeDeep((es) => { hit = isShadowOnlyEvents(es, client.getMap('nodes')); });
    server.transact(() => {
      server.getMap('nodes').set('shadow-video-1', new Y.Map());
    }, 'server-shadow');
    expect(hit).toBe(true);
  });

  it('普通节点变更 → false', () => {
    const client = new Y.Doc();
    let hit = true; // 初值取反侧——observeDeep 若未触发则失败，保证锁力
    client.getMap('nodes').observeDeep((es) => { hit = isShadowOnlyEvents(es, client.getMap('nodes')); });
    client.transact(() => {
      client.getMap('nodes').set('normal-1', new Y.Map());
    }, 'network');
    expect(hit).toBe(false);
  });

  it('影子+普通混合事务 → false（保守全量重建）', () => {
    const client = new Y.Doc();
    let hit = true;
    client.getMap('nodes').observeDeep((es) => { hit = isShadowOnlyEvents(es, client.getMap('nodes')); });
    client.transact(() => {
      client.getMap('nodes').set('shadow-1', new Y.Map());
      client.getMap('nodes').set('normal-1', new Y.Map());
    }, 'network');
    expect(hit).toBe(false);
  });

  it('影子节点 data 写回（深层事件）→ true', () => {
    const client = new Y.Doc();
    const shadow = new Y.Map<any>();
    client.transact(() => { client.getMap('nodes').set('shadow-1', shadow); }, 'network');
    let hit = false;
    client.getMap('nodes').observeDeep((es) => { hit = isShadowOnlyEvents(es, client.getMap('nodes')); });
    client.transact(() => {
      const m = client.getMap('nodes').get('shadow-1') as Y.Map<any>;
      m.set('data', new Y.Map());
    }, 'network');
    expect(hit).toBe(true);
  });

  it('edges map 事件 → false（只有 nodes 的 shadow 事务才短路）', () => {
    const client = new Y.Doc();
    let hit = true;
    client.getMap('edges').observeDeep((es) => { hit = isShadowOnlyEvents(es as any, client.getMap('nodes')); });
    client.transact(() => {
      client.getMap('edges').set('auto:e:s', new Y.Map());
    }, 'network');
    expect(hit).toBe(false);
  });
});
```

- [ ] **Step 3: 确认失败 → Step 4: 实现**

[canvasUndo.ts](apps/web/src/stores/canvasUndo.ts) L5-7 替换：

```ts
/** spec 全局约定 Origin 常量——trackedOrigins 唯一入栈者 */
// Server 为后端 withDoc transact 预留常量；AutoEdge 为自动边专用 origin——刻意不加入 trackedOrigins（画布撤销栈不收自动边，spec 验收 20/26）
export const Origin = { LocalUser: 'local-user', Server: 'server', AutoEdge: 'auto-edge' } as const;
```

[canvasCollabRuntime.ts](apps/web/src/stores/canvasCollabRuntime.ts) 四处修改：

① import 区补 `import { isAutoEdgeId } from './autoEdgeIds';`

② **syncStoreToDoc 边处理两处跳过 auto 前缀**（auto 边全生命周期只归 syncAutoEdgesToDoc——spec R7 P0-A）：

```ts
    for (const id of [...edgesMap.keys()]) {
      if (isAutoEdgeId(id)) continue; // auto 边删除只归 syncAutoEdgesToDoc（防订阅误删）
      if (!edgeIds.has(id)) edgesMap.delete(id);
    }
    for (const e of edges) {
      if (isAutoEdgeId(e.id)) continue; // auto 边新增/更新只归 syncAutoEdgesToDoc
      const existing = edgesMap.get(e.id);
```

③ **新增导出 syncAutoEdgesToDoc**（放 syncStoreToDoc 之后）：

```ts
/** 自动边全量对账（无业务参数——id 自编码 editNodeId）：store 侧 auto 边为期望态，doc 补齐增删。
 *  独立 transact origin=AutoEdge（不入画布撤销栈）。幂等——覆盖删节点级联/手删 auto 边/编辑器 reconcile 全场景（spec v3.6 R8 P0-A2）。 */
export function syncAutoEdgesToDoc(d: Y.Doc) {
  const expected = useCanvasStore.getState().edges
    .filter((e) => isAutoEdgeId(e.id))
    .map((e) => ({ id: e.id, source: e.source, target: e.target }));
  const edgesMap = d.getMap('edges');
  const expectedIds = new Set(expected.map((e) => e.id));
  const docAutoIds = [...edgesMap.keys()].filter(isAutoEdgeId);
  const toAdd = expected.filter((e) => !edgesMap.get(e.id));
  const toRemove = docAutoIds.filter((id) => !expectedIds.has(id));
  if (toAdd.length === 0 && toRemove.length === 0) return;
  d.transact(() => {
    for (const e of toAdd) {
      const m = new Y.Map();
      m.set('source', e.source);
      m.set('target', e.target);
      edgesMap.set(e.id, m);
    }
    for (const id of toRemove) edgesMap.delete(id);
  }, Origin.AutoEdge);
}
```

④ **bindBridge 订阅边变更分支先对账**（L145-159 的 unsubCs 回调）：

```ts
    if (changed) {
      syncAutoEdgesToDoc(doc!); // 先 auto 边对账（覆盖删节点级联留孤儿场景），再常规同步（其内部已跳过 auto 前缀）
      syncStoreToDoc(Origin.LocalUser);
    }
```

⑤ **新增导出 isShadowOnlyEvents + onRemote 短路**：

```ts
/** A1 影子事务短路判定（Plan 1 Task 9 固化：origin 不过网，跨网判据必须用 id 前缀）：
 *  本次 events 全部仅涉及 nodes map 上 shadow- 前缀节点（含深层 data 写回）→ 跳过 applyDocToStore 全量重建（防闪烁，spec 验收 22） */
export function isShadowOnlyEvents(events: Y.YEvent<any>[], nodesMap: Y.Map<any>): boolean {
  for (const ev of events) {
    let root: any = ev.target;
    while (root?.parent != null) root = root.parent;
    if (root !== nodesMap) return false; // edges/其他结构事件不短路
    if (ev.path.length > 0) {
      const nodeKey = ev.path[0];
      if (typeof nodeKey !== 'string' || !nodeKey.startsWith('shadow-')) return false;
    } else {
      // nodes map 顶层 set/delete：所有变更 key 须为 shadow- 前缀
      let hasKey = false;
      for (const k of ev.keys.keys()) {
        hasKey = true;
        if (!k.startsWith('shadow-')) return false;
      }
      if (!hasKey) return false;
    }
  }
  return true;
}
```

onRemote（initCollab 内 L201-211 附近）在 LocalUser 回环判断之后追加：

```ts
      if (isShadowOnlyEvents(events, doc.getMap('nodes'))) return; // 影子 insert/remove/data 写回不触发全量重建
```

（observeDeep 两个绑定点 L212-213 的回调保持既有 events 参数透传到 onRemote。）

- [ ] **Step 5: 跑测试 + 全量回归 + 提交**

```bash
pnpm -C apps/web exec vitest run src/stores/canvasCollabRuntime.auto-edge.test.ts src/stores/canvasUndo.test.ts
pnpm -C apps/web test
# 预期: 全绿（事件形状已由首个"形状固化"用例锁定：path=[] / target=nodesMap——
# 若该用例失败说明 yjs 实际派发形状与此不同，先修 isShadowOnlyEvents 的判定再继续，禁止改断言迁就实现）
git add apps/web/src && git commit -m "feat(video-editor): 协作桥 origin 隔离——syncAutoEdgesToDoc 全量对账/订阅跳 auto 前缀/影子 onRemote 短路（TDD）"
```

---

### Task 14: 时间轴 UI——静态渲染

spec 第五节可测性红线：像素换算/命中/阈值全部纯函数（Task 3/4 已落），组件只绑 pointer 事件。

**Files:**
- Modify: `apps/web/src/pages/canvas/video-editor/components/timeline/TimelinePanel.tsx`（占位 → 实现）
- Create: `apps/web/src/pages/canvas/video-editor/components/timeline/TimelineRuler.tsx` + `TrackRow.tsx` + `ClipBlock.tsx`
- Test: `apps/web/src/pages/canvas/video-editor/components/timeline/TimelinePanel.render.test.tsx`

- [ ] **Step 1: 写失败测试（静态渲染）**

```tsx
// apps/web/src/pages/canvas/video-editor/components/timeline/TimelinePanel.render.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimelinePanel } from './TimelinePanel';
import { useEditorStore } from '../../store/editorStore';
import { createDefaultProjectData, type ProjectData } from '../../types';

const dataWithClips = (): ProjectData => {
  const d = createDefaultProjectData();
  const videoTrack = d.tracks[0];
  const subTrack = d.tracks[1];
  d.clips['v1'] = { id: 'v1', trackId: videoTrack.id, type: 'video', start: 0, duration: 3, sourceStart: 0, mediaId: 'm1', sourceNodeId: 's1', playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] };
  d.clips['a1'] = { id: 'a1', trackId: d.tracks[2].id, type: 'audio', start: 1, duration: 2, sourceStart: 0, mediaId: 'm2', playbackSpeed: 1, volume: 1, fade: { in: 0, out: 0 }, keyframes: [] };
  d.clips['sub1'] = { id: 'sub1', trackId: subTrack.id, type: 'subtitle', start: 0, duration: 2, text: '你好', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 } };
  videoTrack.clips.push('v1');
  d.tracks[2].clips.push('a1');
  subTrack.clips.push('sub1');
  return d;
};

describe('TimelinePanel 静态渲染', () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
  });
  it('status=loading → 加载占位（打开等待禁编辑，spec 入口时序）', () => {
    useEditorStore.setState({ status: 'loading', data: null });
    render(<TimelinePanel />);
    expect(screen.getByTestId('timeline-loading')).toBeInTheDocument();
  });
  it('status=error → 错误态', () => {
    useEditorStore.setState({ status: 'error', loadError: '网络错误', data: null });
    render(<TimelinePanel />);
    expect(screen.getByTestId('timeline-error')).toBeInTheDocument();
    expect(screen.getByText('网络错误')).toBeInTheDocument();
  });
  it('ready → 渲染标尺/全部轨道/片段块与源时间码', () => {
    const d = dataWithClips();
    useEditorStore.setState({
      status: 'ready', data: d, projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't',
      mediaInfo: { m1: { name: '视频A', durationSec: 10 }, m2: { name: '音频B', durationSec: 5 } },
    });
    render(<TimelinePanel />);
    expect(screen.getByTestId('timeline-ruler')).toBeInTheDocument();
    d.tracks.forEach(t => expect(screen.getByTestId(`track-row-${t.id}`)).toBeInTheDocument());
    expect(screen.getByTestId('clip-block-v1')).toBeInTheDocument();
    expect(screen.getByTestId('clip-block-a1')).toBeInTheDocument();
    expect(screen.getByTestId('clip-block-sub1')).toBeInTheDocument();
    // 片段块显示"名称 · 源时间码"（HH:MM:SS:FF）——源时间码是素材内位置 sourceStart
    expect(screen.getByText(/视频A · 00:00:00:00/)).toBeInTheDocument();
    expect(screen.getByText(/音频B · 00:00:00:00/)).toBeInTheDocument();
    expect(screen.getByText('你好')).toBeInTheDocument(); // 字幕块显示文本
  });
  it('空轨渲染占位条，工具行有撤销/重做/分割/删除', () => {
    useEditorStore.setState({ status: 'ready', data: createDefaultProjectData(), projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't' });
    render(<TimelinePanel />);
    expect(screen.getByText('撤销')).toBeInTheDocument();
    expect(screen.getByText('重做')).toBeInTheDocument();
    expect(screen.getByText('分割')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 确认失败 → Step 3: 实现四个组件**

```tsx
// apps/web/src/pages/canvas/video-editor/components/timeline/ClipBlock.tsx
import { memo } from 'react';
import type { Clip } from '../../types';
import { formatTimecode } from '../../timeline/timecode';
import { timeToPx } from '../../timeline/view-scale';

const BLOCK_BG: Record<Clip['type'], string> = { video: '#EDE9FE', image: '#E0E7FF', audio: '#DCF7E8', subtitle: '#FFF6DC' };
const BLOCK_BAR: Record<Clip['type'], string> = { video: '#6C5CE7', image: '#5B7CFA', audio: '#43CC80', subtitle: '#FFC53D' };

export const CLIP_BLOCK_MIN_PX = 8;

interface ClipBlockProps {
  clip: Clip;
  pxPerSec: number;
  selected: boolean;
  mediaName?: string;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export const ClipBlock = memo(function ClipBlock({ clip, pxPerSec, selected, mediaName, onPointerDown }: ClipBlockProps) {
  const left = timeToPx(clip.start, pxPerSec);
  const width = Math.max(CLIP_BLOCK_MIN_PX, timeToPx(clip.duration, pxPerSec));
  const label = clip.type === 'subtitle'
    ? clip.text
    : `${mediaName ?? clip.mediaId} · ${formatTimecode(clip.type === 'video' || clip.type === 'audio' ? clip.sourceStart : 0)}`;
  return (
    <div
      data-testid={`clip-block-${clip.id}`}
      onPointerDown={onPointerDown}
      className="absolute top-1 bottom-1 rounded-md overflow-hidden box-border cursor-grab select-none"
      style={{
        left, width, background: BLOCK_BG[clip.type],
        border: `1px solid ${selected ? BLOCK_BAR[clip.type] : 'transparent'}`,
        boxShadow: selected ? `0 0 0 2px ${BLOCK_BAR[clip.type]}40` : undefined,
      }}
    >
      <div className="h-full flex items-center px-1.5" style={{ borderLeft: `3px solid ${BLOCK_BAR[clip.type]}` }}>
        <span className="text-[11px] text-[#4E5969] truncate whitespace-nowrap" style={{ minWidth: 0 }}>
          {label}
        </span>
      </div>
    </div>
  );
});
```

```tsx
// apps/web/src/pages/canvas/video-editor/components/timeline/TimelineRuler.tsx
import { totalDuration } from '../../timeline/timecode';
import { timeToPx, pxToTime } from '../../timeline/view-scale';
import { quantizeTime } from '../../timeline/clip-math';
import type { ProjectData } from '../../types';
import type React from 'react';

const INTERVALS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];

interface RulerProps {
  data: ProjectData;
  pxPerSec: number;
  playhead: number;
  widthPx: number;
  onSeek?: (t: number) => void;
}

export function TimelineRuler({ data, pxPerSec, playhead, widthPx, onSeek }: RulerProps) {
  const dur = totalDuration(data);
  const interval = INTERVALS.find(i => i * pxPerSec >= 60) ?? 60;
  const ticks: number[] = [];
  const startSec = 0;
  const endSec = dur + interval; // 余量一格
  for (let t = startSec; t <= endSec; t += interval) ticks.push(Number(t.toFixed(4)));
  const handlePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(quantizeTime(Math.max(0, pxToTime(e.clientX - rect.left, pxPerSec))));
  };
  return (
    <div data-testid="timeline-ruler"
      className="relative h-7 border-b border-[#E5E7EB] [border-bottom-style:solid] bg-white cursor-pointer select-none"
      style={{ width: Math.max(widthPx, timeToPx(dur, pxPerSec) + 60) }}
      onPointerDown={handlePointer}
    >
      {ticks.map(t => (
        <div key={t} className="absolute top-0 bottom-0 flex items-end" style={{ left: timeToPx(t, pxPerSec) }}>
          <div className="w-px h-2 bg-[#C9CDD4]" />
          <span className="absolute left-1 top-0.5 text-[10px] text-[#86909C]">{t}s</span>
        </div>
      ))}
      {/* 播放头（紫色，贯穿到轨道区由面板统一渲染竖线） */}
      <div className="absolute top-0 bottom-0 w-0.5 bg-[#6C5CE7]" style={{ left: timeToPx(playhead, pxPerSec) }} data-testid="playhead-ruler" />
    </div>
  );
}
```

```tsx
// apps/web/src/pages/canvas/video-editor/components/timeline/TrackRow.tsx
import { Popconfirm } from 'antd';
import type { ProjectData, Track } from '../../types';
import { totalDuration } from '../../timeline/timecode';
import { timeToPx } from '../../timeline/view-scale';
import { ClipBlock } from './ClipBlock';
import { useEditorStore } from '../../store/editorStore';

const TRACK_ICON: Record<Track['type'], string> = { video: '🎬', subtitle: '字幕', audio: '🎵' };

interface TrackRowProps {
  track: Track;
  data: ProjectData;
  onDropClip?: (e: React.DragEvent<HTMLDivElement>) => void;
  onSubtitleAdd?: (trackId: string) => void;
}

export function TrackRow({ track, data, onDropClip, onSubtitleAdd }: TrackRowProps) {
  const pxPerSec = useEditorStore(s => s.pxPerSec);
  const selectedClipId = useEditorStore(s => s.selectedClipId);
  const mediaInfo = useEditorStore(s => s.mediaInfo);
  const toggleTrack = useEditorStore(s => s.toggleTrack);
  const removeTrack = useEditorStore(s => s.removeTrack);
  const selectClip = useEditorStore(s => s.selectClip);

  return (
    <div data-testid={`track-row-${track.id}`} className="flex border-b border-[#F2F3F5] [border-bottom-style:solid]">
      {/* 轨道头 */}
      <div className="w-[140px] shrink-0 flex items-center gap-1 px-2 py-1.5 border-r border-[#E5E7EB] [border-right-style:solid] bg-[#FAFBFC] box-border">
        <span className="text-[12px] text-[#4E5969] truncate" style={{ minWidth: 0 }}>{TRACK_ICON[track.type]} {track.name}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {track.type === 'subtitle' && (
            <button type="button" title="该轨内新增字幕" onClick={() => onSubtitleAdd?.(track.id)}
              className="text-[12px] text-[#6C5CE7] bg-transparent border-0 cursor-pointer px-1">➕</button>
          )}
          <button type="button" title={track.muted ? '取消静音' : '静音'} onClick={() => toggleTrack(track.id, 'muted')}
            className={`text-[11px] bg-transparent border-0 cursor-pointer px-0.5 ${track.muted ? 'text-[#F53F3F]' : 'text-[#86909C]'}`}>M</button>
          <button type="button" title={track.hidden ? '取消隐藏' : '隐藏'} onClick={() => toggleTrack(track.id, 'hidden')}
            className={`text-[11px] bg-transparent border-0 cursor-pointer px-0.5 ${track.hidden ? 'text-[#F53F3F]' : 'text-[#86909C]'}`}>H</button>
          <Popconfirm title="删除轨道将连同片段一起删除" okText="删 除" cancelText="取 消"
            onConfirm={() => removeTrack(track.id)}>
            <button type="button" title="删除轨道"
              className="text-[11px] text-[#86909C] bg-transparent border-0 cursor-pointer px-0.5">✕</button>
          </Popconfirm>
        </div>
      </div>
      {/* 轨道体（minWidth 对齐标尺宽度——absolute 片段不撑容器，无 minWidth 时超宽片段被滚动区裁掉；R3 审核 P2：原占位 div 为 absolute 不撑宽，纯无效已删） */}
      <div
        className="relative flex-1 h-[52px] bg-white"
        style={{ minWidth: Math.max(600, timeToPx(totalDuration(data), pxPerSec) + 60) }}
        data-track-id={track.id} data-track-type={track.type}
        onDragOver={e => { if (onDropClip) { e.preventDefault(); } }}
        onDrop={onDropClip}
        onClick={() => selectClip(null)}
      >
        {track.clips.map(cid => {
          const c = data.clips[cid];
          if (!c) return null;
          return (
            <ClipBlock key={cid} clip={c} pxPerSec={pxPerSec} selected={selectedClipId === c.id}
              mediaName={c.type === 'subtitle' ? undefined : mediaInfo[c.mediaId]?.name} />
          );
        })}
      </div>
    </div>
  );
}
```

```tsx
// apps/web/src/pages/canvas/video-editor/components/timeline/TimelinePanel.tsx（替换 Task 11 占位）
import { useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { TimelineRuler } from './TimelineRuler';
import { TrackRow } from './TrackRow';

export function TimelinePanel() {
  const status = useEditorStore(s => s.status);
  const loadError = useEditorStore(s => s.loadError);
  const data = useEditorStore(s => s.data);
  const pxPerSec = useEditorStore(s => s.pxPerSec);
  const playhead = useEditorStore(s => s.playhead);
  const setPxPerSec = useEditorStore(s => s.setPxPerSec);
  const scrollRef = useRef<HTMLDivElement>(null);

  if (status === 'loading' || (status !== 'error' && !data)) {
    return <div data-testid="timeline-loading" className="h-[280px] border-t border-[#E5E7EB] [border-top-style:solid] bg-white flex items-center justify-center">
      <span className="text-[13px] text-[#86909C]">工程加载中…（禁止编辑）</span>
    </div>;
  }
  if (status === 'error') {
    return <div data-testid="timeline-error" className="h-[280px] border-t border-[#E5E7EB] [border-top-style:solid] bg-white flex flex-col items-center justify-center gap-2">
      <span className="text-[13px] text-[#F53F3F]">{loadError ?? '加载失败'}</span>
    </div>;
  }

  // Ctrl+滚轮缩放（以播放头为中心的 scrollLeft 锚定换算 Plan 3 接入——anchorZoomScroll 已在 Task 4 就绪；一期直接调 pxPerSec）
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setPxPerSec(pxPerSec * (e.deltaY < 0 ? 1.1 : 0.9));
  };

  return (
    <div data-testid="timeline-panel"
      className="h-[280px] border-t border-[#E5E7EB] [border-top-style:solid] bg-white flex flex-col min-h-0 box-border"
      onWheel={onWheel}>
      {/* 工具行（Plan 3 迁入预览控制条） */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#F2F3F5] [border-bottom-style:solid]">
        <button type="button" className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1" onClick={() => useEditorStore.getState().undo()}>撤销</button>
        <button type="button" className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1" onClick={() => useEditorStore.getState().redo()}>重做</button>
        <span className="text-[12px] text-[#C9CDD4]">|</span>
        <button type="button" className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1" title="在播放头处分割选中片段">分割</button>
        <button type="button" className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1" title="删除选中片段">删除</button>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => useEditorStore.getState().addTrack('video')}
            className="text-[12px] text-[#6C5CE7] bg-transparent border-0 cursor-pointer px-1">+ 视频轨</button>
          <button type="button" onClick={() => useEditorStore.getState().addTrack('audio')}
            className="text-[12px] text-[#6C5CE7] bg-transparent border-0 cursor-pointer px-1">+ 音频轨</button>
          <span className="text-[11px] text-[#86909C]">{pxPerSec.toFixed(0)} px/s</span>
        </div>
      </div>
      {/* 滚动区：标尺 + 轨道 */}
      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto min-h-0">
        <TimelineRuler data={data} pxPerSec={pxPerSec} playhead={playhead} widthPx={scrollRef.current?.clientWidth ?? 800}
          onSeek={t => useEditorStore.getState().setPlayhead(t)} />
        {data.tracks.map(t => <TrackRow key={t.id} track={t} data={data} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/components/timeline/TimelinePanel.render.test.tsx
git add apps/web/src && git commit -m "feat(video-editor): 时间轴静态渲染——标尺/轨道行/片段块/三态分支（TDD）"
```

---

### Task 15: 时间轴 UI——交互（拖动/trim/吸附/分割/删除/键盘）

**Files:**
- Modify: `apps/web/src/pages/canvas/video-editor/components/timeline/TimelinePanel.tsx`（工具行按钮接 store + 键盘）
- Modify: `apps/web/src/pages/canvas/video-editor/components/timeline/ClipBlock.tsx`（pointer 接线 + trim 边缘）
- Modify: `apps/web/src/pages/canvas/video-editor/components/timeline/TrackRow.tsx`（pointer 传递）
- Create: `apps/web/src/pages/canvas/video-editor/hooks/useEditorKeyboard.ts`
- Test: `TimelinePanel.interact.test.tsx` + `useEditorKeyboard.test.ts`

- [ ] **Step 1: 写失败测试（交互——jsdom pointer 事件驱动 store 断言）**

```tsx
// apps/web/src/pages/canvas/video-editor/components/timeline/TimelinePanel.interact.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimelinePanel } from './TimelinePanel';
import { useEditorStore } from '../../store/editorStore';
import { createDefaultProjectData, type ProjectData } from '../../types';

const ready = (data?: ProjectData) => {
  const d = data ?? createDefaultProjectData();
  useEditorStore.setState({ status: 'ready', data: d, projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't', history: useEditorStore.getState().history, mediaInfo: { m1: { name: 'A', durationSec: 10 } } });
  return d;
};
const addVideoClip = (start = 0) => {
  const d = useEditorStore.getState().data!;
  return useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', sourceNodeId: 's1', trackId: d.tracks[0].id, start })!;
};

describe('TimelinePanel 交互', () => {
  beforeEach(() => useEditorStore.getState().reset());
  // R2 审核 P1-B：mock 还原收口到 afterEach——写在用例末尾时断言失败会跳过还原、污染后续用例
  afterEach(() => vi.restoreAllMocks());

  it('拖动片段：pointer 序列 → transient move + pointerup 一次入栈 + 新位置', () => {
    ready();
    const id = addVideoClip(0);
    render(<TimelinePanel />);
    const block = screen.getByTestId(`clip-block-${id}`);
    const depthBefore = useEditorStore.getState().history.past.length;

    fireEvent.pointerDown(block, { button: 0, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 180, clientY: 50 }); // +80px = +1s @80px/s
    fireEvent.pointerUp(window);

    expect(useEditorStore.getState().data!.clips[id].start).toBe(1);
    expect(useEditorStore.getState().history.past.length).toBe(depthBefore + 1); // 一次入栈
    expect(useEditorStore.getState().selectedClipId).toBe(id);
  });

  it('trim 右缘：命中边缘 → duration 变化且 sourceStart 不动', () => {
    ready();
    const id = addVideoClip(0);
    render(<TimelinePanel />);
    const block = screen.getByTestId(`clip-block-${id}`);
    // 宽度 = 10s * 80px/s = 800px；右缘 x=800 内 6px 命中
    fireEvent.pointerDown(block, { button: 0, clientX: 798, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 878, clientY: 50 }); // +80px = +1s
    fireEvent.pointerUp(window);
    const c = useEditorStore.getState().data!.clips[id];
    expect(c.duration).toBe(11);
    expect((c as any).sourceStart).toBe(0);
  });

  it('吸附：拖到片段边缘 8px 内吸附相邻边缘', () => {
    ready();
    const a = addVideoClip(0); // 0-10s
    const b = useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', trackId: useEditorStore.getState().data!.tracks[0].id, start: 12 })!;
    render(<TimelinePanel />);
    const block = screen.getByTestId(`clip-block-${b}`);
    fireEvent.pointerDown(block, { button: 0, clientX: 1000, clientY: 50 });
    // b start=12 → 期望拖到 ~10.06s（距 a 的 end=10 为 0.06s < 0.1s 阈值 @80px/s）→ 吸附 10
    fireEvent.pointerMove(window, { clientX: 805, clientY: 50 });
    fireEvent.pointerUp(window);
    expect(useEditorStore.getState().data!.clips[b].start).toBe(10);
  });

  it('跨轨拖动：拖到同类视频轨换轨（elementFromPoint 命中，R1 审核 P1-3）', () => {
    ready();
    const id = addVideoClip(0);
    render(<TimelinePanel />);
    useEditorStore.getState().addTrack('video');
    const track2 = useEditorStore.getState().data!.tracks.filter(t => t.type === 'video')[1];
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(
      document.querySelector(`[data-track-id="${track2.id}"]`) as HTMLElement,
    );
    const block = screen.getByTestId(`clip-block-${id}`);
    fireEvent.pointerDown(block, { button: 0, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 180, clientY: 300 }); // 纵向移入第二轨
    fireEvent.pointerUp(window);
    expect(useEditorStore.getState().data!.clips[id].trackId).toBe(track2.id);
    expect(useEditorStore.getState().data!.tracks[0].clips).not.toContain(id);
  });

  it('分割按钮：播放头切中选中片段 → 两片', () => {
    ready();
    const id = addVideoClip(0);
    useEditorStore.getState().selectClip(id);
    useEditorStore.getState().setPlayhead(4);
    render(<TimelinePanel />);
    fireEvent.click(screen.getByText('分割'));
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(2);
  });

  it('删除按钮：删选中片段（历史可撤销）', () => {
    ready();
    const id = addVideoClip(0);
    useEditorStore.getState().selectClip(id);
    render(<TimelinePanel />);
    fireEvent.click(screen.getByText('删除'));
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(0);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(1);
  });

  it('字幕轨头 ➕ → 播放头处新增 3s 字幕', () => {
    ready();
    render(<TimelinePanel />);
    const subTrack = useEditorStore.getState().data!.tracks.find(t => t.type === 'subtitle')!;
    useEditorStore.getState().setPlayhead(2);
    fireEvent.click(screen.getByTitle('该轨内新增字幕'));
    const clips = useEditorStore.getState().data!.tracks.find(t => t.id === subTrack.id)!.clips;
    expect(clips).toHaveLength(1);
    expect((useEditorStore.getState().data!.clips[clips[0]] as any).duration).toBe(3);
  });

  it('Ctrl+Z 编辑器内撤销（键盘，画布层已隔离）', () => {
    ready();
    addVideoClip(0);
    render(<TimelinePanel />);
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(0);
  });

  it('Delete 键删除选中片段', () => {
    ready();
    const id = addVideoClip(0);
    useEditorStore.getState().selectClip(id);
    render(<TimelinePanel />);
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 确认失败 → Step 3: 实现交互（三组件接线 + 键盘 hook）**

ClipBlock 增加 pointer 逻辑（Task 14 已留 onPointerDown prop；接线放 TrackRow→ClipBlock 传递）——核心拖拽状态机放 TimelinePanel：

```tsx
// TimelinePanel.tsx 顶部 import 增量（Task 15 交互）：
// - react：useRef → { useEffect, useRef }（window 监听 useEffect 本 task 接入）
// - view-scale 五函数 + ClipBlock 常量（Task 14 面板本体已无 view-scale 依赖，R4 审核 P2-3 配套）
import { timeToPx, pxToTime, edgeHitTest, snapTime, collectSnapPoints } from '../../timeline/view-scale';
import { CLIP_BLOCK_MIN_PX } from './ClipBlock';
import type { Clip } from '../../types';

// TimelinePanel.tsx 内新增（组件顶层）：
interface DragState {
  kind: 'move' | 'trim-left' | 'trim-right';
  clipId: string;
  startClientX: number; startClientY: number;
  startClipStart: number; startDuration: number;
  /** 拖拽起始比例尺快照（R3 审核 P2：整个拖拽用同一比例尺——useEffect([]) 闭包固定首帧 pxPerSec，
   *  拖拽途中 Ctrl+滚轮改缩放会让 dxSec 换算基准突变，快照语义更正确且消除闭包旧值问题） */
  startPxPerSec: number;
  pointerMoved: boolean;
}
const dragRef = useRef<DragState | null>(null);

const onClipPointerDown = (clip: Clip, e: React.PointerEvent) => {
  if (e.button !== 0 || status !== 'ready' || !data) return;
  e.stopPropagation();
  useEditorStore.getState().selectClip(clip.id); // getState 风格——面板无需为此多挂一个 selector
  const widthPx = Math.max(CLIP_BLOCK_MIN_PX, timeToPx(clip.duration, pxPerSec));
  // 不用 e.nativeEvent.offsetX——jsdom 与部分浏览器拖拽中不维护该值，统一 clientX - rect.left
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const hit = edgeHitTest(e.clientX - rect.left, widthPx);
  if (clip.type === 'subtitle' && hit) return; // 字幕无 trim 语义（一期）
  dragRef.current = {
    kind: hit ? (hit === 'left' ? 'trim-left' : 'trim-right') : 'move',
    clipId: clip.id,
    startClientX: e.clientX, startClientY: e.clientY,
    startClipStart: clip.start, startDuration: clip.duration,
    startPxPerSec: pxPerSec, // 拖拽全程固定比例尺
    pointerMoved: false,
  };
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
};

const onWindowPointerMove = (e: PointerEvent) => {
  const d = dragRef.current;
  if (!d) return;
  d.pointerMoved = true;
  const dxSec = pxToTime(e.clientX - d.startClientX, d.startPxPerSec); // 拖拽全程固定比例尺（R3 审核 P2）
  const es = useEditorStore.getState();
  if (d.kind === 'move') {
    if (!es.history.pendingSnapshot && !d.pointerMovedOnce) { es.beginTransient(); (d as any).pointerMovedOnce = true; }
    const target = d.startClipStart + dxSec;
    const snapped = snapTime(target, collectSnapPoints(d.clipId, Object.values(es.data?.clips ?? {}), es.playhead), d.startPxPerSec);
    // 跨轨拖动（spec 第五节"同类型跨轨自由重叠"）：pointer 落点命中轨道行，类型兼容才换轨
    let targetTrackId: string | undefined;
    const trackEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-track-id]') as HTMLElement | null;
    if (trackEl) {
      const elType = trackEl.dataset.trackType!;
      const myType = es.data?.clips[d.clipId]?.type;
      const compatible = myType === 'audio' ? elType === 'audio'
        : myType === 'subtitle' ? elType === 'subtitle'
        : elType === 'video'; // video/image 片只在视频轨间移动（图片归视频轨）
      if (compatible) targetTrackId = trackEl.dataset.trackId;
    }
    es.moveClip(d.clipId, Math.max(0, snapped.time), targetTrackId, { transient: true });
  } else {
    if (!es.history.pendingSnapshot && !(d as any).pointerMovedOnce) { es.beginTransient(); (d as any).pointerMovedOnce = true; }
    es.trimClip(d.clipId, d.kind === 'trim-left' ? 'left' : 'right', dxSec, { transient: true });
  }
};

const onWindowPointerUp = () => {
  const d = dragRef.current;
  dragRef.current = null; // 监听常驻（useEffect 管理），pointerup 只结束本次拖拽
  if (!d) return;
  useEditorStore.getState().endTransient(); // pointerup 一次入栈
};

// R2 审核 P1-B：window 监听常驻注册 + useEffect 卸载清理（拖拽中被卸载——编辑器收起/切工程——不泄漏监听；
// 非拖拽态 dragRef 为 null 直接早退，常驻开销可忽略；pointerup 不用 { once } 因为需同时清 dragRef）。
// R4 审核 P2-1：本块须在 onWindowPointerMove/onWindowPointerUp 定义之后——effect 回调在 render 提交后才执行、
// 闭包拿到的是已初始化引用（运行期无 TDZ 风险），但定义在前会让执行者看到"effect 引用下方 const"的可疑结构而误判重排。
useEffect(() => {
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  return () => {
    window.removeEventListener('pointermove', onWindowPointerMove);
    window.removeEventListener('pointerup', onWindowPointerUp);
    dragRef.current = null;
  };
}, []);

// R2 审核 P1-A：prop 传递正文代码（原计划只写注释，TrackRow 的 ?. 短路会让"字幕轨 ➕"用例必红）
// ① TrackRow.tsx：props 接口扩展 + ClipBlock 渲染处透传（type import 同步补 Clip：`import type { ProjectData, Track, Clip } from '../../types';`）
interface TrackRowProps {
  track: Track;
  data: ProjectData;
  onDropClip?: (e: React.DragEvent<HTMLDivElement>) => void;
  onSubtitleAdd?: (trackId: string) => void;
  onClipPointerDown?: (clip: Clip, e: React.PointerEvent<HTMLDivElement>) => void;
}
// TrackRow 内 ClipBlock 渲处（替换 Task 14 的裸渲染）：
// <ClipBlock key={cid} clip={c} pxPerSec={pxPerSec} selected={selectedClipId === c.id}
//   mediaName={c.type === 'subtitle' ? undefined : mediaInfo[c.mediaId]?.name}
//   onPointerDown={onClipPointerDown ? (e) => onClipPointerDown(c, e) : undefined} />

// ② TimelinePanel.tsx 渲染处（三 prop 显式传入——Task 14 只传了 track/data 两个）：
// data.tracks.map(t => (
//   <TrackRow key={t.id} track={t} data={data}
//     onDropClip={undefined /* Task 16 接通 handleClipDrop（R3 审核 P3-3：显式形态防执行者猜） */}
//     onSubtitleAdd={(trackId) => useEditorStore.getState().addSubtitleClip(trackId, playhead)}
//     onClipPointerDown={onClipPointerDown} />
// ))

// ③ 工具行按钮接 store：分割 = splitClip(selectedClipId, playhead)；删除 = removeClip(selectedClipId)
```

```ts
// apps/web/src/pages/canvas/video-editor/hooks/useEditorKeyboard.ts
import { useEffect } from 'react';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { useEditorStore } from '../store/editorStore';

/** 编辑器内键盘：Delete 删片段 / Ctrl+Z·Ctrl+Shift+Z·Ctrl+Y 撤销重做 / 空格防滚动（播放 Plan 3）。
 *  画布层快捷键已被 isGroupEditContext 早退禁用（Task 11）——本 hook 只服务编辑器 open 期间。
 *  挂载点定死：TimelinePanel 组件体内调用（时间轴是唯一消费方，Shell 不该管键盘——R1 审核 P1-3 决策） */
export function useEditorKeyboard() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!useVideoEditorStore.getState().open) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const es = useEditorStore.getState();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (es.selectedClipId) { e.preventDefault(); es.removeClip(es.selectedClipId); }
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault(); es.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault(); es.redo();
      } else if (e.key === ' ') {
        e.preventDefault(); // 防页面滚动；播放/暂停 Plan 3 主时钟接入
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}
```

TimelinePanel 组件体首行显式调用（R3 审核 P3-3：可粘贴实现行，非散文描述）：

```tsx
export function TimelinePanel() {
  useEditorKeyboard(); // 挂载点唯一（R1 审核 P1-3）——编辑器时间轴是键盘唯一消费方
  const status = useEditorStore(s => s.status);
  // …Task 14 其余实现不变
```

- [ ] **Step 4: 跑测试 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/components/timeline/TimelinePanel.interact.test.tsx
git add apps/web/src && git commit -m "feat(video-editor): 时间轴交互——拖动/trim/吸附/分割/删除/键盘（transient 历史 + pointerup 入栈）（TDD）"
```

---

### Task 16: 左面板资产库 + 拖入闭环

**Files:**
- Modify: `apps/web/src/api/mediaApi.ts`（+batchGetMedia）
- Create: `apps/web/src/pages/canvas/video-editor/components/AssetPanel.tsx`
- Create: `apps/web/src/pages/canvas/video-editor/hooks/useWorkflowAssets.ts`
- Modify: `apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.tsx`（占位 → AssetPanel）
- Modify: `apps/web/src/pages/canvas/video-editor/components/timeline/TimelinePanel.tsx`（handleClipDrop 接通 onDropClip——R2 审核 P0-A 补）
- Test: `useWorkflowAssets.test.ts` + `AssetPanel.test.tsx`

- [ ] **Step 1: mediaApi 追加 batchGetMedia**

```ts
// apps/web/src/api/mediaApi.ts 追加（沿用该文件 apiFetch 惯例）
export interface BatchMediaItem {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  thumbnailUrl: string | null;
  metadata: Record<string, unknown>;
}

/** 左面板聚合：按 mediaId 集合批查 + presigned URL（POST /api/media/batch，Plan 1 Task 12 已就绪） */
export function batchGetMedia(ids: string[], teamId?: string): Promise<BatchMediaItem[]> {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  return apiFetch(`/media/batch${qs}`, { method: 'POST', body: JSON.stringify({ ids }) });
}
```

- [ ] **Step 2: 写失败测试（useWorkflowAssets）**

```ts
// apps/web/src/pages/canvas/video-editor/hooks/useWorkflowAssets.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWorkflowAssets } from './useWorkflowAssets';
import { useNodeStore } from '@/stores/nodeStore';
import { batchGetMedia } from '@/api/mediaApi';

vi.mock('@/api/mediaApi', () => ({ batchGetMedia: vi.fn() }));

describe('useWorkflowAssets（nodeStore 聚合 fileId → batch 批查）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNodeStore.setState({
      nodes: {
        v1: { id: 'v1', type: 'videoGen', position: { x: 0, y: 0 }, data: { fileId: 'm1', status: 'done', duration: 5 } }, // duration = 节点生成配置（决策 6 第一优先级来源）
        a1: { id: 'a1', type: 'audioGen', position: { x: 0, y: 0 }, data: { fileId: 'm2', status: 'done' } },
        v2: { id: 'v2', type: 'videoGen', position: { x: 0, y: 0 }, data: { status: 'loading' } }, // 无 fileId 不收
        e1: { id: 'e1', type: 'videoEdit', position: { x: 0, y: 0 }, data: {} },                    // 非素材节点不收
      } as any,
    });
  });
  it('收集生成节点 fileId 产物并批查（sourceNodeId 关联保留）', async () => {
    (batchGetMedia as any).mockResolvedValue([
      { id: 'm1', originalName: '视频A.mp4', mimeType: 'video/mp4', url: 'http://u1', thumbnailUrl: 'http://t1', metadata: {} },
      { id: 'm2', originalName: '音频B.mp3', mimeType: 'audio/mpeg', url: 'http://u2', thumbnailUrl: null, metadata: {} },
    ]);
    const { result } = renderHook(() => useWorkflowAssets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(batchGetMedia).toHaveBeenCalledWith(['m1', 'm2']);
    expect(result.current.items.find(i => i.mediaId === 'm1')?.sourceNodeId).toBe('v1');
    expect(result.current.items.find(i => i.mediaId === 'm1')?.nodeDurationSec).toBe(5);        // 节点配置时长带出（R4 P1-1）
    expect(result.current.items.find(i => i.mediaId === 'm2')?.nodeDurationSec).toBeUndefined(); // 无配置回落 metadata 链
    expect(result.current.items.find(i => i.mediaId === 'm2')?.kind).toBe('audio');
  });
  it('batch 失败降级空列表不炸', async () => {
    (batchGetMedia as any).mockRejectedValue(new Error('net'));
    const { result } = renderHook(() => useWorkflowAssets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(0);
  });
});
```

- [ ] **Step 3: 写失败测试（AssetPanel——列表/已添加标记/拖入建 clip）**

```tsx
// apps/web/src/pages/canvas/video-editor/components/AssetPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssetPanel } from './AssetPanel';
import { useEditorStore } from '../store/editorStore';
import { createDefaultProjectData } from '../types';
import { batchGetMedia, type BatchMediaItem } from '@/api/mediaApi';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';

vi.mock('@/api/mediaApi', () => ({ batchGetMedia: vi.fn() }));

const mkItem = (id: string, name: string, mime: string, metadata: Record<string, unknown> = {}): BatchMediaItem =>
  ({ id, originalName: name, mimeType: mime, url: `http://${id}`, thumbnailUrl: null, size: 1, metadata });

describe('AssetPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.getState().reset();
    useEditorStore.setState({ status: 'ready', data: createDefaultProjectData(), projectId: 'p1', sourceNodeId: 'edit1', baseUpdatedAt: 't' });
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null }); // ensureAutoEdges 落边目标
    useNodeStore.setState({
      nodes: {
        v1: { id: 'v1', type: 'videoGen', position: { x: 0, y: 0 }, data: { fileId: 'm1', status: 'done', duration: 5 } }, // 节点配置 5s——与素材 metadata 8s 双值分解（R4 P1-1：同值巧合会掩盖优先级回归）
      } as any,
    });
  });

  it('渲染资产条目（缩略图占位 + 名称）', async () => {
    (batchGetMedia as any).mockResolvedValue([mkItem('m1', '视频A.mp4', 'video/mp4')]);
    render(<AssetPanel />);
    await waitFor(() => expect(screen.getByText('视频A.mp4')).toBeInTheDocument());
  });

  it('搜索框过滤', async () => {
    (batchGetMedia as any).mockResolvedValue([mkItem('m1', '视频A.mp4', 'video/mp4'), mkItem('m2', '音乐B.mp3', 'audio/mpeg')]);
    render(<AssetPanel />);
    await waitFor(() => expect(screen.getByText('音乐B.mp3')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('搜索资产'), { target: { value: '视频' } });
    expect(screen.queryByText('音乐B.mp3')).not.toBeInTheDocument();
    expect(screen.getByText('视频A.mp4')).toBeInTheDocument();
  });

  it('已添加标记：时间轴引用的 mediaId 显示"已添加"', async () => {
    (batchGetMedia as any).mockResolvedValue([mkItem('m1', '视频A.mp4', 'video/mp4'), mkItem('m2', '音乐B.mp3', 'audio/mpeg')]);
    render(<AssetPanel />);
    await waitFor(() => expect(screen.getByText('视频A.mp4')).toBeInTheDocument());
    const d = useEditorStore.getState().data!;
    useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', sourceNodeId: 'v1', trackId: d.tracks[0].id, start: 0 });
    expect(screen.getByText('已添加')).toBeInTheDocument();
  });

  it('dragStart payload：节点配置时长优先于 media metadata（决策 6 第一优先级，R4 P1-1）', async () => {
    (batchGetMedia as any).mockResolvedValue([mkItem('m1', '视频A.mp4', 'video/mp4', { durationSec: 8 })]);
    render(<AssetPanel />);
    await waitFor(() => expect(screen.getByText('视频A.mp4')).toBeInTheDocument());
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByTestId('asset-item-m1'), { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith('application/x-clip', expect.any(String));
    const payload = JSON.parse(setData.mock.calls[0][1] as string);
    expect(payload).toMatchObject({ mediaId: 'm1', sourceNodeId: 'v1', originalName: '视频A.mp4' });
    expect(payload.durationSec).toBe(5); // 节点 5s 胜出 metadata 8s——优先级在此锁死
  });

  it('drop 到视频轨 → addClip（带 sourceNodeId，连线同步闭环起点）', async () => {
    (batchGetMedia as any).mockResolvedValue([mkItem('m1', '视频A.mp4', 'video/mp4')]);
    // drop handler 在 TimelinePanel（Step 4 设计决策）——渲染时间轴而非 AssetPanel
    const { TimelinePanel } = await import('./timeline/TimelinePanel');
    render(<TimelinePanel />);
    const trackBody = document.querySelector('[data-track-type="video"]')!;
    // R3 审核 P3-2：payload 必须带 originalName/durationSec——否则 setMediaInfo 分支零覆盖、P0-A 锁力为零。
    // R4 P1-1：payload 是 dragStart 汇点解析后的"已解析时长"契约——本用例锁 drop 侧消费（payload 8 → 片段 8），
    // 与 dragStart 用例（节点 5 胜出 metadata 8 → payload 5）双值分解，任一侧回归均可独立定位。
    const payload = JSON.stringify({
      mediaId: 'm1', sourceNodeId: 'v1', mimeType: 'video/mp4',
      originalName: '视频A.mp4', durationSec: 8,
    });
    fireEvent.drop(trackBody, {
      dataTransfer: { getData: (type: string) => (type === 'application/x-clip' ? payload : '') },
      clientX: trackBody.getBoundingClientRect().left + 80, // 80px = 1s @80px/s
    });
    const d = useEditorStore.getState().data!;
    expect(d.tracks[0].clips).toHaveLength(1);
    const clipId = d.tracks[0].clips[0];
    expect((d.clips[clipId] as any).sourceNodeId).toBe('v1');
    expect(d.clips[clipId].duration).toBe(8); // 决策 6 时长链：payload.durationSec → mediaInfo → addClip
    expect(useEditorStore.getState().mediaInfo['m1']).toMatchObject({ // P0-A 名称链：片段块标签来源
      name: '视频A.mp4', durationSec: 8,
    });
    // ensureAutoEdges 已在 addClip 内触发——确定性 id 边落进真实 canvasStore（连线闭环）
    expect(useCanvasStore.getState().edges.some(e => e.id === 'auto:edit1:v1')).toBe(true);
  });
});
```

- [ ] **Step 4: 实现 useWorkflowAssets + AssetPanel（设计决策：drop handler 归 TimelinePanel，AssetPanel 只管 dragStart——R1 审核 P2-2 上提；payload 自带名称/时长，TimelinePanel 零 assets 依赖——R2 审核 P0-A）**

拖放接线总览：AssetPanel 条目 `onDragStart` 把展示所需字段（originalName + 时长——`nodeDurationSec ?? metadata.durationSec`，决策 6 优先级在此汇点生效）连同 mediaId/sourceNodeId/mimeType 一起写进 payload——**drop 侧零 hooks、零额外请求**（不在 TimelinePanel 再调 useWorkflowAssets，避免同一份资产双倍 batchGetMedia RTT）→ TrackRow 轨道体 `onDrop={handleClipDrop}`（handler 定义在 TimelinePanel 层）。onDragStart 的 5 字段 payload 见下方 AssetPanel 主实现块（R3 审核 P3-1：以主实现块为唯一权威版本，散文段不重复代码）。

TimelinePanel 内的 drop 实现（**Files 清单含 Modify: timeline/TimelinePanel.tsx**）：

```tsx
// TimelinePanel.tsx 内（Task 16 接通）
const handleClipDrop = (e: React.DragEvent<HTMLDivElement>) => {
  e.preventDefault();
  const raw = e.dataTransfer.getData('application/x-clip');
  if (!raw) return;
  const payload = JSON.parse(raw) as {
    mediaId: string; sourceNodeId?: string; mimeType: string;
    originalName?: string; durationSec?: number;
  };
  const trackEl = e.currentTarget;
  const trackType = trackEl.dataset.trackType!;
  const kind = payload.mimeType.startsWith('video/') ? 'video'
    : payload.mimeType.startsWith('audio/') ? 'audio' : 'image';
  // 轨道类型匹配（图片进视频轨；跨类型 drop 忽略）
  if (trackType === 'audio' ? kind !== 'audio' : kind === 'audio') return;
  const rect = trackEl.getBoundingClientRect();
  const start = quantizeTime(Math.max(0, pxToTime(e.clientX - rect.left, pxPerSec)));
  if (payload.originalName) {
    useEditorStore.getState().setMediaInfo(payload.mediaId, {
      name: payload.originalName,
      durationSec: payload.durationSec,
    });
  }
  useEditorStore.getState().addClip({
    type: kind, mediaId: payload.mediaId,
    sourceNodeId: payload.sourceNodeId || undefined,
    trackId: trackEl.dataset.trackId!,
    start,
  });
};
// TrackRow 渲染处（Task 15 已接 onClipPointerDown/onSubtitleAdd，此处补第三个 prop）：
// <TrackRow key={t.id} track={t} data={data} onDropClip={handleClipDrop} ... />
```

TimelinePanel 顶部 import 增量（Task 16——pxToTime 已在 Task 15 引入，此处只补 quantizeTime）：

```tsx
// TimelinePanel.tsx 顶部 import 增量（Task 16）
import { quantizeTime } from '../../timeline/clip-math';
```

```ts
// apps/web/src/pages/canvas/video-editor/hooks/useWorkflowAssets.ts
import { useEffect, useMemo, useState } from 'react';
import { useNodeStore } from '@/stores/nodeStore';
import { batchGetMedia, type BatchMediaItem } from '@/api/mediaApi';

export interface AssetItem extends BatchMediaItem {
  mediaId: string;
  sourceNodeId: string; // 画布来源节点（素材库上传物为空串）
  /** 决策 6 第一优先级：节点生成配置时长（秒）——缺失时 drag payload 回落 media metadata.durationSec（R4 审核 P1-1） */
  nodeDurationSec?: number;
  kind: 'video' | 'audio' | 'image';
}

const SOURCE_TYPES = new Set(['videoGen', 'audioGen', 'imageGen']);
const kindOf = (mime: string): AssetItem['kind'] =>
  mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image';

export function useWorkflowAssets(): { items: AssetItem[]; loading: boolean } {
  const nodes = useNodeStore((s) => s.nodes);
  const entries = useMemo(
    () => Object.values(nodes).filter((n: any) => SOURCE_TYPES.has(n.type) && n.data?.fileId),
    [nodes],
  );
  const idsKey = useMemo(() => entries.map((e: any) => e.data.fileId as string).sort().join(','), [entries]);
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ids = idsKey ? idsKey.split(',') : [];
    if (ids.length === 0) { setItems([]); return; }
    setLoading(true);
    batchGetMedia(ids)
      .then((rows) => {
        if (cancelled) return;
        setItems(rows.map((r) => {
          const owner = entries.find((e: any) => e.data.fileId === r.id) as any;
          return {
            ...r, mediaId: r.id, sourceNodeId: owner?.id ?? '', kind: kindOf(r.mimeType),
            nodeDurationSec: typeof owner?.data?.duration === 'number' ? owner.data.duration : undefined, // 决策 6 第一优先级（R4 P1-1）
          };
        }));
      })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [idsKey]);

  return { items, loading };
}
```

```tsx
// apps/web/src/pages/canvas/video-editor/components/AssetPanel.tsx（只管 dragStart——drop 归 TimelinePanel，见 Step 4 设计决策）
import { useState } from 'react';
import { Input } from 'antd';
import { useWorkflowAssets } from '../hooks/useWorkflowAssets';
import { useEditorStore } from '../store/editorStore';

export function AssetPanel() {
  const { items, loading } = useWorkflowAssets();
  const [keyword, setKeyword] = useState('');
  const data = useEditorStore(s => s.data);

  const addedMediaIds = new Set(
    data ? Object.values(data.clips).map(c => c.mediaId).filter(Boolean) : [],
  );
  const filtered = items.filter(i => i.originalName.includes(keyword));

  return (
    <div data-testid="asset-panel" className="w-[260px] shrink-0 border-r border-[#E5E7EB] [border-right-style:solid] bg-white flex flex-col min-h-0 box-border">
      <div className="p-2 border-b border-[#F2F3F5] [border-bottom-style:solid]">
        <Input placeholder="搜索资产" value={keyword} onChange={e => setKeyword(e.target.value)} size="small" />
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-2 py-1 text-[12px] text-[#86909C]">全集资产</div>
        {loading && <div className="px-2 text-[12px] text-[#86909C]">加载中…</div>}
        <ul className="list-none pl-0 m-0">
          {filtered.map(i => (
            <li key={i.mediaId}
              data-testid={`asset-item-${i.mediaId}`}
              draggable
              onDragStart={e => e.dataTransfer.setData('application/x-clip', JSON.stringify({
                mediaId: i.mediaId,
                sourceNodeId: i.sourceNodeId || undefined,
                mimeType: i.mimeType,
                originalName: i.originalName,                   // R2 P0-A：drop 侧 setMediaInfo 用
                durationSec: i.nodeDurationSec ?? (i.metadata as any)?.durationSec, // 决策 6：节点配置时长优先，metadata 兜底（R4 P1-1）
              }))}
              className="flex items-center gap-2 px-2 py-1.5 cursor-grab hover:bg-[#F7F8FA]">
              <div className="w-10 h-10 rounded-md bg-[#F2F3F5] shrink-0 overflow-hidden flex items-center justify-center">
                {i.thumbnailUrl
                  ? <img src={i.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  : <span className="text-[10px] text-[#86909C]">{i.kind === 'audio' ? '音' : i.kind === 'video' ? '视' : '图'}</span>}
              </div>
              <span className="text-[12px] text-[#4E5969] truncate" style={{ minWidth: 0 }}>{i.originalName}</span>
              {addedMediaIds.has(i.mediaId)
                && <span className="ml-auto text-[10px] text-[#00B42A] shrink-0">已添加</span>}
            </li>
          ))}
        </ul>
        {!loading && filtered.length === 0 && <div className="px-2 py-3 text-[12px] text-[#C9CDD4]">暂无资产</div>}
        {/* spec 第四节"全集资产 = 画布产物 + 团队素材库"——团队素材分支登记 Plan 3（folder 接口接入后实化，R1 审核 P2-2） */}
        <div className="px-2 py-1 mt-2 border-t border-[#F2F3F5] [border-top-style:solid] text-[12px] text-[#C9CDD4]">团队素材（Plan 3）</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 跑测试 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor
pnpm -C apps/web test
git add apps/web/src && git commit -m "feat(video-editor): 左面板资产库——nodeStore 聚合/batch 批查/拖入建 clip 连线闭环（TDD）"
```

---

### Task 17: Plan 2 浏览器验收（preview 工具）

对 spec 29 条手动验收清单中 Plan 2 范围条目逐项核验；前端 dev server + 本地 API + Postgres/Redis/MinIO（按项目启动流程记忆）。验收发现的缺陷按 TDD 修复后复验。

**Files:** 无新文件（修复时改对应源文件）

- [ ] **Step 1: 启动环境并打开画布**

按项目启动流程记忆启动基础设施 + API + web；preview 打开画布页。

- [ ] **Step 2: 逐项验收（spec 验收条目 → Plan 2 范围）**

| spec 条目 | 验收点 | 手段 |
|---|---|---|
| 1 | 菜单"多轨道剪辑"创建节点 → 空态"+ 添加素材"；菜单无第二个视频合并入口 | preview_click + snapshot |
| 2 | 旧"剪辑"（VideoNodeToolbar 单段裁剪）与剪辑节点互不影响 | 手动点验 |
| 3 | 连线同步六场景：加带源片段建边（幂等）/同源多片一边/删全部片删边/素材库片不建边/手动线不删/手删自动边下次编辑重建 | 操作 + 画布视口查边 |
| 4 | 编辑器撤销/重做片段增删边跟随回滚；画布撤销栈无自动边条目 | 编辑器 Ctrl+Z 后查画布边 + 画布 Ctrl+Z 验证栈内无 auto 边 |
| 5 | 素材拖入三类轨正确（图片进视频轨无变速项——变速 UI Plan 3，此处验轨归属） | 拖放 + snapshot |
| 6（部分） | trim/拖动/分割/删除/吸附正确；同轨禁重叠跨轨可叠（变速部分 Plan 3） | 时间轴操作逐项 |
| 15 | 自动保存后刷新重进状态一致（无自打自 409） | 改动 → 等三态绿 → 刷新重进对比 |
| 19 | 画布层撤销隔离：加片产生自动边后画布 Ctrl+Z 栈无自动边条目 | 操作 + 验证 |
| 20 | origin 隔离：自动边事务 origin=AutoEdge 且 UndoManager 不增长（手写 ydoc 检查或按 Task 13 测试佐证 + 浏览器观察 undoStack 行为） | 依赖 Task 13 单测 + 浏览器行为验证 |
| 21 | 编辑器 Ctrl+Z 与画布 Ctrl+Z 互斥；退出后画布栈无时间轴痕迹 | 快捷键逐按验证 |
| 26（部分） | 反复加片删片 10 次 undoStack 不增长（origin 唯一性单测已证，浏览器复查无视觉回归） | 操作观察 |
| 27 | 编辑器打开时 Ctrl+Z/Delete/空格画布无变化；关闭后恢复 | 快捷键逐按 |
| — | 新建 videoEdit 节点落点无偏移（width:320 端到端——单测锁 store 侧，此项锁渲染测量链；执行期 Task 1 quality review 增项） | preview_click + snapshot |

- [ ] **Step 3: 缺陷修复循环（发现 → 复现测试 → TDD 修复 → 复验）**

- [ ] **Step 4: 全量回归 + 提交收尾（tsc 必跑——vitest esbuild 不查类型，build 的 tsc -b 是独立一步，R1 审核 P0-4）**

```bash
pnpm -C apps/web exec tsc -b   # 期望 0 error（strict 全量含测试文件）
pnpm -C apps/web test && pnpm -C apps/api test
# 预期: 全绿
git add -A && git commit -m "test(video-editor): Plan 2 浏览器验收通过（spec 条目 1-6/15/19-21/26-27 部分覆盖）"
```

> 验收工具说明：**执行会话**具备 `preview_*` 工具组（preview_start/snapshot/click/console_logs 等，经 `.claude/launch.json` 启动 dev server；R2 审核沙箱不可见该工具组属环境差异，不代表执行环境缺失）——上表"preview_click + snapshot"均指该工具组，非人工操作；若执行会话确无该工具组，降级为手动操作 + 单测佐证。

---

## Plan 2 完成判定

- `pnpm -C apps/web exec tsc -b` 0 error（R1 审核 P0-4：vitest esbuild 不查类型，tsc 必跑）；`pnpm -C apps/web test` 全绿（新增 ~65 用例：纯函数 7 文件 + store 2 + 组件 7 + 桥层 2）；`pnpm -C apps/api test` 不受影响全绿
- spec 附录 B 阶段 2/3/4 落地核对：
  - 阶段 2：全链路注册清单 6 项（nodeTypes/nodeTypeMap 不需要的决策登记/AddNodeMenu+测试/VideoEditNodeData（union 不动为 spec 定案）/fillDoc+readCanvasFromDoc 往返实测/白名单已 Plan 1）
  - 阶段 3：公式/吸附/历史/连线 reconcile/帧整数不漂移全部 TDD 落地
  - 阶段 4：normalized store + 时间轴 UI（peaksFromAudioBuffer 纯函数化）+ addEdge 小改与 origin 隔离两条独立任务完成 + isExecutableNode 单点共用（Plan 1 已落）
- 浏览器验收 Task 17 清单通过；发现的缺陷全部修复回归
- **登记偏差**：onRemote shadow- 短路自 spec 步骤 8 前移至本 plan（决策 4）；title 固定'多轨剪辑'（决策 8）；团队素材库分支 Plan 3（P2-2）；deleteTransformNode 不含 videoEdit 级联现状登记（P2-3）
- **R1 轮审核（2026-09-10）已闭合**：采纳 8 项（P0-3/P0-4 部分/P1-1/P1-2/P1-3/P2-2/P2-3 + P0-2 稳健化）；驳回 4 项并注明依据（P0-1 修法方向反——duration 随左拉增大、审核算式 -90 不成立，但引出 trimLeftGuard 补 `-start` 时间轴 0 点下界的真修复；P0-2 判定——同表达式位级相等；P0-4 的 Task 3/5 两处——上下文收窄不报错；P2-1——spec 明文"不是扩展现有 union"）
- **R2 轮审核（2026-09-10）已闭合**：R1 四条驳回复核全部维持（审核方撤回）；采纳 P0-A（assets 悬空消除：payload 自带名称/时长）/P1-A（TrackRow 三 prop 正文传递）/P1-B（afterEach 收口 + 监听 useEffect 化）/P1-C 前半（tsc -b 前移 Task 1）/P2-1（无源片 -Infinity 边界用例）；驳回 P1-C 后半（preview 工具组：审核沙箱 ≠ 执行会话）；自修 -0/Object.is 陷阱（toBe(0) → toBeCloseTo）。无遗留阻塞项
- **R3 轮审核（2026-09-10）已闭合**：P0-A 根因（修复未落实现块与断言）三处收口——AssetPanel 主实现块 5 字段 payload（唯一权威版本）/drop 用例补 duration+mediaInfo 断言（锁力归位）/TimelinePanel import 增量与 useEditorKeyboard 实现行；P2×3（-0 归一 /startPxPerSec 拖拽比例尺快照/TrackRow minWidth 修正）。
- **R4 轮审核（2026-09-10）已闭合**：R3 六项复核全部真采纳。P1-1 方案 A——决策 6 第一优先级补代码路径（AssetItem.nodeDurationSec → payload `nodeDurationSec ?? metadata.durationSec`），测试向量 5s/8s 双值分解（dragStart 用例锁优先级解析、drop 用例锁消费契约，两侧独立回归可定位）；P2×3——Task 15 useEffect 移到监听函数定义后（防执行者误判）/intervalsOverlap 死代码删/Task 14 面板删未用 dur 与孤儿 import + Task 15 补 import 增量（view-scale 五函数 + CLIP_BLOCK_MIN_PX + Clip 类型）、Task 16 增量收敛 quantizeTime。四轮共 20 项修订，无遗留

## 后续 Plan（另开文件）

- Plan 3/4：scene 纯函数 + 预览 + audio-engine + 节点本体迷你播放 + 右面板四态 + 转场关键帧 + **素材缺失态片段标红**（spec 生命周期第 3 条：上游素材节点被删 → 片段标红"素材已删除"——依赖资产集合派生，放 Plan 3；导出前置拦截缺失 mediaId 放 Plan 4）
- Plan 4/4：Worker 导出 + 产物登记/上画布 + socket 单例迁移（5 创建点）+ AI 三按钮（消费本 plan 的 onRemote 短路与 regenerate 端点）+ 29 条完整验收
