# Spec: Canvas 视频剪辑器（多轨时间轴 + 纯浏览器导出）v3.3-final

> v1（2026-09-10）：初版。
> v2/v2.1（2026-09-10）：R1/R2 轮审核修订——模型补全、normalized、变速公式、A1 影子节点、pending→confirm、PATCH 单飞等。
> v3（2026-09-10）：**入口模型变更（用户产品决策）**——视频剪辑节点成为画布一等节点类型，上游素材随时间轴增删自动连线，导出产物自动创建视频节点并连到输出端。v2.1 的"视频节点工具栏按钮"方案作废。
> v3.1（2026-09-10）：R3 轮复审修订——执行白名单、composite 死入口接管、空工程定义、自动连线 reconcile 算法定稿、节点播放资源纪律、能力检测分层、生命周期与产物节点收敛、验收清单修复（18 条）。
> v3.2（2026-09-10）：R4 轮复审修订——白名单升级"类型+产物标记"（产物节点二次必挂规避）、origin 隔离拆独立任务、A1 补 insertNode/removeNode 原语与克隆字段清单、产物登记自建化、audio-engine 新建、波形抽峰纯函数化、帧整数真相、crossfade 音频规则、真机兼容矩阵、验收 19 条。
> v3.3-final（2026-09-10）：R5 轮复审修订（冻结版）——socket 单例服务化（更正 useSocket 非单例的 R4 误判）、A1 克隆改 structuredClone 整份深拷、crossfade 音频统一线性 equal-gain、originOverride try/finally 与 transact 分流落地、三态/护栏表残留修正、P3×3 记录项。**冻结开工，不再全面评审。**

## 目标与背景

画布新增"**多轨道剪辑**"节点类型（VideoEditNode，与其他生成节点同级的一等公民），节点本体为只读时间轴预览 + 全屏编辑入口；点击"全屏编辑"打开画布内全屏遮罩的多轨剪辑页面（剪映风格：亮色 + 紫色 #6C5CE7 系）。参与合成的视频/音频/图片节点产物**随时间轴增删自动与剪辑节点连线**；导出 MP4（H.264+AAC）后自动入素材库并在画布创建视频产物节点、连线到剪辑节点输出端。支持多轨时间轴（视频/字幕/音频）、转场特效、关键帧动画、变速不变调。

### 选型结论（2026-09-10 定案，审核确认）

| 项 | 决策 |
|---|---|
| 渲染架构 | 纯浏览器 WebCodecs + mediabunny，同源渲染（scene-builder 纯函数供预览/导出共用） |
| 参考库 | opencut-classic（MIT 归档快照，commit cf5e79e）**vendor 入仓** `docs/vendor/opencut-classic/`——**开工第一前置**（Temp 目录会被 Windows 磁盘清理自动回收，随时会丢） |
| 服务端 | 不参与导出渲染；FFmpeg/BullMQ 管线只留代码、一期无服务端导出入口；导出失败引导仅"重试 / 降 720p" |
| 新依赖 | `mediabunny@^1.56.1`、`@mediabunny/aac-encoder@^1.56.1`（动态 polyfill）、`soundtouchjs@0.3.0`（**精确锁**，停更风险已登记，备选自实现 WSOLA；Worker 内 ESM 导入纳入 spike） |

---

## 一、总体架构

### 模块划分（apps/web/src/pages/canvas/video-editor/）

```
video-editor/
├── store/          # zustand 剪辑状态（normalized，参考 opencut timeline-store）
├── timeline/       # 纯逻辑：吸附/trim/分割/变速公式/重叠判定/像素换算/历史栈（TDD 主战场）
├── scene/          # selectActiveClips + interpolateClip 纯函数（scene-builder）
├── renderer/       # CanvasRenderer（薄绘制层）+ video-cache（LRU 帧缓存）
├── audio-engine/   # 全局音频引擎单例（本项目新建资产：lookahead 调度+增益包络+soundtouch 变速，
│                   #   实时 AudioContext 与 OfflineAudioContext 两套上下文共用同一套
│                   #   不依赖上下文类型的 PCM 纯函数/混音模块——勿写两遍）
├── export/         # 导出 controller（依赖注入可测）+ Worker bootstrap
├── persist/        # 自动保存（1.5s 防抖 PATCH + 三态状态点）
└── components/     # 顶栏/资产库/预览区/多轨时间轴/属性面板（四态）
```

### 核心原则

1. **同源渲染**：`scene/` 两个纯函数 `selectActiveClips(state,t)`（活跃片段判定，含 crossfade overlap 双片段）与 `interpolateClip(clip,t)`（关键帧插值/转场 opacity/变速→输出 sourceTime+transform+opacity+文本）供预览与导出共用；**解码/取帧/LRU 属 renderer 与 video-cache，不进 scene**。
2. **合成坐标系**：固定 1920×1080（16:9）；导出 720p 整体 0.5×缩放绘制。
3. **Worker 可测性**：导出编排为依赖注入的 controller（注入 encoder/muxer/进度回调），Worker 仅 bootstrap + API 适配（jsdom 无 WebCodecs/OffscreenCanvas，controller 用 mock 测）。

---

## 二、入口与形态（视频剪辑节点）

### 剪辑节点（VideoEditNode，画布一等公民）

- **添加方式（接管 composite 死入口）**：[AddNodeMenu.tsx](apps/web/src/pages/canvas/components/AddNodeMenu.tsx) 已存在 `{type:'composite', label:'视频合成', badge:'Beta'}` 菜单项，但 nodeTypeMap/nodeTypes/组件三处皆无——是点了会创建无法渲染节点的**死入口**，且语义与本功能重叠。**决策：直接接管**——菜单项改名"多轨道剪辑"（desc：多轨剪辑视频/音频/字幕，Beta 角标移除），type 注册名 `videoEdit`（nodeTypeMap 增加短名 `composite → videoEdit` 映射或直接改 type，`AddNodeMenu.test.tsx` composite 用例同步改写）；不保留第二个视频合并入口
- **节点本体 UI**（依据节点设计图，白色宽卡片 + 左右 Handle，默认宽 320px 与节点体系协调）：
  - 标题栏：网格图标 + "多轨道剪辑"
  - 工具栏一行（一期轻量）：播放/暂停 + 时间码（简略 `00:00 / 00:00` M:SS 格式，与片段块的 HH:MM:SS:FF 注明为不同精度显示）| 右侧"⤢ 全屏编辑"文字链接
  - 时间刻度尺（随工程时长自适应；小宽度下最小刻度退化为 1s/格）
  - 轨道区**只读缩略**：片段色块（缩略图拼贴，用已有 thumbnail 产物，**不逐帧解码**）+ 播放头位置；空态显示轨道占位条"+ 添加素材"
  - Handle：左输入（接收上游素材连线）/ 右输出（产物连线），复用 NodeHandle 体系（单 target/source，无 id、无类型校验）
- **节点播放资源纪律（v3 多节点并存独有风险）**：① **全局同时只播一个剪辑节点**（播 B 停 A）；② 仅点播放时起轻量 renderer，缩略态零解码；③ IntersectionObserver 移出视口/取消选中即暂停并释放解码与帧缓存；④ **全屏编辑器打开时节点本体播放全部暂停**（互斥）；⑤ 节点本体不新建 AudioContext，复用全局单例 audio engine
- **节点上不显示"执行/生成"按钮**（它不是生成节点，见"执行白名单"）
- **能力检测分层**：点"全屏编辑"检测 `VideoDecoder + AudioDecoder + OffscreenCanvas`（预览依赖解码器；AudioContext 首次手势 resume）；不满足则节点入口置灰 + tip；编码器检测（`VideoEncoder.isConfigSupported` 真实 1080p avc1 config + AAC 静默 polyfill）推迟到点"导出"时。兼容矩阵：Chrome/Edge 全量；Firefox 需较新版本；Safari 部分支持
- **工程创建时机（统一）**：首次"全屏编辑"时 upsert（入口时序 POST 兜底）；添加节点不建工程——节点本体在工程不存在时即空态，省一次失败面；节点 id 先于工程存在
- 旧 VideoNodeToolbar 的"剪辑"（onTrim 单段裁剪）链路**依然一字不动**，与本功能互不干扰

### 执行白名单（升级：类型 + 产物标记，双重规避"全部执行"必挂）

代码事实：[validation.service.ts](apps/api/src/modules/execution/validation.service.ts) 对非 textInput 节点强制校验 `data.model` 存在且 active、**不看 data.status**；[execution.service.ts](apps/api/src/modules/execution/execution.service.ts) 非 textInput/非 videoGen 类型**兜底走图片生成调用**、同样不看 status。

两处必挂源与规避：
1. **videoEdit 剪辑节点**（无 model）→ 类型白名单挡：白名单 `textInput/imageGen/imageExtGen/videoGen/audioGen/multiImageGen` 外的类型（videoEdit、group 等）两处 `continue`——不校验、不执行、不计费
2. **导出产物节点**（类型 videoGen **在白名单内**、data 仅 `{origin:'video-edit',videoProjectId,status:'done',fileId}` 无 model）→ **产物标记挡**：`data.origin==='video-edit'` 的节点在 validation 与 execute 两处同样 `continue`（注意：不能照 trim 子节点先例补 model——那会让产物节点被真的重新生成并扣费）
- 节点上不显示"执行/生成"按钮；对剪辑节点触发展开上游执行一期不做（YAGNI）
- A1 影子节点是 videoGen/audioGen 且克隆完整 data（含 model），正常走白名单
- 测试：画布**同时含空剪辑节点 + 已导出产物节点**时"全部执行"只跑真正待生成节点，两类均跳过、不报错不扣费（API 测试）

### 连线同步规则（定稿算法：确定性 id + 全量 reconcile + origin 隔离）

**代码约束**（[canvasStore.ts](apps/web/src/stores/canvasStore.ts) / [canvasCollabRuntime.ts](apps/web/src/stores/canvasCollabRuntime.ts)）：`addEdge` 无判重且 id 内部生成（L451，需小改支持可选 id）；协作桥**仅持久化 edge 的 `{id, source, target}`**（edge.data/handle 刷新即丢）——自动边身份不能存 data，只能编码进**确定性 id**；`d.transact(fn, origin)` 支持 origin，Y.UndoManager trackedOrigins 仅收 local-user。

```ts
// 自动边 id 确定性派生（身份只依赖 id，不依赖会丢失的 edge.data）
const autoEdgeId = (editNodeId: string, sourceNodeId: string) =>
  `auto:${editNodeId}:${sourceNodeId}`;

// 每次片段增删 commit 后（含 undo/redo 回放）全量 reconcile
function reconcileSourceEdges(data: ProjectData, editNodeId: string) {
  const expected = new Set(
    Object.values(data.clips)
      .filter(c => c.type !== 'subtitle' && c.sourceNodeId)
      .map(c => c.sourceNodeId!));            // 时间轴引用到的源节点
  const mine = edges.filter(e => e.target === editNodeId && e.id.startsWith('auto:'));
  const have = new Set(mine.map(e => e.source));
  for (const src of expected) if (!have.has(src)) addEdgeById(autoEdgeId(editNodeId, src), src, editNodeId); // 幂等建边
  for (const e of mine) if (!expected.has(e.source)) removeEdge(e.id);       // 派生消失即删
  // 手动边（id 无 auto: 前缀）：永不自动建、永不自动删
}
```

规则文字化：
1. **自动边 = 时间轴的派生视图**：手动删自动边，下次 reconcile 会**重建**（spec 明示，避免被报 bug）；手动拖入的边无 `auto:` 前缀，reconcile 不碰；时间轴为唯一数据源，手动连线**不反向加素材**；素材库来源（无 sourceNodeId）不建边
2. `addEdge` 增加可选 id 参数（确定性建边幂等），小改不动现有调用
3. **跨撤销栈隔离（独立改造任务，非 addEdge 小改的一部分）**：协作桥是**订阅式自动同步**——store 变化触发 `subscribe` 内写死 `syncStoreToDoc(Origin.LocalUser)`（[canvasCollabRuntime.ts](apps/web/src/stores/canvasCollabRuntime.ts) bindBridge），UndoManager trackedOrigins 仅收 LocalUser；调用方在 addEdge 参数里**无法指定 doc 事务 origin**。需给协作桥增加**一次性 origin 覆盖**：reconcile 包裹 `try { setOverride(Origin.AutoEdge); …同步… } finally { reset() }`——**try/finally 复位是硬性要求**（全局开关若因异常未复位，后续所有 store→doc 同步都会静默不进画布撤销栈，极难排查）；落地位置在 **syncStoreToDoc 内部按 edge.id 是否 `auto:`/`auto-out:` 前缀分流到两个 transact**（自动边独立事务用 override origin，nodes 与手动边仍走 LocalUser 事务——现实现 nodes+edges 在同一 transact，不分流则"拆独立事务"落不了地）。`addEdge` 增加可选 id 参数（确定性幂等建边）仍是独立小改。**桥层测试**（不止 store 单测）：断言自动边写入 ydoc 的 transaction.origin ≠ LocalUser、UndoManager.undoStack 不增长；编辑器撤销→reconcile 删边后画布 Ctrl+Z 不恢复该边
4. **产物输出边**为一次性边，确定性 id `auto-out:${editId}:${productNodeId}`，不参与 reconcile
5. **连线方向恒定**：素材 source → 剪辑 target；剪辑 source → 产物 target；自动边单向派生不可能成环，一期不做连线类型校验/环检测（手动边仅视觉，无执行语义——执行白名单保证剪辑节点不被执行）；onConnect 现状无判重（同一对节点可重复拖线，现状缺口非本功能引入）——**顺手在 onConnect 加同源判重**
6. **测试矩阵**：加片建边 / 同源多片只一边 / 删全部片删边 / 素材库片不建边 / 手动边不被删 / 自动边判重 / 编辑器撤销后边跟随回滚 / 画布撤销栈不含自动边

### 生命周期规则

- **删除剪辑节点**：`canvasStore.deleteNode` 对 videoEdit 类型 fire-and-forget `DELETE /api/video-projects/by-node/:id`（否则成无入口孤儿；边由 deleteNode 现有逻辑级联清除；**DELETE 失败走 Sentry 上报**，避免静默孤儿无法排查）
- **复制/粘贴剪辑节点**：一期 = **空工程**（新 nodeId，首次全屏编辑时 upsert），不深拷贝时间轴
- **上游素材节点被删**：边级联消失，但 clip 仍引用 mediaId → **素材缺失态**：片段标红"素材已删除"、导出前置校验拦截缺失 mediaId、可在时间轴手动删除
- **左面板可选派生标记**："已连线但未入时间轴"的素材显示"已连线"次级标记（edge 集合派生，帮助理解自动边来源）

### 挂载结构

节点"全屏编辑"只写编辑器 store `{open:true, sourceNodeId: 剪辑节点id}`；编辑器本体挂**画布根层**（不进 VideoEditNode 内部，保证全屏遮罩与画布 React 树不卸载、左面板可读整个 nodeStore），基于 `components/BaseFullscreenModal.tsx` 封装外壳——该组件现状**点击遮罩即关且无开关**（自研 portal 非 antd Modal），需新增 `closeOnBackdrop?: boolean`（默认 true 保持现状，编辑器传 false）；ESC 现状即 onClose 回调，接"flush 后关闭"；底色亮色 #F7F8FA；全屏打开期间节点本体播放全部暂停。

### 入口时序

```
[节点菜单"多轨道剪辑"（接管 composite）] → addNode('videoEdit')（仅建节点，不建工程，本体空态）
[节点上"全屏编辑"] → 能力检测（VideoDecoder/AudioDecoder/OffscreenCanvas）→ editorStore.open({sourceNodeId: 剪辑节点id})
→ 画布根层 VideoEditorShell 挂载（BaseFullscreenModal 定制）
→ POST /api/video-projects（首次全屏编辑时 upsert by sourceNodeId，一次 RTT 幂等，update 分支亦返回全量）→ 加载工程
→ 等待期间只渲染空态加载占位、**禁止增删片段**（POST 未返回前本地默认轨 id 与服务端返回的轨 id 会错位——等待期禁编辑为最简策略，失败转错误态）
```

---

## 三、数据模型

### Prisma（修订版，对齐项目惯例）

```prisma
model VideoProject {
  id           String        @id @default(cuid())
  teamId       String
  userId       String
  workflowId   String        // CanvasProject.id：重拍 enqueue / socket room / 资产过滤 / 级联删除
  sourceNodeId String        @unique // 视频剪辑节点自身的 nodeId——一剪辑节点一工程
  title        String
  data         Json          // ProjectData
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  team      Team          @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user      User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  workflow  CanvasProject @relation(fields: [workflowId], references: [id], onDelete: Cascade)

  @@index([teamId])
  @@index([userId])
  @@index([workflowId])
}
// Team / User / CanvasProject 各补反向字段：videoProjects VideoProject[]
```

### ProjectData（normalized，修订版）

```ts
interface ProjectData {
  version: 1;
  fps: 30;                                            // 固定 30，输出帧率
  tracks: Track[];                                    // UI 排列顺序
  clips: Record<string, VideoClip | ImageClip | AudioClip | SubtitleClip>; // 统一字典
}
interface Track {
  id: string; type: 'video' | 'subtitle' | 'audio'; name: string;
  muted: boolean; hidden: boolean;
  clips: string[];   // 三类轨语义一致：clip id 按 start 有序（图片片放视频轨）
}
interface BaseClip { id: string; trackId: string; start: number; duration: number; }
interface VideoClip extends BaseClip {
  type: 'video'; sourceStart: number; mediaId: string; sourceNodeId?: string;
  transform: { x: number; y: number; scale: number; rotation: number; opacity: number };
  // 默认基准：素材 contain 居中于 1920×1080 = scale 1、x/y=0 偏移、rotation=0、opacity=1
  playbackSpeed: 0.5 | 1 | 2;
  transitionIn?: Transition; transitionOut?: Transition;
  keyframes: TransformKeyframe[];
}
interface ImageClip extends BaseClip {
  type: 'image'; mediaId: string; sourceNodeId?: string; // 连线同步依赖；无 sourceStart/变速/内嵌音轨，无天然时长（默认拖入 5s，边缘可改）
  transform: { x: number; y: number; scale: number; rotation: number; opacity: number };
  transitionIn?: Transition; transitionOut?: Transition;
  keyframes: TransformKeyframe[];
  // 默认拖入时长 5s，边缘可改；导出路径与视频完全不同（一次 drawImage vs seek 抽帧）
}
interface AudioClip extends BaseClip {
  type: 'audio'; sourceStart: number; mediaId: string; sourceNodeId?: string; // 连线同步依赖
  volume: number; fade: { in: number; out: number };
  playbackSpeed: 0.5 | 1 | 2; keyframes: VolumeKeyframe[];
}
interface SubtitleClip extends BaseClip {
  type: 'subtitle'; text: string; visible: boolean;
  style: { fontSize: number; color: string; letterSpacing: number }; // 默认 48 / #FFFFFF / 0
}
// Keyframe.t 为片段局部时间 0..duration（秒）：移动片段不平移关键点；trim 左缘按局部坐标同步裁切
// 插值边界：t 越首点取首点值、越末点取末点值、单点恒值、无关键帧取基准 transform/volume
// 类型拆分：视频/图片片用 TransformKeyframe（x/y/scale/rotation/opacity），音频片用 VolumeKeyframe（volume）——
//   避免无意义的 volume 关键帧混进视觉片
interface TransformKeyframe { id: string; t: number; property: 'x'|'y'|'scale'|'rotation'|'opacity'; value: number; easing: 'linear' }
type VolumeKeyframe = { id: string; t: number; value: number; easing: 'linear' }
interface Transition { type: 'fadeIn'|'fadeOut'|'crossfade'|'toBlack'|'toWhite'; duration: number } // 0.2~2s
```

**渲染顺序 renderOrder（显式，与 UI 轨道顺序解耦）**：① 视频/图片 clip 按所在 track 索引升序、同轨按 start；② 字幕 clip 恒最后合成（视觉最上）；③ 音频 clip 不参与视觉，仅入混音总线。

**重叠规则（同轨限定）**：
- **禁重叠与吸附只作用于同一 trackId 内部**；跨轨允许自由重叠（图层叠加/画中画是多媒体轨的核心），上下层由 renderOrder（track 索引）决定
- **crossfade overlap 仅允许同轨相邻片**：后片 `transitionIn.type==='crossfade'` 时允许其前缘与前片重叠，重叠长度 = `transitionIn.duration`，由后片单侧表达（前片不重复存储）
- **crossfade 边界状态机（全部进纯函数测试）**：前片不存在/被删/被移走 → 退化为 fadeIn 且 overlap 归零；前片 transitionOut 与后片 crossfade 冲突时 crossfade 优先；分割带 overlap 的片段后重新配对；hidden 轨视觉片不进 selectActiveClips，muted 轨 gain=0 但仍占时长

### 变速 / trim / 分割公式（timeline 纯函数，TDD）

```
sourceTime(clip, t) = clip.sourceStart + (t - clip.start) * clip.playbackSpeed

分割（播放头 cutPoint 处）：前片 [start, cutPoint]
  后片.sourceStart = 前片.sourceStart + (cutPoint - 前片.start) * 前片.playbackSpeed
  后片.duration    = 前片.start + 前片.duration - cutPoint
  后片.start       = cutPoint

trim（拖左缘 Δ 成片秒）：
  start += Δ；duration -= Δ；sourceStart += Δ * playbackSpeed   // 右缘拖动不改 sourceStart
约束：sourceStart + duration * speed ≤ 素材真实时长（mediaDuration）
```

**时间真相与浮点纪律**：内部以**帧整数（frame = round(t × 30)）为唯一真相、秒为派生**（或纯函数边界统一 round 到 1/fps）——多次 trim/拖动/吸附不累积浮点误差（否则 1e-7 秒缝隙影响同轨重叠判定与吸附）。**量化边界：只量化成片时间（start/duration/Keyframe.t/吸附位置）；源 sourceStart/sourceTime 保持连续浮点交给 decoder nearest sample**——源可能 24/25/60fps，把源时间也锁 30fps 网格反而错位。TDD 加"反复 trim 100 次不漂移/无缝隙"用例。

### 自动保存（自建，画布 Yjs 模式不适用）

- 编辑器数据 1.5s 防抖 `PATCH /api/video-projects/:id { data, baseUpdatedAt }`（**不带 title**——一期不做重命名，避免半成品字段）
- **PATCH 单飞规则（防自打自 409）**：全局单飞——进行中有新改动则 latest-wins 排队、禁止并发；每次用响应回填的新 updatedAt 更新本地 baseUpdatedAt；仅服务端值 ≠ 本地上一次确认值才判"他处修改"（409 弹冲突提示）；收起 flush 走同一队列并 await 排空再关
- 顶栏三态状态点：保存中（灰）/ 已保存（绿）/ 失败（红，可点重试）
- title 初始取源节点名（创建时写入，不在 PATCH 中更新）

### API（apps/api 新建 modules/video-project/，注册 app.module）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/video-projects` | assertEditor(workflowId) | **服务端 upsert by sourceNodeId**（幂等防双击），写 userId/teamId/workflowId |
| GET | `/api/video-projects/by-node/:sourceNodeId` | assertEditor | 入口加载 |
| PATCH | `/api/video-projects/:id` | assertEditor | 自动保存 + updatedAt 乐观锁（409） |
| DELETE | `/api/video-projects/:id` | assertEditor | 仅删工程记录，引用 Media 不动 |
| POST | `/api/video-projects/regenerate` | assertEditor | **A1 影子节点克隆生成**（见下） |

**A1 影子节点方案（regenerate 落地契约）**：

- execute 链路事实（[execution.service.ts](apps/api/src/modules/execution/execution.service.ts)）：以 Yjs 节点为唯一数据源（`readCanvas` → 拓扑 scope → 执行 → `writeNodeData` 写回节点 data → `emitNodeStatus({nodeId,status})` 以 **nodeId 为键、不带 mediaId**，产物 fileId 在节点 data 里），积分走 teamCredit 循环内扣费
- regenerate 实现：在 Yjs 画布克隆 sourceNode 为 `data.__ephemeral` 影子节点 → **直接复用 `execute(projectId, shadowNodeId)` 全链路**（校验/上游收集/积分/队列/写回全部白捡）→ 接口返回 shadowNodeId
- **后端 doc 原语缺口（必须新增）**：[collab-document.service.ts](apps/api/src/modules/collab/collab-document.service.ts) 现仅有 `writeNodeData`（只能 patch 已有节点 data）——需新增 `insertNode(projectId, node)`（nodes Map 建 Y.Map 写齐 type/position/data 子 Map）与 `removeNode(projectId, nodeId)`（影子无连边无需动 edges），走现有 `withDoc` 直连
- **克隆口径（整份深拷，禁止字段挑拣）**：影子节点孤立（getScope 只含自身）、拿不到上游边补参，且它是白名单内 videoGen/audioGen 会被 validation 校验 model——克隆实现为 **`structuredClone(sourceNode.data)` 整份深拷（含嵌套对象，如 `data.prompt = {text,...}`）后叠加 `__ephemeral` 标记**；后端取词链为 `上游textContents → data.content → data.prompt`，且执行消费 content/endImageUrl/imageUrls/quality/duration/audio/resolution 等一长串字段——**逐字段白名单必漏，字段清单仅作 code review 对照**，不是实现依据
- 前端：socket 按 **shadowNodeId** 监听 node:status；done 后读影子节点 data 取 fileId 摘入资产库，再删影子节点；**影子节点不写 position（或视口外），且在 store 投影层与节点渲染层双重过滤 `__ephemeral`**（防节点列表与迷你播放器闪现；一期单人编辑，协作者闪烁风险可接受）
- 扣费/失败退费复用 teamCredit 既有路径，**不另建**
- 备选 A2（抽 runNode 脱离 Yjs + 事件扩 requestId）架构更干净但需重构 execute 循环体，二期再说

data 校验：class-validator 嵌套 DTO（防 `whitelist:true` 裸放 Json），ProjectData TS 类型放 `packages/shared/src/types/video-project.ts`（有 material-library.ts 先例）前后端共用。响应走全局 TransformInterceptor（前端 `code:0` 解包）。

---

## 四、UI 布局规格（依据效果图）

| 区域 | 内容 |
|---|---|
| 顶栏 | 标题"多轨剪辑" / 三态保存状态点 / 比例 16:9（一期固定不可切）/ "收起" / "导出"黑色主按钮 |
| 左面板 | Tab：资产库/字幕；搜索框；"全集资产"分组 = 当前画布（workflowId）视频/音频/图片节点产物 + 团队素材库；条目 = 缩略图+名称+"已添加"标记（纯派生：已在时间轴的 clip 的 mediaId 集合）；"+新建"上传走现有 presign 链路 |

**左面板数据来源**：前端聚合——nodeStore 遍历当前 workflow 节点收集 fileId + 节点名 → 后端补 `POST /api/media/batch` 批量查详情/预签名（真实媒体前缀是 `api/media`（media.controller），目前仅单查/按 folder 查）→ 团队素材走现有 folder 接口；**避开 material.service 的 `type='generated'` 硬编码过滤**（直接按 mediaId 集合查）。
| 中上 | 16:9 预览播放器；控制条：播放/时间码（当前黑+总长灰）、撤销/重做/分割/删除、**生成音频/添加字幕/片段重拍**（紫色文字按钮，触发时明示"将消耗团队积分"）、设置/音量/全屏/缩放滑杆四控件。**不设全局"速度 1×"控件**（片段变速在右面板，预览速率控件易与导出数据混淆，一期删除） |
| 中下 | 时间轴（第五节） |
| 右面板 | **四态**：视频片段态 / 图片片段态 / 音频片段态 / 字幕态（见下） |

视觉：亮色（背景 #F7F8FA、面板白）、紫 #6C5CE7 强调、字幕片段浅橙黄底、音频片段浅绿底+波形、圆角 8-16px、黑色胶囊主按钮。antd5 + Tailwind；**preflight:false 红线：box-border、list-none pl-0、border 配 [border-xxx-style:solid]、button 字号写在自身**。

### 右面板四态

| 态 | 内容 |
|---|---|
| 视频片段 | transform（x/y/scale/rotation/opacity 数值输入）、播放速度（0.5×/1×/2×）、入/出场转场（类型+时长）、**每属性行旁秒表按钮=在播放头处添加/删除该属性关键帧** |
| 图片片段 | transform、入/出场转场、关键帧秒表（无变速） |
| 音频片段 | 音量滑杆、fade in/out、播放速度 |
| 字幕 | 字幕文本 textarea、显示字幕开关、字号滑杆+数值、字体颜色、字间距（对齐效果图） |

关键帧 UI：属性项旁秒表按钮添加；时间轴片段内显示菱形关键帧刻度（可点击跳转、拖拽移动、Delete 删除）。

### AI 按钮三件（方案 A 桥接）

| 按钮 | 行为 |
|---|---|
| 添加字幕 | 本地完整实现：播放头处创建 3s 字幕片段 |
| 生成音频 | 弹输入框 → `POST /api/video-projects/regenerate`（音频分支）→ 返回 shadowNodeId，按其监听回流，done 后读节点 data 取 fileId 入资产库可拖入；明示扣积分 |
| 片段重拍 | 读选中片段 sourceNodeId → regenerate（视频分支）→ 同上契约，新视频入库可替换；**nodeStore 中参数不可得则置灰** |

socket：**新建模块级单例 socket 服务（非 Hook）**——代码事实：现有 `hooks/useSocket` 是 per-component Hook（每次 mount `io('/execution')` 新建 Socket、各自 join，仅返回 ref、无按 nodeId 订阅 API，cleanup 只 removeAllListeners **无 disconnect**；page.tsx 与 useStitchTask 已各建一个，socket.io 传输层虽 multiplex 但实例/room/监听器 per-hook；且影子节点被 `__ephemeral` 过滤不在 nodeStore，现有"状态→nodeStore"分发到不了编辑器）。改造：① 全画布共享一个 `/execution` Socket，按当前 workflowId join 一次、切换/卸载 leave+disconnect（顺手补现状缺失的 disconnect 清理）；② 暴露 `subscribeNodeStatus(handler): unsubscribe`（内部统一监听 `node:status` 按 payload.nodeId 过滤分发——编辑器据此按 shadowNodeId 分发，node:status 以 nodeId 为键不带 mediaId，见第三节 A1 契约）；③ page.tsx / useStitchTask / 视频编辑器三处全部改用该单例。列入开发步骤 8 前置。

---

## 五、时间轴交互规格

- **轨道**：三类（video/subtitle/audio）数量不限可增删；默认 1 视频+1 字幕+2 音频；字幕轨轨道头"➕"= **该轨内新增字幕**（非新增轨道）；**删除轨道 = 确认后连片段一起删**（入撤销栈），不做跨轨迁移
- **标尺**：自适应刻度；紫色播放头（顶部圆点）可拖拽；片段块显示"名称 · 源时间码"（如 `视频生成需求 · 00:00:10:04`，HH:MM:SS:FF，30fps 非丢帧；节点本体为简略 M:SS 显示，两者注明为不同精度）——时间码格式化与 totalDuration（**时间轴原点恒 0，总长 = max(片.end)**；片段不从 0 开始时前导为黑场并计入成片，此行为写明）均抽纯函数入 TDD
- **片段操作**：拖动（同类型跨轨自由重叠；**禁重叠与吸附仅同轨内**——同轨除 crossfade overlap 外冲突吸附最近空位，规则详见第三节）、边缘 trim（公式见第三节）、播放头分割、删除、撤销/重做
- **历史栈事务性**：拖拽 rAF 级高频 setState **不入栈**，pointerup commit 时一次入栈；快照结构化克隆（禁持引用）；上限 50 步
- **吸附**：片段边缘 ↔ 相邻边缘/播放头/整秒刻度，8px 阈值（换算为秒随 px/s 变化）
- **缩放**：Ctrl+滚轮调 px/s，以播放头为中心；**编辑器挂载期间禁用画布快捷键层**（Delete/空格/Ctrl+滚轮在 document 捕获层 stopPropagation，防"删时间轴片段"穿透成"删画布节点"）
- **波形**：现有 `hooks/useWaveformPeaks` 与 wavesurfer 实例耦合（首参必须传实例），**不能零成本复用**——将"从 AudioBuffer 抽固定数量峰值"的逻辑剥离为纯函数 `peaksFromAudioBuffer(buffer, count)`（可 TDD）+ 共享单例解码器产 AudioBuffer；时间轴 Canvas 自绘静态波形，峰值按 mediaId 缓存（不为每片段 new wavesurfer 实例）
- 交互算法参考移植 opencut `timeline/`（drag-utils/snapping/group-move），适配 zustand4+antd5
- **可测性红线**：像素↔秒换算、边缘命中宽度、8px 阈值行为全部抽纯函数；组件只绑 pointer 事件

---

## 六、预览播放

- **主时钟**：有音频轨时用 Web Audio `audioContext.currentTime`（**首次用户手势 resume**）；项目无音频片时降级 `performance.now()` 时钟（不为时钟空转 AudioContext）；rAF 每帧 `selectActiveClips → interpolateClip → CanvasRenderer 绘制`
- **视频帧**：mediabunny 精确取帧（**nearest sample**，源 24/25/60fps 不做帧插值，轻微运动抖动为已知限制）+ LRU 帧缓存（参考 opencut video-cache 预解码播放位置附近片段）；图片片一次 drawImage 无解码路径
- **降级策略**：播放中解码跟不上 → **跳帧追赶、音频不停**；seek → 等目标帧解码完成再绘
- **音频**：AudioBufferSourceNode 按 start 调度 + **lookahead 调度**（50ms 定时器/0.1s 调度窗，seek 清队列）；**全部进混音总线的 PCM（独立音频片 + 视频片内嵌音轨）统一过 soundtouchjs 变速不变调**（muted 不处理）；混音走 GainNode（volume 关键帧/淡入淡出在调度时计算包络）
- **crossfade overlap 段音频规则（线性 equal-gain）**：两段视频内嵌音轨在重叠区做**线性交叉淡化**——前片音频增益与画面 opacity 同曲线线性 1→0、后片 0→1（中点各 0.5 有约 -6dB 短暂凹陷，一期接受；与画面同曲线、scene 同源最简；等功率 cos/sin 方案二期再说），消除双倍音量/突兀，规则进 scene/混音纯函数测试
- **字幕绘制规格（预览/导出共用绘制函数）**：1920×1080 基准——底部居中、底边安全边距 96px、最大宽 1664px 自动换行、字号 48px（720p 随 0.5× 整体缩）、超长截断

---

## 七、导出管线（Web Worker + mediabunny）

0. **导出弹层**：点击"导出"→ 小弹层选档（720p/1080p）+ 估算体积（码率×时长×1.2）+ 前置校验结果
1. **前置校验**：总时长 ≤15 分钟（超限拦截）；`VideoEncoder.isConfigSupported` 复检；**团队存储配额预检**（StorageQuotaService.assertCanUpload 同款口径，避免编码数分钟后上传 4xx）；内存预估 = 音频 PCM（15min×48kHz×立体声×4B ≈ 86MB/轨 × **音频轨数（按轨数动态计算，非静态文案）**，soundtouch 处理再产出等长 PCM，音频部分 ×2）+ 编码峰值 + mux 缓冲，>1GB 警告但放行；警告结合 `navigator.deviceMemory` 分级提示；**"音频分块流式混音、不整段持有全部 PCM"登记为二期优化**
2. **Worker 执行**（懒加载 chunk，含编辑器页/mediabunny/polyfill 全部动态 import 拆包）：
   - `OfflineAudioContext` 离线混音（含变速不变调/soundtouch 处理/fade/音量关键帧）→ AudioBuffer
   - 逐帧：t → scene 纯函数 → OffscreenCanvas（720p=0.5× / 1080p=1×）→ VideoFrame → VideoEncoder H.264（硬编优先回退软编）
   - **VideoFrame 逐帧 close()（WebCodecs 资源纪律，code review 必查项）**
   - 音频 → AudioEncoder AAC；原生不支持时动态 import `@mediabunny/aac-encoder`
   - `Mp4OutputFormat`：**支持 File System Access API（仅 Chromium）时 StreamTarget 流式直写用户选定文件（导出前选位置）降内存峰值；否则回退 BufferTarget**——StreamTarget 不作通用推荐
3. **产物登记（复用状态机语义，方法自建——勿误调 confirmUpload）**：代码事实——现有 confirm 有 ±1024 字节强校验（编码前估算 vs 实际字节必然超标→对象被删）、现有上传是 presigned **POST**、缩略图由 material.service 主动 enqueue（非 confirm 触发）。因此：**复用"pending→statObject→completed"状态机语义与配额口径**，但 generated 登记/确认两个方法**新写**于 video-project（或 media）模块：登记接口建 `type='generated'`、`status='pending'` 的 Media（估算大小过配额预检，metadata：来源 video-project/分辨率/时长）→ 返回 **PUT 预签名**（自建，非 POST）→ 浏览器 PUT → 确认时 statObject **以实际大小直接落库（不做 ±1024 预估比对）** → 置 `completed` + **主动 enqueue 缩略图**（仿 material.service.ts:82；注意两点：enqueue 必须传 `mimeType:'video/mp4'` 才走 consumer 视频分支；consumer 现固定抽第 1 秒而本功能允许前导黑场——enqueue 时传抽帧时间点 `max(1, 0.1×总时长)`，必要时给 consumer 加可选参数）；不走 presign DTO 的 'uploaded' 通道（素材库类型过滤硬编码 `type='generated'`）；返回 fileId 为 uuid（Media 主键 uuid 非 cuid，前端勿假设 cuid）
4. **产物自动上画布（v3 定案 + 收敛）**：confirm 成功后自动在画布创建**视频产物节点**：`addNode('videoGen', pos, {origin:'video-edit', videoProjectId, status:'done', fileId})`——最小 data 即可走播放展示（VideoGenNode 现有 done 分支）；+ 自动连线：剪辑节点输出 → 新节点输入（确定性 id `auto-out:`，见第二节）；**每次导出都新建独立产物节点**（命名"工程名 · 导出 N"），位置沿剪辑节点右侧固定步长偏移（仿 createDerivedExtNode GAP=80，重叠时步长递增，不做复杂避让算法）；**产物节点工具栏收敛（按真实按钮全量清单）**：VideoNodeToolbar 实际按钮为 剪辑(onTrim)/高清/解析/下载/全屏/音频分离/截帧——产物节点（`data.origin==='video-edit'`）**隐藏：高清/解析/音频分离/截帧**（产物为终态素材，不再二次加工）；**保留：剪辑(旧 trim，仅依赖 fileId)/下载/全屏**；收起后可选 fitView 定位到新节点；toast"导出完成，已添加到画布"
5. **导出中**：两段式进度（离线混音 % + 逐帧编码 %）；ETA 用前 30 帧试编码测速外推 + **每 500 帧滚动修正**（跨 GOP seek 成本不同，首测偏不准）；取消按钮；beforeunload 拦截
6. **失败**：三分类（编码不支持/内存/未知，**含 worker.onerror / Worker OOM 被浏览器杀掉**归入内存/未知）+ 重试 / 降 720p

---

## 八、边界护栏

| 场景 | 行为 |
|---|---|
| WebCodecs 不可用 | **编辑入口**拦截：VideoDecoder/AudioDecoder/OffscreenCanvas 三项（预览不需要 VideoEncoder）；**导出弹层**再检 VideoEncoder.isConfigSupported 真实 config + AAC 静默 polyfill；统一提示最新 Chrome/Edge |
| 兼容真机最小验收集 | 浏览器版本 × 四能力（预览 / 720p 导出 / 1080p 导出 / FSA 流式写盘）矩阵；Safari 不支持项**前置到 UI 降级提示**（入口/导出弹层），不在导出中途才失败 |
| 总时长 >15 分钟 | 导出前拦截 |
| 内存预估 >1GB | 警告但放行 |
| 存储配额不足 | 导出前拦截 |
| 导出中关闭页面 | beforeunload 拦截确认 |
| AAC 编码缺失 | 静默动态 polyfill |
| 多标签并发编辑 | updatedAt 乐观锁 409 提示（PATCH 单飞防自打自，见第三节） |
| 同节点重复创建 | sourceNodeId @unique + 服务端 upsert 幂等；**upsert 的 update 分支同样 select 全量返回** |
| 打开等待 | POST 返回前只渲染空态加载占位、**禁止增删片段**（防本地/服务端轨 id 错位），失败转错误态 |
| 无编辑权限（viewer） | GET 亦 assertEditor，入口按钮直接隐藏（前后端一致） |
| **收起时的运行时释放** | `audioContext.close()`（AudioContext 实例数上限约 6，防泄漏）、终止全部 AudioBufferSource、中断 mediabunny 解码与 LRU、cancelAnimationFrame、revokeObjectURL 全部本地 URL；播放头位置保留、数据留在 store |

---

## 九、测试策略（TDD 红-绿-重构）

| 层 | 内容 |
|---|---|
| timeline 纯函数 | 吸附（8px 多档 px/s 边界）、trim/分割/**变速全部公式**、**同轨重叠限定 + crossfade 唯一合法重叠判定 + 边界状态机（前片缺失退化 fadeIn/冲突优先级/分割重配对）**、像素↔秒换算与命中、历史栈（事务入栈/50 上限/克隆隔离）、**时间码 HH:MM:SS:FF 格式化与 totalDuration（overlap 不重复计时）** |
| scene 纯函数 | selectActiveClips（overlap 双片段/hidden 轨剔除）、interpolateClip（**Keyframe 边界：越首末点取端值/单点恒值/无点取基准**、线性插值/5 种转场输出/contain 基准默认值） |
| store reducers | normalized 增删改、轨道/片段/字幕操作 |
| 导出 controller | 依赖注入 mock：调用序列、两段进度、取消、**VideoFrame close 次数**、AAC polyfill 分支、错误三分类 |
| API 测试 | CRUD + **upsert 幂等（并发双 POST 只一条）** + assertEditor 越权 403 + 乐观锁 409 + **执行白名单（含空剪辑节点 + origin:'video-edit' 产物节点的画布"全部执行"只跑真正待生成节点）**；跟随现有 supertest/spec 模式 |
| 组件 | VideoEditNode：只读预览渲染（片段色块/空态"+ 添加素材"）、播放/暂停、"全屏编辑"回调、Handle 存在性；**连线同步**（addClip→ensureEdge 幂等/移除源全部片段→删 edge/素材库来源跳过/手动连线不反向加素材）抽纯函数或 store 测试；旧 VideoNodeToolbar 不改动（既有用例天然回归） |
| CanvasRenderer | 薄层不测 |

### 手动验收清单（19 条）

1. 节点菜单添加"多轨道剪辑"→ 节点空态"+ 添加素材"，且菜单中无第二个视频合并入口（composite 已接管/下线）
2. 旧"剪辑"（单段裁剪）与剪辑节点分别走通、互不影响
3. 连线同步：加带源片段→自动边（确定性 id、幂等不重复）；同源多片段仅一边；移除该源全部片段→边删；素材库片段不连线；手动拖线不被自动删除、手动删自动边在下次编辑后按派生规则重建
4. 编辑器内撤销/重做片段增删，自动边跟随回滚；画布撤销栈不出现自动边条目
5. 素材拖入三类轨正确（图片进视频轨、无变速项）
6. trim/拖动/分割/删除/吸附正确；0.5×/2× 后公式正确；同轨禁重叠、跨轨可叠
7. 预览音画同步、seek 精确、变速音调不变；节点本体播放/暂停/时间码正确；两个剪辑节点不会同时播放；移出视口释放
8. 字幕添加与样式实时反映（绘制符合 96px/1664px 规格）
9. 5 种转场正确，crossfade overlap 配对与退化（删前片→fadeIn）正确
10. 关键帧增拖删与插值（局部坐标、单点恒值、越界取端值）正确
11. 导出 720p/1080p E2E；素材库"视频"tab 可见产物（generated 通道）
12. 导出后自动建视频产物节点 + 输出端连线，位置在右侧；重复导出产生独立新节点；产物节点工具栏收敛符合定案（隐藏 高清/解析/音频分离/截帧，保留 剪辑/下载/全屏）、旧 trim 可用
13. 含**空剪辑节点 + 已导出产物节点**的画布"全部执行"只跑真正待生成节点，两类均被跳过、不报错、不扣费
14. WebCodecs 不支持：编辑入口按解码能力置灰；导出编码不支持走拦截提示
15. 自动保存后刷新重进状态一致（PATCH 单飞无自冲突 409）
16. 导出中取消/关闭页面拦截；反复进出编辑器 10 次无 AudioContext/内存泄漏
17. 生成音频/片段重拍走 A1 影子节点（shadowNodeId 回流、积分明示、__ephemeral 不闪现）
18. 配额不足导出前拦截；删除剪辑节点后其 VideoProject 同步删除；上游素材删除后片段显缺失态且禁止导出
19. **画布层撤销隔离**：编辑器内添加片段产生自动边后，在画布层按 Ctrl+Z——撤销栈无自动边条目、不会恢复已被时间轴派生删除的边

---

## 十、一期明确不做（YAGNI）

- 多人实时协作（单表 JSON ≠ 平滑迁 Yjs，届时需重写冲突层——排期勿按"平滑"估）
- 服务端导出入口 / 兜底按钮（失败引导仅重试/降档）
- 自定义转场参数、贝塞尔缓动（easing 字段预留）
- 多比例（21:9/9:16）、画中画分屏模板、调色 LUT、遮罩
- WebM/VP9/AV1、GIF、PNG 序列导出；断点续传
- 画布顶栏全局入口（未来需要时 sourceNodeId 改 nullable 演进）
- 产物节点作上游的输入贡献（既有口径记录：collectUpstreamData 只认 `data.resultUrl`，产物节点仅 fileId——用户手动把产物连作其他生成节点上游时贡献不了输入；一期产物边方向固定为 剪辑→产物，不处理此场景）
- 帧插值（源帧率≠30 时 nearest sample，运动抖动为已知限制）

---

## 附录 A：开工前置 Checklist

- [ ] **第一前置**：opencut-classic 快照 vendor 入仓（docs/vendor/opencut-classic/，commit cf5e79e + LICENSE + 移植清单：timeline 交互/scene-builder/video-cache）——Temp 目录会被 Windows 磁盘清理自动回收，先于一切执行
- [ ] 安装依赖：mediabunny@^1.56.1、@mediabunny/aac-encoder@^1.56.1、soundtouchjs@**0.3.0 精确锁**
- [ ] Prisma migration（VideoProject + 三模型反向字段；开发期可 reset）
- [ ] soundtouchjs 变速不变调 spike（半天，**Go/No-Go 关卡**：① 0.5×/2× 音质；② Worker 内 ESM 导入验证——2021 老库可能只有 dist 产物需包一层；③ **OfflineAudioContext 整段离线 PCM 处理用法**——预览与导出两条路径都要过；任一不达标切换 WSOLA 自实现备选，**备选粗估排期 +3~5 天**，Spike 前先给结论防堵死音频链）

## 附录 B：开发顺序建议（供 plan 阶段参考）

**新类型全链路注册清单（第 2 步执行时逐项核对）**：nodeTypes（[CanvasView.tsx](apps/web/src/pages/canvas/components/CanvasView.tsx) L40）→ nodeTypeMap 短名（[canvasStore.ts](apps/web/src/stores/canvasStore.ts) L47，接管 composite）→ AddNodeMenu 菜单项（L95，改写+测试同步）→ **新增 VideoEditNodeData 类型并在节点内收敛**（nodeStore 无集中 NodeData 联合，组件普遍 as any——是新增类型自律，不是扩展现成 union）→ **collab/ydocBuilder fillDoc + readCanvasFromDoc 新类型往返实测（刷新还原）** → execution 白名单两处（validation.service + execution.service，**按"类型 + data.origin 产物标记"双条件**）。

0. **第一前置**：vendor opencut-classic 入仓 + 安装三依赖 + Prisma migration
0.5. **关卡 Spike**：soundtouchjs 三项验证（附录 A），不过即切 WSOLA（+3~5 天预案）
1. 后端 video-project CRUD/upsert + **collabDoc 新增 insertNode/removeNode（A1 原语）** + **generated 登记/确认自建**（PUT 预签名 + statObject 实际大小落库 + 缩略图自 enqueue，勿误调 confirmUpload）
2. **VideoEditNode 全链路注册**（上方清单）+ **执行白名单升级（同时挡 videoEdit 类型与 origin:'video-edit' 产物标记）** + 空外壳
3. timeline 纯函数 TDD（公式/吸附/历史/连线 reconcile/帧整数不漂移）
4. normalized store + 时间轴 UI（peaksFromAudioBuffer 纯函数化）+ 连线同步落地——**addEdge 可选 id（小改）与 origin 隔离（协作桥 originOverride + 独立 transact）为两条独立任务，后者补桥层测试**
5. scene 纯函数 TDD + 主线程预览 + 节点本体迷你播放（资源纪律）+ **全局 audio-engine 新建**（实时/离线共用 PCM 纯函数）
6. 右面板四态 + 转场/关键帧（含 overlap 音频等功率规则）
7. Worker 导出 controller（mock 先行）→ 真实编码 E2E → 产物登记 + 产物节点上画布（origin 标记 + 工具栏全量收敛）
8. **前置：模块级单例 socket 服务改造**（useSocket 三处调用点迁移 + subscribeNodeStatus + disconnect，见第四节 AI 按钮节）→ AI 三按钮（A1 按 doc 原语 + structuredClone 整份克隆）+ 护栏 + 19 条手动验收

## 附录 C：审核采纳记录

### R1 轮（2026-09-10，v1→v2）

- 采纳：P0-1~5 全部（并存命名/模型补全/方案 A/overlap 规则+公式/normalized）、P1-1/2/3/4/5/7/8/9/10/12 全部、P1-6 变速不变调（用户拍板）、P1-11 缺口采纳但"设计稿"轻量化为文字规格、P2 全部（乐观锁取轻量版 updatedAt 校验）
- 纠正：P0-6"参考库不存在"不成立（git bash /tmp = C:\Users\link\AppData\Local\Temp\opencut-classic 实存，审核查了 C:\tmp 错路径；R2 轮审核已正式更正并实测确认 1128 文件/commit cf5e79e）；"vendor 入仓优于临时目录"建议采纳并提级为开工第一前置；依赖未装属实（实施前置，非 spec 缺陷）

### R2 轮（2026-09-10，v2→v2.1，复审确认"修订即可开工，无需第三轮全面评审"）

- 核验成立并采纳 R1-R5：R1 ImageClip 类型（四处同步：timeline/scene/导出取帧路径 drawImage/右面板四态）、R2 重叠规则限定同轨（跨轨自由重叠=多轨核心）、R3 regenerate 落地 A1 影子节点（node:status 以 nodeId 为键无 mediaId 已实测 execution.service；复用 execute 全链路；按 shadowNodeId 分发；teamCredit 复用）、R4 产物登记改 pending→confirm（复用现有状态机，仅新增 generated 登记入口）、R5 PATCH 单飞 + updatedAt 回填
- 采纳 R6-R11：R6 视频内嵌音轨统一过 soundtouch、R7 Keyframe.t 片段局部坐标+插值边界、R8 字幕绘制规格（96px 底距/1664px 最大宽/换行/截断）、R9 左面板 batch 接口 + 已添加派生、R10 删除全局速度控件、R11 crossfade 边界状态机入测试
- 采纳 R12-R22：StreamTarget 仅 FSA 可用时直写否则 BufferTarget（**事实微纠正：StreamTarget 接口本身不依赖 FSA，是"内存降峰值"收益依赖 FSA 流式写盘**，结论不变：不作通用推荐）、soundtouch 内存×2、lookahead 调度、AudioContext 手势 resume/无音频降级 performance.now、打开乐观渲染、导出弹层选档+体积估算、PATCH 不带 title、删轨道连片段、时间码/totalDuration 纯函数、viewer 隐藏入口、spike 扩展 ESM 导入验证、upsert update 分支返回全量、ETA 每 500 帧滚动修正
- 依赖版本定案：mediabunny/^1.56.1、aac-encoder/^1.56.1、soundtouchjs 0.3.0 精确锁（npm 实测最新即 0.3.0）

### v3（2026-09-10，用户产品决策：入口模型变更）

- **入口作废重设计**：v2.1 的"VideoNodeToolbar 多轨剪辑按钮"方案作废（R1 轮 P0-1 落地要求随之作废）；改为**视频剪辑节点**（VideoEditNode 画布一等公民，节点面板添加，与生成节点同级）
- **节点本体**（依据节点设计图）：只读时间轴缩略 + 播放/暂停 + "全屏编辑"入口 + 左输入/右输出 Handle；剪切/删除等重交互不进节点（一期定案）
- **连线同步（用户拍板：随时间轴增删同步，单向）**：时间轴加入带 sourceNodeId 的素材 → 自动建 edge（源→剪辑节点，幂等）；移除该源全部片段 → 删 edge；素材库来源不连线；手动拖线不反向加素材
- **导出产物（用户拍板：视频节点+自动连线）**：confirm 后自动创建视频产物节点（复用现有视频展示形态）+ 剪辑节点输出端→新节点连线，位置右侧偏移避让
- **类型补字段**：AudioClip/ImageClip 补 `sourceNodeId?`（连线同步依赖）；VideoProject.sourceNodeId 语义 = 剪辑节点自身 id（@unique 不变：一剪辑节点一工程）
- 旧"剪辑"（onTrim 单段裁剪）依然一字不动；A1 影子节点 regenerate 不受影响（上游连线反而显式可见）

### R3 轮（2026-09-10，v3→v3.1，复审结论"一等节点方向成立，修完 P0 即可开工"）

- 核验成立并采纳 P0×4：**P0-1 执行白名单**（validation 强制 data.model + execute 兜底图片调用均已实测——剪辑节点会让"全部执行"必挂，白名单两处排除 + 节点无执行按钮）；**P0-2 composite 死入口接管**（AddNodeMenu L95 死入口实测存在，改"多轨道剪辑" type=videoEdit，不留双入口）；**P0-3 v2 残留清理**（护栏表"源节点初始片"→空工程默认轨+空 clips；ImageClip"天然时长"措辞修正）；**P0-4 连线算法定稿**（addEdge 无判重 + edge.data 不持久化实测属实→确定性 id `auto:{editId}:{sourceId}` + commit 后全量 reconcile + 专用 Yjs origin 不入画布撤销栈 + 产物输出边 `auto-out:` + 8 项测试矩阵）
- 采纳 P1×6：节点迷你播放资源纪律（全局单播放/缩略零解码/移出视口释放/全屏互斥/复用全局 audio engine）；能力检测分层（编辑入口测 VideoDecoder/AudioDecoder/OffscreenCanvas，导出才测 VideoEncoder+AAC polyfill——原方案漏了解码器）；生命周期（删节点级联删工程/复制=空工程/素材缺失态标红禁导出）；产物节点收敛（origin:'video-edit' 标记+隐藏生成类按钮+独立新节点步进偏移+命名"工程名·导出 N"）；连线类型规则（一期不校验类型/不检测环）；工程创建统一到首次全屏编辑 upsert
- 采纳 P2×10：验收清单损坏修复（v3 编辑事故：旧清单 3-15 残留——以本轮 §18 条干净版整体替换）；totalDuration=max(end)+前导黑场行为写明；时间码两处精度注明；文档头版本笔误修正（v1 误写 v2）；节点默认宽 320+小宽度刻度策略；全链路注册清单（含 ydocBuilder 往返实测）入附录 B；左面板"已连线"派生标记（可选）；影子节点双重过滤+无 position；全屏打开停节点播放；其余 v2.1 机制确认无回退
- 附：审核确认 V1-V7 全部成立（addNode 双 store+Yjs 同步/done 节点最小 data/createDerivedExtNode 先例/Handle 单口多边/删节点清边/A1 不受影响/旧 trim 无耦合）

### R4 轮（2026-09-10，v3.1→v3.2，复审结论"主体成立可开发，但 3 个 P0 先写回 Spec"）

- 核验：18 项代码断言逐条取证全部属实；vendor 入仓确认未做（docs/vendor 不存在）。采纳 P0×3：**P0-1 白名单升级"类型+产物标记"**（产物节点是白名单内 videoGen 带无 model data、validation/execute 均不看 status——"全部执行"二次必挂；不能照 trim 先例补 model 否则被真重跑扣费）；**P0-2 origin 隔离拆独立任务**（协作桥订阅链写死 syncStoreToDoc(LocalUser) 已实测——originOverride + auto: 前缀拆独立 transact + 桥层测试）；**P0-3 A1 补 doc 原语**（collab-document 仅 writeNodeData 无法建删整节点已实测——新增 insertNode/removeNode + 克隆深拷完整 data 字段清单，否则影子节点复现"模型不存在"）
- 采纳 P1×6：P1-1 产物登记自建化（confirmUpload ±1024 强校验/presigned POST/缩略图 material 主动 enqueue 均实测——复用状态机语义，登记+PUT 预签名+实际大小落库+缩略图 enqueue 全新写）；P1-2 audio-engine 标注新建资产（全仓零 AudioContext 实测）+实时/离线两套上下文共用 PCM 纯函数；P1-3 useWaveformPeaks 耦合 wavesurfer 实测——剥 peaksFromAudioBuffer 纯函数；P1-4 BaseFullscreenModal 加 closeOnBackdrop 开关（自研 portal 默认点遮罩即关）；P1-5 复用现有 useSocket 全局连接；P1-6 乐观期改为空态占位+禁编辑（防轨 id 错位）
- 采纳 P2×11：crossfade overlap 音频等功率交叉规则（与画面 opacity 同曲线）；帧整数真相（TDD 反复 trim 不漂移）；worker.onerror 归入失败分类；删工程失败 Sentry 上报；产物工具栏按真实按钮全量收敛（隐藏 高清/解析/音频分离/截帧，保留 剪辑/下载/全屏）；Keyframe 拆 TransformKeyframe/VolumeKeyframe；API 路径 api/media/batch（真实前缀实测）；NodeData 措辞（新增类型自律）；Media 主键 uuid 注释；版本对齐；onConnect 顺手加同源判重
- 采纳风险前置×4：vendor 立即执行；soundtouch Spike 升级 Go/No-Go 关卡（补③离线整段用法，WSOLA 备选 +3~5 天粗估）；内存 deviceMemory 分级 + 按轨数动态预估 + 分块流式混音登记二期；兼容真机矩阵（版本×预览/720p/1080p/FSA 四能力，Safari 前置 UI 降级）
- 验收清单：第 12/13 条改写（产物工具栏收敛 + 双类节点均跳过）、新增第 19 条（画布层撤销隔离兜底验证），共 19 条

### R5 轮（2026-09-10，v3.2→v3.3-final，复审结论"可冻结，不需 R6 全面评审"）

- 闭环核验：R4 全部 21 项采纳无回退、无表面采纳；v3.2 新增事实假设取证 2 项成立（产物登记/缩略图视频支持）1 项修正
- **P1-1（更正 R4 误判）**：useSocket 实测为 per-component Hook（每次 mount 新建 Socket、无 nodeId 订阅 API、cleanup 无 disconnect、page.tsx/useStitchTask 已各建一个；影子节点被 __ephemeral 过滤、现有分发到不了编辑器）——"确认订阅能力即可"不成立，改为**新建模块级单例 socket 服务**（一个 Socket/join 一次/subscribeNodeStatus/三处共用/补 disconnect），列入步骤 8 前置
- P2×4：A1 克隆改 **structuredClone 整份深拷**（实测 data.prompt 为嵌套对象、取词链 content 优先、执行消费字段一长串——逐字段挑拣必漏，清单仅 review 对照）；crossfade 音频统一**线性 equal-gain**（删"等功率"——与"同 opacity 曲线"自相矛盾，等功率 cos/sin 二期再说）；originOverride **try/finally 复位硬性要求** + 分流落地在 syncStoreToDoc 内部按 auto: 前缀拆两个 transact；右面板"三态"残留与护栏表能力检测行（编辑入口应检解码器非编码器）修正
- P3×3 记录：缩略图固定第 1 秒遇前导黑场会黑帧（enqueue 传 video/mp4 + 抽帧时间点）；帧整数只量化成片时间（源时间保持浮点交 nearest sample，防 30fps 网格错位）；产物节点作上游的 resultUrl 既有口径（记录不处理）
- **冻结判定：v3.3-final，不再全面评审，开工前置按附录 A/B 执行**
