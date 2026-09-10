# Spec: Canvas 视频剪辑器（多轨时间轴 + 纯浏览器导出）

## 目标与背景

在画布的视频节点工具栏新增"剪辑"按钮，点击后弹出画布内全屏遮罩的多轨视频剪辑页面（UI 依据用户提供的效果图，剪映风格：亮色主题 + 紫色强调色 #6C5CE7 系）。支持多轨时间轴编辑（视频/字幕/音频）、转场特效、关键帧动画，导出为 MP4（H.264+AAC）自动入素材库。

### 选型结论（2026-09-10 调研定案）

| 项 | 决策 |
|---|---|
| 渲染架构 | **纯浏览器 WebCodecs + mediabunny**，CanvasRenderer 同源渲染预览+导出（WYSIWYG） |
| 参考库 | `opencut-classic`（MIT 已归档快照，本地克隆 `/tmp/opencut-classic`），timeline 交互/scene-builder/video-cache 直接参考移植 |
| 服务端 | 不参与导出渲染；FFmpeg 管线保留为后续兜底路径（不删不扩） |
| 服务器约束 | 2核/1.9GB 无显卡——导出算力全部在用户设备，服务端零增量负载 |

---

## 一、总体架构

### 模块划分（apps/web/src/pages/canvas/video-editor/）

```
video-editor/
├── store/          # zustand 剪辑状态（参考 opencut timeline-store）
├── timeline/       # 时间轴纯逻辑：吸附/trim/分割/时间换算/历史栈（纯函数，TDD 主战场）
├── renderer/       # scene-builder（状态→帧场景树）+ CanvasRenderer（预览/导出共用）
├── export/         # Web Worker + mediabunny 导出器
├── persist/        # 自动保存（防抖 PATCH）
└── components/     # 顶栏/资产库/预览区/多轨时间轴/属性面板
```

### 核心原则：同源渲染

`scene-builder(state, t)` 输出"时刻 t 的场景树"（活跃片段、变换、透明度、关键帧插值值、字幕内容）。预览（CanvasRenderer + rAF）与导出（Worker 内 OffscreenCanvas 逐帧）消费**同一棵树**，所见即所得由架构保证。Canvas 绘制层保持薄，逻辑全部在纯函数中。

### 合成坐标系

合成分辨率固定 **1920×1080（16:9）**，布局坐标全部基于该坐标系；导出 720p 时整体 0.5 倍缩放绘制。布局与导出档位解耦。

---

## 二、入口与形态

1. `VideoNodeToolbar` 新增"剪辑"按钮
2. 点击 → **WebCodecs 能力检测**（`VideoEncoder.isConfigSupported` + `AudioEncoder` 存在性）：不可用则 message 提示"当前浏览器不支持视频剪辑，请使用最新版 Chrome/Edge"，不打开
3. 检测通过 → 查询 `GET /api/video-projects/by-node/:sourceNodeId`：
   - 已有项目 → 打开该项目
   - 无 → 以该节点视频为初始视频轨片段创建新项目（POST），后打开
4. 编辑器为**画布内全屏遮罩**（与 CropOverlay/EraseCanvas 同级模式），顶部"收起"返回画布，画布状态不丢
5. 同一 `sourceNodeId` 绑定至多一个项目

---

## 三、数据模型

### Prisma 单表

```prisma
model VideoProject {
  id            String   @id @default(uuid())
  teamId        String
  sourceNodeId  String   @unique
  title         String
  data          Json     // 见下方 schema
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### data JSON Schema（version: 1）

```ts
interface ProjectData {
  version: 1;
  fps: 30;                          // 固定 30
  tracks: Track[];                  // 顺序即图层顺序（索引大者在上）
  subtitleClips: SubtitleClip[];    // 字幕片段（挂在字幕轨上，样式内联）
}

interface Track {
  id: string;
  type: 'video' | 'subtitle' | 'audio';
  name: string;                     // 显示名（视频 / 字幕1 / 音频1 ...）
  muted: boolean;
  hidden: boolean;                  // 字幕/视频轨可隐藏
  clips: string[];                  // 视频/音频轨：clip id 有序数组（按 start 排序）；字幕轨恒为空，字幕片段存于 subtitleClips
}

interface VideoClip {
  id: string;
  trackId: string;
  start: number;                    // 轨道起点（秒）
  duration: number;                 // 成片时长（秒）
  sourceStart: number;              // 素材入点（秒）
  mediaId: string;                  // 素材库/节点产物 media id
  sourceNodeId?: string;            // 来源画布节点（片段重拍依赖，可得则有）
  transform: { x: number; y: number; scale: number; rotation: number; opacity: number };
  playbackSpeed: 0.5 | 1 | 2;
  transitionIn?: Transition;        // 入场转场
  transitionOut?: Transition;       // 出场转场
  keyframes: Keyframe[];            // 属性级关键帧
}

interface AudioClip {
  id: string;
  trackId: string;
  start: number;
  duration: number;
  sourceStart: number;
  mediaId: string;
  volume: number;                   // 0~1
  fade: { in: number; out: number }; // 秒
  playbackSpeed: 0.5 | 1 | 2;
  keyframes: Keyframe[];            // 仅 volume
}

interface SubtitleClip {
  id: string;
  trackId: string;
  start: number;
  duration: number;
  text: string;
  visible: boolean;
  style: { fontSize: number; color: string; letterSpacing: number }; // 默认 48px / #FFFFFF / 0
}

interface Keyframe {
  id: string;
  clipId: string;
  t: number;                        // 相对片段起点（秒）
  property: 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';
  value: number;
  easing: 'linear';                 // 预留字段，一期仅 linear
}

interface Transition {
  type: 'fadeIn' | 'fadeOut' | 'crossfade' | 'toBlack' | 'toWhite';
  duration: number;                 // 秒，0.2~2
}
```

**crossfade 语义**：作用于相邻两片段的 overlap 区间（后片段 start 早于前片段结束），区间内前片段 opacity 1→0、后片段 0→1，两帧叠加合成。

### 自动保存

- 防抖 1.5s `PATCH /api/video-projects/:id { data, title }`（复用画布自动保存模式）
- 顶栏状态点：保存中（灰）/ 已保存（绿，对齐效果图"已保存"）

### API（apps/api，权限走现有 assertTeamMember）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/video-projects` | 创建（含初始 data） |
| GET | `/api/video-projects/by-node/:sourceNodeId` | 入口查询 |
| PATCH | `/api/video-projects/:id` | 自动保存 |
| DELETE | `/api/video-projects/:id` | 删除项目 |

---

## 四、UI 布局规格（依据效果图）

| 区域 | 内容 |
|---|---|
| 顶栏 | Logo+标题"多轨剪辑"标签 / 绿点保存状态 / 比例 16:9（一期固定）/ "收起" / "导出"黑色主按钮 |
| 左面板 | Tab：资产库/字幕；搜索框；"全集资产"分组 = 当前画布视频/音频/图片节点产物 + 团队素材库；条目=缩略图+名称+"已添加"标记；"+新建"上传 |
| 中上 | 16:9 预览播放器；下方控制条：播放/时间码（当前黑色+总长灰色）、撤销/重做/分割/删除/速度(1×)、生成音频/添加字幕/片段重拍（紫色文字按钮）、音量/缩放滑杆 |
| 中下 | 时间轴（详见第五节） |
| 右面板 | 选中片段设置 / 字幕编辑（字幕文本 textarea、显示字幕开关、字号滑杆+数值、字体颜色、字间距），标题+关闭按钮 |

视觉：亮色主题（背景 #F7F8FA、面板 #FFFFFF）、紫色 #6C5CE7 系强调（播放头/开关/紫色文字按钮）、字幕片段浅橙黄底、音频片段浅绿底+波形、全局圆角 8-16px、黑色胶囊主按钮。antd5 组件为主 + Tailwind 辅助；**preflight:false 红线：显式 box-border、ul 加 list-none pl-0、border 配 [border-xxx-style:solid]、button 字号写在自身**。

### AI 按钮三件（桥接现有第三方 API 管线）

| 按钮 | 一期行为 |
|---|---|
| 添加字幕 | 完整实现：播放头处创建字幕片段（时长 3s，可在属性面板改） |
| 生成音频 | 弹输入框 → 调现有音频生成 API（AudioGenNode 同款）→ 产物入资产库可拖入 |
| 片段重拍 | 读选中视频片段 sourceNodeId 的生成参数 → 调现有视频生成 API → 新视频入资产库；**参数不可得则按钮置灰** |

---

## 五、时间轴交互规格

- **轨道**：类型三种（video/subtitle/audio），数量不限可增删；默认模板 1 视频 + 1 字幕 + 2 音频；左侧标签（视频▶ / 字幕1👁➕ / 音频1♪🔊）
- **标尺**：时间刻度（0:00/0:05/...，随缩放自适应），紫色播放头（顶部圆点手柄）可拖拽
- **片段操作**：
  - 拖动（同类型跨轨移动、轨道内移动，冲突时让位/覆盖策略：不允许重叠，吸附最近空位）
  - 边缘 trim（改 start/duration 并同步 sourceStart，受素材实际时长约束）
  - 播放头处分割（一分为二，sourceStart 连续）
  - 删除（Delete 键 / 控制条按钮）
  - 撤销/重做（zustand 历史栈快照，上限 50 步）
- **吸附**：片段边缘 ↔ 相邻片段边缘 / 播放头 / 整秒刻度，阈值内（8px 换算为秒）自动吸附
- **缩放**：Ctrl+滚轮调整 px/s，以播放头为中心
- 波形：音频片段内绘制波形（wavesurfer.js 已有依赖，或解码 PCM 自绘）

交互算法参考移植 opencut `timeline/`（drag-utils/snapping/group-move），适配 zustand4 + antd5。

---

## 六、预览播放

- **主时钟**：Web Audio `audioContext.currentTime`（音画同步标准做法）；rAF 每帧 `t → scene-builder → CanvasRenderer 绘制`
- **视频帧获取**：mediabunny 精确解码到 sample + LRU 帧缓存（参考 opencut video-cache：预解码播放位置附近片段；seek 时等目标帧解码完成再绘，保证帧精确）
- **音频调度**：AudioBufferSourceNode 按片段 start 挂载调度；seek 时停全部源、重建调度队列；变速用 soundtouchjs（opencut 同款依赖）
- 字幕/图片：Canvas 直接绘制（文字样式按字幕 style）

---

## 七、导出管线（Web Worker + mediabunny）

1. **触发**：顶栏"导出"→ 确认弹窗（档位 720p / 1080p，MP4 H.264+AAC 固定格式；预估耗时提示）→ 前置校验：总时长 ≤15 分钟（超限拦截提示删减）、`VideoEncoder.isConfigSupported` 确认、内存预估（音频 PCM + 轨道数估算 >1GB 时警告"项目较大，低配设备可能导出失败"但允许继续）
2. **Worker 内执行**：
   - `OfflineAudioContext` 离线混音全部音频轨（含变速/fade/volume 关键帧）→ AudioBuffer
   - 逐帧循环：t → scene-builder → OffscreenCanvas（按档位 1280×720 或 1920×1080 缩放绘制）→ VideoFrame → mediabunny `CanvasSource`
   - 音频 → AudioEncoder AAC；浏览器原生不支持时**动态 import `@mediabunny/aac-encoder`** polyfill
   - `Output + Mp4OutputFormat + BufferTarget` → Blob
3. **完成后**：Blob 走现有素材上传管线（material-library file upload）→ MinIO → 自动登记团队素材库 → toast"已入库，可添加到画布"
4. **导出中**：进度条（progress 事件）+ 取消按钮 + "请勿关闭页面"警示 + beforeunload 拦截
5. **失败**：错误分类提示（编码不支持 / 内存 / 未知），可重试

---

## 八、边界护栏

| 场景 | 行为 |
|---|---|
| WebCodecs 不可用 | 入口拦截，提示"请使用最新版 Chrome/Edge" |
| 总时长 >15 分钟 | 导出前校验拦截 |
| 内存预估 >1GB | 警告但允许继续 |
| 导出中关闭页面 | beforeunload 拦截确认 |
| AAC 编码缺失 | 动态加载 polyfill，对用户透明 |
| 同节点重复创建项目 | sourceNodeId @unique + by-node 查询保证 |

---

## 九、测试策略（TDD 红-绿-重构）

| 层 | 方式 |
|---|---|
| timeline/ 纯函数（吸附/trim 边界/分割/时间换算/历史栈） | vitest 全覆盖，TDD 主战场 |
| scene-builder（活跃判定/关键帧插值/转场混合值/crossfade overlap） | 状态+时刻 → 断言场景树 |
| store reducers（轨道/片段/字幕增删改） | vitest |
| 导出编排 | mock mediabunny/encoder，验证调用序列/进度/取消/错误分类 |
| VideoProject CRUD API | 跟随项目现有 API 测试模式（supertest/spec） |
| 组件交互 | RTL（antd5 测试坑：两字按钮文本带空格等既有经验） |
| CanvasRenderer 绘制 | 薄层不测（逻辑在 scene-builder） |

### 手动验收清单（浏览器可视化验收）

1. 视频节点"剪辑"→ 打开编辑器，初始片段在视频轨
2. 素材拖入时间轴（视频/音频/字幕轨各类型正确）
3. trim/拖动/分割/删除/撤销重做/吸附行为正确
4. 播放预览音画同步、seek 帧精确
5. 字幕添加+样式编辑，预览实时反映
6. 转场 5 种效果（fadeIn/fadeOut/crossfade/toBlack/toWhite）预览正确
7. 关键帧添加+线性插值动画正确
8. 导出 720p/1080p 真实编码 E2E，产物入库可在画布添加
9. Chrome 正常导出；WebCodecs 检测拦截路径（模拟不支持）
10. 自动保存：编辑后刷新重进状态一致
11. 导出中取消/关闭页面拦截

---

## 十、一期明确不做（YAGNI）

- 多人实时协作（数据模型已预留：单表 JSON 可平滑迁 Yjs）
- 服务端导出兜底（管线保留，按需启用）
- 自定义转场参数/贝塞尔缓动（easing 字段已预留）
- 多比例（21:9/9:16 等，架构上仅改合成分辨率常量）
- 画中画分屏布局模板、调色 LUT、遮罩
- 导出 WebM/VP9/AV1、 GIF、逐帧 PNG 序列
- 断点续传导出

---

## 参考资料

- opencut-classic 本地克隆：`/tmp/opencut-classic`（timeline/、services/renderer/scene-builder.ts、video-cache）
- mediabunny 文档：mediabunny.dev（AAC polyfill: /guide/extensions/aac-encoder）
- 效果图 UI：见 brainstorming 会话记录（2026-09-10）
