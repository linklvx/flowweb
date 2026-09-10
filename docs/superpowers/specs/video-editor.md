# Spec: Canvas 视频剪辑器（多轨时间轴 + 纯浏览器导出）v3

> v2（2026-09-10）：按架构审核 R1 轮修订——入口并存、数据模型补全、normalized 结构、变速公式、护栏修正、桥接方案 A、变速不变调。
> v2.1（2026-09-10）：按 R2 轮复审修订——ImageClip、同轨重叠限定、regenerate A1 影子节点、产物 pending→confirm 时序、PATCH 单飞、R6-R22 缺口与打磨。
> v3（2026-09-10）：**入口模型变更（用户产品决策）**——视频剪辑节点成为画布一等节点类型，上游素材随时间轴增删自动连线，导出产物自动创建视频节点并连到输出端。v2.1 的"视频节点工具栏按钮"方案作废。采纳明细见附录 C。

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
├── export/         # 导出 controller（依赖注入可测）+ Worker bootstrap
├── persist/        # 自动保存（1.5s 防抖 PATCH + 三态状态点）
└── components/     # 顶栏/资产库/预览区/多轨时间轴/属性面板（三态）
```

### 核心原则

1. **同源渲染**：`scene/` 两个纯函数 `selectActiveClips(state,t)`（活跃片段判定，含 crossfade overlap 双片段）与 `interpolateClip(clip,t)`（关键帧插值/转场 opacity/变速→输出 sourceTime+transform+opacity+文本）供预览与导出共用；**解码/取帧/LRU 属 renderer 与 video-cache，不进 scene**。
2. **合成坐标系**：固定 1920×1080（16:9）；导出 720p 整体 0.5×缩放绘制。
3. **Worker 可测性**：导出编排为依赖注入的 controller（注入 encoder/muxer/进度回调），Worker 仅 bootstrap + API 适配（jsdom 无 WebCodecs/OffscreenCanvas，controller 用 mock 测）。

---

## 二、入口与形态（视频剪辑节点）

### 剪辑节点（VideoEditNode，画布一等公民）

- **添加方式**：接入现有节点面板添加流程（与视频/音频/图片生成节点同级），节点类型注册进 nodeTypes/nodeStore
- **节点本体 UI**（依据节点设计图，白色宽卡片 + 左右 Handle）：
  - 标题栏：网格图标 + "多轨道剪辑"
  - 工具栏一行（一期轻量）：播放/暂停 + 时间码 `00:00 / 00:00` | 右侧"⤢ 全屏编辑"文字链接
  - 时间刻度尺（随工程时长自适应）
  - 轨道区**只读缩略**：视频/音频片段色块 + 播放头位置；空态显示轨道占位条"+ 添加素材"
  - Handle：左输入（接收上游素材连线）/ 右输出（产物连线），复用 NodeHandle 体系
- **交互深度（一期定案）**：节点本体**只读预览 + 播放/暂停 + 全屏编辑入口**；剪切/删除/撤销重做等重交互一律进全屏编辑器（小尺寸内复杂交互不做）
- 旧 VideoNodeToolbar 的"剪辑"（onTrim 单段裁剪）链路**依然一字不动**，与本功能互不干扰

### 连线同步规则（时间轴 ↔ 画布 edges，单向）

- **素材加入时间轴**（clip.sourceNodeId 存在的节点产物）→ 自动创建 edge：源节点输出 Handle → 剪辑节点输入 Handle；同一源节点至多一条（幂等）
- **时间轴移除该源节点的全部片段** → 自动删除对应 edge
- **素材库来源（无 sourceNodeId）不连线**
- 同步方向**单向**：时间轴是数据源，时间轴操作驱动连线；用户在画布手动拖线到剪辑节点仅作视觉/依赖表达，**不反向自动加素材**
- 实现走现有画布 store/Yjs edges 写入（与画布协作一致，无需新链路）

### 挂载结构

节点"全屏编辑"只写编辑器 store `{open:true, sourceNodeId: 剪辑节点id}`；编辑器本体挂**画布根层**（不进 VideoEditNode 内部，保证全屏遮罩与画布 React 树不卸载、左面板可读整个 nodeStore），基于 `components/BaseFullscreenModal.tsx` 封装外壳：底色亮色 #F7F8FA、**去掉点击外部关闭**（防误触丢编辑状态）、ESC 与"收起"统一走"挂起自动保存 flush 后关闭"。

### 入口时序

```
[节点面板添加"多轨道剪辑"节点] → 节点创建（空工程随节点创建 upsert 建立）
[节点上"全屏编辑"] → 能力检测 → editorStore.open({sourceNodeId: 剪辑节点id})
→ 画布根层 VideoEditorShell 挂载（BaseFullscreenModal 定制）
→ POST /api/video-projects（服务端 upsert by sourceNodeId，一次 RTT 幂等，update 分支亦返回全量）→ 加载工程
→ 等待期间用本地构造 ProjectData（默认轨）乐观渲染，失败转错误态
```

### WebCodecs 能力检测（修订）

入口只卡两项：① `VideoEncoder.isConfigSupported`（**真实导出 config**：`codec:'avc1.640028'`、1920×1080、30fps、目标码率）② `OffscreenCanvas` 存在。**AAC/AudioEncoder 不在入口拦截**（Chrome 上 AAC isConfigSupported 常返回 false，正是 polyfill 的存在意义）；不满足统一提示"当前浏览器不支持视频剪辑，请使用最新版 Chrome/Edge"。兼容矩阵：Chrome/Edge 全量；Firefox 需较新版本；Safari 部分支持。

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
  keyframes: Keyframe[];
}
interface ImageClip extends BaseClip {
  type: 'image'; mediaId: string; sourceNodeId?: string; // 连线同步依赖；无 sourceStart/变速/内嵌音轨，天然时长
  transform: { x: number; y: number; scale: number; rotation: number; opacity: number };
  transitionIn?: Transition; transitionOut?: Transition;
  keyframes: Keyframe[];
  // 默认拖入时长 5s，边缘可改；导出路径与视频完全不同（一次 drawImage vs seek 抽帧）
}
interface AudioClip extends BaseClip {
  type: 'audio'; sourceStart: number; mediaId: string; sourceNodeId?: string; // 连线同步依赖
  volume: number; fade: { in: number; out: number };
  playbackSpeed: 0.5 | 1 | 2; keyframes: Keyframe[];  // 仅 volume
}
interface SubtitleClip extends BaseClip {
  type: 'subtitle'; text: string; visible: boolean;
  style: { fontSize: number; color: string; letterSpacing: number }; // 默认 48 / #FFFFFF / 0
}
// Keyframe.t 为片段局部时间 0..duration（秒）：移动片段不平移关键点；trim 左缘按局部坐标同步裁切
// 插值边界：t 越首点取首点值、越末点取末点值、单点恒值、无关键帧取基准 transform/volume
interface Keyframe { id: string; t: number; property: 'x'|'y'|'scale'|'rotation'|'opacity'|'volume'; value: number; easing: 'linear' }
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
- 前端：socket 按 **shadowNodeId** 监听 node:status；done 后读影子节点 data 取 fileId 摘入资产库，再删影子节点；画布渲染层过滤 `__ephemeral` 节点（一期单人编辑，协作者闪烁风险可接受）
- 扣费/失败退费复用 teamCredit 既有路径，**不另建**
- 备选 A2（抽 runNode 脱离 Yjs + 事件扩 requestId）架构更干净但需重构 execute 循环体，二期再说

data 校验：class-validator 嵌套 DTO（防 `whitelist:true` 裸放 Json），ProjectData TS 类型放 `packages/shared/src/types/video-project.ts`（有 material-library.ts 先例）前后端共用。响应走全局 TransformInterceptor（前端 `code:0` 解包）。

---

## 四、UI 布局规格（依据效果图）

| 区域 | 内容 |
|---|---|
| 顶栏 | 标题"多轨剪辑" / 三态保存状态点 / 比例 16:9（一期固定不可切）/ "收起" / "导出"黑色主按钮 |
| 左面板 | Tab：资产库/字幕；搜索框；"全集资产"分组 = 当前画布（workflowId）视频/音频/图片节点产物 + 团队素材库；条目 = 缩略图+名称+"已添加"标记（纯派生：已在时间轴的 clip 的 mediaId 集合）；"+新建"上传走现有 presign 链路 |

**左面板数据来源**：前端聚合——nodeStore 遍历当前 workflow 节点收集 fileId + 节点名 → 后端补 `POST /api/material/media/batch` 批量查详情/预签名（现有仅单查/按 folder 查）→ 团队素材走现有 folder 接口；**避开 material.service 的 `type='generated'` 硬编码过滤**（直接按 mediaId 集合查）。
| 中上 | 16:9 预览播放器；控制条：播放/时间码（当前黑+总长灰）、撤销/重做/分割/删除、**生成音频/添加字幕/片段重拍**（紫色文字按钮，触发时明示"将消耗团队积分"）、设置/音量/全屏/缩放滑杆四控件。**不设全局"速度 1×"控件**（片段变速在右面板，预览速率控件易与导出数据混淆，一期删除） |
| 中下 | 时间轴（第五节） |
| 右面板 | **三态**：视频片段态 / 音频片段态 / 字幕态（见下） |

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

socket：编辑器内 `/execution` namespace **单例连接**，join workflowId room，统一监听 `node:status` **按 shadowNodeId 分发**（node:status 以 nodeId 为键、不带 mediaId——见第三节 A1 契约）；禁止每按钮一连接。

---

## 五、时间轴交互规格

- **轨道**：三类（video/subtitle/audio）数量不限可增删；默认 1 视频+1 字幕+2 音频；字幕轨轨道头"➕"= **该轨内新增字幕**（非新增轨道）；**删除轨道 = 确认后连片段一起删**（入撤销栈），不做跨轨迁移
- **标尺**：自适应刻度；紫色播放头（顶部圆点）可拖拽；片段块显示"名称 · 源时间码"（如 `视频生成需求 · 00:00:10:04`，HH:MM:SS:FF，30fps 非丢帧）——时间码格式化与 totalDuration（**overlap 区间不重复计时**：总长 = max(片.end) - min(片.start)）均抽纯函数入 TDD
- **片段操作**：拖动（同类型跨轨自由重叠；**禁重叠与吸附仅同轨内**——同轨除 crossfade overlap 外冲突吸附最近空位，规则详见第三节）、边缘 trim（公式见第三节）、播放头分割、删除、撤销/重做
- **历史栈事务性**：拖拽 rAF 级高频 setState **不入栈**，pointerup commit 时一次入栈；快照结构化克隆（禁持引用）；上限 50 步
- **吸附**：片段边缘 ↔ 相邻边缘/播放头/整秒刻度，8px 阈值（换算为秒随 px/s 变化）
- **缩放**：Ctrl+滚轮调 px/s，以播放头为中心；**编辑器挂载期间禁用画布快捷键层**（Delete/空格/Ctrl+滚轮在 document 捕获层 stopPropagation，防"删时间轴片段"穿透成"删画布节点"）
- **波形**：复用 `hooks/useWaveformPeaks` 抽峰 + Canvas 自绘静态波形，峰值按 mediaId 缓存（不为每片段 new wavesurfer 实例）
- 交互算法参考移植 opencut `timeline/`（drag-utils/snapping/group-move），适配 zustand4+antd5
- **可测性红线**：像素↔秒换算、边缘命中宽度、8px 阈值行为全部抽纯函数；组件只绑 pointer 事件

---

## 六、预览播放

- **主时钟**：有音频轨时用 Web Audio `audioContext.currentTime`（**首次用户手势 resume**）；项目无音频片时降级 `performance.now()` 时钟（不为时钟空转 AudioContext）；rAF 每帧 `selectActiveClips → interpolateClip → CanvasRenderer 绘制`
- **视频帧**：mediabunny 精确取帧（**nearest sample**，源 24/25/60fps 不做帧插值，轻微运动抖动为已知限制）+ LRU 帧缓存（参考 opencut video-cache 预解码播放位置附近片段）；图片片一次 drawImage 无解码路径
- **降级策略**：播放中解码跟不上 → **跳帧追赶、音频不停**；seek → 等目标帧解码完成再绘
- **音频**：AudioBufferSourceNode 按 start 调度 + **lookahead 调度**（50ms 定时器/0.1s 调度窗，seek 清队列）；**全部进混音总线的 PCM（独立音频片 + 视频片内嵌音轨）统一过 soundtouchjs 变速不变调**（muted 不处理）；混音走 GainNode（volume 关键帧/淡入淡出在调度时计算包络）
- **字幕绘制规格（预览/导出共用绘制函数）**：1920×1080 基准——底部居中、底边安全边距 96px、最大宽 1664px 自动换行、字号 48px（720p 随 0.5× 整体缩）、超长截断

---

## 七、导出管线（Web Worker + mediabunny）

0. **导出弹层**：点击"导出"→ 小弹层选档（720p/1080p）+ 估算体积（码率×时长×1.2）+ 前置校验结果
1. **前置校验**：总时长 ≤15 分钟（超限拦截）；`VideoEncoder.isConfigSupported` 复检；**团队存储配额预检**（StorageQuotaService.assertCanUpload 同款口径，避免编码数分钟后上传 4xx）；内存预估 = 音频 PCM（15min×48kHz×立体声×4B ≈ 86MB/轨 × 音频轨数，**soundtouch 处理再产出等长 PCM，音频部分 ×2**）+ 编码峰值 + mux 缓冲，>1GB 警告但放行
2. **Worker 执行**（懒加载 chunk，含编辑器页/mediabunny/polyfill 全部动态 import 拆包）：
   - `OfflineAudioContext` 离线混音（含变速不变调/soundtouch 处理/fade/音量关键帧）→ AudioBuffer
   - 逐帧：t → scene 纯函数 → OffscreenCanvas（720p=0.5× / 1080p=1×）→ VideoFrame → VideoEncoder H.264（硬编优先回退软编）
   - **VideoFrame 逐帧 close()（WebCodecs 资源纪律，code review 必查项）**
   - 音频 → AudioEncoder AAC；原生不支持时动态 import `@mediabunny/aac-encoder`
   - `Mp4OutputFormat`：**支持 File System Access API（仅 Chromium）时 StreamTarget 流式直写用户选定文件（导出前选位置）降内存峰值；否则回退 BufferTarget**——StreamTarget 不作通用推荐
3. **产物登记（pending→confirm 状态机，对齐现有 storage.service）**：新增"generated 登记入口"接口——建 `type='generated'`、`status='pending'` 的 Media（估算大小过配额预检，metadata：来源 video-project/分辨率/时长）→ 返回预签名地址 → 浏览器 PUT → confirm 时 statObject 校验 → 置 `completed` 并触发缩略图 consumer。**复用现有状态机，不新写**；不走 presign DTO 的 'uploaded' 通道（素材库类型过滤硬编码 `type='generated'`）
4. **产物自动上画布（v3 定案）**：confirm 成功后自动在画布创建**视频产物节点**（复用现有视频展示节点形态，可播放/可被下游引用）+ 自动连线：剪辑节点输出 Handle → 新节点输入 Handle；新节点位置放剪辑节点右侧附近空位（简单偏移 + 避让）；toast"导出完成，已添加到画布"
5. **导出中**：两段式进度（离线混音 % + 逐帧编码 %）；ETA 用前 30 帧试编码测速外推 + **每 500 帧滚动修正**（跨 GOP seek 成本不同，首测偏不准）；取消按钮；beforeunload 拦截
6. **失败**：三分类（编码不支持/内存/未知）+ 重试 / 降 720p

---

## 八、边界护栏

| 场景 | 行为 |
|---|---|
| WebCodecs 不可用 | 入口拦截（仅 VideoEncoder 真实 config + OffscreenCanvas 两项），提示最新 Chrome/Edge |
| 总时长 >15 分钟 | 导出前拦截 |
| 内存预估 >1GB | 警告但放行 |
| 存储配额不足 | 导出前拦截 |
| 导出中关闭页面 | beforeunload 拦截确认 |
| AAC 编码缺失 | 静默动态 polyfill |
| 多标签并发编辑 | updatedAt 乐观锁 409 提示（PATCH 单飞防自打自，见第三节） |
| 同节点重复创建 | sourceNodeId @unique + 服务端 upsert 幂等；**upsert 的 update 分支同样 select 全量返回** |
| 打开等待 | POST 返回前用本地构造 ProjectData（默认轨+源节点初始片）**乐观渲染**，失败转错误态，不白屏等 RTT |
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
| API 测试 | CRUD + **upsert 幂等（并发双 POST 只一条）** + assertEditor 越权 403 + 乐观锁 409；跟随现有 supertest/spec 模式 |
| 组件 | VideoEditNode：只读预览渲染（片段色块/空态"+ 添加素材"）、播放/暂停、"全屏编辑"回调、Handle 存在性；**连线同步**（addClip→ensureEdge 幂等/移除源全部片段→删 edge/素材库来源跳过/手动连线不反向加素材）抽纯函数或 store 测试；旧 VideoNodeToolbar 不改动（既有用例天然回归） |
| CanvasRenderer | 薄层不测 |

### 手动验收清单（16 条）

1. 节点面板添加"多轨道剪辑"节点 → 节点呈现（空态"+ 添加素材"）→"全屏编辑"打开编辑器
2. **旧"剪辑"（单段裁剪）与新剪辑节点分别走通、互不影响**
3. **连线同步**：时间轴加入节点产物 → 画布自动连线；移除该源全部片段 → 连线删除；素材库来源不连线；手动拖线不反向加素材
4. 素材拖入时间轴（三类轨正确）
5. trim/拖动/分割/删除/撤销重做/吸附正确；0.5×/2× 变速后 trim/分割公式正确
6. 播放预览音画同步；seek 帧精确；变速播放音调不变；节点本体播放/暂停与时间码正确
7. 字幕添加+样式编辑实时反映
8. 转场 5 种（fadeIn/fadeOut/crossfade/toBlack/toWhite）预览正确，crossfade overlap 拖拽配对正确
9. 关键帧添加/拖动/删除 + 线性插值动画正确
10. 导出 720p/1080p 真实编码 E2E；**素材库"视频"过滤 tab 可见产物**
11. **导出后画布自动创建视频产物节点 + 输出端连线**
12. Chrome 正常导出；模拟 WebCodecs 不支持走拦截提示
13. 自动保存：编辑后刷新重进状态一致
14. 导出中取消 / 关闭页面拦截
15. **反复进出编辑器 10 次无 AudioContext/内存泄漏**
16. 生成音频/片段重拍走通 regenerate（A1 影子节点）且积分扣费有明示
17. **配额不足时导出前拦截**
3. 素材拖入时间轴（三类轨正确）
4. trim/拖动/分割/删除/撤销重做/吸附正确；0.5×/2× 变速后 trim/分割公式正确
5. 播放预览音画同步；seek 帧精确；**变速播放音调不变**
6. 字幕添加+样式编辑实时反映
7. 转场 5 种（fadeIn/fadeOut/crossfade/toBlack/toWhite）预览正确，crossfade overlap 拖拽配对正确
8. 关键帧添加/拖动/删除 + 线性插值动画正确
9. 导出 720p/1080p 真实编码 E2E；**素材库"视频"过滤 tab 可见产物**
10. Chrome 正常导出；模拟 WebCodecs 不支持走拦截提示
11. 自动保存：编辑后刷新重进状态一致
12. 导出中取消 / 关闭页面拦截
13. **反复进出编辑器 10 次无 AudioContext/内存泄漏**
14. **配额不足时导出前拦截**
15. 生成音频/片段重拍走通 regenerate 接口且积分扣费有明示

---

## 十、一期明确不做（YAGNI）

- 多人实时协作（单表 JSON ≠ 平滑迁 Yjs，届时需重写冲突层——排期勿按"平滑"估）
- 服务端导出入口 / 兜底按钮（失败引导仅重试/降档）
- 自定义转场参数、贝塞尔缓动（easing 字段预留）
- 多比例（21:9/9:16）、画中画分屏模板、调色 LUT、遮罩
- WebM/VP9/AV1、GIF、PNG 序列导出；断点续传
- 画布顶栏全局入口（未来需要时 sourceNodeId 改 nullable 演进）
- 帧插值（源帧率≠30 时 nearest sample，运动抖动为已知限制）

---

## 附录 A：开工前置 Checklist

- [ ] **第一前置**：opencut-classic 快照 vendor 入仓（docs/vendor/opencut-classic/，commit cf5e79e + LICENSE + 移植清单：timeline 交互/scene-builder/video-cache）——Temp 目录会被 Windows 磁盘清理自动回收，先于一切执行
- [ ] 安装依赖：mediabunny@^1.56.1、@mediabunny/aac-encoder@^1.56.1、soundtouchjs@**0.3.0 精确锁**
- [ ] Prisma migration（VideoProject + 三模型反向字段；开发期可 reset）
- [ ] soundtouchjs 变速不变调 spike（半天：① 0.5×/2× 音质验证；**② Worker 内 ESM 导入验证**——2021 老库可能只有 dist 产物，需包一层；任一不达标启用 WSOLA 自实现备选）

## 附录 B：开发顺序建议（供 plan 阶段参考）

1. Prisma migration + video-project CRUD/upsert（含测试）
2. **VideoEditNode 节点本体**（只读预览/全屏编辑入口/Handle/节点面板注册）+ 空 BaseFullscreenModal 外壳（可进出）
3. timeline 纯函数 TDD（公式/吸附/历史/**连线同步规则**）——无 UI 依赖可独立验收
4. normalized store + 时间轴 UI（复用 useWaveformPeaks）+ **连线同步落地（时间轴增删→画布 edges）**
5. scene 纯函数 TDD + 主线程预览
6. 右面板四态 + 转场/关键帧
7. Worker 导出 controller（mock 先行）→ 真实编码 E2E → 产物登记入库 + **产物节点自动上画布连线**
8. AI 三按钮（regenerate A1）+ 护栏 + 17 条手动验收

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
