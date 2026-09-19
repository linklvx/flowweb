# Spec: Canvas 视频剪辑器（多轨时间轴 + 纯浏览器导出）v3.6

> **v3.7 勘误（2026-09-11，用户拍板）**：本文 7 处条款被 [2026-09-11-video-editor-ui-overhaul-design.md](2026-09-11-video-editor-ui-overhaul-design.md) 修订——①:287 亮色视觉→暗黑扁平（#141414 系）②:287 语义色→opencut 色表（subtitle #5DBAA0/audio #8F5DBA+白波形/video #1f1f1f 兜底）③默认 4 轨→初始 1 空视频轨+动态建轨 ④:49/:279/§十 固定 16:9→C 档多比例（canvasSize+6 档+全消费方）⑤§七 FSA 直写→FSA/OPFS 中转+目的地后置 ⑥:283 控制条文字按钮→图标化+Tooltip ⑦分辨率两档→480P/720P/1080P 三档（DTO+@Max(900)+metadata w/h）。冲突处以新 spec 为准。

> v1（2026-09-10）：初版。
> v2/v2.1（2026-09-10）：R1/R2 轮审核修订——模型补全、normalized、变速公式、A1 影子节点、pending→confirm、PATCH 单飞等。
> v3（2026-09-10）：**入口模型变更（用户产品决策）**——视频剪辑节点成为画布一等节点类型，上游素材随时间轴增删自动连线，导出产物自动创建视频节点并连到输出端。v2.1 的"视频节点工具栏按钮"方案作废。
> v3.1（2026-09-10）：R3 轮复审修订——执行白名单、composite 死入口接管、空工程定义、自动连线 reconcile 算法定稿、节点播放资源纪律、能力检测分层、生命周期与产物节点收敛、验收清单修复（18 条）。
> v3.2（2026-09-10）：R4 轮复审修订——白名单升级"类型+产物标记"（产物节点二次必挂规避）、origin 隔离拆独立任务、A1 补 insertNode/removeNode 原语与克隆字段清单、产物登记自建化、audio-engine 新建、波形抽峰纯函数化、帧整数真相、crossfade 音频规则、真机兼容矩阵、验收 19 条。
> v3.3-final（2026-09-10）：R5 轮复审修订——socket 单例服务化（更正 useSocket 非单例的 R4 误判）、A1 克隆改 structuredClone 整份深拷、crossfade 音频统一线性 equal-gain、originOverride try/finally 与 transact 分流落地、三态/护栏表残留修正、P3×3 记录项。
> v3.4（2026-09-10）：R6 轮复审修订——origin 隔离改独立入口 syncAutoEdgesToDoc（syncStoreToDoc 内分流不可落地）、撤销互斥显式化（时间轴数据不进画布 store）、影子事务 onRemote 短路（防全量重建闪烁）、克隆改 JSON 深拷、insertNode 与 fillDoc 逐键同构、产物上传改复用 presigned POST（零新依赖）、白名单过滤前置 emitNodeStatus + isExecutableNode 共享谓词、socket 迁移扩至 5 创建点、验收 25 条。
> v3.5（2026-09-10）：R7 轮复审修订——订阅路径边处理跳过 auto: 前缀（P0-A 闭环：auto 边全生命周期只归 syncAutoEdgesToDoc）、removeEdge 新增登记、stopCapturing 编辑器 commit 接入、PUT→POST 三处统一、subscribeNodeEditResult（ImageGenNode edit-result 迁移去向）、快捷键禁用改 isGroupEditContext 早退、内存预估含视频内嵌音轨、ValidationPipe 自挂入正文、验收 28 条。
> v3.6（2026-09-10）：R8 轮复审修订（终版）——syncAutoEdgesToDoc 改**无参幂等全量对账**并在订阅边变更分支调用（封住删节点级联留孤儿 auto 边）、附录 B 两处残留同步（等功率→equal-gain/25→29 条）、readDocCanvas 措辞软化（topology 有 src/tgt 归一化兜底）、白名单生效场景限定（全部执行/nodeIds 路径）、验收 29 条。**八轮审核收官，按附录 B 开发顺序直接开工。**（Plan 轮勘误 ×2：① 影子短路判据改 **id 前缀 shadow- + __ephemeral**——原 SHADOW_ORIGIN 两层证伪（withDoc 嵌套事务 origin 死代码 + Yjs origin 不过网）；② A1 fileId 事实修正——ai-download.processor 的 done 事件**带 fileId**（"gateway 只发 status"有误），权威来源仍是 doc、socket 时序不保证）。Plan 3 轮勘误 ×2（2026-09-11）：① 第六节字幕"超长截断"具体化为**最多 2 行、超出按 maxWidth 截断**（第三节 SubtitleClip.style 行同步）；② 第四节控制条四控件中"设置"**一期省略**（内容未定义，TODO 待定——音量/全屏/缩放三控件照做）。Plan 3 R2 轮勘误 ×2（2026-09-11）：③ 第七节内存预估"≈86MB/轨"量级算错，按自身算式修正为 **345.6MB/轨**（>1GB 警告阈值口径同源修正，Plan 4 执行）；④ 预览取帧新增 **Range 206 前置验证**（UrlSource 依赖 HTTP Range，Nginx 反代若吃掉 Range 头需配置修正——Plan 3 Task 14 验收项）

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
- **节点本体 UI**（依据节点设计图，白色宽卡片 + 左右 Handle，**addNode 时显式设 width: 320**——addNode 对非 textInput 不写 width，产物位置计算的 fallback 链（measured→width→300）会在首渲染前落到 300 导致偏移不可复现）：
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

两处必挂源与规避（**抽成共享谓词 `isExecutableNode(node)`，validation/execute 单点共用防两处漂移；execute 侧过滤必须在循环首行 `emitNodeStatus` 之前**——否则剪辑/产物节点会闪一次 loading 态）：
1. **videoEdit 剪辑节点**（无 model）→ 类型白名单挡：白名单 `textInput/imageGen/imageExtGen/videoGen/audioGen/multiImageGen` 外的类型（videoEdit、group 等）两处 `continue`——不校验、不执行、不计费、**不发 loading**
2. **导出产物节点**（类型 videoGen **在白名单内**、data 仅 `{origin:'video-edit',videoProjectId,status:'done',fileId}` 无 model）→ **产物标记挡**：`data.origin==='video-edit'` 的节点在 validation 与 execute 两处同样 `continue`（注意：不能照 trim 子节点先例补 model——那会让产物节点被真的重新生成并扣费）
- 节点上不显示"执行/生成"按钮；对剪辑节点触发展开上游执行一期不做（YAGNI）
- A1 影子节点是 videoGen/audioGen 且克隆完整 data（含 model），正常走白名单
- 测试：画布**同时含空剪辑节点 + 已导出产物节点**时"全部执行"只跑真正待生成节点，两类均跳过、不报错不扣费（API 测试）。**限定说明**：白名单真正生效的场景是"全部执行 / nodeIds 批量执行"——单节点执行时 getScope 只收上游，产物边方向为 剪辑→产物，剪辑/产物两类节点只有 allNodes 路径才会进 scope（防护偏保守但正确）

### 连线同步规则（定稿算法：确定性 id + 全量 reconcile + origin 隔离）

**sourceNodeId 落点**：素材节点的 `useNodeStore.nodes[id].data` 挂 `sourceNodeId`（编辑器落地时写入），随协作桥 storeProjection 的 data 逐键 diff 持久化（否则重开画布后编辑器读不到）。

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
3. **跨撤销栈隔离（独立入口方案，非 addEdge 小改的一部分）**：协作桥是订阅式自动同步——store 变化触发 `subscribe` 内写死 `syncStoreToDoc(Origin.LocalUser)`，单一 transact 单 origin 贯穿 nodes+edges 全部增删（[canvasCollabRuntime.ts](apps/web/src/stores/canvasCollabRuntime.ts) L71-119），且 syncStoreToDoc 的边删除是**单一循环遍历整个边集合**——"在其内部按前缀分流"不可落地。**定稿方案（v3.6 无参幂等全量对账）**：协作桥新增 **`syncAutoEdgesToDoc(origin=Origin.AutoEdge)`——无参、幂等、全量对账**：遍历 store 中所有 `auto:`/`auto-out:` 前缀边（id 本身编码了 editNodeId，无需参数）→ 与 doc 比对增删补齐，独立 transact。调用点两处：① **bindBridge 订阅内**（pickStructEdges 变化时先调 `syncAutoEdgesToDoc()` 再走原 `syncStoreToDoc(Origin.LocalUser)`）——自然覆盖"删节点级联删 auto 边"（deleteNode 的 edges.filter 会移除 store 中 auto 边，但订阅路径不认 auto 前缀、reconcile 也不会为已删节点跑——若无此调用会留**孤儿 auto 边**，重开画布出现悬空连线）、"用户手删 auto 边"、"编辑器 reconcile" 全部场景，且全部落 AutoEdge origin 不入撤销栈；② 编辑器 reconcile 显式调用（幂等，重复调无副作用）。同时**订阅路径的边处理全部跳过 `auto:`/`auto-out:` 前缀**（edgeIds 构造、边删除循环、fillDoc(d,[],[e]) 新增分支都排除该前缀）——**auto 边全生命周期只归 syncAutoEdgesToDoc**。配套：`Origin` 常量扩（现仅 {LocalUser, Server}，新增 AutoEdge），**刻意不加入 trackedOrigins**；`canvasStore` 需**新增 `removeEdge(id)` 方法**（现无，只有 addEdge/onEdgesChange）与 `addEdge` 可选 id 参数（且 addEdgeById 对同 id 已存在须 no-op 断言，防 React Flow 双 key）；**编辑器 commit 点接入 `stopCapturing()`**（canvasUndo 现有机制，防 500ms 合并窗把编辑器前后的画布操作错误并栈）
   **撤销互斥显式定义（数据流澄清）**：时间轴数据只存 Prisma（VideoProject.data，PATCH 通道），**不进画布 Yjs store**——画布撤销栈唯一可能沾到的剪辑器痕迹就是 auto 边（origin 隔离后也不入栈）。互斥 = ① 编辑器打开期间画布快捷键层禁用（含画布 Ctrl+Z）；② 退出后画布栈不含任何时间轴/auto 边痕迹。既有画布 UndoManager `captureTimeout: 500`（500ms 内连续操作合并为一个栈项）为既有行为，登记不改
4. **产物输出边**为一次性边，确定性 id `auto-out:${editId}:${productNodeId}`，不参与 reconcile
5. **连线方向恒定**：素材 source → 剪辑 target；剪辑 source → 产物 target；自动边单向派生不可能成环，一期不做连线类型校验/环检测（手动边仅视觉，无执行语义——执行白名单保证剪辑节点不被执行）；onConnect 现状无判重（同一对节点可重复拖线，现状缺口非本功能引入）——**顺手在 onConnect 加同源判重**
6. **测试矩阵**：加片建边 / 同源多片只一边 / 删全部片删边 / 素材库片不建边 / 手动边不被删 / 自动边判重 / 编辑器撤销后边跟随回滚 / 画布撤销栈不含自动边

### 生命周期规则

- **删除剪辑节点**：`canvasStore.deleteNode` 对 videoEdit 类型 fire-and-forget `DELETE /api/video-projects/by-node/:id`（否则成无入口孤儿；边由 deleteNode 现有逻辑级联清除；**DELETE 失败走 Sentry 上报**，避免静默孤儿无法排查）
- **复制/粘贴剪辑节点**：一期 = **空工程**（新 nodeId，首次全屏编辑时 upsert），不深拷贝时间轴
- **上游素材节点被删**：边级联消失，但 clip 仍引用 mediaId → **素材缺失态**：片段标红"素材已删除"、导出前置校验拦截缺失 mediaId、可在时间轴手动删除。**素材缺失态下连线对账（ensureAutoEdges）不重建连线**——toAdd 按画布现存节点过滤，clip 引用悬空 sourceNodeId 时跳过建边（防悬空边入库并经协作层持久化）
- **左面板可选派生标记**："已连线但未入时间轴"的素材显示"已连线"次级标记（edge 集合派生，帮助理解自动边来源）

### 挂载结构

节点"全屏编辑"只写编辑器 store `{open:true, sourceNodeId: 剪辑节点id}`；编辑器组件挂**画布根层组件树下**（不进 VideoEditNode 内部，保证画布 React 树不卸载、左面板可读整个 nodeStore；DOM 层经 BaseFullscreenModal 的 `createPortal` 挂 document.body——z-index 与滚动锁由其管理，与"React 树挂画布根"不矛盾），基于 `components/BaseFullscreenModal.tsx` 封装外壳——该组件现状**点击遮罩即关且无开关**（自研 portal 非 antd Modal），需新增 `closeOnBackdrop?: boolean`（默认 true 保持现状，编辑器传 false）；ESC 现状即 onClose 回调（含 stopImmediatePropagation），接"flush 后关闭"，与画布快捷键层的事件顺序需实测；底色亮色 #F7F8FA；全屏打开期间节点本体播放全部暂停。

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
  userId       String        // 取当前操作用户（assertEditor 通过者）——与 CanvasProject.userId 可空无关，必填无碍
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
  style: { fontSize: number; color: string; letterSpacing: number }; // 默认 48 / #FFFFFF / 0；渲染时最多 2 行（见第六节绘制规格）
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
- **crossfade 边界状态机（全部进纯函数测试）**：前片不存在/被删/被移走 → 退化为 fadeIn 且 overlap 归零；前片 transitionOut 与后片 crossfade 冲突时 crossfade 优先；分割带 overlap 的片段后重新配对；hidden 轨视觉片不进 selectActiveClips，muted 轨 gain=0 但仍占时长；**转场仅对同轨相邻片段生效，跨轨重叠不触发任何转场**

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
- 顶栏三态状态点：保存中（灰）/ 已保存（绿）/ 失败（红，可点重试）；**自动重试**：失败后指数退避自动重试 3 次（1s/4s/16s），期间不改状态点；红点点击 = `retry()`（重置退避额度并无条件重发当前数据——409 冲突后点击会重弹提示，半自动恢复语义）；**离线暂停**：协作连接状态非 connected 时暂停 PATCH，恢复后立即 flush 队列。**收起/ESC 的 flush 排空结果化（2026-09-11 执行期定案）**：flush 返回是否排空——离线且有未保存数据、或持续失败烧完退避额度时返回 false，收起路径 `message.warning` 提示并**阻止关闭**（数据留编辑器 store 待恢复/手动重试）；flush 等待退避 timer 自然执行不绕开（防连打烧额度）；409 冲突放行关闭（用户已收提示，本地编辑以服务端为准）；加载迁移（loadProject）不触发自动保存（status 迁移过滤）
- title 初始取源节点名（创建时写入，不在 PATCH 中更新）

### API（apps/api 新建 modules/video-project/，注册 app.module）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/video-projects` | assertEditor(workflowId) | **服务端 upsert by sourceNodeId**（幂等防双击 + **跨画布归属校验 403**），teamId 服务端派生；写 userId/workflowId |
| GET | `/api/video-projects/by-node/:sourceNodeId` | assertEditor | 入口加载 |
| PATCH | `/api/video-projects/:id` | assertEditor | 自动保存 + updatedAt 乐观锁（409；记录不存在 404） |
| DELETE | `/api/video-projects/by-node/:sourceNodeId` | assertEditor | 仅删工程记录，引用 Media 不动 |
| POST | `/api/video-projects/regenerate` | assertEditor | **A1 影子节点克隆生成**（见下） |
| POST | `/api/video-projects/remove-shadow` | assertEditor | 前端 done 回流后删影子；**shadow- 前缀强校验**（防借道删任意节点，Plan 1 final review 补） |
| POST | `/api/video-projects/generated-media/register` | assertEditor | 编码完成后登记：派生 teamId + 配额终判 + 建 pending Media + presigned POST |
| POST | `/api/video-projects/generated-media/confirm` | media.userId 所有权 | statSize 实际大小落库 + 缩略图 enqueue（seekSec=时长×0.1） |
| POST | `/api/media/batch` | assertTeamMember | 左面板按 mediaId 集合批查 + presigned URL（@ArrayMaxSize 200） |

> Plan 1 final review 登记项：① regenerate 直调路径下影子被 validateAll 跳过（__ephemeral 全局排除）——model 无定价时错误呈现路径与源节点直执行不一致（error 仍 emit，前端可见，可接受）；② confirm 不限 media.type/status（幂等无害，语义可二期收紧）；③ upsertByNode 的 data 兜底（空轨）与 createDefaultProjectData()（4 轨）两套默认并存——仅客户端漏传 data 时触发，前端正常路径不走。

**A1 影子节点方案（regenerate 落地契约）**：

- execute 链路事实（[execution.service.ts](apps/api/src/modules/execution/execution.service.ts)）：以 Yjs 节点为唯一数据源（`readCanvas` → 拓扑 scope → 执行 → `writeNodeData` 写回节点 data → `emitNodeStatus({nodeId,status})` 以 **nodeId 为键、不带 mediaId**，产物 fileId 在节点 data 里），积分走 teamCredit 循环内扣费
- regenerate 实现：在 Yjs 画布克隆 sourceNode 为 `data.__ephemeral` 影子节点 → **服务端直调 `ExecutionService.execute(projectId, shadowNodeId)`**（**不走 HTTP、不带 x-yjs-sv**——若经 HTTP 携前端状态向量，影子节点可能被 sv 裁剪不可见；校验/上游收集/积分/队列/写回全部白捡）→ 接口返回 shadowNodeId；ValidationService 循环内逐节点查定价（N 次查询）为既有行为，登记不改；**A1 是同步执行占用 HTTP 连接（可能数分钟）——前端 axios 超时对 regenerate 单独放大或忽略**；edges 键名以 ydocBuilder.fillDoc（source/target）为准以保持一致（消费侧 topology 有 src/tgt 归一化兜底，两种键名都能吃，非缺陷仅风格统一）
- **后端 doc 原语缺口（必须新增）**：[collab-document.service.ts](apps/api/src/modules/collab/collab-document.service.ts) 现仅有 `writeNodeData`（只能 patch 已有节点 data）——需新增 `insertNode(projectId, node)` 与 `removeNode(projectId, nodeId)`（影子无连边无需动 edges），走现有 `withDoc` 直连。**insertNode 契约与 ydocBuilder.fillDoc 逐键同构**（type / parentId 条件写（null 时**省略键**，防 syncStoreToStore 差异循环）/ width?/height? 条件写 / position 独立 Y.Map（必写）/ data 独立 Y.Map），**建议直接抽取 fillDoc 的单节点构造逻辑复用**（跨端复制契约 + 往返测试）；删除"不写 position"选项——position 必写（缺 position 会破坏协作桥差异判定的 position 分支）
- **克隆口径（整份深拷，禁止字段挑拣）**：影子节点孤立（getScope 只含自身）、拿不到上游边补参，且它是白名单内 videoGen/audioGen 会被 validation 校验 model——克隆实现为 **`JSON.parse(JSON.stringify(sourceNode.data))` 整份深拷**（Yjs readCanvas 的 toJSON 本就是 JSON 语义；structuredClone 对历史 data 中的非常规值可能抛 DataCloneError，JSON 方案无此险）后叠加 `__ephemeral` 标记；后端取词链为 `上游textContents → data.content → data.prompt`，且执行消费 content/endImageUrl/imageUrls/quality/duration/audio/resolution 等一长串字段——**逐字段白名单必漏，字段清单仅作 code review 对照**，不是实现依据
- **影子事务防闪烁（机制修正：id 前缀判据，origin 方案证伪）**：协作桥 `onRemote` 对任何非 LocalUser 事务 50ms 防抖后 `applyDocToStore` **全量重建** canvasStore.nodes/edges + applyGroupDerivations + refitExpandedGroups + 全量替换 nodeStore——影子 insert/remove 各触发一次全量重建。**原"专用 SHADOW_ORIGIN + onRemote 按 origin 短路"机制不可行（两层证伪）**：① withDoc 的 `connection.transact(fn)` 无 origin 参数，Yjs 嵌套事务 origin 由最外层决定——内层 transact 的 origin 是死代码；② **Yjs transaction.origin 不跨网络传输**（update 二进制不含 origin，客户端 applyUpdate 的 origin 是应用方自己的）——前端 onRemote 永远读不到服务端 origin。**定稿判据：影子节点 id 前缀 + `__ephemeral`**——onRemote 扫 events 命中的 nodes map key，本次事件仅涉及 `shadow-` 前缀节点时短路跳过 applyDocToStore；`__ephemeral` 在 store 投影层与节点渲染层双重过滤照做（双保险）；**fileId 的权威来源是 doc**（videoGen 的 execute 只写 videoUrl，fileId 由 ai-result-download 队列异步回写 doc 后、随第二次 done 事件附带发出——node:status 虽可能携带 fileId 但与 doc 回写无时序保证，Plan 4 前端不得以 socket 有无 fileId 判完成，实现必须读 doc）——影子读路径不受短路影响。**（Plan 1 执行期补）影子幽灵执行兜底**：`__ephemeral` 节点在 isExecutableNode 全局排除（客户端崩溃残留影子不得被"全部执行"扫到扣费），regenerate 的单 nodeId 直调是唯一放行口（execute 循环按 `nodeId === node.id && shadow- 前缀` 放行）
- 扣费/失败退费复用 teamCredit 既有路径，**不另建**
- 备选 A2（抽 runNode 脱离 Yjs + 事件扩 requestId）架构更干净但需重构 execute 循环体，二期再说

data 校验：class-validator 嵌套 DTO（ProjectData TS 类型放 `packages/shared/src/types/video-project.ts`，有 material-library.ts 先例，前后端共用）。**ValidationPipe 非全局**（main.ts 仅挂 HttpExceptionFilter + TransformInterceptor，各 controller 逐处 @UsePipes）——**新 controller 必须自挂 `@UsePipes(new ValidationPipe({whitelist:true, transform:true}))`**，否则校验不生效。响应走全局 TransformInterceptor（前端 `code:0` 解包）。

---

## 四、UI 布局规格（依据效果图）

| 区域 | 内容 |
|---|---|
| 顶栏 | 标题"多轨剪辑" / 三态保存状态点 / 比例 16:9（一期固定不可切）/ "收起" / "导出"黑色主按钮 |
| 左面板 | Tab：资产库/字幕；搜索框；"全集资产"分组 = 当前画布（workflowId）视频/音频/图片节点产物 + 团队素材库；条目 = 缩略图+名称+"已添加"标记（纯派生：已在时间轴的 clip 的 mediaId 集合）；"+新建"上传走现有 presign 链路 |

**左面板数据来源**：前端聚合——nodeStore 遍历当前 workflow 节点收集 fileId + 节点名 → 后端补 `POST /api/media/batch` 批量查详情/预签名（真实媒体前缀是 `api/media`（media.controller），目前仅单查/按 folder 查）→ 团队素材走现有 folder 接口；**避开 material.service 的 `type='generated'` 硬编码过滤**（直接按 mediaId 集合查）。
| 中上 | 16:9 预览播放器；控制条：播放/时间码（当前黑+总长灰）、撤销/重做/分割/删除、**生成音频/添加字幕/片段重拍**（紫色文字按钮，触发时明示"将消耗团队积分"）、设置/音量/全屏/缩放滑杆四控件（"设置"一期省略——内容未定义，TODO 待定，Plan 3 勘误②）。**不设全局"速度 1×"控件**（片段变速在右面板，预览速率控件易与导出数据混淆，一期删除） |
| 中下 | 时间轴（第五节） |
| 右面板 | **四态**：视频片段态 / 图片片段态 / 音频片段态 / 字幕态（见下） |

视觉：亮色（背景 #F7F8FA、面板白）、紫 #6C5CE7 强调、字幕片段浅橙黄底、音频片段浅绿底+波形、圆角 8-16px、黑色胶囊主按钮。antd5 + Tailwind；**preflight:false 红线：box-border、list-none pl-0、border 配 [border-xxx-style:solid]、button 字号写在自身**。

> 【已废止 2026-09-19】preflight:false 红线已被 docs/superpowers/specs/2026-09-18-css-base-layer-theme-design.md 推翻并重开（A 段落地）；本条仅存历史档。另：上文亮色视觉未落地，实现现状暗色已被该 spec 显式追认（D4 video-editor 恒深）。

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

socket：**新建模块级单例 socket 服务（非 Hook）**——代码事实：`/execution` 现有 **5 个创建点**（useSocket Hook（page.tsx/useStitchTask 经它调用）+ AudioGenNode.tsx:54 + ImageGenNode.tsx:337/:936（同组件两处）+ VideoGenNode.tsx:349 直连），全部 cleanup 只 removeAllListeners **无 disconnect**（Socket 实例泄漏，N 个素材节点 = N 个实例）；**其中 ImageGenNode:936（editMode 下）监听的是 `node:edit-result`/`node:edit-failed` 独立事件（回填 fileId 退出编辑态）——迁移时必须保留此事件通道**（gateway 的 status 联合类型虽含 edit-result/edit-failed，但 execution.service 从未以 node:status 发射过它们）。改造：① 全画布共享一个 `/execution` Socket，按当前 workflowId join 一次、**connect/reconnect 后重 join**（现有直连都手写了 reconnect 重加入，单例同样要）、切换/卸载 leave+disconnect；② 暴露 `subscribeNodeStatus(handler): unsubscribe`（统一监听 `node:status` 按 payload.nodeId 过滤分发——编辑器据此按 shadowNodeId 分发，见第三节 A1 契约）**及 `subscribeNodeEditResult(handler): unsubscribe`**（分发 node:edit-result/edit-failed，图片 AI 编辑回填走它）；③ **5 个创建点全部迁移**到该单例并补 disconnect。列入开发步骤 8 前置。

---

## 五、时间轴交互规格

- **轨道**：三类（video/subtitle/audio）数量不限可增删；默认 1 视频+1 字幕+2 音频；字幕轨轨道头"➕"= **该轨内新增字幕**（非新增轨道）；**删除轨道 = 确认后连片段一起删**（入撤销栈），不做跨轨迁移
- **标尺**：自适应刻度；紫色播放头（顶部圆点）可拖拽；片段块显示"名称 · 源时间码"（如 `视频生成需求 · 00:00:10:04`，HH:MM:SS:FF，30fps 非丢帧；节点本体为简略 M:SS 显示，两者注明为不同精度）——时间码格式化与 totalDuration（**时间轴原点恒 0，总长 = max(片.end)**；片段不从 0 开始时前导为黑场并计入成片，此行为写明）均抽纯函数入 TDD
- **片段操作**：拖动（同类型跨轨自由重叠；**禁重叠与吸附仅同轨内**——同轨除 crossfade overlap 外冲突吸附最近空位，规则详见第三节）、边缘 trim（公式见第三节）、播放头分割、删除、撤销/重做
- **历史栈事务性**：拖拽 rAF 级高频 setState **不入栈**，pointerup commit 时一次入栈；快照结构化克隆（禁持引用）；上限 50 步
- **吸附**：片段边缘 ↔ 相邻边缘/播放头/整秒刻度，8px 阈值（换算为秒随 px/s 变化）
- **缩放**：Ctrl+滚轮调 px/s，以播放头为中心；**编辑器打开期间禁用画布快捷键——落点为 `isGroupEditContext()`（useGroupKeyboard.ts 统一早退钩子）加"编辑器 store open 则返回 true"**（document keydown 是冒泡阶段监听，捕获层 stopPropagation 挡不住；isGroupEditContext 是现成早退点）；编辑器 open 状态放 `stores/videoEditorStore.ts`（避免 hooks→pages 反向依赖）。**Delete 隔离核验结论（2026-09-11 执行期实测）**：React Flow 的 deleteKeyCode 走 useGlobalKeyHandler 挂 document 冒泡、portal 挂 body 不构成隔离，且焦点残留画布按钮时 button 非 input 守卫失效——三重防线落定：编辑器壳根 div 加 `nokey` class（isInputDOMNode 的 closest('.nokey') 逃生门）+ `initialFocusRef` 焦点移入壳内（div 需 tabIndex=-1 才可聚焦）+ CanvasView `deleteKeyCode` 随 editorOpen 置空数组；CanvasKeyboardHandler（Tab/Ctrl+0/Alt+Shift+F）同加 store open 早退
- **波形**：现有 `hooks/useWaveformPeaks` 与 wavesurfer 实例耦合（首参必须传实例），**不能零成本复用**——将"从 AudioBuffer 抽固定数量峰值"的逻辑剥离为纯函数 `peaksFromAudioBuffer(buffer, count)`（可 TDD）+ 共享单例解码器产 AudioBuffer；时间轴 Canvas 自绘静态波形，峰值按 mediaId 缓存（不为每片段 new wavesurfer 实例）
- 交互算法参考移植 opencut `timeline/`（drag-utils/snapping/group-move），适配 zustand4+antd5
- **可测性红线**：像素↔秒换算、边缘命中宽度、8px 阈值行为全部抽纯函数；组件只绑 pointer 事件

---

## 六、预览播放

- **主时钟**：有音频轨时用 Web Audio `audioContext.currentTime`（**首次用户手势 resume**）；项目无音频片时降级 `performance.now()` 时钟（不为时钟空转 AudioContext）；rAF 每帧 `selectActiveClips → interpolateClip → CanvasRenderer 绘制`
- **视频帧**：mediabunny 精确取帧（**nearest sample**，源 24/25/60fps 不做帧插值，轻微运动抖动为已知限制）+ LRU 帧缓存（参考 opencut video-cache 预解码播放位置附近片段）；图片片一次 drawImage 无解码路径
- **降级策略**：播放中解码跟不上 → **跳帧追赶、音频不停**；seek → 等目标帧解码完成再绘
- **音频**：AudioBufferSourceNode 按 start 调度 + **lookahead 调度**（50ms 定时器/0.1s 调度窗，seek 清队列）；**变速在调度前离线预处理成新 PCM（soundtouchjs），播放时 playbackRate 恒 1**——若 buffer 未预处理而用 playbackRate≠1 会二次变调；预览与导出共用同一 PCM 纯函数（audio-engine 设计意图）；**全部进混音总线的 PCM（独立音频片 + 视频片内嵌音轨）统一过 soundtouchjs 变速不变调**（muted 不处理）；混音走 GainNode（volume 关键帧/淡入淡出在调度时计算包络）
- **crossfade overlap 段音频规则（线性 equal-gain）**：两段视频内嵌音轨在重叠区做**线性交叉淡化**——前片音频增益与画面 opacity 同曲线线性 1→0、后片 0→1（中点各 0.5 有约 -6dB 短暂凹陷，一期接受；与画面同曲线、scene 同源最简；等功率 cos/sin 方案二期再说），消除双倍音量/突兀，规则进 scene/混音纯函数测试
- **字幕绘制规格（预览/导出共用绘制函数）**：1920×1080 基准——底部居中、底边安全边距 96px、最大宽 1664px 自动换行、字号 48px（720p 随 0.5× 整体缩）、超长截断（最多 2 行，超出按 maxWidth 截断——Plan 3 定案）

---

## 七、导出管线（Web Worker + mediabunny）

0. **导出弹层**：点击"导出"→ 小弹层选档（720p/1080p）+ 估算体积（码率×时长×1.2）+ 前置校验结果
1. **前置校验**：总时长 ≤15 分钟（超限拦截）；`VideoEncoder.isConfigSupported` 复检；**团队存储配额预检**（StorageQuotaService.assertCanUpload 同款口径，避免编码数分钟后上传 4xx）；内存预估 = 音频 PCM（15min×48kHz×立体声×4B ≈ **345.6MB/轨**（Plan 3 勘误③：原"86MB/轨"量级算错——按本算式实为 345.6MB） × **（音频轨数 + 参与混音的含音频视频片数）**——视频内嵌音轨同样解码出等长 PCM 并过 soundtouch，只按音频轨数会显著低估；Plan 3 起 **AudioBuffer 稳态单份驻留**；**prepare 瞬时峰值约为稳态 3-4 倍**（R3 实测口径：解码拼接 chunks+merged、变速 padded+输出缓冲并存——替换原"×2"乐观估算，Plan 3 验收含内存观测项）+ 编码峰值 + mux 缓冲，>1GB 警告但放行；警告结合 `navigator.deviceMemory` 分级提示；**"音频分块流式混音、不整段持有全部 PCM"登记为二期优化**
2. **Worker 执行**（懒加载 chunk，含编辑器页/mediabunny/polyfill 全部动态 import 拆包）：
   - `OfflineAudioContext` 离线混音（含变速不变调/soundtouch 处理/fade/音量关键帧）→ AudioBuffer
   - 逐帧：t → scene 纯函数 → OffscreenCanvas（720p=0.5× / 1080p=1×）→ VideoFrame → VideoEncoder H.264（硬编优先回退软编）
   - **VideoFrame 逐帧 close()（WebCodecs 资源纪律，code review 必查项）**
   - 音频 → AudioEncoder AAC；原生不支持时动态 import `@mediabunny/aac-encoder`
   - `Mp4OutputFormat`：**支持 File System Access API（仅 Chromium）时 StreamTarget 流式直写用户选定文件（导出前选位置）降内存峰值；否则回退 BufferTarget**——StreamTarget 不作通用推荐
3. **产物登记（复用状态机语义，方法自建——勿误调 confirmUpload）**：代码事实——现有 confirm 有 ±1024 字节强校验（编码前估算 vs 实际字节必然超标→对象被删）、现有上传是 presigned **POST**、缩略图由 material.service 主动 enqueue（非 confirm 触发）。因此：**复用"pending→statObject→completed"状态机语义与配额口径**，但 generated 登记/确认两个方法**新写**于 video-project（或 media）模块。**登记时序（plan 阶段修正）**：`generatePresignedPost` 的 Conditions 自带 `content-length-range ±1024`（实测 minio.service.ts L73）——编码前估算体积过不了该条件，**登记必须发生在编码完成后**（前端持有 Blob，actualSize=Blob.size）：① 编码完成 → ② 登记接口建 `type='generated'`、`status='pending'` 的 Media（**actualSize 过配额终判**，metadata：来源 video-project/分辨率/时长）+ 返回 **presigned POST**（复用现有 `generatePresignedPost`，浏览器 FormData 上传——MinioService 无 PUT 预签名且新增 PUT 需新依赖 + CORS/policy 放通，POST 通道零新依赖零配置改动）→ ③ 确认时 statObject **以实际大小直接落库（不做 ±1024 比对）** → 置 `completed` + **主动 enqueue 缩略图**（仿 material.service.ts:82；注意：enqueue 必须传 `mimeType:'video/mp4'` 才走 consumer 视频分支；consumer 现固定抽第 1 秒而本功能允许前导黑场——**须给 consumer 加抽帧时间点参数**（job 现仅 {mediaId,key,mimeType}），取 `max(1, 0.1×总时长)`）；不走 presign DTO 的 'uploaded' 通道（素材库类型过滤硬编码 `type='generated'`）；返回 fileId 为 uuid（Media 主键 uuid 非 cuid，前端勿假设 cuid）；**confirm 归属校验为 creator 本人（`media.userId === userId` 硬校验），窄于既有 confirmUpload 的"creator 或团队成员"语义——一期单用户导出流程无影响，若二期出现协作者接手上传需放开为团队口径**
4. **产物自动上画布（v3 定案 + 收敛）**：confirm 成功后自动在画布创建**视频产物节点**：`addNode('videoGen', pos, {origin:'video-edit', videoProjectId, status:'done', fileId})`——最小 data 即可走播放展示（VideoGenNode 现有 done 分支）；+ 自动连线：剪辑节点输出 → 新节点输入（确定性 id `auto-out:`，见第二节）；**每次导出都新建独立产物节点**（命名"工程名 · 导出 N"），位置沿剪辑节点右侧固定步长偏移（仿 createDerivedExtNode GAP=80，重叠时步长递增，不做复杂避让算法）；**产物节点工具栏收敛（按真实按钮全量清单，共 8 个）**：VideoNodeToolbar 实际按钮为 剪辑(onTrim)/**裁剪（无 onClick 死按钮，维持现状不动）**/高清/解析/下载/全屏/音频分离/截帧——产物节点（`data.origin==='video-edit'`）**隐藏：高清/解析/音频分离/截帧**（产物为终态素材，不再二次加工）；**保留：剪辑(旧 trim，仅依赖 fileId)/下载/全屏**；死按钮"裁剪"按现状保留（全节点一致，不在本功能清理）；收起后可选 fitView 定位到新节点；toast"导出完成，已添加到画布"
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
| 多标签双解码 | 写侧有乐观锁，读侧（预览解码 PCM/取帧）无跨标签约束——同工程开多标签各自全量解码一遍，一期接受（Plan 3 R2 登记） |
| 预签名 URL 过期（UrlSource） | presigned GET 有效期 3600s；长会话中段过期时 video-cache 释放 entry 重开自愈（同 URL 重试），但 URL 本身过期则需重开编辑器/重进画布刷新 mediaInfo——一期接受（Plan 3 R3 登记） |
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
| API 测试 | CRUD + **upsert 幂等（并发双 POST 只一条）** + assertEditor 越权 403 + 乐观锁 409 + **执行白名单（含空剪辑节点 + origin:'video-edit' 产物节点的画布"全部执行"只跑真正待生成节点）**；本仓无 supertest 基建——单测走 vitest + mock prisma/perm 模式，"并发唯一性"由 DB @unique 约束物理兜底 + 手动 curl 冒烟覆盖（越权 403/归属校验已入 service 单测，Task 6 执行期修订 I1） |
| 组件 | VideoEditNode：只读预览渲染（片段色块/空态"+ 添加素材"）、播放/暂停、"全屏编辑"回调、Handle 存在性；**连线同步**（addClip→ensureEdge 幂等/移除源全部片段→删 edge/素材库来源跳过/手动连线不反向加素材）抽纯函数或 store 测试；旧 VideoNodeToolbar 不改动（既有用例天然回归） |
| CanvasRenderer | 薄层不测 |

### 手动验收清单（29 条）

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
20. **origin 隔离落地验证**：自动边写入 ydoc 的 transaction.origin 为 AutoEdge（非 LocalUser）且 UndoManager.undoStack 在 reconcile 前后不增长；手动边/节点写入仍为 LocalUser 且入栈（证明分流无误伤）
21. **编辑器 Ctrl+Z 与画布 Ctrl+Z 互斥**：编辑器内撤销只消费本地历史栈（画布快捷键已禁用）；退出编辑器后画布栈不含任何时间轴/auto 边痕迹
22. **A1 期间画布无闪烁**：regenerate 全程影子 insert/remove 不触发 applyDocToStore 全量重建（onRemote 短路生效），节点列表/分组 bounds 无重排
23. **存量节点 data 的 regenerate 成功**：用含嵌套 prompt 对象的真实节点跑通，JSON 深拷不抛错、克隆节点 data 与源一致
24. **产物上传直传成功**：presigned POST 浏览器 FormData 上传返回 2xx，confirm 以 statObject 实际大小落库（无 ±1024 误杀）
25. **Socket 单例**：全画布 /execution 实例数为 1（打开 N 个视频/音频/图片节点后），卸载节点不残留连接；subscribeNodeStatus 能收到不在 nodeStore 的 shadowNodeId 事件
26. **auto 边删除路径唯一性**：reconcile 删除 auto 边后，ydoc 中该边删除事务的 origin 唯一为 AutoEdge（订阅路径未参与）；反复"加片→删片"10 次，undoStack.length 严格不增长
27. **编辑器期间快捷键隔离**：编辑器打开时按 Ctrl+Z / Delete / 空格，画布无任何节点/边变化、无 undo 栈变化；关闭后画布 Ctrl+Z 恢复正常（证明 isGroupEditContext 早退生效）
28. **图片 AI 编辑结果回流**：socket 单例迁移后，editMode 下 AI 编辑完成仍能经 node:edit-result 回填 fileId 并退出编辑态（subscribeNodeEditResult 通道有效）
29. **孤儿 auto 边**：删除剪辑节点后，ydoc 中 `auto:{editId}:*` 边全部消失；删除产物节点后 `auto-out:*` 消失；重开画布无悬空连线；以上删除事务 origin 均为 AutoEdge、undoStack 不增长

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
1. 后端 video-project CRUD/upsert + **collabDoc 新增 insertNode/removeNode（A1 原语）** + **generated 登记/确认自建**（presigned POST 直传 + statObject 实际大小落库 + 缩略图自 enqueue，勿误调 confirmUpload）
2. **VideoEditNode 全链路注册**（上方清单）+ **执行白名单升级（同时挡 videoEdit 类型与 origin:'video-edit' 产物标记）** + 空外壳
3. timeline 纯函数 TDD（公式/吸附/历史/连线 reconcile/帧整数不漂移）
4. normalized store + 时间轴 UI（peaksFromAudioBuffer 纯函数化）+ 连线同步落地——**addEdge 可选 id（小改）与 origin 隔离（协作桥独立入口 syncAutoEdgesToDoc + Origin 扩 AutoEdge + 桥层测试）为两条独立任务**；步骤 2 的白名单谓词 isExecutableNode 单点共用
5. scene 纯函数 TDD + 主线程预览 + 节点本体迷你播放（资源纪律）+ **全局 audio-engine 新建**（实时/离线共用 PCM 纯函数）
6. 右面板四态 + 转场/关键帧（含 overlap 音频线性 equal-gain 规则）
7. Worker 导出 controller（mock 先行）→ 真实编码 E2E → 产物登记 + 产物节点上画布（origin 标记 + 工具栏全量收敛）
8. **前置：模块级单例 socket 服务改造**（**5 个创建点**迁移 + subscribeNodeStatus + subscribeNodeEditResult + disconnect，见第四节 AI 按钮节）→ AI 三按钮（A1 按 doc 原语 insertNode/removeNode 与 fillDoc 同构 + JSON 整份克隆 + 影子 origin onRemote 短路 + 服务端直调 execute）+ 护栏 + 29 条手动验收

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

### R6 轮（2026-09-10，v3.3→v3.4，结论"冻结判定过于乐观，7 项 P0 后可开工"）

- 核验：开工前置 5 项实测均未做（判断正确）；**新发现 socket 创建点实为 5 处**（useSocket Hook + AudioGenNode:54 + ImageGenNode:337/:936 同组件两处 + VideoGenNode:349 直连，R5"三处"漏了 3 个节点组件）——迁移清单扩至 5 创建点，并确认现状全部无 disconnect（实例泄漏）
- 采纳 P0×5：**P0-1 origin 隔离改独立入口**（syncStoreToDoc 边删除为单一循环、单一 transact 单 origin 贯穿——内部按前缀分流不可落地；改为 bridge 层独立方法 syncAutoEdgesToDoc 只处理 auto: 前缀边独立 transact，订阅路径不动；Origin 常量需扩 AutoEdge 且不入 trackedOrigins）；**P0-3 影子事务防闪烁**（onRemote 任意非 LocalUser 事务 50ms 防抖 applyDocToStore 全量重建 canvasStore+nodeStore+分组 re-fit——影子 insert/remove 用专用 origin + onRemote 短路；socket 无 fileId 必须读 doc 的路径不受影响）；**P0-4 克隆改 JSON 深拷**（structuredClone 对历史 data 非常规值可能抛 DataCloneError）；**P0-5 insertNode 与 fillDoc 逐键同构**（parentId null 省略键防差异循环、position 必写、抽取单节点构造复用+往返测试，删"或视口外"歧义）；**P0-7 白名单过滤在循环首行 emitNodeStatus 之前**（防 loading 闪烁）+ isExecutableNode 共享谓词
- **修正后采纳 P0-2**（撤销互斥）：报告"画布 Ctrl+Z 会撤时间轴改动"的数据流不成立——时间轴数据存 Prisma 不进画布 Yjs store，画布栈唯一剪辑器痕迹是 auto 边（origin 隔离后不入栈）；按澄清写入（编辑器内画布快捷键禁用 + 退出后栈无痕迹 = 完整互斥定义；登记既有 captureTimeout:500 行为）
- **修正后采纳 P0-6**（产物上传）：PUT 预签名确实不存在（MinioService 仅 presigned POST 实测），但不采纳"新增 PUT 依赖"——**改复用现有 presigned POST**（浏览器 FormData，零新依赖零 CORS/policy 改动），confirm 自建按 statObject 实际大小落库
- 采纳 P1 重点：P1-2 工具栏实为 8 按钮（补"裁剪"死按钮处置：维持现状）；P1-3 sourceNodeId 落点（nodeStore.data 挂载随 storeProjection 持久化）；P1-4 跨轨重叠不触发转场；P1-5 变速 PCM 调度前预处理 playbackRate 恒 1（防二次变调）；P1-9 自动保存指数退避重试 + 离线暂停；P1-12 regenerate 服务端直调 execute 不走 HTTP 不带 sv；P1-14 portal 措辞澄清（React 树挂画布根、DOM 经 portal 到 body）
- 采纳 P2 重点：ValidationPipe 非全局（新 controller 自挂 @UsePipes——main.ts 无 useGlobalPipes 实测）；readDocCanvas 返回 sourceId/targetId 与消费方 source/target 口径差异登记；**驳回"CanvasProject.userId 可空导致外键失败"**（VideoProject.userId 取当前操作用户，与画布 userId 无关，已加注释防误读）；A1 同步执行占用 HTTP 连接的超时策略登记
- 验收清单扩至 25 条（新增 20-25：origin 隔离/撤销互斥/A1 无闪烁/存量节点克隆/POST 直传/Socket 单例）

### R7 轮（2026-09-10，v3.4→v3.5，结论"仅剩 1 个 P0，改完可开工；R6 报告 P0-2 自我更正——v3.4 的数据流澄清正确"）

- 采纳 P0-A（唯一阻断）：reconcile 的 store 侧 removeEdge 会触发订阅同步以 LocalUser 删 doc 边（执行顺序靠时序运气）——**订阅路径边处理全部跳过 auto:/auto-out: 前缀**（edgeIds/删除循环/fillDoc 新增分支），auto 边全生命周期只归 syncAutoEdgesToDoc；配套：canvasStore 新增 removeEdge（实测无此方法）、addEdgeById 同 id no-op 断言、编辑器 commit 点接 stopCapturing（防 500ms 合并窗错误并栈）
- 修复 v3.4 引入的内部矛盾 ×2：第三节/附录 B 残留"PUT 预签名"统一为 presigned POST（R6 部分采纳时漏改的两处）；ImageGenNode:936 实测监听 node:edit-result/edit-failed 独立事件（gateway 联合类型含但 service 从未以 node:status 发射）——单例增暴露 subscribeNodeEditResult，防图片 AI 编辑迁移后静默失效；补单例重连重 join 语义
- 采纳 P1×2：快捷键禁用落点改 isGroupEditContext 早退（实测 document keydown 冒泡阶段、stopPropagation 无效；Delete/空格画布层无处理器系虚设，改实测 ReactFlow deleteKeyCode 项；编辑器 open 状态放 stores/ 防反向依赖）；内存预估口径改"音频轨数 + 含音频视频片数"（视频内嵌音轨同样 PCM×2）
- 采纳 P2×6：ValidationPipe 自挂入第三节正文（附录记录不动正文不生效）；readDocCanvas 键名口径注明（edges 以 fillDoc 的 source/target 为准）；A1 同步执行的 axios 超时兜底；addEdgeById no-op；videoEdit 节点显式 width:320（防 fallback 链 300 偏移）；单例 connect/reconnect 重 join
- 验收扩至 28 条（26 auto 边删除路径唯一性/27 快捷键隔离早退/28 图片编辑结果回流）

### R8 轮（2026-09-10，v3.5→v3.6 终版，结论"剩余三项确定性修改，不必再出审核轮次"）

- R7 全部 13 项闭合确认，无回退无表面采纳
- **采纳 P0-A2（孤儿 auto 边，唯一功能缺口）**：deleteNode 级联删边含 auto 边（实测 edges.filter）→ 订阅不认 auto 前缀 → doc 永不删 → 悬空连线；且 reconcile 不会为已删节点跑。修复：**syncAutoEdgesToDoc 改无参幂等全量对账**（auto 边 id 自编码 editNodeId，参数无必要），调用点两处——bindBridge 订阅边变更分支（先 syncAutoEdges 再 syncStoreToDoc）+ 编辑器 reconcile 显式调用；自然覆盖 删节点级联/手删 auto 边/reconcile 全场景
- 文档一致性 ×2：附录 B 步骤 8"25 条"→29、步骤 6"等功率"→线性 equal-gain
- 接受 R7 P2-2 自我降级：topology src/tgt 归一化层实测存在（两种键名都能吃），"照抄会错"软化为风格统一
- 记录两个"看着像问题实际成立"项：白名单真正生效场景为"全部执行/nodeIds 批量"（单节点 getScope 只收上游，已加限定句）；__ephemeral 前端自洽（onRemote 短路→storeProjection 不含→不回写）
- 验收 29 条（新增 29 孤儿 auto 边）
