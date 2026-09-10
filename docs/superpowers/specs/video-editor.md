# Spec: Canvas 视频剪辑器（多轨时间轴 + 纯浏览器导出）v2

> v2（2026-09-10）：按架构审核报告修订——入口并存、数据模型补全、normalized 结构、变速公式、护栏修正、桥接方案 A、变速不变调。审核采纳明细见文末附录 C。

## 目标与背景

在画布的视频节点工具栏新增"**多轨剪辑**"按钮（与既有节点级"剪辑"按钮并存，互不干扰），点击后弹出画布内全屏遮罩的多轨视频剪辑页面（UI 依据效果图，剪映风格：亮色主题 + 紫色 #6C5CE7 系）。支持多轨时间轴（视频/字幕/音频）、转场特效、关键帧动画、变速不变调，导出 MP4（H.264+AAC）自动入素材库。

### 选型结论（2026-09-10 定案，审核确认）

| 项 | 决策 |
|---|---|
| 渲染架构 | 纯浏览器 WebCodecs + mediabunny，同源渲染（scene-builder 纯函数供预览/导出共用） |
| 参考库 | opencut-classic（MIT 归档快照）**vendor 入仓** `docs/vendor/opencut-classic/`（固定 commit），禁止依赖临时目录 |
| 服务端 | 不参与导出渲染；FFmpeg/BullMQ 管线只留代码、一期无服务端导出入口；导出失败引导仅"重试 / 降 720p" |
| 新依赖 | `mediabunny`、`@mediabunny/aac-encoder`（动态 polyfill）、`soundtouchjs@0.3.x`（变速不变调，锁版本；停更风险已登记，备选自实现 WSOLA） |

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

## 二、入口与形态（与既有"剪辑"并存）

### 入口按钮

- [VideoNodeToolbar.tsx](apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.tsx) 已有"剪辑"（onTrim，节点级单段裁剪，**链路一字不动**）与死按钮"裁剪"（维持现状不碰）
- 平级新增 `onMultiTrackEdit?: () => void`，按钮命名"**多轨剪辑**"，顺序：剪辑 → 多轨剪辑 → 裁剪 → 高清；图标用"胶片+轨道"区别于旧剪刀；沿用 `if (!show) return null` 无动画模式
- 互斥双保险：打开多轨编辑器前 `setTrimMode(false)`；反向旧 trim 打开时工具条本就隐藏（`!trimMode`），天然互斥

### 挂载结构

节点按钮只写编辑器 store `{open:true, sourceNodeId}`；编辑器本体挂**画布根层**（不进 VideoGenNode 内部，保证全屏遮罩与画布 React 树不卸载、左面板可读整个 nodeStore），基于 `components/BaseFullscreenModal.tsx` 封装外壳：底色亮色 #F7F8FA、**去掉点击外部关闭**（防误触丢编辑状态）、ESC 与"收起"统一走"挂起自动保存 flush 后关闭"。

### 入口时序

```
[多轨剪辑] → 能力检测 → editorStore.open({sourceNodeId})；setTrimMode(false)
→ 画布根层 VideoEditorShell 挂载（BaseFullscreenModal 定制）
→ POST /api/video-projects（服务端 upsert by sourceNodeId，一次 RTT 幂等）→ 加载工程
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
  sourceNodeId String        @unique // 一节点至多一个多轨工程
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
  clips: Record<string, VideoClip | AudioClip | SubtitleClip>; // 统一字典
}
interface Track {
  id: string; type: 'video' | 'subtitle' | 'audio'; name: string;
  muted: boolean; hidden: boolean;
  clips: string[];   // 三类轨语义一致：clip id 按 start 有序
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
interface AudioClip extends BaseClip {
  type: 'audio'; sourceStart: number; mediaId: string;
  volume: number; fade: { in: number; out: number };
  playbackSpeed: 0.5 | 1 | 2; keyframes: Keyframe[];  // 仅 volume
}
interface SubtitleClip extends BaseClip {
  type: 'subtitle'; text: string; visible: boolean;
  style: { fontSize: number; color: string; letterSpacing: number }; // 默认 48 / #FFFFFF / 0
}
interface Keyframe { id: string; t: number; property: 'x'|'y'|'scale'|'rotation'|'opacity'|'volume'; value: number; easing: 'linear' }
interface Transition { type: 'fadeIn'|'fadeOut'|'crossfade'|'toBlack'|'toWhite'; duration: number } // 0.2~2s
```

**渲染顺序 renderOrder（显式，与 UI 轨道顺序解耦）**：① 视频 clip 按所在 track 索引升序、同轨按 start；② 字幕 clip 恒最后合成（视觉最上）；③ 音频 clip 不参与视觉，仅入混音总线。

**唯一合法重叠**：后片 `transitionIn.type==='crossfade'` 时允许其前缘与前片重叠，重叠长度 = `transitionIn.duration`，由后片单侧表达（前片不重复存储）；其余任何情形禁止重叠（吸附/让位处理）。

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

- 编辑器数据 1.5s 防抖 `PATCH /api/video-projects/:id { data, title, baseUpdatedAt }`
- 乐观锁：PATCH 校验 updatedAt，冲突返 409，前端提示"项目已在别处修改"（多标签场景）
- 顶栏三态状态点：保存中（灰）/ 已保存（绿）/ 失败（红，可点重试）
- 收起时 flush 挂起保存再关闭

### API（apps/api 新建 modules/video-project/，注册 app.module）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/video-projects` | assertEditor(workflowId) | **服务端 upsert by sourceNodeId**（幂等防双击），写 userId/teamId/workflowId |
| GET | `/api/video-projects/by-node/:sourceNodeId` | assertEditor | 入口加载 |
| PATCH | `/api/video-projects/:id` | assertEditor | 自动保存 + updatedAt 乐观锁（409） |
| DELETE | `/api/video-projects/:id` | assertEditor | 仅删工程记录，引用 Media 不动 |
| POST | `/api/video-projects/regenerate` | assertEditor | **方案 A 克隆生成**：从 CanvasDoc(Yjs) 读 sourceNode 生成参数 → 入 execution 队列（扣团队积分）→ 产物 `type='generated'` 直接入库 → socket `node:status` 回流 |

data 校验：class-validator 嵌套 DTO（防 `whitelist:true` 裸放 Json），ProjectData TS 类型放 `packages/shared/src/types/video-project.ts`（有 material-library.ts 先例）前后端共用。响应走全局 TransformInterceptor（前端 `code:0` 解包）。

---

## 四、UI 布局规格（依据效果图）

| 区域 | 内容 |
|---|---|
| 顶栏 | 标题"多轨剪辑" / 三态保存状态点 / 比例 16:9（一期固定不可切）/ "收起" / "导出"黑色主按钮 |
| 左面板 | Tab：资产库/字幕；搜索框；"全集资产"分组 = 当前画布（workflowId）视频/音频/图片节点产物 + 团队素材库；条目 = 缩略图+名称+"已添加"标记；"+新建"上传走现有 presign 链路 |
| 中上 | 16:9 预览播放器；控制条：播放/时间码（当前黑+总长灰）、撤销/重做/分割/删除/速度(1×)、**生成音频/添加字幕/片段重拍**（紫色文字按钮，触发时明示"将消耗团队积分"）、设置/音量/全屏/缩放滑杆四控件 |
| 中下 | 时间轴（第五节） |
| 右面板 | **三态**：视频片段态 / 音频片段态 / 字幕态（见下） |

视觉：亮色（背景 #F7F8FA、面板白）、紫 #6C5CE7 强调、字幕片段浅橙黄底、音频片段浅绿底+波形、圆角 8-16px、黑色胶囊主按钮。antd5 + Tailwind；**preflight:false 红线：box-border、list-none pl-0、border 配 [border-xxx-style:solid]、button 字号写在自身**。

### 右面板三态

| 态 | 内容 |
|---|---|
| 视频片段 | transform（x/y/scale/rotation/opacity 数值输入）、播放速度（0.5×/1×/2×）、入/出场转场（类型+时长）、**每属性行旁秒表按钮=在播放头处添加/删除该属性关键帧** |
| 音频片段 | 音量滑杆、fade in/out、播放速度 |
| 字幕 | 字幕文本 textarea、显示字幕开关、字号滑杆+数值、字体颜色、字间距（对齐效果图） |

关键帧 UI：属性项旁秒表按钮添加；时间轴片段内显示菱形关键帧刻度（可点击跳转、拖拽移动、Delete 删除）。

### AI 按钮三件（方案 A 桥接）

| 按钮 | 行为 |
|---|---|
| 添加字幕 | 本地完整实现：播放头处创建 3s 字幕片段 |
| 生成音频 | 弹输入框 → `POST /api/video-projects/regenerate`（音频分支）→ 产物入库入资产库可拖入；明示扣积分 |
| 片段重拍 | 读选中片段 sourceNodeId → regenerate（视频分支）→ 新视频入库可替换；**nodeStore 中参数不可得则置灰** |

socket：编辑器内 `/execution` namespace **单例连接**，join workflowId room，统一监听 `node:status` 按 mediaId 分发（禁止每按钮一连接）。

---

## 五、时间轴交互规格

- **轨道**：三类（video/subtitle/audio）数量不限可增删；默认 1 视频+1 字幕+2 音频；字幕轨轨道头"➕"= **该轨内新增字幕**（非新增轨道）
- **标尺**：自适应刻度；紫色播放头（顶部圆点）可拖拽；片段块显示"名称 · 源时间码"（如 `视频生成需求 · 00:00:10:04`，HH:MM:SS:FF）
- **片段操作**：拖动（同类型跨轨；除 crossfade overlap 外禁止重叠，冲突吸附最近空位）、边缘 trim（公式见第三节）、播放头分割、删除、撤销/重做
- **历史栈事务性**：拖拽 rAF 级高频 setState **不入栈**，pointerup commit 时一次入栈；快照结构化克隆（禁持引用）；上限 50 步
- **吸附**：片段边缘 ↔ 相邻边缘/播放头/整秒刻度，8px 阈值（换算为秒随 px/s 变化）
- **缩放**：Ctrl+滚轮调 px/s，以播放头为中心；**编辑器挂载期间禁用画布快捷键层**（Delete/空格/Ctrl+滚轮在 document 捕获层 stopPropagation，防"删时间轴片段"穿透成"删画布节点"）
- **波形**：复用 `hooks/useWaveformPeaks` 抽峰 + Canvas 自绘静态波形，峰值按 mediaId 缓存（不为每片段 new wavesurfer 实例）
- 交互算法参考移植 opencut `timeline/`（drag-utils/snapping/group-move），适配 zustand4+antd5
- **可测性红线**：像素↔秒换算、边缘命中宽度、8px 阈值行为全部抽纯函数；组件只绑 pointer 事件

---

## 六、预览播放

- **主时钟**：Web Audio `audioContext.currentTime`；rAF 每帧 `selectActiveClips → interpolateClip → CanvasRenderer 绘制`
- **视频帧**：mediabunny 精确取帧（**nearest sample**，源 24/25/60fps 不做帧插值，轻微运动抖动为已知限制）+ LRU 帧缓存（参考 opencut video-cache 预解码播放位置附近片段）
- **降级策略**：播放中解码跟不上 → **跳帧追赶、音频不停**；seek → 等目标帧解码完成再绘
- **音频**：AudioBufferSourceNode 按 start 调度；seek 重建调度队列；**变速不变调用 soundtouchjs（WSOLA，0.3.x 锁版本）**；混音走 GainNode（volume 关键帧/淡入淡出在调度时计算包络）
- 字幕/图片：Canvas 直接绘制

---

## 七、导出管线（Web Worker + mediabunny）

1. **前置校验**：总时长 ≤15 分钟（超限拦截）；`VideoEncoder.isConfigSupported` 复检；**团队存储配额预检**（StorageQuotaService.assertCanUpload 同款口径，避免编码数分钟后上传 4xx）；内存预估 = 音频 PCM（15min×48kHz×立体声×4B ≈ 86MB/轨 × 音频轨数）+ 编码峰值 + mux 缓冲，>1GB 警告但放行
2. **Worker 执行**（懒加载 chunk，含编辑器页/mediabunny/polyfill 全部动态 import 拆包）：
   - `OfflineAudioContext` 离线混音（含变速不变调/soundtouch 处理/fade/音量关键帧）→ AudioBuffer
   - 逐帧：t → scene 纯函数 → OffscreenCanvas（720p=0.5× / 1080p=1×）→ VideoFrame → VideoEncoder H.264（硬编优先回退软编）
   - **VideoFrame 逐帧 close()（WebCodecs 资源纪律，code review 必查项）**
   - 音频 → AudioEncoder AAC；原生不支持时动态 import `@mediabunny/aac-encoder`
   - `Mp4OutputFormat` + **StreamTarget（推荐，低配降峰值）** 或 BufferTarget → Blob
3. **产物登记**：新接口**直接建 `type='generated'`、`status='completed'` 的 Media**（metadata：来源 video-project、分辨率、时长）+ 返回预签名地址上传——**不走 presign 'uploaded' 链路**（素材库按类型过滤硬编码 `type='generated'`，'uploaded' 会在"视频"tab 不可见）；复用 thumbnail-generator consumer 出缩略图；toast"已入库，可添加到画布"
4. **导出中**：两段式进度（离线混音 % + 逐帧编码 %）；ETA 用前 30 帧试编码测速外推；取消按钮；beforeunload 拦截
5. **失败**：三分类（编码不支持/内存/未知）+ 重试 / 降 720p

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
| 多标签并发编辑 | updatedAt 乐观锁 409 提示 |
| 同节点重复创建 | sourceNodeId @unique + 服务端 upsert 幂等 |
| **收起时的运行时释放** | `audioContext.close()`（AudioContext 实例数上限约 6，防泄漏）、终止全部 AudioBufferSource、中断 mediabunny 解码与 LRU、cancelAnimationFrame、revokeObjectURL 全部本地 URL；播放头位置保留、数据留在 store |

---

## 九、测试策略（TDD 红-绿-重构）

| 层 | 内容 |
|---|---|
| timeline 纯函数 | 吸附（8px 多档 px/s 边界）、trim/分割/**变速全部公式**、crossfade 唯一合法重叠判定、像素↔秒换算与命中、历史栈（事务入栈/50 上限/克隆隔离） |
| scene 纯函数 | selectActiveClips（overlap 双片段）、interpolateClip（线性插值/5 种转场输出/contain 基准默认值） |
| store reducers | normalized 增删改、轨道/片段/字幕操作 |
| 导出 controller | 依赖注入 mock：调用序列、两段进度、取消、**VideoFrame close 次数**、AAC polyfill 分支、错误三分类 |
| API 测试 | CRUD + **upsert 幂等（并发双 POST 只一条）** + assertEditor 越权 403 + 乐观锁 409；跟随现有 supertest/spec 模式 |
| 组件 | VideoNodeToolbar：新增"多轨剪辑"回调 + **旧"剪辑→onTrim"用例原样保留作回归锁**；RTL（antd5 两字按钮带空格既有经验） |
| CanvasRenderer | 薄层不测 |

### 手动验收清单（15 条）

1. 视频节点"多轨剪辑"→ 打开编辑器，初始片段在视频轨
2. **旧"剪辑"（单段裁剪）与新"多轨剪辑"分别走通、互不影响**
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

- [ ] opencut-classic 快照 vendor 入仓（docs/vendor/opencut-classic/，固定 commit + LICENSE + 移植清单：timeline 交互/scene-builder/video-cache）
- [ ] 安装依赖：mediabunny、@mediabunny/aac-encoder、soundtouchjs@0.3.x
- [ ] Prisma migration（VideoProject + 三模型反向字段；开发期可 reset）
- [ ] soundtouchjs 变速不变调 spike（半天：验证 0.5×/2× 质量；不达标启用备选 WSOLA 自实现）

## 附录 B：开发顺序建议（供 plan 阶段参考）

1. Prisma migration + video-project CRUD/upsert（含测试）
2. timeline 纯函数 TDD（公式/吸附/历史）——无 UI 依赖可独立验收
3. normalized store + 时间轴 UI（复用 useWaveformPeaks）
4. scene 纯函数 TDD + 主线程预览
5. 右面板三态 + 转场/关键帧
6. Worker 导出 controller（mock 先行）→ 真实编码 E2E → 产物登记入库
7. AI 三按钮（regenerate）+ 护栏 + 15 条手动验收

## 附录 C：审核采纳记录（2026-09-10）

- 采纳：P0-1~5 全部（并存命名/模型补全/方案 A/overlap 规则+公式/normalized）、P1-1/2/3/4/5/7/8/9/10/12 全部、P1-6 变速不变调（用户拍板）、P1-11 缺口采纳但"设计稿"轻量化为文字规格、P2 全部（乐观锁取轻量版 updatedAt 校验）
- 纠正：P0-6"参考库不存在"不成立（git bash /tmp = C:\Users\link\AppData\Local\Temp\opencut-classic 实存，审核查了 C:\tmp 错路径）；但"vendor 入仓优于临时目录"建议采纳；依赖未装属实（实施前置，非 spec 缺陷）
