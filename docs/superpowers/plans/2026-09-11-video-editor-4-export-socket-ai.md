# 视频剪辑器 Plan 4/4：Worker 导出 + 产物上画布 + socket 单例迁移 + AI 三按钮 + 导出前置校验 + 遗留项 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地纯浏览器 MP4 导出全链路（前置校验弹层 → Worker 编码 → 产物登记直传 → 自动上画布），/execution socket 单例化（5 创建点迁移），AI 三按钮（A1 影子节点消费），资产面板全集范围缺口实化（团队素材 + 新建上传），并完成 spec 29 条全量验收。

**Architecture:** spec v3.6（docs/superpowers/specs/video-editor.md）第七节导出管线 + 第四节 AI 按钮/socket 单例 + 第八节护栏 + 附录 B 阶段 7/8 + Plan 3 验收遗留①②③。导出编排为依赖注入 controller（jsdom 可测），Worker 仅 bootstrap + 真实装配（mediabunny Output/CanvasSource/**AudioSampleSource + AudioSample raw f32（R5 决策 8——Web Audio 不进 Worker）** + FSA StreamTarget 优先/BufferTarget 回退）；帧渲染**直接复用** `renderFrameAt`（全注入设计）与 `VideoCacheService`（Worker 独立实例）；混音复用 audio-engine PCM 纯函数群（stretchPcm/buildGainPoints）+ 新增 mixdown 纯函数。socket 单例修复 `node:edit-result` 坏监听历史 bug（见决策 1）。

**Tech Stack:** 既有栈 + mediabunny@1.56.1（写侧 Output/Mp4OutputFormat/CanvasSource/**AudioSampleSource/AudioSample（raw f32——决策 8 R5 勘误）**/BufferTarget/StreamTarget）+ @mediabunny/aac-encoder（registerAacEncoder）+ socket.io-client。全部已装（Plan 1）。

**测试命令：** `pnpm -C apps/web test`（vitest run + tsc -b）；单文件 `pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/export/controller.test.ts`；API `pnpm -C apps/api test`

**本 plan 边界（不做）：** 服务端导出入口/FFmpeg 兜底按钮（spec YAGNI）；产物节点作上游的输入贡献；断点续传；WebM/AV1；多人协作编辑；"设置"控件（spec 已留 TODO）；收起后 fitView 定位（用户拍板省略，见决策 5）；多标签并发（读侧无约束，spec 边界表已登记）。

**关键决策（写代码前必读，含三处用户拍板与两处重大勘误）：**

1. **socket 单例与 `node:edit-result` 坏监听勘误（重大）**：spec v3.5 R7 轮记载"ImageGenNode:936 监听 `node:edit-result`/`node:edit-failed` 独立事件，迁移时必须保留此事件通道"——**实测证伪**：全仓 grep 证实 emit 侧只有 `node:status` 单一事件（execution.gateway.ts L29），`edit-result`/`edit-failed` 是其 **status 字段取值**（ai-image-edit.processor.ts L159-175 以 `emitNodeStatus(projectId, {status:'edit-result', fileId})` 发射）；事件名 `node:edit-result` **从未被任何代码 emit**——ImageGenNode.tsx:946/952 的监听是**永不触发的历史坏监听**（图片 AI 编辑回填现靠轮询兜底等其它路径）。单例的 `subscribeNodeEditResult` 因此**监听 `node:status` 按 status 值分流**——迁移即顺带修复此 bug（spec 验收 28 的落地路径）。另实测 gateway **无 leave handler**（前端 emit 'leave' 是 no-op）——单例卸载只 `disconnect()` 不 emit leave。
2. **A1 影子 fileId 的读取 = 轮询读前端 ydoc（spec"实现必须读 doc"的落地）**：emit 侧时序实测——execution.service 的 done **不带 fileId**（L157-159 仅 `{nodeId,status:'done',credits}`），fileId 由 ai-download.processor **先 writeNodeData 写 doc 再随第二次 done 附带**（L116-122）。前端策略：socket done（第一次/第二次都行）仅作**触发信号**，判完成依据 = 轮询读协作桥 ydoc 影子节点 data（`readNodeFileIdFromDoc(shadowNodeId)`，前端内存 doc 零网络成本，立即探测 + 2s 间隔、120s 超时）——彻底满足 spec"不得以 socket 有无 fileId 判完成"。
3. **「生成音频」按钮置灰 + 登记偏离（用户拍板 2026-09-11，R1 审核 P0-2）**：**核验事实**——execution.service 只有 textInput(:78)/videoGen(:110) 分支，其余一律走 callImageGen 兜底(:167)；api-caller 无 callAudioGen、MODEL_CONFIG 无 audio 项——**audioGen 影子会被当图片生成**（产出 jpg URL→轮询 readNodeFileIdFromDoc 120s 超时假死）。且 audio 片 data 取词链是 `data.content`（非 prompt），原"promptOverride 覆盖"方案对 audio 语义本就不成立。**定案**：按钮渲染但置灰 + Tooltip"音频生成暂未接入，待供应商接入后开放"；spec §4"生成音频"整项与验收 17 的该分支登记偏离（二期实化：需补 callAudioGen + execution 分支 + 真实第三方音频 API）；regenerate 的 promptOverride 后端改动**取消**（其唯一用途是生成音频）。AI 三按钮中"添加字幕"（本地）与"片段重拍"（videoGen 分支真实可用）照做。
4. **导出写盘 = FSA StreamTarget 优先 + BufferTarget 回退（用户拍板 2026-09-11）**：Chromium 下开始导出时 `showSaveFilePicker`（用户手势内）拿 handle 传 Worker（structured clone 支持 FileSystemFileHandle），Worker 内 `createWritable()` 经适配 WritableStream 喂 StreamTarget（产物上传时 `fileHandle.getFile()` 得 File 零内存读回）；不支持 FSA（Firefox/Safari）回退 BufferTarget（finalize 后 `target.buffer` → Blob）。15min 1080p 码流 ≈1.35GB，BufferTarget 为堆内 ArrayBuffer 长工程会超标——FSA 是刚需非优化。
5. **收起编辑器不做 fitView（用户拍板 2026-09-11；spec §7.4 L348 措辞为"可选"——本条为登记性省略非功能缺口）**：产物节点位置在剪辑节点右侧固定偏移可见，toast 足够。**附带登记**：addNode 会把新节点置为 selected 并清空其它选中（canvasStore:203-206 既有行为）——导出后画布选中态被产物节点接管，一期接受。
6. **VideoFrame close 纪律的实形（偏离 spec 字面）**：mediabunny 写侧实测——`CanvasSource.add(timestamp, duration)` 内部从 canvas 抓帧并管理 VideoFrame 生命周期，controller 全程**不直接持有 VideoFrame**（CanvasSink 返回 canvas → drawImage → CanvasSource.add）。spec §九 测试策略 L382 原文"VideoFrame close 次数"落地为等价断言：**controller 无 VideoFrame 创建点**（code review 确认零 `new VideoFrame`）+ 测试断言 `videoTrack.add 恰好 totalFrames 次`。
7. **Worker 复用预览渲染全链（DRY 关键）**：`renderFrameAt(data, t, deps)` 与 `VideoCacheService`/`openMediabunnySink` 均为全注入设计；mediabunny 的动态 `import('mediabunny')` 在 video-cache.ts:165 与 audio-engine/decode.ts:7 内（renderFrameAt 本身无动态 import）——Worker 直接 `new VideoCacheService({ openSink: openMediabunnySink })`（Worker 模块图独立实例，与主线程单例互不干扰）；`CanvasRenderer` 接受任何 2D ctx（Worker 传 `OffscreenCanvasRenderingContext2D as unknown as CanvasRenderingContext2D`，结构兼容登记）。720p = canvas 960×540 + `ctx.scale(0.5, 0.5)`（CANVAS_W/H 常量 1920×1080 逻辑坐标不变）。
8. **Worker 音频装配 = AudioSampleSource + 原始 f32（R5 勘误——原 OfflineAudioContext 方案作废）**：Web Audio API 的 IDL 为 `[Exposed=Window]`（BaseAudioContext/OfflineAudioContext/AudioBuffer 均不暴露 DedicatedWorker）——本机 TS 5.6.3 实证 lib.webworker.d.ts 对 OfflineAudioContext/AudioBuffer **0 命中**（lib.dom 18 命中）。原方案（`new OfflineAudioContext(2,1,48000).createBuffer()` 作 AudioBuffer 工厂 + AudioBufferSource）在 Worker 内**必然 ReferenceError**，且自检在 runInWorker 开头无条件执行——纯视频工程也被连坐，导出整体不可用。**新装配**：混音仍用纯函数（决策 9），写侧换 mediabunny 自有类型——`AudioSampleSource({codec:'aac', bitrate})` + `new AudioSample({ data: Float32Array, format:'f32', numberOfChannels:2, sampleRate, timestamp })`（AudioSampleInit 接受 raw bytes，d.ts :390-403 实证；AudioSample 不依赖 Web Audio，Worker 可用）；controller 契约改为 `audioTrack.add(channels: Float32Array[], sampleRate)`（交织与 ~5s 分块是 Worker 装配侧内部细节，见 Task 8）。**AudioSample 释放方法是 `close()`**（d.ts :342——无 dispose() 命名方法；[Symbol.dispose]() 是调 close() 的语法糖（R8-5 措辞订正），ES2022 lib 下其类型依赖 esnext.disposable 不可用——R6-P1-A）；每块 add 后 `sample.close()`（与决策 6 的 VideoFrame 纪律同源）。原"混音移主线程传 PCM"备选不再需要（本方案零 Web Audio 依赖）。**spec §七 L342 同一假设需勘误**（随完成记录登记）。
9. **mixdown 增益按 128 样本块恒定（性能必要）**：15min 工程 4320 万样本/轨 × 逐样本 `gainValueAt` 折线求值不可行；128 样本（≈2.7ms）块内增益恒定，听感无差（拐点对齐误差 ≤2.7ms）。
10. **导出码率/体积/内存口径定案（实现自定——spec 只给"码率×时长×1.2"公式未给码率数值，登记口径）**：720p 5Mbps / 1080p 12Mbps / AAC 128kbps；体积估算 = (video+audio)/8 × duration × 1.2（spec §7.0）；内存预估 = `duration × 48000 × 2ch × 4B × (音频轨数 + 视频片数) × 3.5`（瞬时 3-4 倍取 3.5，spec §7.1 勘误③口径；视频片是否含音轨不可预知，保守全算）>1GB 警告放行 + `navigator.deviceMemory ≤ 4` 追加低配提示。

11. **取消 = Worker.terminate()**：粗暴可靠（无需 AbortSignal 贯穿 Worker 内部清理；FSA 路径无残留风险——FileSystemWritableFileStream 未 close() 不提交（swap 丢弃），至多留 picker 新建的 0 字节空文件（R8-5 订正原"半文件残留"措辞）；AAC 守卫抛错路径同理无害）。controller 的 AbortSignal 用于 **mock 测试**与主线程协作，真实取消走 terminate（两者并存：terminate 后 promise reject canceled）。
12. **A1 产物入资产面板 = `editorStore.generatedMediaIds`**：A1 done 后 removeShadow 删影子节点——画布上无节点持有该 fileId（useWorkflowAssets 画布池派生不可见）；编辑器记 `generatedMediaIds: string[]` + mergeMediaInfo（done 时经 `batchGetMedia([mediaId])` 补 url/name/durationSec），AssetPanel 在"全集资产"分组后显示"生成结果"分组（与画布产物同款拖拽 payload）。
13. **产物节点命名 = `data.label` + VideoGenNode 标题接线（R1 修正）**：VideoGenNode 标题是组件本地 `useState('Video')`（:326/:345），`data.label` 仅在 :191 分离子节点命名被读——**不接线则"多轨剪辑 · 导出 N"不显示**（spec §7.4 + 验收 12 要求命名可见）。修法：VideoGenNode 标题初始化改 `useState((nodeData as { label?: string } | undefined)?.label ?? 'Video')`（产物节点首渲染 data 即含 label，无需 effect 同步）；位置 = 剪辑节点右侧 `sw + 80 + count×400` 水平排开（count = 同工程已有产物节点数，**nodes 为 Node[] 数组须用 filter 非 Object.values**）；边 = `auto-out:${editId}:${productId}`（addEdge 第五参确定性 id，Plan 2 已实现）。
14. **遗留②③修法（R1 扩充）**：② usePreviewPlayback 暂停态单帧渲染 effect 依赖数组补 `mediaInfo`；③ video-cache openSink 三形态失败路径（resolve null / **reject 直穿**（getFrame open 段补 .catch）/ handle null）全部 warn + 冷却；**+P0-7**：editorStore.setMediaInfo 改保既有 url（TimelinePanel drop 的整条替换会擦 url → 渲染/导出静默黑帧）。
15. **后端配额预检新端点 `POST /api/video-projects/export-precheck`**：`{workflowId, estimatedSize}` → assertEditor + StorageQuotaService.assertCanUpload（不建 Media）——避免编码数分钟后上传 4xx（spec §7.1）。

**R1 审核修订（2026-09-11，用户报告核验后全数采纳）**：P0×7——worker 删 webworker lib（DOM lib 冲突实测 TS6200/2374/2403）；生成音频置灰（决策 3 重写，callAudioGen 不存在实证）；canvasStore.nodes 为 **Node[] 数组**非 Record（product-node 实现与夹具重写）；四组测试断言与实现矛盾修正（体积 1.6GB 非 13.7GB/eta 97.0 非 97.1/controller createOutput 缺失与 mix 进度条数与取消语义/socket join 时序）；video-cache getFrame open 段补 .catch+冷却（openSink reject 直穿实证）；mergeMediaInfo 实为 **Record 形参**（Object.entries 消费）非 entries 数组；TimelinePanel drop 的 setMediaInfo 整条替换**擦掉 url**（黑帧链）。P1×10——Task 9/10 顺序交换（弹层静态 import 产物模块必须后置）；Task 5 后端五处修正（assertEditor 参数序/quota 注入/DTO !/方法级 UsePipes 冗余/apiFetch body 需 stringify）；Task 3 三坑（禁 removeAllListeners/trim·separate 通道保持现状/useSocket.test 随删+useStitchTask 真实路径）；PcmData 实为 **channels 数组**（mixdown/worker 适配）；Worker 硬化（fastStart 显式 false/createWritable 失败回退 Buffer/vite worker.format:'es'）；Task 1 测试重写与验收口径降级（renderLatest in-flight 去重吞同 t 补帧）；MediaInfo 扩 mimeType（生成结果拖拽音频轨被拒）；VideoGenNode 标题本地 state 不读 data.label（产物命名不显示）；团队素材必须进 mediaInfo merge + material files 禁传 type 参数（type='generated' 滤掉 uploaded 实证）；弹层四取值函数落地（loadProject 存 title/projectId）。P2 登记项与"实现自定"措辞修正（生成结果分组/资产面板分组顺序/拖拽 payload/导出按钮预置灰均非 spec 明文）。


**R2 复审修订（2026-09-11，第二轮报告核验后全数采纳——R1 修订经其逐条复核确认 + 两处实机编译验证：worker 骨架去 webworker lib 在真实 tsconfig 下 exit 0、StreamTarget 适配片段在 mediabunny@1.56.1 d.ts 下 exit 0）**：必修四条——N1 renderLatest 尾追判据升级请求代数（同 t 补帧成为保证，消掉 R3 §4.2 旧闭包登记；测试加 act 冲刷）+ Task 13 遗留②口径恢复强保证（N6 统一）；N2 getFrame 补丁不重复声明 entry（外层 :82 遮蔽）；N3 null handle 分支补 warn（三形态失败全有痕迹，用例计数=2 成立）；N4 createWritable 前置 await + 拒绝回退 Buffer（Promise 拒绝原会在 output.start 后才爆）。顺手九条——N5 auto-out 边改用仓库 autoOutEdgeId helper；N7 exportPrecheck 换 NotFoundException + 先鉴权后查库；N8 EditResultPayload 带 nodeId 一次到位（Task 3 免回补）；N9 shadowJob.ts 改名（无 hook）+ PreviewPlayer 残留 state 删除；N10 生成结果 payload 兜底空串（video/mp4 会把音频产物建 video 片）；N11 取值函数改 currentXxx（react-hooks lint）+ precheck 加 empty 错误码；N12 导出中收起行为登记（后台完成语义）；N13 pcmCache 用后清空（混音 PCM 不常驻）；N14 去 CanvasSource/AudioBufferSource 的 as never；N15 UnsupportedEnvError 显式类型替代关键词判定；后端语义——register 配额 400 文案特判"配额在导出期间被占用"。


**R3 三审修订（2026-09-11，第三轮报告核验后全数采纳——R2 修订经其逐条复核确认 + 两处实证：StreamTarget._finalize 自动 close 流（target.js:388-403）→ FSA 路径 getFile() 读到完整文件；quota 超限抛 400 与 batch 字段有据）。修完即可开工，无需第四轮**：必修 R3-1——**FSA 回退静默上传 0 字节产物**（Worker 回退 BufferTarget 后 done 不带标记，主线程仍按句柄读空文件→register actualSize=0→"导出完成"假成功）——done 消息加 `fsa` 标记全链透传（worker/client/ExportModal 按标记择源），删 ExportJobHandle.saveFileHandle 死字段。小修五条：R3-2 测试补 `act` import + Step 5 补 mediaInfo selector（TS2304）+ 去未用 req 变量；R3-3 配额正则补"存储空间不足"（后端实测文案，原正则是死代码）；R3-4 四 getter 归一 `?? ''`（可空透传 TS2345）+ startExport 前置真值守卫；R3-5 生成结果条目 `draggable={Boolean(info?.mimeType)}`（拒绝来源不明资产）；R3-6 pcmCache.clear() 挪 finally + classifyError 保留 NotSupportedError 窄兜底（硬编不可用归 unsupported）。

**R4 四审修订（2026-09-11，第四轮报告核验后全数采纳——10 条断言逐条实机核验成立：usePreviewPlayback.ts:17-19 无 mediaInfo selector、useStitchTask.ts:70 once 在 start() 内闭包 taskId、socket.io-client 4.8.3 socket.d.ts:55-58 SocketReservedEvents 无 reconnect、TimelinePanel.tsx:189-192 drop 形状、video-project.service.ts:87-88 只校验类型、storage.service.ts:20-29 三级回落、file.controller.ts:15-23 透传 teamId、editorStore.ts:132 已存 projectId/sourceNodeId。R3-2 确认半落地——selector 指令本版补全）。P1×3：R4-1 ExportModal 测试被 R3-4 守卫卡死（三 getter 全 '' 静默 return → runJob 用例必红）——beforeEach 补 editorStore.projectId/title + canvasStore.projectId + videoEditorStore.sourceNodeId 三上下文，守卫补 message.warning，配额预检 effect 空守卫早退；R4-2 capabilities 用例在 jsdom 必走短路分支（Node 无 WebCodecs）——独立 describe 内 beforeEach stubGlobal VideoEncoder/AudioEncoder + 新增不 stub 短路用例，删用例 2 代码块与散文矛盾断言（统一 `{video:false,audio:false}`），删 precheck.test 未使用的 createDefaultProjectData import；R4-3 useStitchTask 的 once 注册必须在 start() 内（闭包 taskId/settle，mount effect 编译不过且 once 被任意首事件消耗）——只换 socket 来源为 ensureExecutionSocket（去 .current），注册位置不动。P2×6：R4-4 删 socket.on('reconnect') 坏监听（决策 1 同类问题——重连成功必再触发 connect，测试改断言二次 connect → 再 join）；R4-5 setMediaInfo 保 mimeType（MediaInfo 扩 mimeType 字段**前移 Task 1**）+ TimelinePanel 落轨 setMediaInfo 补 mimeType: payload.mimeType（双保险——否则生成结果拖一次后 draggable 判据失效）；R4-6 watchShadowJob mimeType 用 kind 兜底（batch 失败被容忍路径不再静默不可拖）；R4-7 canRetake 排除 origin='video-edit' 产物节点（后端只校验类型会放行空 prompt 真实生成）+ 配套测试用例；R4-8 Tooltip 内包 `<span className="inline-block">`（Chromium 不对 disabled 控件派发 mouse 事件——验收 17 Tooltip 文案核对依赖）+ 删"新增 Tooltip import"（PreviewPlayer:2 已有）；R4-9 上传/列表团队上下文对齐——presignUpload 传 projectId（后端解析画布 teamId + assertMember）+ useTeamAssets 请求带 teamId query（editorStore.teamId，loadProject 顺手存——byNode 返回整行含 teamId）+ useTeamAssets 测试补 teamId 透传用例。P3 顺手：loadProject 措辞修正（真实缺口 title+teamId 两字段，projectId/sourceNodeId :132 已有——避免误导执行者）；AssetPanel setUploading 声明补全 + uploading 态按钮防重复；AssetPanel.test 顶部 axios mock（防 useTeamAssets 挂载真 XHR）；readNodeFileIdFromDoc 改 instanceof Y.Map 守卫（doc 形状已实证，删"若 data 是 JSON 值"兜底注释）；worker finally 补 blobCache.clear()（源文件 blob 用后即弃）+ 内存口径登记（estimateMemoryBytes 只算 PCM，源文件 blob 峰值另计，Worker terminate 有界）；detectExportCapabilities 主线程 polyfill 注册注明（Worker 内注册自己的副本，幂等）；estimateSizeBytes 720p 断言改数值字面量 46_152_000（复刻实现公式是同义反复）；ExportModal 配额预检补请求序号守卫（切档竞态）+ 用例 1 按钮断言包 waitFor（caps 落地前 not.toBeDisabled 有竞态）。

**R5 五审修订（2026-09-11，第五轮报告核验后全数采纳——16 条断言逐条实机核验成立，其中 P0 为四轮均漏的规范级错误）。P0（决策 8 重写）：Worker 内 OfflineAudioContext/AudioBuffer **高置信不可用**——Web Audio IDL `[Exposed=Window]`，本机 TS 5.6.3 实证 lib.webworker.d.ts 对两者 **0 命中**（lib.dom 18 命中）；原方案自检在 runInWorker 开头无条件执行 → Worker 内必 ReferenceError → **纯视频工程也被连坐成 unsupported（导出整体不可用）**。定案换装配（不再依赖 spike 定论——证据链已闭合）：`AudioSampleSource({codec:'aac',bitrate})` + `new AudioSample({data: interleaved-f32, format:'f32', numberOfChannels:2, sampleRate, timestamp(秒)})`（AudioSampleInit d.ts :390-403 实证接受 raw bytes；AudioSample 不依赖 Web Audio）；controller 契约改 `audioTrack.add(channels: Float32Array[], sampleRate)`（Task 7 一次调用语义不变，交织/5s 分块是 Task 8 装配侧内部）；createAudioBuffer 依赖删除；原"混音移主线程"备选不再需要；spec §七 L342 同一假设随完成记录勘误登记。P1×6：① ExportCapsDeps 宽签名 `(c: string, o?: object)` strictFunctionTypes 参数逆变 TS2322（报告 scratch 复现）——改 `Pick<typeof import('mediabunny'), 'canEncodeVideo'|'canEncodeAudio'>`；② useStitchTask.test.ts:11 mock useSocket——Task 3 删模块后必红，Files 补该测试改造（mock executionSocket，轮询/竞态用例保留）；③ Worker done 消息 buffer 未走 transfer list——15min 1080p ≈1.6GB structured clone 复制直接顶爆内存，post 辅助函数加 transfer 参、done 传 `[buffer]` 零拷贝转移；④ watchShadowJob 悬挂——regenerate HTTP 响应晚于 execute 内首次 done（execution.service.ts:157-159 实证），订阅必错过首个信号，download job 失败时无第二次 done → 永挂——重构为进入即启动 pollFileId（决策 2 彻底化：doc 轮询是唯一完成判据，socket 仅贡献 error 提前失败，done 不再消费），测试用例语义同步；⑤ useTeamAssets 的 getState().teamId 非响应式——AssetPanel 挂载早于 loadProject 异步回写 → 恒请求默认团队，改 selector 订阅 + teamId 进 effect deps + 新增 null→实值二次请求用例；⑥ precheck 无法识别"id 存在但 url 缺失"（batch 失败容忍/团队素材 url 空）→ Worker 静默黑帧却"导出成功"——runPrecheck 第二参从 Set 改 `mediaUrls: Record<string, string|undefined>`，新增 missing-url 错误码（与 missing-media 互斥），ExportModal 调用处适配 + 用例补。P2×8：setMediaInfo 合并规则扩 durationSec（drop payload 可 undefined——擦掉后 addClip 兜 5s，editorStore:170 实证）；AssetPanel:18 全集资产 merge 补 `mimeType: i.mimeType`（AssetItem extends BatchMediaItem 含该字段——画布产物 mimeType 源头补全）；useTeamAssets 补 `import { useEditorStore }`（load 内消费 store，无 import TS2304）；VideoNodeToolbar 用例 fn 未声明补 `const fn = vi.fn()`；EditorTopBar 导出按钮四处占位残留一起清（disabled/title/cursor-not-allowed/opacity-50——:22-23 实证，只删 disabled 会"可点但显示禁用"）；ExportModal 三小修（失败提示 class 多余 `]` 语法错、beforeunload 补 `e.returnValue = ''`（Chromium 确认框要求）、detectExportCapabilities 补 `.catch(() => setCaps({video:false,audio:false}))` 防 chunk 加载失败永久禁用无提示）；重拍"可替换"语义一期口径登记（人工拖替——Task 13 Step 3 边界④）；组件旧 socket 生命周期用例点名删除（AudioGenNode.test:250 connect on mount、VideoGenNode.test:306、**:338 reconnect 用例在验证坏监听**、disconnect on unmount 一并删——迁移后行为不存在，只换 mock 不删断言必红）。

**R6 六审修订（2026-09-11，第六轮报告核验后全数采纳——两条必修均实机坐实：mediabunny d.ts :342 只有 close() 无 dispose()；mockResolvedValue 对同步函数返回 thenable 恒 truthy。R5 方向性结论全数复核确认，无需第七轮）。必修 P1-A：Task 8 `sample.dispose()` → `sample.close()`（AudioSample 无 dispose 方法——TS2339 scratch 复现；Symbol.dispose 类型依赖 esnext.disposable 不可用；决策 8/Task 8 注释同步）。必修 P1-B：shadowJob 测试 `mockResolvedValue(Once)` → `mockReturnValue(Once)`（readNodeFileIdFromDoc 同步返回 string|null，thenable 被 `if (fid)` 当已命中——用例 1 假通过、用例 2 readDoc 调用数必红；此缺陷 R1 时代即存在、R6 揭发）；用例 1 删无效 fire done 行、用例 2 的 fire done 保留为"干扰输入被忽略"的负路径实证。P2×3：① regenerate 早失败透传——后端返回 { shadowNodeId, result }（:98 实证）而 wrapper 只回 shadowNodeId，execute 的 error 在 HTTP 往返内已 emit（订阅必错过）→ 早失败干等 120s——regenerateNode 带出 result + watchShadowJob 第 4 参 initial（success=false 立即 throw）+ PreviewPlayer 接线 + 配套用例；② useTeamAssets teamId 切换双 in-flight 过期响应竞态——reqRef 序号守卫（then/catch/finally 三处）；③ Worker 内 AAC polyfill 注册后复测仍 false → 抛 UnsupportedEnvError 归 unsupported（polyfill 依赖子 Worker + WASM + AudioData，主线程检测通过不代表 Worker 内可用——否则落到 output.start() 才爆成 unknown）+ Task 13 验收表加 native/polyfill 双分支真实编码冒烟条目。P3×3：pollFileId 的 finish/off 互相引用改 let off 占位先行；Task 11 Step 2 标题更新（进入即轮询）；Task 3 mock 模板 ensureExecutionSocket 返回带 once/off 的 fake（空对象会 TS2339）。

**R7 七审修订（2026-09-11，第七轮报告核验后采纳——R6 全数复核确认 + 关键实证加分：registerEncoder 对 CustomAudioEncoder 分支执行 canEncodeAudioMemo.clear()（custom-coder.js:119）、AacEncoder.supports 要求数字 bitrate 且 _toAudioBitrate 原值带回——polyfill 注册后复测必为 true，R6-P2-3 守卫无误杀）。P2×2：① AAC 守卫下沉 hasAudio 分支——原守卫在 runInWorker 装配段无条件执行，polyfill 因嵌套子 Worker/CSP 失败时**纯视频工程被连坐成 unsupported**（与 R5-P0 批判的原方案同构错误）——createOutput 契约改 async（Task 7 接口/runExport await/测试 mock.results 适配三处），守卫移至 AudioSampleSource 创建点（mixdown 返回 null 即不检测不注册不失败，错误文案改"音频编码不可用"）；不取"装配段 mayHaveAudio 预判"的零契约替代——那要在 Worker 侧镜像 mixdown 的 audible 过滤谓词，两处判断会漂移。② Task 13 AAC 冒烟手段订正——`--disable-blink-features=WebCodecs` **连 VideoEncoder 一起禁**（precheck encoder-video 即拦，导出走不完，原手段作废）——native 分支冒烟**提前至 Task 8 Step 6**（console 直驱 runExportJob 真实带音轨素材，打包/嵌套 Worker/AAC 装配问题早 10 个任务暴露）；polyfill 分支登记为发布前人工验证项（开发机 Chromium native AAC 恒可用、无法复现 native-false；dev 强制开关否决——mediabunny 编码器选择顺序不保证可强制且引入临时代码；守卫序列由 Task 4 capabilities.test 同款"注册→复测→仍 false 抛"逻辑单测佐证）。P3×4 顺手：PreviewPlayer onOk 补 try/catch + message.error（antd confirm onOk reject 只停 loading 无提示）+ projectId 非空断言改守卫；Task 11 用例 2 fake timers 包 try/finally（失败不污染后续用例）；Task 1 测试骨架占位注释强化（`/* 按现签名 */` 必须落成真实组件否则 TS2554）；完成判定用例计数刷新（shadowJob 4/AI 按钮 5/teamAssets 4/上传 1，总数 65+）。P3 不改登记：watchShadowJob 先 running 后 downloading 两连 set——React 18 同步自动批处理单次渲染、无 UI 闪烁，且 running 初值已被 Step 1 用例断言固化，保持现状。

**R8 八审修订（2026-09-11，第八轮报告核验后采纳——R4-R7 共 40 余条全数落地核实通过；收敛曲线 R4:10→R5:16→R6:8→R7:6→R8:4。三条关键断言本轮实机坐实：AudioSampleSource.add(audioSample) 单参返回 Promise（media-source.d.ts:211，doc 明说 resolves once ready to receive more samples）——await add + finally close 是官方生命周期；AudioSampleInit 字段名逐一吻合（sample.d.ts:447-460）、{codec:'aac',bitrate} 运行时合法（encode.js:182-195 仅 quality 与 bitrate 双缺才抛，deprecated bitrate 经 resolveQuality 归一）；file.controller @Query('teamId')+resolveTeamId 回落默认团队实证——Task 12 的 teamId 拼接非装饰）。R8-1（P1）：ExportModal 用例 2 断言 /素材缺失/ 与实现文案"素材 m1 缺失或未加载"两词不相邻永不匹配（R1 起漏网七版的"断言与实现矛盾"同类）→ 改 /缺失或未加载/ + toBeDisabled 包 waitFor（caps 未落地时按钮天然禁用防假绿）。R8-2（P2，实际为编译阻断）：VideoProjectDto 无 teamId 字段——Shell 传 p.teamId 直接 TS2339（不止类型悬空）→ Task 10 Files 补 DTO `teamId: string`（运行时 getByNode 回 Prisma 整行恒含）。R8-3（P2 登记）：重拍 regenerate 的 HTTP 响应等整轮生成结束（execution await :97）——生成段进度由 confirm loading 承载、网络层失败（生产网关超时截断等）影子不可回收残留（__ephemeral 不渲染不扣费，ydoc 留垃圾）→ 一期 Task 13 Step 3 边界⑤登记 + 二期候选"前端预生成 shadowNodeId（RegenerateDto 可选参数）"入后续节；execute 的 provider 异常 emit error + success:false 已实证——R6-P2-1 initial 早失败价值不受影响。R8-4（P3）：mergeMediaInfo 既有键合并从只补 url 扩三字段对齐（与 setMediaInfo 对称——"面板刷新补字段"对 mimeType/durationSec 同样成立，watchShadowJob 的 batch 失败容忍路径靠此回填）。R8-5（P3×6）：决策 11 FSA 措辞订正（FileSystemWritableFileStream 未 close() 不提交、至多留 0 字节空文件——原"半文件残留"不成立）；决策 8 措辞精确化（"无 dispose() 命名方法；[Symbol.dispose]() 是调 close() 的语法糖"）；precheck.test 删未用 EXPORT_BITRATES import；Task 12 useEffect 补 eslint 抑制注释；useTeamAssets 删无消费者 reload（AssetPanel 经 teamKey→refreshKey 触发重拉）；VideoEditorShell 补 useState 具名导入提醒。

**执行期勘误（2026-09-11，Task 8 真实冒烟发现——R1-R8 八轮均漏的规范级错误，读侧与 R5-P0 写侧同构）**：Task 8 的 resolvePcm 原注入 `decodeMediaPcm`（AudioBufferSink 版）——**AudioBufferSink 产出 Web Audio 的 AudioBuffer（[Exposed=Window]，Worker 内 ReferenceError: AudioBuffer is not defined）**，decodeMediaPcm 的 catch 吞错返 null → mixdown anyMixed=false → **导出产物静默无音轨（视频正常、两段进度正常、done 正常——最恶劣的静默失败形态）**。冒烟实证链：Worker 内 fetch 三素材全成功 → decodeMediaPcm 全 null → 临时 catch→throw 后 error 通道现形。R5-P0 只勘误了写侧（AudioBufferSource→AudioSampleSource），读侧 AudioBufferSink 同依赖被遗漏。修复（commit 1dbf0589）：decode.ts 新增 `decodeMediaPcmRaw`（**AudioSampleSink** + `sink.samples(0)` 迭代 + 逐 sample `copyTo(dst, {planeIndex: ch, format: 'f32-planar'})` + finally `s.close()` 资源纪律 + merge/resamplePcm 同构），worker.ts resolvePcm 切换之；主线程预览继续用 decodeMediaPcm（AudioBufferSink 版喂 Web Audio）。复验：产物 tracks = video(avc) + **audio(aac)** 双轨（修复前仅 avc）、体积 +268KB 音频数据、duration 16.5s、960×540。**教训登记：同类 [Exposed=Window] 审计今后必须读写两侧对称**。

## 文件结构总览

```
apps/web/src/
├── services/
│   └── executionSocket.ts              # [新] /execution 单例（Task 2）
├── stores/
│   ├── canvasCollabRuntime.ts          # [改] +readNodeFileIdFromDoc 导出（Task 11）
│   └── canvasStore.ts                  # [改] 无（addEdge/removeEdge 已就绪，仅消费）
├── api/videoProjectApi.ts              # [改] +regenerate/removeShadow/registerGenerated/confirmGenerated/exportPrecheck（Task 5）
├── pages/canvas/
│   ├── page.tsx                        # [改] socket ensure/teardown + 删 useSocket（Task 3）
│   ├── hooks/useStitchTask.ts          # [改] 迁单例 once 监听（Task 3）
│   ├── components/nodes/
│   │   ├── AudioGenNode.tsx            # [改] socket 迁移（Task 3）
│   │   ├── ImageGenNode.tsx            # [改] socket 迁移 ×2 处（Task 3，936 处含坏监听修复）
│   │   ├── VideoGenNode.tsx            # [改] socket 迁移 + productMode 传参（Task 3/10）
│   │   └── VideoNodeToolbar.tsx        # [改] productMode 隐藏四按钮（Task 10）
│   └── video-editor/
│       ├── capabilities.ts             # [改] +detectExportCapabilities（Task 4）
│       ├── audio-engine/
│       │   └── mixdown.ts              # [新] 全时间线混音纯函数（Task 6）
│       ├── export/
│       │   ├── precheck.ts             # [新] 前置校验/体积/内存估算纯函数（Task 4）
│       │   ├── eta.ts                  # [新] ETA 纯函数（Task 4）
│       │   ├── controller.ts           # [新] 导出编排（依赖注入，Task 7）
│       │   ├── worker.ts               # [新] Worker bootstrap + 真实装配（Task 8）
│       │   ├── client.ts               # [新] 主线程 client + terminate 取消（Task 8）
│       │   ├── upload.ts               # [新] 登记-直传-确认三步（Task 9）
│       │   └── product-node.ts         # [新] 产物上画布（Task 9）
│       ├── components/
│       │   ├── ExportModal.tsx         # [新] 导出弹层（选档/校验/进度/失败）（Task 10）
│       │   ├── EditorTopBar.tsx        # [改] 导出按钮接线（Task 9）
│       │   ├── PreviewPlayer.tsx       # [改] AI 三按钮（Task 11）
│       │   └── AssetPanel.tsx          # [改] 团队素材分组 + 生成结果分组 + 新建上传（Task 11/12）
│       ├── hooks/
│       │   ├── usePreviewPlayback.ts   # [改] 遗留② mediaInfo 依赖（Task 1）
│       │   └── shadowJob.ts            # [新] A1 影子状态机纯函数（Task 11，无 hook——R2-N9 改名）
│       ├── renderer/video-cache.ts     # [改] 遗留③ console.warn（Task 1）
│       └── store/editorStore.ts        # [改] shadowJobs/generatedMediaIds（Task 11）
apps/api/src/modules/video-project/
├── video-project.controller.ts         # [改] +export-precheck 路由（Task 5）
├── video-project.service.ts            # [改] +exportPrecheck + quota 注入（Task 5）
└── video-project.dto.ts                # [改] +ExportPrecheckDto（Task 5）
```

---

### Task 1: 遗留②③ + url 保护——暂停态补帧、openSink 诊断痕迹、setMediaInfo 不擦 url

**Files:**
- Modify: `apps/web/src/pages/canvas/video-editor/hooks/usePreviewPlayback.ts`
- Modify: `apps/web/src/pages/canvas/video-editor/renderer/video-cache.ts`
- Modify: `apps/web/src/pages/canvas/video-editor/store/editorStore.ts`（setMediaInfo 保 url）
- Test: `apps/web/src/pages/canvas/video-editor/hooks/usePreviewPlayback.test.ts`（**新建**——R1 核实该文件现不存在）
- Test: `apps/web/src/pages/canvas/video-editor/renderer/video-cache.test.ts`（追加）
- Test: `apps/web/src/pages/canvas/video-editor/store/editorStore.test.ts`（追加 setMediaInfo 回归）
- Modify: `apps/web/src/pages/canvas/video-editor/store/editorStore.ts`（**另：MediaInfo 扩 `mimeType?: string` 字段——R4 从 Task 11 前移**，本 Task 的 mimeType 保护断言依赖该字段先存在）

- [x] **Step 1: 写失败测试（遗留②）**

新建 usePreviewPlayback.test.ts——**测试策略（R1 修订）**：不真渲染 canvas（jsdom 无解码），`vi.mock('../renderer/render-frame')` 断言 renderFrameAt 调用次数；canvas getContext/createImageBitmap stub 先例抄 PreviewPlayer.test.tsx:109-126：

```ts
// apps/web/src/pages/canvas/video-editor/hooks/usePreviewPlayback.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const renderFrameAt = vi.fn(async () => {});
vi.mock('../renderer/render-frame', () => ({ renderFrameAt: (...a: unknown[]) => renderFrameAt(...a) }));

import { usePreviewPlayback } from './usePreviewPlayback';
import { useEditorStore } from '../store/editorStore';

// harness：render(<canvas ref>) 或按 hook 现签名传参（现码 usePreviewPlayback.ts:23-46 是纯形参——
// 按实形包一层测试组件把 canvasRef 接到 <canvas>，getContext stub 返回伪 2d ctx：
// HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ fillRect: vi.fn(), drawImage: vi.fn(), ... }))
// R7-P3：下方 renderHook(() => usePreviewPlayback(/* 按现签名 */)) 是骨架占位——执行时必须落成真实测试组件
// 与真实参数（占位原样保留必 TS2554），本注释与占位不可原样带入实现）

const imageClip = (id: string, mediaId: string, duration: number) => ({
  id, trackId: 'tv', type: 'image' as const, start: 0, duration, mediaId,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});

beforeEach(() => {
  renderFrameAt.mockClear();
  useEditorStore.setState({
    status: 'ready', playing: false, playhead: 0,
    data: { version: 1, fps: 30, tracks: [{ id: 'tv', type: 'video', name: 'v', muted: false, hidden: false, clips: ['a'] }], clips: { a: imageClip('a', 'mi', 5) } },
    mediaInfo: { mi: { name: 'i', durationSec: 5 } }, // 无 url
  } as never);
});

it('遗留②：暂停态 mediaInfo 变化（url 回填）触发补帧渲染', async () => {
  const { rerender } = renderHook(() => usePreviewPlayback(/* 按现签名 */));
  expect(renderFrameAt).toHaveBeenCalledTimes(1); // 首帧（无 url 也渲——层跳过在 render-frame 内部）
  await act(async () => {}); // R2-N1：冲刷首个 mock promise——否则 pendingRef=true 期间 setState 被去重吞掉（确定性红非 flaky）
  useEditorStore.setState((s) => ({ mediaInfo: { ...s.mediaInfo, mi: { name: 'i', durationSec: 5, url: 'http://x/i.png' } } }) as never);
  rerender();
  await act(async () => {});
  expect(renderFrameAt).toHaveBeenCalledTimes(2); // mediaInfo 进 deps + 代数尾追（Step 5 renderLatest 升级）→ 补帧
});
```

**验收口径（R2-N1② 后恢复强保证）**：本 Task 同时把 renderLatest 的尾追判据从"仅比 t"升级为"比请求代数"（见 Step 5）——同 t 的 mediaInfo 变化也保证补帧（顺带消掉 R3 §4.2 登记的"尾追闭包旧 data"低危项）。Task 13 验收按强口径："url 回填后无需任何后续操作即出画"。

- [x] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/hooks/usePreviewPlayback.test.ts
```
预期：FAIL（effect 依赖 `[playing, playhead, data, canvasRef]` 不含 mediaInfo，第 2 次 renderFrameAt 不发生）。

- [x] **Step 3: 写失败测试（遗留③ + P0-5：getFrame open 段 reject 直穿）**

video-cache.test.ts 追加：

```ts
it('遗留③：openSink 失败三形态（resolve null / reject / null handle）均返回 null + console.warn + 进冷却（R1：open 段 reject 原直穿）', async () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  let now = 0;
  // ① openSink resolve null（无视频轨/打开失败分支）
  const svc1 = new VideoCacheService({ openSink: async () => null, now: () => now });
  expect(await svc1.getFrame('m1', 'http://x', 0)).toBeNull();
  // ② openSink reject（403 等）——R1 核实：getFrame 的 `await opening` 无 catch，reject 直穿 getFrame
  const svc2 = new VideoCacheService({ openSink: async () => { throw new Error('403'); }, now: () => now });
  expect(await svc2.getFrame('m2', 'http://x', 0)).toBeNull(); // 修复前：本行 rejects
  // 冷却生效：2s 内重开被冷却跳过（仍 null 且无第二次 open）
  now += 1000;
  expect(await svc2.getFrame('m2', 'http://x', 0)).toBeNull();
  expect(warnSpy.mock.calls.filter((a) => String(a[0]).includes('[video-cache]')).length).toBeGreaterThanOrEqual(2);
  warnSpy.mockRestore();
});
```

- [x] **Step 4: 写失败测试（P0-7：setMediaInfo 整条替换擦 url/mimeType）**

editorStore.test.ts 追加（**这是 Task 9/12 的前提**——drop 回调 setMediaInfo 无 url 会擦掉既有 url，渲染 getMediaUrl undefined → 静默黑帧，导出 mediaUrls 缺项；R4-5：mimeType 同被擦 → 生成结果条目 `draggable={Boolean(info?.mimeType)}` 拖一次后永久失效）：

```ts
it('P0-7：setMediaInfo 整条替换不擦既有 url/mimeType/durationSec（drop 回调 payload 字段不全场景）', () => {
  const s = useEditorStore.getState();
  s.setMediaInfo('m1', { name: 'a', durationSec: 3, url: 'http://old', mimeType: 'video/mp4' });
  s.setMediaInfo('m1', { name: 'a', durationSec: undefined }); // TimelinePanel.tsx:189-192 drop 形状（无 url/mimeType，durationSec 可 undefined）
  const kept = useEditorStore.getState().mediaInfo['m1'];
  expect(kept.url).toBe('http://old'); // 修复前 undefined
  expect(kept.mimeType).toBe('video/mp4'); // R4-5：修复前 undefined
  expect(kept.durationSec).toBe(3); // R5-P2-1：修复前 undefined → addClip 兜 5s
});
```

- [x] **Step 5: 实现五处修改**

usePreviewPlayback.ts 两处——① 暂停态单帧渲染 effect 依赖补 `mediaInfo`（**R4：现码 :17-19 只 select playing/playhead/data 三项，effect 在 :39-46——必须先补 selector 声明**，否则 deps 塞未声明标识符 = TS2304；`!data`/`!canvasRef`/`getContext` 守卫全部保留）：

```ts
const mediaInfo = useEditorStore(s => s.mediaInfo); // R4：selector 声明（:19 data 之后追加）——无此声明 deps 塞 mediaInfo 编译不过
// ...
// deps 追加 mediaInfo（遗留②自愈）；effect 体与守卫原样不动
}, [playing, playhead, data, mediaInfo, canvasRef]); // eslint-disable-line react-hooks/exhaustive-deps —— 现文件若已有该注释保留
```

② **renderLatest 尾追判据升级为请求代数（R2-N1②）**——替换现码 :20-34 的 renderLatest（保留 pendingRef 声明、删 latestTRef）：

```ts
const pendingRef = useRef(false);
const reqRef = useRef(0);
const latestRef = useRef<{ deps: FrameRenderDeps; d: ProjectData; t: number } | null>(null);

const renderLatest = (deps: FrameRenderDeps, d: ProjectData, t: number): void => {
  ++reqRef.current; // R3-2：自增值直接作废旧请求，无需具名 req 变量
  latestRef.current = { deps, d, t }; // 同 t 的 mediaInfo 变化也触发代数 +1（R2-N1：仅比 t 会吞同 t 补帧）
  if (pendingRef.current) return;
  const run = (): void => {
    pendingRef.current = true;
    const at = reqRef.current;
    const cur = latestRef.current!;
    renderFrameAt(cur.d, cur.t, cur.deps).catch(() => {}).finally(() => {
      pendingRef.current = false;
      if (reqRef.current !== at) run(); // 期间有新请求（含同 t）→ 以最新 deps/data 补渲（消掉 R3 §4.2 旧闭包登记）
    });
  };
  run();
};
```

video-cache.ts 三处——① `getFrame` 的 open 段 reject 处理（**R2-N2：只包赋值不重新声明 entry**——外层 :82 已有 `let entry = this.entries.get(mediaId)`）：

```ts
// P0-5：openSink reject 不再直穿 getFrame——转 null + warn + 冷却（与 R5 handle===null 路径同款待遇，
// 否则注入坏 openSink 时 rAF 30-60 次/秒重开风暴——冷却限频是 warn 不刷屏的前提）
try {
  entry = (await opening) ?? undefined;
} catch (err) {
  console.warn('[video-cache] openSink 失败:', mediaId, err);
  this.retryAfter.set(mediaId, this.now() + RETRY_COOLDOWN_MS);
  return null;
}
```

② `getFrame` 的 `.then` 内 `if (!handle)` 分支（R5 冷却路径 :88-92）补 warn（R2-N3——兑现"所有 openSink 失败路径至少一行痕迹"，使 Step 3 用例 warn 计数 = 2 成立）：

```ts
if (!handle) {
  console.warn('[video-cache] openSink 失败（null handle）:', mediaId); // R2-N3
  this.retryAfter.set(mediaId, this.now() + RETRY_COOLDOWN_MS);
  return null; // 以现码该分支原形为准——warn 插在 return 前，冷却逻辑原样
}
```

③ `openMediabunnySink`（L162 起）两处静默 return null 前补 warn（无视频轨分支 `console.warn('[video-cache] openSink 失败（无视频轨）:', url)`；catch 分支 `console.warn('[video-cache] openSink 失败:', url, err)`）。

editorStore.ts——setMediaInfo 保既有 url 与 mimeType（P0-7 + R4-5），**MediaInfo 接口扩 `mimeType?: string`**（R4 从 Task 11 前移至此——本测试依赖字段先存在）：

```ts
export interface MediaInfo { name: string; durationSec: number | undefined; url?: string; mimeType?: string; }
// ...
// R5-P2-1：durationSec 同保——drop payload 的 durationSec 可为 undefined（生成结果 info?.durationSec），
// 整条替换会把已有值擦掉 → addClip 兜底 5s（editorStore:170）时长错
setMediaInfo: (mediaId, info) => set((s) => ({
  mediaInfo: { ...s.mediaInfo, [mediaId]: {
    ...info,
    url: info.url ?? s.mediaInfo[mediaId]?.url,
    mimeType: info.mimeType ?? s.mediaInfo[mediaId]?.mimeType,
    durationSec: info.durationSec ?? s.mediaInfo[mediaId]?.durationSec,
  } },
})),
```

**R8-4 顺带同文件**：mergeMediaInfo 的既有键合并规则从只补 url 扩为三字段对齐（与 setMediaInfo 对称——"面板刷新补字段"对 mimeType/durationSec 同样成立；watchShadowJob 的 batch 失败容忍路径"详情后续面板刷新再补"正是靠此回填）：

```ts
mergeMediaInfo: (entries) => set((s) => {
  const next = { ...s.mediaInfo };
  for (const [id, info] of Object.entries(entries)) {
    next[id] = next[id]
      ? { ...next[id], url: next[id].url ?? info.url, mimeType: next[id].mimeType ?? info.mimeType, durationSec: next[id].durationSec ?? info.durationSec }
      : info;
  }
  return { mediaInfo: next };
}),
```

- [x] **Step 6: 跑测试确认通过 + 全量回归 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/hooks/usePreviewPlayback.test.ts src/pages/canvas/video-editor/renderer/video-cache.test.ts src/pages/canvas/video-editor/store/editorStore.test.ts && pnpm -C apps/web exec tsc -b
git add apps/web/src && git commit -m "fix(video-editor): 遗留②③+url保护——mediaInfo 补帧依赖/openSink 三形态诊断与冷却/setMediaInfo 不擦 url（TDD）"
```

**登记（本 Task 不修）**：VideoEditNode 节点本体迷你播放（:103-140）是 url 回填缺图的同型第二现场——其 mediaUrls 经 loadMediaUrls 现查、tick 每帧重读 mediaUrlsRef（Plan 3 R4 修复），url 到达后自然出画，无持续性问题；若浏览器验收发现首帧缺图不补，按本 Task 同款 deps 思路补修。

---

### Task 2: /execution socket 单例服务

**Files:**
- Create: `apps/web/src/services/executionSocket.ts`
- Test: `apps/web/src/services/executionSocket.test.ts`

- [x] **Step 1: 写失败测试**

```ts
// apps/web/src/services/executionSocket.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const listeners = new Map<string, Set<(data: unknown) => void>>();
const emitSpy = vi.fn();
const disconnectSpy = vi.fn();
const fakeSocket = {
  connected: false,
  on: vi.fn((ev: string, fn: (data: unknown) => void) => {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev)!.add(fn);
  }),
  emit: emitSpy,
  disconnect: disconnectSpy,
};
const ioSpy = vi.fn(() => fakeSocket);

vi.mock('socket.io-client', () => ({ io: ioSpy }));

// 模块级单例状态——每用例前重置模块注册表
beforeEach(() => {
  vi.resetModules();
  listeners.clear();
  emitSpy.mockClear();
  disconnectSpy.mockClear();
  ioSpy.mockClear();
  fakeSocket.connected = false;
});
afterEach(async () => {
  const { teardownExecutionSocket } = await import('./executionSocket');
  teardownExecutionSocket();
});

const fire = (ev: string, data: unknown) => listeners.get(ev)?.forEach((fn) => fn(data));

describe('executionSocket 单例服务', () => {
  it('两次 ensure 同一 Socket 实例（io 只调用一次）', async () => {
    const { ensureExecutionSocket } = await import('./executionSocket');
    const a = ensureExecutionSocket('p1');
    const b = ensureExecutionSocket('p1');
    expect(ioSpy).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('connect 后 join 当前 workflowId；重连（再次 connect）重 join（R4-4：socket 级无 reconnect 事件——SocketReservedEvents 仅 connect/connect_error/disconnect，重连成功即再次 connect）', async () => {
    const { ensureExecutionSocket } = await import('./executionSocket');
    ensureExecutionSocket('p1'); // 未连接 → 不立即 emit
    expect(emitSpy).not.toHaveBeenCalled();
    fire('connect', undefined); // 连接建立 → joinCurrent
    expect(emitSpy).toHaveBeenCalledWith('join', 'p1');
    emitSpy.mockClear();
    fire('connect', undefined); // R4-4：断线重连成功 → connect 再触发 → 重 join（真实契约）
    expect(emitSpy).toHaveBeenCalledWith('join', 'p1');
  });

  it('subscribeNodeStatus 全量分发并返回退订函数', async () => {
    const { ensureExecutionSocket, subscribeNodeStatus } = await import('./executionSocket');
    ensureExecutionSocket('p1');
    const seen: string[] = [];
    const off = subscribeNodeStatus((p) => seen.push(p.nodeId));
    fire('node:status', { nodeId: 'n1', status: 'done' });
    off();
    fire('node:status', { nodeId: 'n2', status: 'done' });
    expect(seen).toEqual(['n1']);
  });

  it('决策 1 勘误：edit-result/edit-failed 经 node:status status 值分流到 subscribeNodeEditResult（payload 含 nodeId——R2-N8）', async () => {
    const { ensureExecutionSocket, subscribeNodeEditResult } = await import('./executionSocket');
    ensureExecutionSocket('p1');
    const seen: { nodeId: string; failed: boolean }[] = [];
    subscribeNodeEditResult((p) => seen.push({ nodeId: p.nodeId, failed: p.failed }));
    fire('node:status', { nodeId: 'n1', status: 'edit-result', fileId: 'f1' });
    fire('node:status', { nodeId: 'n2', status: 'edit-failed', error: 'boom' });
    expect(seen).toEqual([{ nodeId: 'n1', failed: false }, { nodeId: 'n2', failed: true }]);
  });

  it('payload.credits 转发 window credits:update（CanvasTopBar 消费，5 创建点转发逻辑统一收编）', async () => {
    const { ensureExecutionSocket } = await import('./executionSocket');
    ensureExecutionSocket('p1');
    const handler = vi.fn();
    window.addEventListener('credits:update', handler);
    fire('node:status', { nodeId: 'n1', status: 'done', credits: { credits: 1, subscriptionCredits: 2, total: 3 } });
    window.removeEventListener('credits:update', handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ credits: 1, subscriptionCredits: 2, total: 3 });
  });

  it('teardown disconnect 且下次 ensure 重建', async () => {
    const { ensureExecutionSocket, teardownExecutionSocket } = await import('./executionSocket');
    ensureExecutionSocket('p1');
    teardownExecutionSocket();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    ensureExecutionSocket('p1');
    expect(ioSpy).toHaveBeenCalledTimes(2);
  });
});
```

- [x] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/web exec vitest run src/services/executionSocket.test.ts
```
预期：FAIL（模块不存在）。

- [x] **Step 3: 实现单例服务**

```ts
// apps/web/src/services/executionSocket.ts
import { io, type Socket } from 'socket.io-client';

/** gateway emitNodeStatus 的 payload 实形（execution.gateway.ts L21-30 实测） */
export interface NodeStatusPayload {
  nodeId: string;
  status: 'loading' | 'done' | 'error' | 'edit-result' | 'edit-failed';
  resultUrl?: string;
  fileId?: string;
  error?: string;
  credits?: { credits: number; subscriptionCredits: number; total: number };
}
export interface EditResultPayload { nodeId: string; fileId?: string; error?: string; failed: boolean; } // R2-N8：nodeId 一次到位（Task 3 迁移需按节点过滤）

let socket: Socket | null = null;
let joinedProjectId: string | null = null;
const statusHandlers = new Set<(p: NodeStatusPayload) => void>();
const editResultHandlers = new Set<(p: EditResultPayload) => void>();

function joinCurrent(s: Socket): void {
  if (joinedProjectId) s.emit('join', joinedProjectId);
}

/** 全画布共享一个 /execution Socket（spec 第四节）。生命周期挂画布 page（mount ensure / unmount teardown）；
 *  节点组件只 subscribe 不建连。gateway 无 leave handler（实测）——卸载只 disconnect。 */
export function ensureExecutionSocket(projectId: string): Socket {
  if (!socket) {
    socket = io('/execution', { transports: ['websocket', 'polling'] });
    // R4-4：socket.io-client 4.x Socket 级无 'reconnect' 事件（那是 Manager 事件——socket.d.ts SocketReservedEvents 仅
    // connect/connect_error/disconnect）；重连成功必再触发 connect → joinCurrent 天然覆盖重连重 join，勿加坏监听
    socket.on('connect', () => joinCurrent(socket!));
    socket.on('node:status', (data: NodeStatusPayload) => {
      // 决策 1 勘误：edit-result/edit-failed 是 status 值非事件名——统一在此分流（修复 ImageGenNode 坏监听）
      if (data.status === 'edit-result' || data.status === 'edit-failed') {
        for (const h of editResultHandlers) h({ nodeId: data.nodeId, fileId: data.fileId, error: data.error, failed: data.status === 'edit-failed' });
      }
      for (const h of statusHandlers) h(data);
      if (data.credits) window.dispatchEvent(new CustomEvent('credits:update', { detail: data.credits }));
    });
  }
  if (projectId && projectId !== joinedProjectId) {
    joinedProjectId = projectId;
    if (socket.connected) socket.emit('join', projectId);
  }
  return socket;
}

export function teardownExecutionSocket(): void {
  socket?.disconnect();
  socket = null;
  joinedProjectId = null;
}

/** 统一监听 node:status（调用方按 payload.nodeId 自行过滤——编辑器据此按 shadowNodeId 分发，spec A1 契约） */
export function subscribeNodeStatus(handler: (p: NodeStatusPayload) => void): () => void {
  statusHandlers.add(handler);
  return () => { statusHandlers.delete(handler); };
}

/** 图片 AI 编辑回填通道（spec 验收 28）——内部按 status 值分流 */
export function subscribeNodeEditResult(handler: (p: EditResultPayload) => void): () => void {
  editResultHandlers.add(handler);
  return () => { editResultHandlers.delete(handler); };
}
```

- [x] **Step 4: 跑测试确认通过 + 提交**

```bash
pnpm -C apps/web exec vitest run src/services/executionSocket.test.ts && pnpm -C apps/web exec tsc -b
git add apps/web/src/services && git commit -m "feat(video-editor): /execution socket 模块级单例——subscribeNodeStatus/EditResult + credits 统一转发（TDD）"
```

---

### Task 3: 5 创建点迁移到单例

**Files:**
- Modify: `apps/web/src/pages/canvas/page.tsx`（L209 附近 useSocket 调用改 ensure/teardown）
- Modify: `apps/web/src/hooks/useStitchTask.ts`（**真实路径在 src/hooks/ 非 pages/canvas/hooks/**——L9 useSocket 改单例 once 监听）
- Delete: `apps/web/src/hooks/useSocket.ts` + Delete: `apps/web/src/hooks/useSocket.test.ts`（**测试文件随删**——消费者全迁后 grep 零残留再删）
- Modify: `apps/web/src/pages/canvas/components/nodes/AudioGenNode.tsx`（L54 起 socket effect）
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`（L337 与 L936 两处）
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx`（L349 起）
- Modify: `apps/web/src/hooks/useStitchTask.test.ts`（**R5-P1-2：现码 L11 `vi.mock('@/hooks/useSocket')`——useSocket.ts 删除后 mock 目标消失必红**；改造为 mock `@/services/executionSocket` 的 `ensureExecutionSocket` 返回带 `once/off` 的 fake Socket，轮询兜底/双路径竞态用例逻辑保留）
- Test: 上述组件的既有测试文件（socket.io-client mock 改为 executionSocket mock）

- [x] **Step 1: 迁移节点组件（以 VideoGenNode 为模板，其余同构）**

VideoGenNode.tsx L348-396 现状（自建 io + join + node:status + credits 转发 + cleanup leave）整体替换为：

```ts
// 删除：const socketRef = useRef<Socket | null>(null) 与整个 io() 创建 effect
// 保留组件内原有 status/fileId 处理逻辑，改为订阅单例：
useEffect(() => {
  const off = subscribeNodeStatus((data) => {
    if (data.nodeId !== id) return;
    // ——以下为该组件原有处理逻辑，原样保留——
    if (data.status === 'loading') setStatus('loading');
    else if (data.status === 'done') {
      setStatus('done');
      if (data.fileId) setFileResult(id, data.fileId);
      else if (data.resultUrl) setVideoResult?.(id, data.resultUrl); // 按现码实际字段调用核对
    } else if (data.status === 'error') setStatus('error');
    // credits 转发已由单例统一做（决策 1/Task 2）——组件内 dispatchEvent 删除
  });
  return off;
}, [id]);
```

**执行注意**：① 各组件原处理逻辑以现码为准逐行保留（本块为结构模板，`setVideoResult` 等以实际函数名为准）；② `import { subscribeNodeStatus } from '@/services/executionSocket'`；③ 组件不再需要 `io`/`Socket` import（`socket.io-client` import 删除——tsc noUnusedLocals 若无则按 CLAUDE.md 精准修改清孤儿）。

ImageGenNode.tsx **L936 处（editMode）特殊**——现状监听 `node:edit-result`/`node:edit-failed` 独立事件名（坏监听，决策 1），迁移为：

```ts
useEffect(() => {
  const off = subscribeNodeEditResult((p) => {
    if (p.nodeId !== id) return; // R2-N8：payload 带 nodeId，按节点过滤
    if (p.failed) {
      // 原 node:edit-failed 分支逻辑（editError 置位等，以现码为准）
    } else if (p.fileId) {
      // 原 node:edit-result 分支逻辑（回填 fileId 退出编辑态，以现码为准）
    }
  });
  return off;
}, [/* 现有依赖 */]);
```

**注意**：subscribeNodeEditResult 的 payload 已带 `nodeId`（R2-N8：Task 2 一次到位）——迁移时按 `p.nodeId !== id` 早退过滤（与 subscribeNodeStatus 同款写法）。

**三个真坑（R1 审核登记，迁移必读）**：

1. **禁止对单例调用 removeAllListeners**——单例共享后任一组件卸载若沿用现状的 `socket.removeAllListeners()` 会清掉**其它组件**的 handler（含 useStitchTask 的 once 监听）。迁移后组件退订**只用 subscribe 返回的 off 函数**（Task 2 的 Set 精确退订）；全仓 grep 确认迁移后无对单例 socket 实例的 removeAllListeners 调用。
2. **VideoGenNode 的 trim/separate socket 通道**——~~原判"socketRef.current 恒 null 一直走轮询，传 null 等价"~~ **执行期勘误（spec 审查发现 2）**：原 socketRef.current 并非恒 null——mount effect 赋值后，触发 trim/separate 任务的 re-render 传入的是**真 socket**，快路径（video-separate:status/video-trim:status 推送 + 10s 轮询兜底）实际生效过；传 null 会退化为 3s 纯轮询（行为退化）。落地修正：`taskSocket = projectId ? ensureExecutionSocket(projectId) : null` 接回单例（useAsyncMediaTask 内部精确 on/off，不破坏单例其它 handler）——commit 2d7bcaa0。
3. **useSocket.test.ts 随 useSocket.ts 一起删**（Files 已列）；删除前跑全量确认无 import 残留。

- [x] **Step 2: 迁移 page.tsx 与 useStitchTask**

page.tsx（L209 附近）：

```ts
// 删：const socketRef = useSocket(projectId)（及其 import）
// 加（与 projectId 同 effect）：
useEffect(() => {
  if (!projectId) return;
  ensureExecutionSocket(projectId);
  return () => teardownExecutionSocket();
}, [projectId]);
```

useStitchTask.ts（L9/L70）——**R4-3：once 注册必须保持在 start() 内部**（回调闭包 taskId 与 settle，mount effect 位置两者不在作用域直接编译不过；且 mount 级 once 会被任意首个 stitch 事件消耗，第二次 start 起永久失去 socket 快路径退化到 5s 轮询）。只换 socket 来源，注册位置不动：

```ts
// L9 删：const socket = useSocket(projectId)（返回 MutableRefObject<Socket|null>）——替换为：
import { ensureExecutionSocket } from '@/services/executionSocket';
// start() 内 createStitchTask 之后（原 :70 位置原样，仅 .current 取值去掉——ensure 直接返回 Socket 实例）：
const socket = ensureExecutionSocket(projectId);
socket.once('storyboard:stitch:completed', (evt: any) => {
  if (evt.taskId !== taskId) return; // 原逻辑原样（taskId 闭包在 start 作用域）
  // ... settle 分支原样 ...
});
// useCallback deps：删 socket 项（projectId 派生），保留 [projectId, spawnResultNode]
// 注：once 消耗型 + settle 的 done 保护——超时/轮询结算路径下未触发的 once 残留至下次命中（evt.taskId 不匹配早退），与现状行为一致，不新增清理
```

删除 `apps/web/src/hooks/useSocket.ts`（确认全仓 grep `useSocket` 零残留后）。

- [x] **Step 3: 组件测试适配**

各组件既有测试中 `vi.mock('socket.io-client', ...)` 改为：

```ts
vi.mock('@/services/executionSocket', () => {
  const handlers = new Set<(p: unknown) => void>();
  return {
    subscribeNodeStatus: (h: (p: unknown) => void) => { handlers.add(h); return () => handlers.delete(h); },
    subscribeNodeEditResult: vi.fn(() => () => {}),
    ensureExecutionSocket: vi.fn(() => ({ once: vi.fn(), off: vi.fn() })), // R6-P3：useStitchTask 经 ensure 拿实例调 once——空对象会 TS2339/运行时崩
    teardownExecutionSocket: vi.fn(),
  };
});
// 测试内触发：handlers 需暴露——用 vi.hoisted 或模块级变量按文件既有 mock 风格组织
```

以各测试文件现存的触发辅助（emit fake）等价改造。ImageGenNode 编辑态测试若存在事件触发路径，改经 subscribeNodeEditResult handler 触发（原 `socket.emit('node:edit-result')` 形态已不可达——本来就是坏监听，测试大概率 mock 的是独立事件名，一并修正为 status 值分流）。

**R5-P2：旧 socket 生命周期用例点名删除**——这些断言绑在"组件自建 io"行为上，迁移后行为不存在，保留必红（不要只换 mock 文件）：AudioGenNode.test.tsx:250 `should connect to socket.io on mount`、VideoGenNode.test.tsx:306 `connect on mount and join project room`、**VideoGenNode.test.tsx:338 `re-join room on socket reconnect`（:340-347 手动 fire 'reconnect'——R4-4 已定 reconnect 是 Socket 级不存在的事件，此用例在验证坏监听）**。同文件若还有 `disconnect on unmount` 用例一并删（单例生命周期归 page.tsx，Task 2 的 executionSocket.test 已覆盖）。

- [x] **Step 4: 全量回归 + 提交**

```bash
pnpm -C apps/web test && pnpm -C apps/web exec tsc -b
git add -A && git commit -m "refactor(video-editor): /execution 5 创建点迁移单例——含 ImageGenNode edit-result 坏监听修复（nodeId 透传）"
```

---

### Task 4: capabilities 导出检测 + precheck/eta 纯函数

**Files:**
- Modify: `apps/web/src/pages/canvas/video-editor/capabilities.ts`
- Create: `apps/web/src/pages/canvas/video-editor/export/precheck.ts`
- Create: `apps/web/src/pages/canvas/video-editor/export/eta.ts`
- Test: `capabilities.test.ts`（扩）、`export/precheck.test.ts`、`export/eta.test.ts`

- [x] **Step 1: 写 precheck 失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/export/precheck.test.ts
import { describe, it, expect } from 'vitest';
import { estimateSizeBytes, estimateMemoryBytes, runPrecheck } from './precheck'; // R8-5：原稿误入未用的 EXPORT_BITRATES 已删
import type { ProjectData, VideoClip, AudioClip, SubtitleClip } from '../types';

const vc = (id: string, mediaId: string, start: number, duration: number, trackId = 't-video'): VideoClip => ({
  id, trackId, type: 'video', start, duration, sourceStart: 0, mediaId, playbackSpeed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});
const ac = (id: string, mediaId: string, start: number, duration: number, trackId = 't-audio1'): AudioClip => ({
  id, trackId, type: 'audio', start, duration, sourceStart: 0, mediaId,
  volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [],
});
const mk = (clips: (VideoClip | AudioClip | SubtitleClip)[], tracks: { id: string; type: 'video' | 'subtitle' | 'audio' }[]): ProjectData => ({
  version: 1, fps: 30,
  tracks: tracks.map((t) => ({ id: t.id, type: t.type, name: t.id, muted: false, hidden: false, clips: clips.filter((c) => c.trackId === t.id).map((c) => c.id) })),
  clips: Object.fromEntries(clips.map((c) => [c.id, c])),
});

describe('estimateSizeBytes（码率×时长×1.2）', () => {
  it('720p 60s ≈ 46.15MB（R4：数值字面量钉子——复刻实现公式是同义反复）', () => {
    expect(estimateSizeBytes('720p', 60)).toBe(46_152_000); // (5M+128k)/8×60×1.2
  });
  it('1080p 900s（15min 上限）≈ 1.64GB 口径仅数值断言', () => {
    expect(estimateSizeBytes('1080p', 900)).toBeGreaterThan(1.5 * 1024 ** 3); // (12.128M/8)×900×1.2 ≈ 1.64GB
  });
});

describe('estimateMemoryBytes（345.6MB/轨口径按实际时长线性 × 3.5 瞬时）', () => {
  it('900s 单视频片无音频轨 = 345.6MB × 1 × 3.5', () => {
    const data = mk([vc('v', 'm1', 0, 900)], [{ id: 't-video', type: 'video' }]);
    expect(estimateMemoryBytes(data, 900)).toBe(Math.round(900 * 48000 * 2 * 4 * 1 * 3.5));
  });
  it('音频轨数与视频片数都计入（视频内嵌音轨保守全算）', () => {
    const data = mk([vc('v', 'm1', 0, 10), ac('a', 'm2', 0, 10)], [{ id: 't-video', type: 'video' }, { id: 't-audio1', type: 'audio' }]);
    expect(estimateMemoryBytes(data, 10)).toBe(Math.round(10 * 48000 * 2 * 4 * 2 * 3.5));
  });
});

describe('runPrecheck', () => {
  const okEncoder = { video: true, audio: true };
  // R5-P1-6：第二参是 mediaUrls Record（id→url）——Set 时代结束
  const urls = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, `http://x/${id}`]));
  it('时长 >15min 拦截（errors 含 duration）', () => {
    const data = mk([vc('v', 'm1', 0, 901)], [{ id: 't-video', type: 'video' }]);
    const r = runPrecheck(data, urls('m1'), okEncoder);
    expect(r.errors.some((e) => e.code === 'duration')).toBe(true);
  });
  it('mediaId 不在已知媒体集 → missing-media（素材缺失拦截导出，spec §7.1）', () => {
    const data = mk([vc('v', 'ghost', 0, 5)], [{ id: 't-video', type: 'video' }]);
    const r = runPrecheck(data, urls('other'), okEncoder);
    expect(r.errors.some((e) => e.code === 'missing-media')).toBe(true);
  });
  it('R5-P1-6：id 存在但 url 空 → missing-url（防导出黑帧却"成功"）', () => {
    const data = mk([vc('v', 'm1', 0, 5)], [{ id: 't-video', type: 'video' }]);
    const r = runPrecheck(data, { m1: '' }, okEncoder);
    expect(r.errors.some((e) => e.code === 'missing-url')).toBe(true);
    expect(r.errors.some((e) => e.code === 'missing-media')).toBe(false); // 两者互斥——id 在
  });
  it('字幕片无 mediaId 不参与缺失检查', () => {
    const sub = { id: 's', trackId: 't-sub', type: 'subtitle', start: 0, duration: 3, text: 'x', visible: true, style: { fontSize: 48, color: '#FFF', letterSpacing: 0 } } as SubtitleClip;
    const data = mk([sub], [{ id: 't-sub', type: 'subtitle' }]);
    expect(runPrecheck(data, {}, okEncoder).errors).toHaveLength(0);
  });
  it('编码器不支持 → encoder-video / encoder-audio 错误', () => {
    const data = mk([vc('v', 'm1', 0, 5)], [{ id: 't-video', type: 'video' }]);
    expect(runPrecheck(data, urls('m1'), { video: false, audio: true }).errors.some((e) => e.code === 'encoder-video')).toBe(true);
    expect(runPrecheck(data, urls('m1'), { video: true, audio: false }).errors.some((e) => e.code === 'encoder-audio')).toBe(true);
  });
  it('内存 >1GB 警告但不算错误（放行）', () => {
    const data = mk([vc('v', 'm1', 0, 900), vc('v2', 'm2', 0, 900), ac('a', 'm3', 0, 900)], [{ id: 't-video', type: 'video' }, { id: 't-audio1', type: 'audio' }]);
    const r = runPrecheck(data, urls('m1', 'm2', 'm3'), okEncoder);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings.some((w) => w.code === 'memory')).toBe(true);
  });
});
```

- [x] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/export/precheck.test.ts
```
预期：FAIL（模块不存在）。

- [x] **Step 3: 实现 precheck.ts**

```ts
// apps/web/src/pages/canvas/video-editor/export/precheck.ts
import type { ProjectData } from '../types';
import { totalDuration } from '../timeline/timecode';

export const EXPORT_BITRATES = {
  '720p': { video: 5_000_000, audio: 128_000 },
  '1080p': { video: 12_000_000, audio: 128_000 },
} as const;
export type ExportResolution = keyof typeof EXPORT_BITRATES;

export const MAX_EXPORT_DURATION_SEC = 900; // spec §7.1：15 分钟上限
export const MEMORY_WARN_BYTES = 1024 ** 3; // >1GB 警告放行

export function estimateSizeBytes(resolution: ExportResolution, durationSec: number): number {
  const { video, audio } = EXPORT_BITRATES[resolution];
  return Math.round(((video + audio) / 8) * durationSec * 1.2); // spec §7.0：码率×时长×1.2
}

/** spec §7.1 勘误③口径：48kHz 立体声 float32 × (音频轨数 + 视频片数) × 3.5 瞬时系数（视频内嵌音轨保守全算） */
export function estimateMemoryBytes(data: ProjectData, durationSec: number): number {
  let audioTracks = 0;
  for (const t of data.tracks) if (t.type === 'audio') audioTracks++;
  let videoClips = 0;
  for (const c of Object.values(data.clips)) if (c.type === 'video') videoClips++;
  return Math.round(durationSec * 48_000 * 2 * 4 * (audioTracks + videoClips) * 3.5);
}

export type PrecheckError =
  | { code: 'empty'; message: string }
  | { code: 'duration'; message: string }
  | { code: 'missing-media'; message: string }
  | { code: 'missing-url'; message: string }
  | { code: 'encoder-video'; message: string }
  | { code: 'encoder-audio'; message: string };
export type PrecheckWarning = { code: 'memory'; message: string };

/** R5-P1-6：第二参从 knownMediaIds（Set）改为 mediaUrls（Record<mediaId, url|undefined>）——
 *  只查 id 会放行"条目存在但 url 缺失"（batch 失败容忍/团队素材 url 空/历史条目），
 *  Worker 端 renderFrameAt 对无 url 静默 continue → 导出黑帧却"成功"，绕过 spec §7.1 拦截本意。 */
export function runPrecheck(
  data: ProjectData,
  mediaUrls: Record<string, string | undefined>,
  encoder: { video: boolean; audio: boolean },
): { errors: PrecheckError[]; warnings: PrecheckWarning[]; durationSec: number; memoryEstimateBytes: number } {
  const errors: PrecheckError[] = [];
  const warnings: PrecheckWarning[] = [];
  const durationSec = totalDuration(data);
  if (durationSec <= 0) errors.push({ code: 'empty', message: '空工程不可导出——请先添加素材片段' }); // R2-N11：前置拦截（原放行到 runExport 才抛）
  if (durationSec > MAX_EXPORT_DURATION_SEC) {
    errors.push({ code: 'duration', message: `总时长 ${Math.round(durationSec)}s 超过 15 分钟上限` });
  }
  for (const c of Object.values(data.clips)) {
    if (c.type === 'subtitle') continue; // 字幕无 mediaId
    const url = mediaUrls[c.mediaId];
    if (url === undefined) errors.push({ code: 'missing-media', message: `素材 ${c.mediaId} 缺失或未加载（上游已删除？）` });
    else if (!url) errors.push({ code: 'missing-url', message: `素材 ${c.mediaId} 的下载地址缺失（详情未就绪？稍后重开面板刷新）` }); // R5-P1-6
  }
  if (!encoder.video) errors.push({ code: 'encoder-video', message: '当前浏览器不支持 H.264 视频编码，请使用最新 Chrome/Edge' });
  if (!encoder.audio) errors.push({ code: 'encoder-audio', message: '当前浏览器不支持 AAC 音频编码（含 polyfill）' });
  const memoryEstimateBytes = estimateMemoryBytes(data, durationSec);
  if (memoryEstimateBytes > MEMORY_WARN_BYTES) {
    warnings.push({ code: 'memory', message: `预计内存峰值约 ${(memoryEstimateBytes / 1024 ** 3).toFixed(1)}GB，可能影响稳定性，建议降 720p 或缩短工程` });
  }
  return { errors, warnings, durationSec, memoryEstimateBytes };
}
```

- [x] **Step 4: 写 eta 失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/export/eta.test.ts
import { describe, it, expect } from 'vitest';
import { createEtaTracker } from './eta';

describe('createEtaTracker（前 30 帧外推 + 每 500 帧滚动修正）', () => {
  it('不足 30 帧无 ETA（null）', () => {
    let now = 0;
    const t = createEtaTracker(1000, () => now);
    t.observe(0); now = 50; t.observe(10);
    expect(t.etaSec()).toBeNull();
  });
  it('第 30 帧（index 29）首次外推：10fps → 剩 970 帧 = 97.0s', () => {
    let now = 0;
    const t = createEtaTracker(1000, () => now);
    t.observe(0);
    now = 2900; // 29 帧 2.9s → 10 帧/s
    t.observe(29);
    expect(t.etaSec()).toBeCloseTo(970 / 10, 1); // (1000-1-29)/10 = 97.0
  });
  it('每 500 帧滚动修正：速率骤升 → ETA 随最新窗口下降', () => {
    let now = 0;
    const t = createEtaTracker(10000, () => now);
    t.observe(0);
    now = 2900; t.observe(29);        // 首 30 帧 2.9s → 10fps → eta1 = 9970 帧 / 10fps = 997s
    const eta1 = t.etaSec()!;
    now += 500_000; t.observe(5499);  // 滚动窗 5470 帧 / 500s ≈ 10.94fps → eta2 = 4500/10.94 ≈ 411.5s
    const eta2 = t.etaSec()!;
    now += 100; t.observe(9999);      // 滚动窗 4500 帧 / 0.1s → 速率极快 → eta3 = 0
    const eta3 = t.etaSec()!;
    expect(eta1).toBeCloseTo(997, 0);
    expect(eta2).toBeGreaterThan(300);
    expect(eta3).toBeLessThan(eta2);
    expect(eta3).toBe(0);
  });
});
```

- [x] **Step 5: 实现 eta.ts**

```ts
// apps/web/src/pages/canvas/video-editor/export/eta.ts
const FIRST_SAMPLE = 29;   // 前 30 帧试编码测速外推（spec §7.5）
const ROLLING_EVERY = 500; // 每 500 帧滚动修正（跨 GOP seek 成本不同，首测偏不准）

export interface EtaTracker { observe(frameIndex: number): void; etaSec(): number | null; }

export function createEtaTracker(totalFrames: number, nowMs: () => number = () => performance.now()): EtaTracker {
  let lastFrame = -1;
  let rate = 0; // 帧/ms
  let windowStart = 0;
  let windowStartFrame = 0;
  return {
    observe(frameIndex: number): void {
      if (frameIndex <= lastFrame) return;
      if (lastFrame < 0) { windowStart = nowMs(); windowStartFrame = 0; lastFrame = frameIndex; return; }
      lastFrame = frameIndex;
      if (frameIndex === FIRST_SAMPLE || (frameIndex > FIRST_SAMPLE && frameIndex % ROLLING_EVERY === FIRST_SAMPLE % ROLLING_EVERY + 1 || frameIndex % ROLLING_EVERY === 499)) {
        // 首测（index 29）+ 之后每 500 帧（index 499, 999, ...）重测滚动窗口
        const t = nowMs();
        const dt = Math.max(1, t - windowStart);
        rate = (frameIndex - windowStartFrame) / dt;
        windowStart = t;
        windowStartFrame = frameIndex;
      }
    },
    etaSec(): number | null {
      if (rate <= 0) return null;
      return ((totalFrames - 1 - lastFrame) / rate) / 1000;
    },
  };
}
```

**注意**：上面 observe 的修正条件表达式有冗余（首稿笔误风格），实现时写干净：

```ts
observe(frameIndex: number): void {
  if (frameIndex <= lastFrame) return;
  if (lastFrame < 0) { windowStart = nowMs(); windowStartFrame = 0; lastFrame = frameIndex; return; }
  lastFrame = frameIndex;
  const isSample = frameIndex === FIRST_SAMPLE || frameIndex % ROLLING_EVERY === ROLLING_EVERY - 1;
  if (isSample) {
    const t = nowMs();
    rate = (frameIndex - windowStartFrame) / Math.max(1, t - windowStart);
    windowStart = t;
    windowStartFrame = frameIndex;
  }
},
```

（测试中 5499 % 500 === 499 ✓、10499 % 500 === 499 ✓）

- [x] **Step 6: capabilities 扩展（失败测试 → 实现）**

capabilities.test.ts 追加（**R4-2：jsdom/Node 无 WebCodecs 全局——实现首行 `typeof VideoEncoder === 'undefined' && typeof AudioEncoder === 'undefined'` 短路分支必中，用例 1 若不 stubGlobal 必红**。文件既有 describe 用 stubGlobal 检测的是 VideoDecoder/AudioDecoder（解码侧）与新用例互不干扰——新用例写**独立 describe 块**，钩子作用域内聚）：

```ts
describe('detectExportCapabilities（导出编码器检测）', () => {
  beforeEach(() => {
    vi.stubGlobal('VideoEncoder', class {}); // 绕过短路分支——mock deps 才能被消费
    vi.stubGlobal('AudioEncoder', class {});
  });
  afterEach(() => vi.unstubAllGlobals());

it('detectExportCapabilities：mediabunny canEncodeVideo(avc, 1080p 码率) + AAC 检测→polyfill 注册→复测', async () => {
  const canEncodeVideo = vi.fn().mockResolvedValue(true);
  const canEncodeAudio = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const registerAacEncoder = vi.fn();
  const r = await detectExportCapabilities({
    loadMediabunny: async () => ({ canEncodeVideo, canEncodeAudio }) as never,
    loadAacPolyfill: async () => ({ registerAacEncoder }) as never,
  });
  expect(r).toEqual({ video: true, audio: true });
  expect(canEncodeVideo).toHaveBeenCalledWith('avc', expect.objectContaining({ width: 1920, height: 1080 }));
  expect(registerAacEncoder).toHaveBeenCalledTimes(1); // 缺失时静态 polyfill（spec 边界表）
});

it('polyfill 注册后复测仍 false → { video: false, audio: false }（注册不改变结论）', async () => {
  const canEncodeVideo = vi.fn().mockResolvedValue(false);
  const canEncodeAudio = vi.fn().mockResolvedValue(false);
  const registerAacEncoder = vi.fn();
  const r = await detectExportCapabilities({
    loadMediabunny: async () => ({ canEncodeVideo, canEncodeAudio }) as never,
    loadAacPolyfill: async () => ({ registerAacEncoder }) as never,
  });
  expect(r).toEqual({ video: false, audio: false }); // R4-2：代码块与散文一致——注册后仍 false 保持 false
  expect(registerAacEncoder).toHaveBeenCalledTimes(1);
});

it('WebCodecs 全无（不 stub）→ 首行短路 { video: false, audio: false }，deps 不被消费', async () => {
  vi.unstubAllGlobals(); // 本用例内撤销 stub——短路分支专属
  const loadMediabunny = vi.fn();
  const r = await detectExportCapabilities({ loadMediabunny, loadAacPolyfill: vi.fn() });
  expect(r).toEqual({ video: false, audio: false });
  expect(loadMediabunny).not.toHaveBeenCalled();
});
});
```

capabilities.ts 追加：

```ts
export interface ExportCapabilities { video: boolean; audio: boolean; }
export interface ExportCapsDeps {
  // R5-P1-1：宽签名 (c: string, o?: object) 在 strictFunctionTypes 下接收不了真实 mediabunny 函数
  // （其 codec 参数是 'avc'|'hevc'|... 字面量联合——参数逆变 TS2322，scratch 已复现）——直接 Pick 真实模块类型
  loadMediabunny: () => Promise<Pick<typeof import('mediabunny'), 'canEncodeVideo' | 'canEncodeAudio'>>;
  loadAacPolyfill: () => Promise<{ registerAacEncoder: () => void }>;
}
/** 导出弹层打开时检测（spec §8 能力分层：编码器检测推迟到点导出）。真实 config：1080p avc + 48k 立体声 AAC。
 *  R4 登记：本函数在主线程注册 AAC polyfill（拉起一个常驻 worker）作探针复测——无功能问题；
 *  Worker 内（Task 8）会注册自己的副本，两处注册幂等不冲突。 */
export async function detectExportCapabilities(deps: ExportCapsDeps = {
  loadMediabunny: () => import('mediabunny'),
  loadAacPolyfill: () => import('@mediabunny/aac-encoder'),
}): Promise<ExportCapabilities> {
  if (typeof VideoEncoder === 'undefined' && typeof AudioEncoder === 'undefined') return { video: false, audio: false };
  const mb = await deps.loadMediabunny();
  const video = await mb.canEncodeVideo('avc', { width: 1920, height: 1080, bitrate: 12_000_000 }).catch(() => false);
  let audio = await mb.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48_000, bitrate: 128_000 }).catch(() => false);
  if (!audio) {
    // AAC 静默动态 polyfill（spec 边界表；注册后复测）
    (await deps.loadAacPolyfill()).registerAacEncoder();
    audio = await mb.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48_000, bitrate: 128_000 }).catch(() => false);
  }
  return { video: Boolean(video), audio: Boolean(audio) };
}
```

- [x] **Step 7: 跑测试 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/export/ src/pages/canvas/video-editor/capabilities.test.ts && pnpm -C apps/web exec tsc -b
git add apps/web/src && git commit -m "feat(video-editor): 导出前置校验纯函数（时长/缺失/编码/内存预估）+ ETA 滚动修正 + 导出能力检测（TDD）"
```

---

### Task 5: 后端 export-precheck 端点 + 前端 API 封装

**Files:**
- Modify: `apps/api/src/modules/video-project/video-project.dto.ts`（新建 ExportPrecheckDto）
- Modify: `apps/api/src/modules/video-project/video-project.service.ts`（新增 exportPrecheck；**constructor 加 `@Inject(StorageQuotaService)` 注入**——现有构造仅 prisma/perm/collab/execution :10-15）
- Modify: `apps/api/src/modules/video-project/video-project.controller.ts`（+POST export-precheck）
- Modify: `apps/api/src/modules/video-project/video-project.service.spec.ts` **与** `video-project.regenerate.spec.ts`（构造处补 quota mock——Files 漏列会连带红）
- Create: `apps/api/src/modules/video-project/video-project.precheck.spec.ts`
- Modify: `apps/web/src/api/videoProjectApi.ts`

**R1 修订说明**：原 promptOverride 后端改动**取消**（决策 3 置灰定案——生成音频不落地）。regenerate/removeShadow/generated-media register/confirm 四端点 Plan 1 已存在，本 Task **仅前端包装** + 新增 exportPrecheck。

- [x] **Step 1: 写后端失败测试**

video-project.precheck.spec.ts（新建，mock prisma/perm/quota 与既有 spec 同款；**注意 assertEditor 真实签名是 `(projectId, userId)` 参数序**——project-permission.service.ts:31，服务内 6 处既有调用均 workflowId 在前）：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
// 按 video-project.service 既有 spec 的 mock 夹具组织（canvasProject 查询、permAssertEditor、StorageQuotaService）
describe('exportPrecheck', () => {
  it('配额充足 → { ok: true }，不建任何 Media', async () => {
    quotaMock.assertCanUpload.mockResolvedValue(undefined);
    const r = await service.exportPrecheck(userId, { workflowId, estimatedSize: 1024 });
    expect(r).toEqual({ ok: true });
    expect(prismaMock.media.create).not.toHaveBeenCalled();
    expect(quotaMock.assertCanUpload).toHaveBeenCalledWith(expect.any(String), 1024);
  });
  it('配额不足 → 抛原异常（HTTP 层转 4xx）', async () => {
    quotaMock.assertCanUpload.mockRejectedValue(new Error('存储配额不足'));
    await expect(service.exportPrecheck(userId, { workflowId, estimatedSize: 1024 })).rejects.toThrow('存储配额不足');
  });
});
```

- [x] **Step 2: 确认失败**

```bash
pnpm -C apps/api exec vitest run src/modules/video-project/video-project.precheck.spec.ts src/modules/video-project/video-project.service.spec.ts
```
预期：FAIL（exportPrecheck 不存在）。

- [x] **Step 3: 实现后端**

video-project.dto.ts：

```ts
export class ExportPrecheckDto {
  @IsString() workflowId!: string;
  @IsNumber() estimatedSize!: number; // 前端估算体积（estimateSizeBytes）——strict 模式字段需 !
}
```

video-project.service.ts——**constructor 注入 StorageQuotaService**（现有构造仅 prisma/perm/collab/execution :10-15）：

```ts
constructor(
  // ... 现有四个注入保持不变 ...
  @Inject(StorageQuotaService) private readonly quota: StorageQuotaService,
) {}
// StorageQuotaService 来自 modules/team/storage-quota.service（generated-media.service 同款引用抄）；
// 模块 imports 若未导出该 provider，按 generated-media 所在 module 的引法补。
```

新增方法：

```ts
/** 导出前置配额预检（spec §7.1：编码数分钟前拦截，避免上传时 4xx）——不建 Media */
async exportPrecheck(userId: string, dto: { workflowId: string; estimatedSize: number }): Promise<{ ok: true }> {
  // R2-N7：先鉴权再查库（仓内既有顺序——防未授权存在性探测）；异常类用已 import 的 NotFoundException（:2）
  await this.perm.assertEditor(dto.workflowId, userId); // ⚠ 参数序 (projectId, userId)——R1 核实 project-permission.service.ts:31
  const project = await this.prisma.canvasProject.findUnique({ where: { id: dto.workflowId } });
  if (!project) throw new NotFoundException('画布不存在');
  await this.quota.assertCanUpload(project.teamId, dto.estimatedSize);
  return { ok: true };
}
```

video-project.controller.ts（**类级已挂 @UsePipes（:7），方法级不重复挂**）：

```ts
@Post('export-precheck')
async exportPrecheck(@Req() req: any, @Body() dto: ExportPrecheckDto) {
  return this.svc.exportPrecheck(req.user?.id, dto);
}
```

**连带**：video-project.service.spec.ts 与 video-project.regenerate.spec.ts 的 service 构造处补第 5 个参数 quota mock（否则全文件红——本 Task Files 已列）。

- [x] **Step 4: 前端 API 扩展（videoProjectApi.ts）**

**R1 核实**：apiFetch 的 `body?: string`（client.ts:5）——**必须 `JSON.stringify`**（与文件既有方法同款）：

```ts
export interface RegenerateInput { workflowId: string; sourceNodeId: string; kind: 'video' | 'audio'; }
// R6-P2-1：后端 regenerate 返回 { shadowNodeId, result }（video-project.service.ts:98）——result 含 success/errors。
// execute 的 error 事件在第一轮 HTTP 往返内就可能已 emit（watchShadowJob 订阅必错过）——不带出 result 会让
// 早失败（扣费失败等）等到 120s 超时才反馈；带出后 watchShadowJob 以 initial 立即失败。
export async function regenerateNode(input: RegenerateInput): Promise<{ shadowNodeId: string; result?: { success: boolean; errors?: string[] } }> {
  return apiFetch('/video-projects/regenerate', { method: 'POST', body: JSON.stringify(input) });
}
export async function removeShadowNode(workflowId: string, shadowNodeId: string): Promise<void> {
  await apiFetch('/video-projects/remove-shadow', { method: 'POST', body: JSON.stringify({ workflowId, shadowNodeId }) });
}
export interface RegisterGeneratedInput { workflowId: string; videoProjectId: string; resolution: '720p' | '1080p'; durationSec: number; actualSize: number; }
export async function registerGeneratedMedia(input: RegisterGeneratedInput): Promise<{ mediaId: string; upload: { url: string; fields: Record<string, string> } }> {
  return apiFetch('/video-projects/generated-media/register', { method: 'POST', body: JSON.stringify(input) });
}
export async function confirmGeneratedMedia(mediaId: string): Promise<unknown> {
  return apiFetch('/video-projects/generated-media/confirm', { method: 'POST', body: JSON.stringify({ mediaId }) });
}
export async function exportPrecheck(workflowId: string, estimatedSize: number): Promise<{ ok: true }> {
  return apiFetch('/video-projects/export-precheck', { method: 'POST', body: JSON.stringify({ workflowId, estimatedSize }) });
}
```

- [x] **Step 5: 跑测试 + 提交**

```bash
pnpm -C apps/api test && pnpm -C apps/web exec tsc -b
git add apps/api/src apps/web/src/api && git commit -m "feat(video-project): export-precheck 配额预检端点 + 前端四端点 API 封装（TDD）"
```

---

### Task 6: audio-engine mixdown 全时间线混音纯函数

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/audio-engine/mixdown.ts`
- Test: `apps/web/src/pages/canvas/video-editor/audio-engine/mixdown.test.ts`

- [x] **Step 1: 写失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/audio-engine/mixdown.test.ts
import { describe, it, expect } from 'vitest';
import { mixdownTimeline, MIX_SAMPLE_RATE } from './mixdown';
import type { ProjectData, AudioClip, VideoClip } from '../types';

// R1：PcmData 实形 = { sampleRate, channels: Float32Array[] }（pcm.ts:4）——夹具同形
const mkPcm = (seconds: number, amp = 1) => {
  const n = Math.round(seconds * MIX_SAMPLE_RATE);
  return { sampleRate: MIX_SAMPLE_RATE, channels: [new Float32Array(n).fill(amp), new Float32Array(n).fill(amp)] };
};
const ac = (id: string, mediaId: string, start: number, duration: number, over: Partial<AudioClip> = {}): AudioClip => ({
  id, trackId: 'ta', type: 'audio', start, duration, sourceStart: 0, mediaId,
  volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [], ...over,
});
const mk = (clips: (AudioClip | VideoClip)[], muted = false): ProjectData => ({
  version: 1, fps: 30,
  tracks: [{ id: 'ta', type: 'audio', name: 'a', muted, hidden: false, clips: clips.map((c) => c.id) }],
  clips: Object.fromEntries(clips.map((c) => [c.id, c])),
});

describe('mixdownTimeline（导出离线混音——复用 buildGainPoints/gainValueAt 同源语义）', () => {
  it('无音频片/视频片 → null（不产 PCM）', async () => {
    expect(await mixdownTimeline(mk([]), async () => null)).toBeNull();
  });
  it('全部 PCM 不可得（纯视频素材无音轨）→ null', async () => {
    expect(await mixdownTimeline(mk([ac('a', 'm1', 0, 2)]), async () => null)).toBeNull();
  });
  it('单片线性写入：2s amp=0.5 volume=1 → 左右声道 0..2s 恒 0.5', async () => {
    const data = mk([ac('a', 'm1', 0, 2, { volume: 0.5 })]);
    const r = await mixdownTimeline(data, async () => mkPcm(3));
    expect(r).not.toBeNull();
    expect(r!.left.length).toBe(2 * MIX_SAMPLE_RATE);
    expect(r!.left[0]).toBeCloseTo(0.5, 5);
    expect(r!.left[2 * MIX_SAMPLE_RATE - 1]).toBeCloseTo(0.5, 5);
    expect(r!.sampleRate).toBe(MIX_SAMPLE_RATE);
  });
  it('时间偏移：片 start=1s → [0,48000) 静音、[48000,96000) 有声（前导黑场计入成片）', async () => {
    const data = mk([ac('a', 'm1', 1, 1)]);
    const r = await mixdownTimeline(data, async () => mkPcm(2));
    expect(r!.left[100]).toBe(0);
    expect(r!.left[MIX_SAMPLE_RATE + 100]).toBeCloseTo(1, 5);
  });
  it('sourceStart 偏移进入 stretched 坐标（sourceStart/speed，Plan 3 决策 3 同款）', async () => {
    const data = mk([ac('a', 'm1', 0, 1, { sourceStart: 1 })]); // 源 1s 处开始取 1s
    const left = new Float32Array(MIX_SAMPLE_RATE * 3); // 源 [1s,2s) 为 1
    left[MIX_SAMPLE_RATE] = 1; left[MIX_SAMPLE_RATE * 2 - 1] = 1;
    const pcm = { sampleRate: MIX_SAMPLE_RATE, channels: [left, left] };
    const r = await mixdownTimeline(data, async () => pcm);
    expect(r!.left[0]).toBeCloseTo(1, 5);
    expect(r!.left[MIX_SAMPLE_RATE - 1]).toBeCloseTo(1, 5);
  });
  it('多片叠加求和（同刻两片各 1 → 2）', async () => {
    const data = mk([ac('a', 'm1', 0, 2), ac('b', 'm2', 1, 1)]);
    const r = await mixdownTimeline(data, async (mediaId) => mkPcm(3, mediaId === 'm1' ? 1 : 1));
    expect(r!.left[MIX_SAMPLE_RATE + 100]).toBeCloseTo(2, 4);
  });
  it('muted 轨 gain=0（buildGainPoints 语义）但仍占时长', async () => {
    const data = mk([ac('a', 'm1', 0, 2)], true);
    const r = await mixdownTimeline(data, async () => mkPcm(3));
    expect(r!.left.every((v) => v === 0)).toBe(true);
    expect(r!.left.length).toBe(2 * MIX_SAMPLE_RATE);
  });
  it('fade in 生效：片头增益≈0（128 样本块粒度）', async () => {
    const data = mk([ac('a', 'm1', 0, 2, { fade: { in: 1, out: 0 } })]);
    const r = await mixdownTimeline(data, async () => mkPcm(3));
    expect(Math.abs(r!.left[10])).toBeLessThan(0.01);   // 首 128 样本块 gain≈块中点时刻
    expect(r!.left[MIX_SAMPLE_RATE]).toBeCloseTo(1, 2); // 1s 处 fade 完成
  });
  it('onProgress 按 clip 数推进（0.5/1）', async () => {
    const seen: number[] = [];
    const data = mk([ac('a', 'm1', 0, 1), ac('b', 'm2', 1, 1)]);
    await mixdownTimeline(data, async () => mkPcm(2), (r) => seen.push(r));
    expect(seen).toEqual([0.5, 1]);
  });
});
```

- [x] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/audio-engine/mixdown.test.ts
```
预期：FAIL（模块不存在）。

- [x] **Step 3: 实现 mixdown.ts**

```ts
// apps/web/src/pages/canvas/video-editor/audio-engine/mixdown.ts
import type { ProjectData, AudioClip, VideoClip } from '../types';
import { buildGainPoints, gainValueAt } from './gain';
import { totalDuration } from '../timeline/timecode';
import type { PcmData } from './pcm';

export const MIX_SAMPLE_RATE = 48000;
const GAIN_BLOCK = 128; // 决策 9：增益按 128 样本块恒定（≈2.7ms），15min 工程逐样本折线求值不可行

export type MixdownPcm = PcmData; // R1：与 pcm.ts PcmData 同形 { sampleRate, channels: Float32Array[] }
export type PcmResolver = (mediaId: string, speed: number) => Promise<MixdownPcm | null>;

/** 全时间线离线混音（导出专用）：audio 片 + video 片内嵌音轨 → 立体声 PCM。
 *  增益语义与实时调度同源（buildGainPoints/gainValueAt——equal-gain crossfade/fade/关键帧/muted 一致）。
 *  返回 null 表示无任何可混音轨（纯图片/字幕/无音轨工程）。 */
export async function mixdownTimeline(
  data: ProjectData,
  resolvePcm: PcmResolver,
  onProgress?: (ratio: number) => void,
): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | null> {
  const audible = Object.values(data.clips).filter(
    (c): c is AudioClip | VideoClip => c.type === 'audio' || c.type === 'video',
  );
  if (audible.length === 0) return null;
  const totalSamples = Math.ceil(totalDuration(data) * MIX_SAMPLE_RATE);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);
  let anyMixed = false;
  let done = 0;
  for (const clip of audible) {
    const pcm = await resolvePcm(clip.mediaId, clip.playbackSpeed);
    if (pcm) {
      anyMixed = true;
      const pts = buildGainPoints(data, clip.id);
      const outStart = Math.round(clip.start * MIX_SAMPLE_RATE);
      // stretched 坐标系：resolvePcm 返回已 stretchPcm 的 PCM，源坐标 = 原坐标 / speed（Plan 3 决策 3）
      const srcStart = Math.round((clip.sourceStart / clip.playbackSpeed) * MIX_SAMPLE_RATE);
      const srcL = pcm.channels[0];
      const srcR = pcm.channels[1] ?? pcm.channels[0]; // 单声道素材复制到双声道
      const nSamples = Math.min(
        Math.round(clip.duration * MIX_SAMPLE_RATE),
        totalSamples - outStart,
        srcL.length - srcStart,
      );
      for (let i = 0; i < nSamples; i += GAIN_BLOCK) {
        const g = gainValueAt(pts, (i / MIX_SAMPLE_RATE)); // 块首时刻增益，块内恒定
        const end = Math.min(i + GAIN_BLOCK, nSamples);
        for (let j = i; j < end; j++) {
          left[outStart + j] += srcL[srcStart + j] * g;
          right[outStart + j] += srcR[srcStart + j] * g;
        }
      }
    }
    done += 1;
    onProgress?.(done / audible.length);
  }
  return anyMixed ? { left, right, sampleRate: MIX_SAMPLE_RATE } : null;
}
```

（`gainValueAt(pts, t)` 的 t 为片段局部秒 ✓ 与 buildGainPoints 输出坐标系一致。）

- [x] **Step 4: 跑测试确认通过 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/audio-engine/ && pnpm -C apps/web exec tsc -b
git add apps/web/src && git commit -m "feat(video-editor): mixdown 全时间线离线混音纯函数——增益与实时调度同源、128 样本块恒定（TDD）"
```

---

### Task 7: 导出 controller（依赖注入，mock TDD）

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/export/controller.ts`
- Test: `apps/web/src/pages/canvas/video-editor/export/controller.test.ts`

- [x] **Step 1: 写失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/export/controller.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runExport, ExportCanceledError, EXPORT_FPS } from './controller';
import type { ProjectData, VideoClip } from '../types';

const vc = (id: string, start: number, duration: number): VideoClip => ({
  id, trackId: 'tv', type: 'video', start, duration, sourceStart: 0, mediaId: 'm1', playbackSpeed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});
const data = (d: number): ProjectData => ({
  version: 1, fps: 30,
  tracks: [{ id: 'tv', type: 'video', name: 'v', muted: false, hidden: false, clips: ['a'] }],
  clips: { a: vc('a', 0, d) },
});

/** mock deps：renderFrameAt 的 FrameRenderDeps 部分（video/images/getMediaUrl/getBlob/renderer）
 *  + mixdown/createOutput（R1：controller 依赖 createOutput(opts) 工厂非 output 实例；
 *  R5-P0：createAudioBuffer 已删——音频契约改 audioTrack.add(channels, sampleRate)） */
function makeDeps(over: Partial<Record<string, unknown>> = {}) {
  const calls = {
    videoAdd: [] as number[],
    audioAdd: 0,
    progress: [] as [string, number][],
    draw: 0,
    cancel: 0,
    finalize: 0,
    start: 0,
  };
  const output = {
    videoTrack: { add: vi.fn(async (t: number) => { calls.videoAdd.push(t); }) },
    audioTrack: { add: vi.fn(async (_channels: Float32Array[], _sampleRate: number) => { calls.audioAdd++; }) },
    start: vi.fn(async () => { calls.start++; }),
    finalize: vi.fn(async () => { calls.finalize++; }),
    cancel: vi.fn(async () => { calls.cancel++; }),
  };
  const deps = {
    video: { getFrame: vi.fn(async () => null) },
    images: { getImageBitmap: vi.fn(async () => null) },
    getMediaUrl: vi.fn(() => 'http://x'),
    getBlob: vi.fn(async () => null),
    renderer: { draw: vi.fn(() => { calls.draw++; }) },
    mixdown: vi.fn(async () => null),
    createOutput: vi.fn(async () => output), // R7-P2-1：契约 async（守卫下沉 Worker 侧 hasAudio 分支）
    onProgress: vi.fn((phase: string, ratio: number) => { calls.progress.push([phase, ratio]); }),
    signal: new AbortController().signal,
    ...over,
  };
  return { deps, calls };
}

describe('runExport 编排（jsdom 无 WebCodecs——deps 全 mock）', () => {
  it('1s 工程：videoTrack.add 恰 30 次、时间戳 t=k/30（决策 6 VideoFrame 纪律等价断言）', async () => {
    const { deps, calls } = makeDeps();
    await runExport(data(1), '720p', deps as never);
    expect(calls.videoAdd).toHaveLength(EXPORT_FPS);
    expect(calls.videoAdd[0]).toBe(0);
    expect(calls.videoAdd[1]).toBeCloseTo(1 / 30, 6);
    expect(calls.videoAdd[29]).toBeCloseTo(29 / 30, 6);
    expect(calls.start).toBe(1);
    expect(calls.finalize).toBe(1);
  });

  it('帧渲染走 renderFrameAt 复用（draw 每帧一次）', async () => {
    const { deps, calls } = makeDeps();
    await runExport(data(0.2), '720p', deps as never); // 6 帧
    expect(calls.draw).toBe(6);
  });

  it('两段进度：mixdown 回调透传 + controller 补末帧 mix=1 + encode totalFrames 次且末次 ratio=1（spec §7.5）', async () => {
    const { deps, calls } = makeDeps();
    deps.mixdown = vi.fn(async (_d: unknown, onP?: (r: number) => void) => { onP?.(0.5); return null; }) as never;
    await runExport(data(0.2), '720p', deps as never);
    const mix = calls.progress.filter(([p]) => p === 'mix');
    const enc = calls.progress.filter(([p]) => p === 'encode');
    expect(mix).toEqual([['mix', 0.5], ['mix', 1]]); // mock 只回调 0.5，末值 1 由 controller 收敛补发
    expect(enc).toHaveLength(6);
    expect(enc[enc.length - 1][1]).toBe(1);
  });

  it('有混音结果：audioTrack.add 恰一次且携带 (channels, sampleRate)（R5-P0：契约改 raw f32——分块是装配侧内部）', async () => {
    const { deps, calls } = makeDeps();
    deps.mixdown = vi.fn(async () => ({ left: new Float32Array(48000).fill(0.5), right: new Float32Array(48000).fill(0.5), sampleRate: 48000 })) as never;
    await runExport(data(0.2), '720p', deps as never);
    expect(calls.audioAdd).toBe(1);
    const created = await (deps.createOutput as ReturnType<typeof vi.fn>).mock.results[0].value; // R7-P2-1：async 契约——results[0].value 是 Promise
    const addCall = created.audioTrack.add.mock.calls[0];
    expect(addCall[0]).toHaveLength(2); // [left, right]
    expect(addCall[0][0][0]).toBeCloseTo(0.5, 5);
    expect(addCall[1]).toBe(48000);
  });

  it('取消（未建 output 前中止）：直接 ExportCanceledError，不装配不 start 不 cancel（R1：开头中止无需建 output）', async () => {
    const { deps, calls } = makeDeps();
    const ac = new AbortController();
    ac.abort();
    deps.signal = ac.signal;
    await expect(runExport(data(1), '720p', deps as never)).rejects.toBeInstanceOf(ExportCanceledError);
    expect(deps.createOutput).not.toHaveBeenCalled();
    expect(calls.start).toBe(0);
    expect(calls.cancel).toBe(0);
    expect(calls.videoAdd).toHaveLength(0);
  });

  it('中途 abort（第 3 帧后）：已完成帧保留、cancel 调用', async () => {
    const { deps, calls } = makeDeps();
    const ac = new AbortController();
    deps.video.getFrame = vi.fn(async () => { if (calls.videoAdd.length >= 3) ac.abort(); return null; });
    deps.signal = ac.signal;
    await expect(runExport(data(1), '720p', deps as never)).rejects.toBeInstanceOf(ExportCanceledError);
    expect(calls.videoAdd.length).toBeGreaterThanOrEqual(3);
    expect(calls.videoAdd.length).toBeLessThan(EXPORT_FPS);
    expect(calls.cancel).toBe(1);
  });

  it('空工程（duration=0）抛错不入帧循环', async () => {
    const { deps, calls } = makeDeps();
    const empty: ProjectData = { version: 1, fps: 30, tracks: [{ id: 'tv', type: 'video', name: 'v', muted: false, hidden: false, clips: [] }], clips: {} };
    await expect(runExport(empty, '720p', deps as never)).rejects.toThrow('空工程');
    expect(calls.start).toBe(0);
  });

  it('帧渲染抛错原样传播（错误分类归 Worker 层）', async () => {
    const { deps } = makeDeps();
    deps.renderer.draw = vi.fn(() => { throw new Error('draw boom'); });
    await expect(runExport(data(0.2), '720p', deps as never)).rejects.toThrow('draw boom');
  });
});
```

- [x] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/export/controller.test.ts
```
预期：FAIL（模块不存在）。

- [x] **Step 3: 实现 controller.ts**

```ts
// apps/web/src/pages/canvas/video-editor/export/controller.ts
import type { ProjectData } from '../types';
import { totalDuration } from '../timeline/timecode';
import { renderFrameAt, type FrameRenderDeps } from '../renderer/render-frame';

export const EXPORT_FPS = 30;
export class ExportCanceledError extends Error {
  constructor() { super('export canceled'); this.name = 'ExportCanceledError'; }
}

/** mediabunny Output 装配抽象（Worker 真实实现/测试 mock；audioTrack 在 hasAudio 时才非 null）。
 *  R5-P0：音频契约是 raw f32（channels + sampleRate）——AudioBuffer/Web Audio 不进 Worker（决策 8 勘误）；
 *  交织/分块/AudioSample 构造是装配侧（Task 8）内部细节，controller 只调一次 add。 */
export interface ExportOutput {
  videoTrack: { add(timestamp: number, duration: number): Promise<void> };
  audioTrack: { add(channels: Float32Array[], sampleRate: number): Promise<void> } | null;
  start(): Promise<void>;
  finalize(): Promise<void>;
  cancel(): Promise<void>;
}
export interface ExportControllerDeps extends FrameRenderDeps {
  /** 全时间线混音（Task 6 纯函数注入）；onMixProgress 为 mix 阶段进度 */
  mixdown(data: ProjectData, onMixProgress?: (ratio: number) => void): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | null>;
  createOutput(opts: { hasAudio: boolean }): Promise<ExportOutput>; // R7-P2-1：async 契约——Worker 侧 AAC 守卫下沉至 hasAudio 分支（纯视频工程不检测不注册不失败）
  onProgress: (phase: 'mix' | 'encode', ratio: number) => void;
  signal: AbortSignal;
}

/** 导出编排（依赖注入，jsdom 可测——spec §一 原则 3）：
 *  混音 → 装配 Output（hasAudio 决定音轨）→ start → 音频单次 add → 逐帧 renderFrameAt（复用预览渲染）→ videoTrack.add → finalize。
 *  VideoFrame 纪律（决策 6）：本函数零 `new VideoFrame`——CanvasSink→canvas→drawImage→CanvasSource.add 由 mediabunny 内部管理。 */
export async function runExport(data: ProjectData, _resolution: '720p' | '1080p', deps: ExportControllerDeps): Promise<void> {
  const duration = totalDuration(data);
  if (duration <= 0) throw new Error('空工程不可导出');
  if (deps.signal.aborted) throw new ExportCanceledError();

  // 段 1：离线混音（进度经 onProgress('mix')）
  const mixed = await deps.mixdown(data, (r) => deps.onProgress('mix', r));
  deps.onProgress('mix', 1);

  const output = await deps.createOutput({ hasAudio: !!mixed }); // R7-P2-1：await async 契约
  await output.start();

  if (mixed) {
    if (deps.signal.aborted) { await output.cancel(); throw new ExportCanceledError(); }
    await output.audioTrack!.add([mixed.left, mixed.right], mixed.sampleRate); // R5-P0：raw f32 一次交付（分块在装配侧）
  }

  // 段 2：逐帧编码（renderFrameAt 全注入——绘制到 Worker 的 OffscreenCanvas）
  const totalFrames = Math.round(duration * EXPORT_FPS);
  for (let f = 0; f < totalFrames; f++) {
    if (deps.signal.aborted) { await output.cancel(); throw new ExportCanceledError(); }
    const t = f / EXPORT_FPS;
    await renderFrameAt(data, t, deps);
    if (deps.signal.aborted) { await output.cancel(); throw new ExportCanceledError(); }
    await output.videoTrack.add(t, 1 / EXPORT_FPS);
    deps.onProgress('encode', (f + 1) / totalFrames);
  }
  await output.finalize();
}
```

（`_resolution` 前缀下划线：分辨率由装配侧 canvas 尺寸/ctx.scale 决定（决策 7），controller 不消费——保留参数为日志/语义完整；若 tsc 报未使用按项目 lint 现状处理。）

- [x] **Step 4: 跑测试确认通过 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/export/controller.test.ts && pnpm -C apps/web exec tsc -b
git add apps/web/src && git commit -m "feat(video-editor): 导出 controller 依赖注入编排——混音先行/逐帧复用 renderFrameAt/取消/两段进度（TDD）"
```

---

### Task 8: Worker bootstrap + 主线程 client

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/export/worker.ts`
- Create: `apps/web/src/pages/canvas/video-editor/export/client.ts`
- Modify: `apps/web/vite.config.ts`（**R1 必改**：加 `worker: { format: 'es' }`——Vite 5.4 默认 worker.format='iife' 且 iife 强制 inlineDynamicImports（vite dist:66494/65537），不加则 mediabunny/aac-polyfill 动态 import 被内联、"Worker 拆包"声明不成立）
- Test: `apps/web/src/pages/canvas/video-editor/export/client.test.ts`

- [x] **Step 1: 写 client 失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/export/client.test.ts
import { describe, it, expect, vi } from 'vitest';

// Worker 构造 mock：new Worker(url, opts) 返回 fake；postMessage 记录；dispatch 模拟 worker→主线程
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(msg: unknown) { this.posted.push(msg); }
  terminate() { this.terminated = true; }
  // 测试辅助：worker 侧回发
  emit(msg: unknown) { this.onmessage?.({ data: msg }); }
}

describe('runExportJob（主线程 client）', () => {
  it('run 消息带 params；done 回传 buffer 并 resolve；worker terminate', async () => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
    const { runExportJob } = await import('./client');
    const p = runExportJob(
      { data: { version: 1, fps: 30, tracks: [], clips: {} } as never, resolution: '720p', mediaUrls: {} },
      { onProgress: vi.fn() },
    );
    const w = FakeWorker.instances[0];
    expect(w.posted[0]).toMatchObject({ type: 'run', params: { resolution: '720p' } });
    w.emit({ type: 'done', buffer: new ArrayBuffer(8) });
    const r = await p.promise;
    expect(r.blob.size).toBe(8);
    expect(r.fsa).toBe(false);
    expect(w.terminated).toBe(true);
    vi.unstubAllGlobals();
  });

  it('error 消息 reject 且分类透传（决策 11：terminate 即取消兜底）', async () => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
    const { runExportJob } = await import('./client');
    const p = runExportJob({ data: {} as never, resolution: '720p', mediaUrls: {} }, { onProgress: vi.fn() });
    FakeWorker.instances[0].emit({ type: 'error', category: 'memory', message: 'OOM' });
    await expect(p.promise).rejects.toMatchObject({ category: 'memory' });
    vi.unstubAllGlobals();
  });

  it('cancel() → terminate + reject canceled；进度/eta 回调透传', async () => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
    const { runExportJob } = await import('./client');
    const progress = vi.fn(); const eta = vi.fn();
    const p = runExportJob({ data: {} as never, resolution: '720p', mediaUrls: {} }, { onProgress: progress, onEta: eta });
    const w = FakeWorker.instances[0];
    w.emit({ type: 'progress', phase: 'encode', ratio: 0.5 });
    w.emit({ type: 'eta', etaSec: 42 });
    expect(progress).toHaveBeenCalledWith('encode', 0.5);
    expect(eta).toHaveBeenCalledWith(42);
    p.cancel();
    await expect(p.promise).rejects.toMatchObject({ category: 'canceled' });
    expect(w.terminated).toBe(true);
    vi.unstubAllGlobals();
  });
});
```

- [x] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/export/client.test.ts
```
预期：FAIL（模块不存在）。

- [x] **Step 3: 实现 worker.ts（真实装配——决策 4/7/8）**

```ts
// apps/web/src/pages/canvas/video-editor/export/worker.ts
// R1（P0-1）：不加 /// <reference lib="webworker" />——apps/web lib 为 ES2022+DOM，混挂 webworker lib
// 实测报 TS6200/TS2374/TS2403 数十条（self/onmessage/URL/FormData 冲突）。用 DOM lib：
// OffscreenCanvas/createImageBitmap/FileSystemFileHandle 均在 DOM lib 中，
// self 与 onmessage 经 as unknown 强转访问。
// ⚠ R5-P0：DOM lib 声明 OfflineAudioContext/AudioBuffer 只是编译期可见——运行时 Worker 无这些全局
// （Web Audio [Exposed=Window]，lib.webworker.d.ts 0 命中）——Worker 代码零 Web Audio 依赖（决策 8）。
import { runExport, type ExportOutput } from './controller';
import { mixdownTimeline, MIX_SAMPLE_RATE, type MixdownPcm } from '../audio-engine/mixdown';
import { decodeMediaPcm } from '../audio-engine/decode';
import { stretchPcm } from '../audio-engine/pcm';
import { VideoCacheService, openMediabunnySink } from '../renderer/video-cache';
import { CanvasRenderer, CANVAS_W, CANVAS_H } from '../renderer/canvas-renderer';
import { EXPORT_BITRATES } from './precheck';
import { createEtaTracker } from './eta';
import { totalDuration } from '../timeline/timecode';
import type { ProjectData } from '../types';

export interface WorkerRunParams {
  data: ProjectData;
  resolution: '720p' | '1080p';
  mediaUrls: Record<string, string>;            // mediaId → presigned GET url
  saveFileHandle: FileSystemFileHandle | null;  // 决策 4：FSA 优先，null 回退 BufferTarget
}

type Post = (msg: unknown, transfer?: Transferable[]) => void; // R5-P1-3：transfer 透传——done 的 buffer 零拷贝转移

/** R2-N15：环境不支持用显式类型判定（关键词兜底只留给 Worker OOM——spec §7.6 三分类） */
export class UnsupportedEnvError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsupportedEnvError'; }
}

function classifyError(err: unknown): 'unsupported' | 'memory' | 'unknown' {
  if (err instanceof UnsupportedEnvError) return 'unsupported';
  const msg = String((err as Error)?.message ?? err);
  if (/NotSupportedError|not supported|isConfigSupported/i.test(msg)) return 'unsupported'; // R3-6②：output.start() 硬编不可用一类
  if (/OOM|out of memory|Array buffer allocation failed/.test(msg)) return 'memory';
  return 'unknown';
}

async function runInWorker(params: WorkerRunParams, post: Post): Promise<{ buffer: ArrayBuffer | null; fsa: boolean }> {
  const { data, resolution, mediaUrls, saveFileHandle } = params;
  const scale = resolution === '720p' ? 0.5 : 1;

  // 合成 canvas（决策 7：逻辑坐标 1920×1080 不变，720p 整体 0.5×）
  const offscreen = new OffscreenCanvas(Math.round(CANVAS_W * scale), Math.round(CANVAS_H * scale));
  const ctx2d = offscreen.getContext('2d')!;
  ctx2d.scale(scale, scale);

  // R5-P0（决策 8 勘误）：删 OfflineAudioContext 自检——Web Audio IDL [Exposed=Window]，Worker 内必然
  // ReferenceError（TS lib.webworker 0 命中实证），且无条件自检会把纯视频工程也连坐成 unsupported。
  // 音频写侧改 AudioSampleSource + raw f32（零 Web Audio 依赖，装配见 createOutput）。

  // 视频帧缓存（Worker 独立实例——决策 7）
  const videoCache = new VideoCacheService({ openSink: openMediabunnySink });

  // 图片/音频 blob 缓存（R4 登记：estimateMemoryBytes 只算 PCM——混音取源经 getBlob 整文件 fetch 且无淘汰，
  // 峰值另含全部带音轨源文件；Worker 在 done/error 后 terminate 整体回收，有界）
  const blobCache = new Map<string, Blob>();
  const getBlob = async (mediaId: string): Promise<Blob | null> => {
    const url = mediaUrls[mediaId];
    if (!url) return null;
    if (!blobCache.has(mediaId)) {
      try { blobCache.set(mediaId, await (await fetch(url)).blob()); } catch { return null; }
    }
    return blobCache.get(mediaId) ?? null;
  };
  const bitmaps = new Map<string, ImageBitmap>();
  const images = {
    getImageBitmap: async (mediaId: string, blob: Blob): Promise<ImageBitmap | null> => {
      if (!bitmaps.has(mediaId)) {
        try { bitmaps.set(mediaId, await createImageBitmap(blob)); } catch { return null; }
      }
      return bitmaps.get(mediaId) ?? null;
    },
  };

  // PCM 解析（mixdown 依赖：blob → decodeMediaPcm → 变速 stretchPcm，按 mediaId:speed 缓存）
  // R1：stretchPcm 返回 PcmData（channels 形）与 MixdownPcm 同型——无转换
  // R2-N13：缓存仅服务"同 mediaId 多片共享解码"，runExport 返回前整体清空（全片常驻 15min×3 片 ≈1GB+ 不可接受）
  const pcmCache = new Map<string, MixdownPcm>();
  const resolvePcm = async (mediaId: string, speed: number): Promise<MixdownPcm | null> => {
    const key = `${mediaId}:${speed}`;
    if (pcmCache.has(key)) return pcmCache.get(key) ?? null;
    const blob = await getBlob(mediaId);
    if (!blob) return null;
    const raw = await decodeMediaPcm(blob, MIX_SAMPLE_RATE);
    if (!raw) return null; // 无音轨
    const pcm = speed === 1 ? raw : stretchPcm(raw, speed);
    pcmCache.set(key, pcm);
    return pcm;
  };

  // mediabunny 写侧装配（懒加载拆包——需 vite.config worker.format:'es'，见 Files）
  // R5-P0：AudioSampleSource/AudioSample 替代 AudioBufferSource/AudioBuffer（决策 8 勘误——Web Audio 不进 Worker）
  // R7-P2-1：AAC 守卫（canAac + polyfill 注册 + 复测）下沉至 createOutput 的 hasAudio 分支——
  // 原装配段无条件版在 polyfill 因嵌套子 Worker/CSP 失败时连坐纯视频工程（与 R5-P0 批判的原方案同构）
  const { Output, Mp4OutputFormat, CanvasSource, AudioSampleSource, AudioSample, BufferTarget, StreamTarget, canEncodeAudio } = await import('mediabunny');
  const canAac = () => canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: MIX_SAMPLE_RATE, bitrate: 128_000 }).catch(() => false);

  // R2-N4：createWritable 是 Promise——同步 try/catch 罩不住拒绝（会在 output.start() 后的首次 write 才爆）。
  // "能不能写"的判定前置到装配前 await；失败（句柄失效/权限撤销）→ 回退 BufferTarget 而非整单失败
  const fsaWritable = saveFileHandle ? await saveFileHandle.createWritable().catch(() => null) : null;
  let bufferResult: ArrayBuffer | null = null;
  const makeBufferTarget = () => new BufferTarget({ onFinalize: (buffer: ArrayBuffer) => { bufferResult = buffer; } });
  const createOutput = async (opts: { hasAudio: boolean }): Promise<ExportOutput> => { // R7-P2-1：async——AAC 守卫在 hasAudio 分支内 await
    // R1：fastStart 显式——FSA 流式路径必须 false（moov 尾置顺序写，内存有界前提）；
    // Buffer 路径 auto 即 'in-memory'（本来就在内存，无需显式）
    const format = fsaWritable ? new Mp4OutputFormat({ fastStart: false }) : new Mp4OutputFormat();
    let target: InstanceType<typeof BufferTarget> | InstanceType<typeof StreamTarget>;
    if (fsaWritable) {
      // 决策 4：FSA StreamTarget 流式直写（WritableStream<StreamTargetChunk> 适配 FileSystemWritableFileStream）
      const writable = fsaWritable;
      target = new StreamTarget(new WritableStream({
        async write(chunk) {
          await writable.write({ type: 'write', position: chunk.position, data: chunk.data });
        },
        async close() { await writable.close(); },
        async abort() { await writable.abort(); },
      }));
    } else {
      target = makeBufferTarget(); // R3-1：回退事实经 done.fsa 标记回传主线程择源
    }
    const output = new Output({ format, target });
    // R2-N14：无 as never——codec/bitrate/keyFrameInterval 均在 VideoEncodingConfig（d.ts 实证），保留 cast 会掩盖类型漂移
    const canvasSource = new CanvasSource(offscreen, {
      codec: 'avc', bitrate: EXPORT_BITRATES[resolution].video, keyFrameInterval: 2,
    });
    output.addVideoTrack(canvasSource, { frameRate: 30 });
    let audioSource: InstanceType<typeof AudioSampleSource> | null = null;
    if (opts.hasAudio) {
      // R7-P2-1：守卫下沉——只有真要建音轨才检测/注册/失败（R6-P2-3 的注册后复测守卫原样，仅位置从装配段移入）：
      // Worker 内环境与主线程 detectExportCapabilities 不同（polyfill 依赖子 Worker + WASM + AudioData）——
      // 注册后复测仍 false 必须显式失败（归 unsupported），否则落到 output.start() 才爆成 unknown；
      // 纯视频工程（mixdown null）不走到这里——polyfill 环境性失败不连坐
      if (!(await canAac())) {
        (await import('@mediabunny/aac-encoder')).registerAacEncoder(); // AAC 静默 polyfill
        if (!(await canAac())) throw new UnsupportedEnvError('音频编码不可用（AAC native 与 polyfill 均失败）');
      }
      audioSource = new AudioSampleSource({ codec: 'aac', bitrate: EXPORT_BITRATES[resolution].audio });
    }
    const audioTrack = audioSource ? output.addAudioTrack(audioSource) : null;
    return {
      videoTrack: { add: (t: number, d: number) => canvasSource.add(t, d) },
      // R5-P0：controller 契约是 raw f32——这里交织 L/R 为 interleaved f32、按 ~5s 分块构造 AudioSample 喂源。
      // AudioSampleInit { data, format:'f32'(interleaved), numberOfChannels, sampleRate, timestamp(秒) }（d.ts :390-403）；
      // 释放用 close()（R6-P1-A：AudioSample 无 dispose() 方法——TS2339；Symbol.dispose 类型依赖 esnext.disposable 不可用）。
      audioTrack: audioTrack ? { add: async (channels: Float32Array[], sampleRate: number) => {
        const [left, right] = channels;
        const framesPerChunk = sampleRate * 5; // 每块 5s（48k×2ch×5s ≈ 1.9MB）控峰值
        for (let start = 0; start < left.length; start += framesPerChunk) {
          const n = Math.min(framesPerChunk, left.length - start);
          const interleaved = new Float32Array(n * 2);
          for (let i = 0; i < n; i++) {
            interleaved[i * 2] = left[start + i];
            interleaved[i * 2 + 1] = right[start + i];
          }
          const sample = new AudioSample({ data: interleaved, format: 'f32', numberOfChannels: 2, sampleRate, timestamp: start / sampleRate });
          try { await audioSource!.add(sample); } finally { sample.close(); }
        }
      } } : null,
      start: () => output.start(),
      finalize: () => output.finalize(),
      cancel: () => output.cancel(),
    };
  };

  const ac = new AbortController(); // worker 内协作取消（真实取消走 terminate，此为 mock 测试同构）
  const totalFrames = Math.round(totalDuration(data) * 30);
  const eta = createEtaTracker(totalFrames);
  let frameSeen = 0;

  try {
  await runExport(data, resolution, {
    video: videoCache,
    images,
    getMediaUrl: (mediaId) => mediaUrls[mediaId],
    getBlob,
    renderer: new CanvasRenderer(ctx2d as unknown as CanvasRenderingContext2D),
    mixdown: (d, onP) => mixdownTimeline(d, resolvePcm, onP),
    createOutput,
    onProgress: (phase, ratio) => {
      if (phase === 'encode') {
        frameSeen += 1;                 // controller 每帧恰一次 encode 回调
        eta.observe(frameSeen - 1);     // 0-based 帧号（29 首测 / 499 滚动修正——Task 4 语义）
        if (frameSeen % 30 === 0) {
          const e = eta.etaSec();
          if (e != null) post({ type: 'eta', etaSec: e }); // 每 30 帧节流上报，防消息风暴
        }
      }
      post({ type: 'progress', phase, ratio });
    },
    signal: ac.signal,
  });
  } finally {
    pcmCache.clear(); // R2-N13 + R3-6①：混音 PCM 用后即弃、错误路径同样回收（mixed L/R 已分块喂 AudioSample）
    blobCache.clear(); // R4-10：源文件 blob 同弃——长工程多素材的堆占用不等到 terminate 才释放（bitmaps 量小可留）
  }

  // R3-1：fsa 标记随 done 回传——主线程据此择源（FSA 成功读文件 / 回退读 buffer）
  return { buffer: bufferResult, fsa: !!fsaWritable };
}

// P0-1：DOM lib 下 self 是 Window 类型——onmessage 赋值类型兼容（Window.onmessage 同签名），
// Worker 运行时 self 为 DedicatedWorkerGlobalScope 行为正确；postMessage 经强转（无 Window.postMessage 冲突面）
self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as { type: string; params?: WorkerRunParams };
  if (msg.type !== 'run' || !msg.params) return;
  const post = (m: unknown, transfer?: Transferable[]) =>
    (self as unknown as Worker).postMessage(m, transfer ?? []);
  try {
    const { buffer, fsa } = await runInWorker(msg.params, post);
    // R3-1：done 必须带 fsa 标记——createWritable 被拒回退 Buffer 后，主线程若仍按句柄读文件会得到 0 字节静默上传
    // R5-P1-3：buffer 走 transfer list 零拷贝转移——15min 1080p ≈1.6GB 若 structured clone 复制一份直接顶爆内存预算
    post({ type: 'done', buffer, fsa }, buffer ? [buffer] : []);
  } catch (err) {
    post({ type: 'error', category: classifyError(err), message: String((err as Error)?.message ?? err) });
  }
};
```

**实现注意（执行时核对现码签名）**：① `decodeMediaPcm`/`stretchPcm` 的返回类型 PcmData 与 MixdownPcm 的字段差异（right 可选性）按 `pcm.ts` 实形适配；② `CanvasSource` 构造第二参 `VideoEncodingConfig` 无 bitrate 布尔兼容问题——d.ts 有 `quality?: Quality` 与 deprecated `bitrate`，传 bitrate 数字可用（deprecated 警告可忽略）或改 `new Quality(...)` 按码率换算——**执行时用 d.ts 验证取其一**。

- [x] **Step 4: 实现 client.ts**

```ts
// apps/web/src/pages/canvas/video-editor/export/client.ts
import type { ProjectData } from '../types';

export interface ExportJobParams { data: ProjectData; resolution: '720p' | '1080p'; mediaUrls: Record<string, string>; }
export interface ExportJobResult { blob: Blob; fsa: boolean; } // R3-1：fsa=true 且调用方持 handle → getFile() 择源
export class ExportJobError extends Error {
  constructor(public category: 'unsupported' | 'memory' | 'unknown' | 'canceled', message: string) { super(message); }
}
export interface ExportJobHandle {
  promise: Promise<ExportJobResult>;
  cancel(): void;
}

/** 决策 4：FSA picker 需用户手势——由调用方（ExportModal）在点击处理器内先调本函数拿 handle */
export async function pickSaveFile(suggestedName: string): Promise<FileSystemFileHandle | null> {
  if (!('showSaveFilePicker' in window)) return null;
  try {
    return await (window as unknown as { showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
      suggestedName,
      types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }],
    });
  } catch { return null; } // 用户取消 picker
}

export function runExportJob(
  params: ExportJobParams,
  callbacks: { onProgress: (phase: 'mix' | 'encode', ratio: number) => void; onEta?: (etaSec: number) => void },
  saveFileHandle: FileSystemFileHandle | null = null,
): ExportJobHandle {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let cancelFn: () => void = () => {};
  const promise = new Promise<ExportJobResult>((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { type: string; buffer?: ArrayBuffer; phase?: 'mix' | 'encode'; ratio?: number; etaSec?: number; category?: string; message?: string };
      if (msg.type === 'progress' && msg.phase !== undefined && msg.ratio !== undefined) callbacks.onProgress(msg.phase, msg.ratio);
      else if (msg.type === 'eta' && msg.etaSec !== undefined) callbacks.onEta?.(msg.etaSec);
      else if (msg.type === 'done') {
        resolve({ blob: msg.buffer ? new Blob([msg.buffer], { type: 'video/mp4' }) : new Blob(), fsa: msg.fsa === true }); // R3-1
        worker.terminate();
      } else if (msg.type === 'error') {
        reject(new ExportJobError((msg.category as 'memory') ?? 'unknown', msg.message ?? ''));
        worker.terminate();
      }
    };
    worker.onerror = (ev: ErrorEvent) => {
      // worker.onerror / OOM 被杀归内存/未知（spec §7.6）
      reject(new ExportJobError(/memory|allocation/i.test(ev.message) ? 'memory' : 'unknown', ev.message || 'Worker 异常终止'));
      worker.terminate();
    };
    cancelFn = () => {
      worker.terminate();
      reject(new ExportJobError('canceled', '已取消'));
    };
    worker.postMessage({ type: 'run', params: { ...params, saveFileHandle } });
  });
  return { promise, cancel: () => cancelFn() };
}
```

**注意**：FSA 路径 done 时 buffer 为 null——blob 为空 Blob，上传侧（Task 9）改用 `saveFileHandle.getFile()`；测试用例 1 的 buffer 路径已覆盖。

- [x] **Step 5: 跑测试确认通过 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/export/client.test.ts && pnpm -C apps/web exec tsc -b
git add apps/web/src && git commit -m "feat(video-editor): 导出 Worker bootstrap（FSA/Buffer 双 target + AudioSampleSource raw f32 音频 + AAC polyfill + transfer 零拷贝）+ 主线程 client/取消（TDD）"
```

- [x] **Step 6: 真实编码冒烟（R7-P2-2：native AAC + Worker 打包链路——提前暴露，不等到 Task 13）**

ExportModal 尚未接线（Task 10 才有 UI 入口）——dev server 打开画布进入编辑器，拖入一段带音轨视频素材后，浏览器 console 直驱（**刷新页面后立即执行**——避开 HMR ?t 孤儿实例陷阱，见记忆 vite_hmr_dual_instance；若 editorStore 读到空态即撞双实例，刷新重试）：

```js
const { runExportJob } = await import('/src/pages/canvas/video-editor/export/client.ts');
const { useEditorStore } = await import('/src/pages/canvas/video-editor/store/editorStore.ts');
const es = useEditorStore.getState();
const mediaUrls = {}; for (const [id, i] of Object.entries(es.mediaInfo)) if (i.url) mediaUrls[id] = i.url;
const job = runExportJob({ data: es.data, resolution: '720p', mediaUrls }, { onProgress: (p, r) => console.log(p, r) }, null);
const r = await job.promise;
console.log('size', r.blob.size, 'fsa', r.fsa);
window.open(URL.createObjectURL(r.blob)); // 下载后本地播放器验证
```

验收点：① progress 走完 mix→encode 到 done；② blob 非零、MP4 本地播放**音画同步**、时长正确；③ vite worker.format:'es' 打包 / mediabunny 与 aac-encoder 的 Worker 内动态 import / AudioSampleSource+AudioSample+close 装配任一环失败在此立即暴露（发现问题按 TDD 修复后复跑）。纯冒烟无代码变更不新增提交；发现缺陷则随修复提交。

---

### Task 9: 产物登记三步 + 产物上画布 + 工具栏收敛

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/export/upload.ts`
- Create: `apps/web/src/pages/canvas/video-editor/export/product-node.ts`
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.tsx`（productMode）
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx`（传参）
- Test: `export/upload.test.ts`、`export/product-node.test.ts`、`VideoNodeToolbar` 既有测试文件追加用例

- [x] **Step 1: 写 upload 失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/export/upload.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const registerApi = vi.fn();
const confirmApi = vi.fn();
vi.mock('@/api/videoProjectApi', () => ({
  registerGeneratedMedia: (...a: unknown[]) => registerApi(...a),
  confirmGeneratedMedia: (...a: unknown[]) => confirmApi(...a),
}));
const axiosPost = vi.fn();
vi.mock('axios', () => ({ default: { post: (...a: unknown[]) => axiosPost(...a) } }));

import { uploadExportedProduct } from './upload';

beforeEach(() => {
  registerApi.mockReset(); confirmApi.mockReset(); axiosPost.mockReset();
  registerApi.mockResolvedValue({ mediaId: 'uuid-1', upload: { url: 'https://minio/flowai/x', fields: { key: 'k', policy: 'p' } } });
  confirmApi.mockResolvedValue({});
  axiosPost.mockResolvedValue({ status: 200 });
});

describe('uploadExportedProduct（spec §7.3：编码完成后登记→presigned POST 直传→statObject 确认）', () => {
  it('三步顺序调用：register(actualSize=file.size) → FormData POST（fields+file、/flowai 同源改写）→ confirm(mediaId)', async () => {
    const file = new Blob(['abcd'], { type: 'video/mp4' });
    await uploadExportedProduct({ workflowId: 'w', videoProjectId: 'vp', resolution: '720p', durationSec: 10, file });
    expect(registerApi).toHaveBeenCalledWith({ workflowId: 'w', videoProjectId: 'vp', resolution: '720p', durationSec: 10, actualSize: file.size });
    expect(axiosPost).toHaveBeenCalledWith('/flowai/x', expect.any(FormData));
    expect(confirmApi).toHaveBeenCalledWith('uuid-1');
  });
  it('返回 mediaId（uuid，前端勿假设 cuid——spec §7.3）', async () => {
    const r = await uploadExportedProduct({ workflowId: 'w', videoProjectId: 'vp', resolution: '720p', durationSec: 1, file: new Blob(['x']) });
    expect(r).toEqual({ mediaId: 'uuid-1' });
  });
});
```

- [x] **Step 2: 写 product-node 失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/export/product-node.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createProductNode } from './product-node';
import { useCanvasStore } from '@/stores/canvasStore';
import { autoOutEdgeId } from '@/stores/autoEdgeIds';

// R1（P0-3）：canvasStore.nodes 是 Node[] 数组（canvasStore.ts:93/169）非 Record——夹具用数组
beforeEach(() => {
  useCanvasStore.setState({
    projectId: 'wf1',
    nodes: [
      { id: 'edit1', type: 'videoEdit', position: { x: 100, y: 50 }, data: {}, width: 320, measured: { width: 320 } } as never,
    ],
    edges: [],
  } as never);
});

describe('createProductNode（spec §7.4）', () => {
  it('建 videoGen 产物节点：data 含 origin/videoProjectId/status/fileId/label，位置在剪辑节点右侧', () => {
    const id = createProductNode('edit1', 'vp1', 'file-1', '多轨剪辑');
    const s = useCanvasStore.getState();
    const node = s.nodes.find((n) => n.id === id) as unknown as { type: string; data: Record<string, unknown>; position: { x: number; y: number } };
    expect(node.type).toBe('videoGen');
    expect(node.data).toMatchObject({ origin: 'video-edit', videoProjectId: 'vp1', status: 'done', fileId: 'file-1', label: '多轨剪辑 · 导出 1' });
    expect(node.position.x).toBe(100 + 320 + 80); // sw + GAP
    expect(node.position.y).toBe(50);
    expect(s.edges.some((e: { id: string }) => e.id === autoOutEdgeId('edit1', id))).toBe(true);
  });
  it('重复导出独立新节点：label 导出 2、位置再偏移 400', () => {
    createProductNode('edit1', 'vp1', 'file-1', '多轨剪辑');
    const id2 = createProductNode('edit1', 'vp1', 'file-2', '多轨剪辑');
    const s = useCanvasStore.getState();
    const n2 = s.nodes.find((n) => n.id === id2) as unknown as { data: { label: string }; position: { x: number } };
    expect(n2.data.label).toBe('多轨剪辑 · 导出 2');
    expect(n2.position.x).toBe(100 + 320 + 80 + 400);
  });
});
```

- [x] **Step 3: 写工具栏收敛失败测试**

VideoNodeToolbar 既有测试文件追加（按文件既有 render 风格）：

```tsx
it('productMode（产物节点）：隐藏 高清/解析/截帧/音频分离，保留 剪辑/裁剪/下载/全屏（spec §7.4 收敛定案）', () => {
  const fn = vi.fn(); // R5-P2：原稿 fn 未声明——TS2304
  render(<VideoNodeToolbar show onFullscreen={fn} onDownload={fn} onTrim={fn} productMode />);
  expect(screen.getByText('剪辑')).toBeTruthy();
  expect(screen.getByText('裁剪')).toBeTruthy();     // 死按钮维持现状
  expect(screen.getByLabelText('下载')).toBeTruthy();
  expect(screen.getByLabelText('全屏')).toBeTruthy();
  expect(screen.queryByText('高清')).toBeNull();
  expect(screen.queryByText('解析')).toBeNull();
  expect(screen.queryByText('视频截帧')).toBeNull();
  expect(screen.queryByText('音频分离')).toBeNull();
});
```

- [x] **Step 4: 确认三组测试失败**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/export/upload.test.ts src/pages/canvas/video-editor/export/product-node.test.ts src/pages/canvas/components/nodes/VideoNodeToolbar.test.tsx
```

- [x] **Step 5: 实现三处**

```ts
// apps/web/src/pages/canvas/video-editor/export/upload.ts
import axios from 'axios';
import { registerGeneratedMedia, confirmGeneratedMedia } from '@/api/videoProjectApi';

export interface UploadProductInput { workflowId: string; videoProjectId: string; resolution: '720p' | '1080p'; durationSec: number; file: Blob | File; }

/** spec §7.3：编码完成后登记（actualSize 过配额终判）→ presigned POST 浏览器 FormData 直传（零新依赖）→ confirm 实际大小落库+缩略图。
 *  File（FSA getFile 零内存读回）与 Blob 同走 FormData。 */
export async function uploadExportedProduct(input: UploadProductInput): Promise<{ mediaId: string }> {
  const { mediaId, upload } = await registerGeneratedMedia({
    workflowId: input.workflowId,
    videoProjectId: input.videoProjectId,
    resolution: input.resolution,
    durationSec: input.durationSec,
    actualSize: input.file.size,
  });
  const fd = new FormData();
  Object.entries(upload.fields).forEach(([k, v]) => fd.append(k, v));
  fd.append('file', input.file);
  await axios.post(upload.url.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai'), fd); // 同源代理改写（AddNodeMenu 同款）
  await confirmGeneratedMedia(mediaId);
  return { mediaId };
}
```

```ts
// apps/web/src/pages/canvas/video-editor/export/product-node.ts
import { useCanvasStore } from '@/stores/canvasStore';
import { autoOutEdgeId } from '@/stores/autoEdgeIds'; // R2-N5：仓库既有 helper（isAutoEdgeId 已覆盖 auto-out:——该边走 AutoEdge 通道不入撤销栈）

const GAP = 80;
const PRODUCT_STEP = 400; // 产物节点近似宽 + 间隔（水平排开，重叠时步长递增——spec §7.4 简化避让）

/** confirm 成功后自动建产物节点 + auto-out 输出边（一次性，不参与 reconcile——spec §二 规则 4） */
export function createProductNode(editNodeId: string, videoProjectId: string, fileId: string, projectTitle: string): string {
  const { nodes, addNode, addEdge } = useCanvasStore.getState();
  // R1（P0-3）：nodes 为 Node[] 数组——find 非 Record 索引
  const editNode = nodes.find((n) => n.id === editNodeId);
  if (!editNode) throw new Error(`剪辑节点不存在: ${editNodeId}`);
  const sw = (editNode as { measured?: { width?: number }; width?: number }).measured?.width
    ?? (editNode as { width?: number }).width ?? 320;
  const count = nodes.filter(
    (n) => (n as { data?: Record<string, unknown> }).data?.origin === 'video-edit'
      && (n as { data?: Record<string, unknown> }).data?.videoProjectId === videoProjectId,
  ).length;
  const position = { x: editNode.position.x + sw + GAP + count * PRODUCT_STEP, y: editNode.position.y };
  const label = `${projectTitle} · 导出 ${count + 1}`;
  const nodeId = addNode('videoGen', position, { origin: 'video-edit', videoProjectId, status: 'done', fileId, label });
  addEdge(editNodeId, nodeId, undefined, undefined, autoOutEdgeId(editNodeId, nodeId)); // R2-N5
  return nodeId;
}
```

VideoNodeToolbar.tsx：props 加 `productMode?: boolean`；四处按钮/组件条件渲染 `{!productMode && <>高清/解析/截帧 Dropdown/音频分离 Dropdown</>}`（剪辑/裁剪/下载/全屏不动——以现码四个 JSX 块为锚点分别包条件）。VideoGenNode.tsx 调用处（L677 附近）传 `productMode={(nodeData as { origin?: string } | undefined)?.origin === 'video-edit'}`；**另补标题接线（R1/决策 13）**——L326 标题本地 state 初始化改：

```ts
const [label, setLabel] = useState((nodeData as { label?: string } | undefined)?.label ?? 'Video');
```

（产物节点首渲染 data 即含 label——初始化一次到位；普通 videoGen 节点无 label 行为不变。补一条 VideoGenNode 既有测试：data.label='x · 导出 1' 时标题显示 x · 导出 1。）

- [x] **Step 6: 跑测试通过 + 全量回归 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/export/ src/pages/canvas/components/nodes/VideoNodeToolbar.test.tsx && pnpm -C apps/web exec tsc -b
git add apps/web/src && git commit -m "feat(video-editor): 产物登记三步直传 + 产物节点上画布（auto-out 边/命名/偏移）+ 工具栏 productMode 收敛（TDD）"
```

---

### Task 10: 导出弹层 ExportModal + EditorTopBar 接线

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/components/ExportModal.tsx`
- Modify: `apps/web/src/pages/canvas/video-editor/components/EditorTopBar.tsx`
- Modify: `apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.tsx`（挂 ExportModal）
- Modify: `apps/web/src/pages/canvas/video-editor/store/editorStore.ts`（**R4-10：loadProject :132 已存 projectId/sourceNodeId——真实缺口只有 `title` 与 `teamId` 两字段**（弹层标题取值 + Task 12 useTeamAssets 团队上下文）；VideoEditorShell:34 传入的 p 是 getByNode 返回的整行 DTO（含 title/teamId）；需扩 loadProject 入参类型（:45 加 `title?: string; teamId?: string`）+ state 字段 + reset()（:138-143））
- Modify: `apps/web/src/api/videoProjectApi.ts`（**R8-2：VideoProjectDto 补 `teamId: string`**——现 DTO 只有 id/sourceNodeId/workflowId/title/data/updatedAt，Shell 传 p.teamId 直接 TS2339（编译阻断非仅类型悬空）；运行时 getByNode 回 Prisma 整行恒含 teamId）
- Test: `apps/web/src/pages/canvas/video-editor/components/ExportModal.test.tsx`

- [x] **Step 1: 写失败测试**

```tsx
// apps/web/src/pages/canvas/video-editor/components/ExportModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// mock：videoProjectApi.exportPrecheck / client runExportJob / capabilities / upload 与 product-node
// （后两者已在 Task 9 建成——mock 仅为组件测试隔离上传/上画布副作用，真实行为在 Task 9 自测）
const precheckApi = vi.fn();
vi.mock('@/api/videoProjectApi', () => ({ exportPrecheck: (...a: unknown[]) => precheckApi(...a) }));
vi.mock('../export/upload', () => ({ uploadExportedProduct: vi.fn().mockResolvedValue({ mediaId: 'uuid-1' }) }));
vi.mock('../export/product-node', () => ({ createProductNode: vi.fn() }));
const runJob = vi.fn();
const pickSave = vi.fn();
vi.mock('../export/client', () => ({
  runExportJob: (...a: unknown[]) => runJob(...a),
  pickSaveFile: (...a: unknown[]) => pickSave(...a),
  ExportJobError: class extends Error { constructor(public category: string, m: string) { super(m); } },
}));
const detectCaps = vi.fn();
vi.mock('../capabilities', async (orig) => ({
  ...(await orig<typeof import('../capabilities')>()),
  detectExportCapabilities: () => detectCaps(),
}));

import { ExportModal } from './ExportModal';
import { useEditorStore } from '../store/editorStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useVideoEditorStore } from '@/stores/videoEditorStore'; // R4-1：startExport 三 getter 真值守卫的上下文

const clip = (id: string, mediaId: string, duration: number) => ({
  id, trackId: 'tv', type: 'video' as const, start: 0, duration, sourceStart: 0, mediaId, playbackSpeed: 1 as const,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});

beforeEach(() => {
  precheckApi.mockResolvedValue({ ok: true });
  detectCaps.mockResolvedValue({ video: true, audio: true });
  pickSave.mockResolvedValue(null); // jsdom 无 FSA
  runJob.mockImplementation((_p, cb) => {
    cb.onProgress('mix', 1);
    cb.onProgress('encode', 0.5);
    return { promise: Promise.resolve({ blob: new Blob(['x']), fsa: false }), cancel: vi.fn() };
  });
  useEditorStore.setState({
    status: 'ready',
    data: { version: 1, fps: 30, tracks: [{ id: 'tv', type: 'video', name: 'v', muted: false, hidden: false, clips: ['a'] }], clips: { a: clip('a', 'm1', 2) } },
    mediaInfo: { m1: { name: 'v', durationSec: 2, url: 'http://x' } },
    projectId: 'vp1', title: '多轨剪辑', // R4-1：startExport 守卫三 getter 的取值来源（缺这三处 → 静默 return → runJob 用例必红）
  } as never);
  useCanvasStore.setState({ projectId: 'wf1' } as never);
  useVideoEditorStore.setState({ sourceNodeId: 'edit1' } as never);
});

describe('ExportModal', () => {
  it('渲染选档（720p/1080p）+ 体积估算 + 校验通过态', async () => {
    render(<ExportModal open onClose={vi.fn()} />);
    expect(await screen.findByText(/720p/)).toBeTruthy();
    expect(screen.getByText(/预计体积/)).toBeTruthy();
    // R4-10：/720p/ 是 Radio 静态文本先于 caps 到达——not.toBeDisabled 必须等 caps 落地后断言（包 waitFor 防竞态）
    await waitFor(() => expect(screen.getByRole('button', { name: /开始导出/ })).not.toBeDisabled());
  });

  it('素材缺失（mediaInfo 无该 mediaId）→ 开始导出禁用 + 缺失提示', async () => {
    useEditorStore.setState({ mediaInfo: {} } as never);
    render(<ExportModal open onClose={vi.fn()} />);
    // R8-1：实现文案是"素材 m1 缺失或未加载（…）"——/素材缺失/ 要求两词相邻永不匹配（findByText 超时红，R1 起漏网）
    expect(await screen.findByText(/缺失或未加载/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: /开始导出/ })).toBeDisabled()); // R8-1②：caps 未落地时按钮天然禁用——包 waitFor 防假绿
  });

  it('配额预检失败（exportPrecheck reject）→ 禁用 + 配额提示', async () => {
    precheckApi.mockRejectedValue(new Error('存储配额不足'));
    render(<ExportModal open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/存储配额/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /开始导出/ })).toBeDisabled();
  });

  it('开始导出：调 runExportJob（params 含 data/resolution/mediaUrls）并展示两段进度', async () => {
    render(<ExportModal open onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /开始导出/ }));
    await waitFor(() => expect(runJob).toHaveBeenCalledTimes(1));
    const params = runJob.mock.calls[0][0];
    expect(params.resolution).toBe('720p'); // 默认档
    expect(params.mediaUrls).toEqual({ m1: 'http://x' });
    expect(await screen.findByTestId('export-progress')).toBeTruthy();
  });

  it('编码器不支持（detectExportCapabilities video=false）→ 拦截提示', async () => {
    detectCaps.mockResolvedValue({ video: false, audio: true });
    render(<ExportModal open onClose={vi.fn()} />);
    expect(await screen.findByText(/不支持 H.264/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /开始导出/ })).toBeDisabled();
  });
});
```

- [x] **Step 2: 跑测试确认失败**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/components/ExportModal.test.tsx
```
预期：FAIL（组件不存在）。

- [x] **Step 3: 实现 ExportModal.tsx**

```tsx
// apps/web/src/pages/canvas/video-editor/components/ExportModal.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Radio, Progress, Button, message } from 'antd';
import { useEditorStore } from '../store/editorStore';
import { totalDuration } from '../timeline/timecode';
import { runPrecheck, estimateSizeBytes, type ExportResolution } from '../export/precheck';
import { detectExportCapabilities } from '../capabilities';
import { exportPrecheck } from '@/api/videoProjectApi';
import { runExportJob, pickSaveFile, ExportJobError } from '../export/client';
import { uploadExportedProduct } from '../export/upload';
import { createProductNode } from '../export/product-node';

function fmtSize(bytes: number): string {
  return bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)}GB` : `${(bytes / 1024 ** 2).toFixed(0)}MB`;
}

export function ExportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const data = useEditorStore((s) => s.data);
  const mediaInfo = useEditorStore((s) => s.mediaInfo);
  const [resolution, setResolution] = useState<ExportResolution>('720p');
  const [caps, setCaps] = useState<{ video: boolean; audio: boolean } | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'config' | 'exporting'>('config');
  const [progress, setProgress] = useState<{ phase: 'mix' | 'encode'; ratio: number }>({ phase: 'mix', ratio: 0 });
  const [etaSec, setEtaSec] = useState<number | null>(null);
  const [fail, setFail] = useState<{ category: string; message: string } | null>(null);
  const [job, setJob] = useState<{ cancel(): void } | null>(null);
  const quotaReqRef = useRef(0); // R4-10：配额预检请求序号（切档竞态守卫）

  const durationSec = useMemo(() => (data ? totalDuration(data) : 0), [data]);
  const sizeBytes = useMemo(() => estimateSizeBytes(resolution, durationSec), [resolution, durationSec]);
  const precheck = useMemo(
    () => (data && caps ? runPrecheck(
      data,
      // R5-P1-6：传 id→url Record（含 undefined）——missing-media 与 missing-url 双拦截
      Object.fromEntries(Object.entries(mediaInfo).map(([id, i]) => [id, i.url])),
      caps,
    ) : null),
    [data, mediaInfo, caps],
  );

  useEffect(() => {
    if (!open) return;
    setPhase('config'); setFail(null); setQuotaError(null); setProgress({ phase: 'mix', ratio: 0 }); setEtaSec(null);
    // R5：补 catch——动态 import 失败（chunk 网络错）时 then 无 catch 会永 pending：按钮永久禁用且无提示
    void detectExportCapabilities().then(setCaps).catch(() => setCaps({ video: false, audio: false }));
  }, [open]);

  useEffect(() => {
    if (!open || !precheck || precheck.errors.length > 0) return;
    if (!currentCanvasProjectId()) return; // R4-1：workflowId 为空不发请求（否则拿 '' 打一次 4xx）
    setQuotaError(null);
    const req = ++quotaReqRef.current; // R4-10：序号守卫——快速切档时过期响应不得覆盖最新态
    exportPrecheck(currentCanvasProjectId(), sizeBytes)
      .catch((e: Error) => { if (quotaReqRef.current === req) setQuotaError(e.message || '存储配额不足'); });
  }, [open, precheck, sizeBytes]);

  // 导出中 beforeunload 拦截（spec §7.5/§8）——R5：preventDefault 外补 returnValue=''（Chromium 确认框要求）
  useEffect(() => {
    if (phase !== 'exporting') return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [phase]);

  const blocked = !!precheck && (precheck.errors.length > 0 || !!quotaError);

  const startExport = async () => {
    if (!data) return;
    if (!currentCanvasProjectId() || !currentEditorProjectId() || !currentEditorSourceNodeId()) {
      void message.warning('工程尚未就绪，请稍候重试'); // R4-1：静默 return 用户无感知——补提示
      return;
    } // R3-4：真值守卫（工程未就绪/上下文缺失不发单）
    setFail(null);
    const handle = await pickSaveFile(`${currentEditorProjectTitle() || '导出'}.mp4`); // 用户手势内（决策 4）
    const mediaUrls: Record<string, string> = {};
    for (const [id, info] of Object.entries(mediaInfo)) if (info.url) mediaUrls[id] = info.url;
    const j = runExportJob(
      { data, resolution, mediaUrls },
      { onProgress: (p, r) => setProgress({ phase: p, ratio: r }), onEta: setEtaSec },
      handle,
    );
    setJob(j); setPhase('exporting');
    try {
      const r = await j.promise;
      const file = r.fsa && handle ? await handle.getFile() : r.blob; // R3-1：按 fsa 标记择源（回退 Buffer 时读 blob，防 0 字节静默上传）
      const { mediaId } = await uploadExportedProduct({ workflowId: currentCanvasProjectId(), videoProjectId: currentEditorProjectId(), resolution, durationSec, file });
      createProductNode(currentEditorSourceNodeId(), currentEditorProjectId(), mediaId, currentEditorProjectTitle() || '多轨剪辑');
      void message.success('导出完成，已添加到画布');
      onClose();
    } catch (err) {
      if (err instanceof ExportJobError && err.category === 'canceled') { setPhase('config'); return; }
      const category = err instanceof ExportJobError ? err.category : 'unknown';
      // R2-后端语义：precheck 与 register 相隔数分钟，期间配额可能被他处占用 → register 400——文案特判
      const quotaHit = /存储空间不足|配额|quota/i.test((err as Error).message); // R3-3：后端实测文案为"存储空间不足"（storage-quota.service.ts:29）
      setFail({ category, message: quotaHit ? '存储配额在导出期间被占用，请清理团队存储后重试' : (err as Error).message });
      setPhase('config');
    } finally { setJob(null); }
  };

  return (
    <Modal
      open={open} title="导出视频" footer={null} onCancel={() => { if (phase !== 'exporting') onClose(); }}
      width={480} maskClosable={false}
    >
      {phase === 'config' && (
        <div className="flex flex-col gap-3 pt-2" data-testid="export-config">
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-[#1F2329]">清晰度</span>
            <Radio.Group value={resolution} onChange={(e) => setResolution(e.target.value)} options={[{ label: '720p', value: '720p' }, { label: '1080p', value: '1080p' }]} optionType="button" buttonStyle="solid" />
          </div>
          <div className="text-[12px] text-[#86909C]">
            时长 {Math.round(durationSec)}s · 预计体积 {fmtSize(sizeBytes)}{('showSaveFilePicker' in window) ? ' · 直写本地文件' : ' · 内存缓冲'}
          </div>
          {precheck?.errors.map((e, i) => <div key={i} className="text-[12px] text-[#F53F3F]">✕ {e.message}</div>)}
          {quotaError && <div className="text-[12px] text-[#F53F3F]">✕ 存储配额不足：{quotaError}</div>}
          {precheck?.warnings.map((w, i) => (
            <div key={i} className="text-[12px] text-[#FF7D00]">
              ⚠ {w.message}{typeof navigator !== 'undefined' && (navigator as unknown as { deviceMemory?: number }).deviceMemory !== undefined && (navigator as unknown as { deviceMemory: number }).deviceMemory <= 4 ? '（当前设备内存较低，强烈建议 720p）' : ''}
            </div>
          ))}
          {fail && <div className="text-[12px] text-[#F53F3F]">上次导出失败（{fail.category}）：{fail.message}——可重试或降 720p</div>}
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" disabled={blocked || !precheck} onClick={() => void startExport()} data-testid="export-start">开始导出</Button>
          </div>
        </div>
      )}
      {phase === 'exporting' && (
        <div className="flex flex-col gap-3 pt-2" data-testid="export-progress">
          <div className="text-[13px]">{progress.phase === 'mix' ? '离线混音中…' : '逐帧编码中…'}</div>
          <Progress percent={Math.round((progress.phase === 'mix' ? 0.2 : 0.2 + progress.ratio * 0.8) * 100)} status="active" strokeColor="#6C5CE7" />
          {etaSec != null && <div className="text-[12px] text-[#86909C]">预计剩余 {etaSec > 60 ? `${Math.floor(etaSec / 60)}分${Math.round(etaSec % 60)}秒` : `${Math.round(etaSec)}秒`}</div>}
          <div className="flex justify-end"><Button danger onClick={() => job?.cancel()}>取消导出</Button></div>
        </div>
      )}
    </Modal>
  );
}
```

**实现注意**：① 四个取值函数（R2-N11 改名 currentXxx——use 前缀在回调内调用会触发 react-hooks lint 误报；**R3-4：返回类型归一为 string（`?? ''`）**——projectId/sourceNodeId 均可空，直接透传 strict 下 TS2345）落地路径：`currentCanvasProjectId()` = `useCanvasStore.getState().projectId ?? ''`；`currentEditorSourceNodeId()` = `useVideoEditorStore.getState().sourceNodeId ?? ''`（剪辑节点 id，Task 9 createProductNode 首参）；`currentEditorProjectId()`/`currentEditorProjectTitle()` = editorStore 字段（`?? ''` 同款归一）（**R4-10：loadProject :132 已存 projectId/sourceNodeId/baseUpdatedAt——本 Task 只补 `title` 与 `teamId` 两字段**：入参类型（:45）+ state 声明 + loadProject 的 set + reset()（:138-143）四处；spec L241 title 初始取源节点名，byNode 返回整行已含；teamId 供 Task 12 useTeamAssets 团队上下文）；② `fail.category === 'memory'` 时文案追加"建议降 720p"（spec §7.6 重试/降档引导）；③ 硬编码进度映射 mix=0~20% / encode=20~100%（两段拼接展示）；④ antd Radio 两字按钮间空格（antd5 测试坑记忆——查询用 `/720p/` 正则已规避）；⑤ **R2-N12 登记（Task 10 review I-2 勘误后成立）**：导出中"收起"编辑器不拦截——Modal 随 Shell 卸载、进度 UI 丢失，但 Worker 继续跑到 done、产物登记与上画布（store 全局）照常产出、**beforeunload 仍拦关页（守卫已提升模块级、不随 Modal 卸载——commit 8cfe3da4 修复；原"监听在 Modal useEffect 内"的实现会在收起后失效，plan 初稿的该句是事实错误，已随修复落地）**——后台完成语义一期接受（spec 未要求，Task 13 验收知会）。同 commit 另修 startExport 在 pickSaveFile await 窗口的重入（startingRef 锁——双击=双 Worker 双上传双配额）。

- [x] **Step 4: EditorTopBar 与 Shell 接线**

EditorTopBar.tsx——导出按钮去 disabled 加回调。**R5-P2：现码 :22-23 有四处占位残留一起清**（`disabled`、`title="导出（Plan 4 开放）"`、`cursor-not-allowed`、`opacity-50`——只删 disabled 会"可点但显示禁用"）：

```tsx
export function EditorTopBar({ onClose, onManualRetry, onExport }: { onClose: () => void; onManualRetry?: () => void; onExport?: () => void }) {
  // ... 现有渲染不变，导出按钮整体替换（disabled/title/cursor-not-allowed/opacity-50 全清）：
  <button type="button" onClick={onExport} className="text-[14px] text-white bg-[#1F2329] rounded-full px-4 py-1.5 border-0">导出</button>
}
```

VideoEditorShell.tsx（**R8-5：现码 :1 react 具名导入仅 useEffect/useRef——useState 须一并补入**，否则 TS2339）：

```tsx
const [exportOpen, setExportOpen] = useState(false);
// EditorTopBar 传 onExport={() => setExportOpen(true)}
// Shell JSX 末尾（BaseFullscreenModal 内层 div 之后）挂：
<ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
```

（ExportModal 的 antd Modal 默认挂 body——z-index 高于编辑器壳可用；若被壳遮挡，Modal zIndex 提到 1100+。）

- [x] **Step 5: 跑测试 + 全量回归 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/components/ExportModal.test.tsx && pnpm -C apps/web exec tsc -b
git add apps/web/src && git commit -m "feat(video-editor): 导出弹层——选档/体积估算/四类前置校验/配额预检/两段进度/取消/beforeunload（TDD）"
```

---

### Task 11: AI 三按钮（A1 影子节点前端消费）

**Files:**
- Modify: `apps/web/src/stores/canvasCollabRuntime.ts`（+readNodeFileIdFromDoc）
- Modify: `apps/web/src/pages/canvas/video-editor/store/editorStore.ts`（shadowJobs/generatedMediaIds）
- Create: `apps/web/src/pages/canvas/video-editor/hooks/shadowJob.ts`（R2-N9：模块内无 hook 纯函数，改名 shadowJob 防误导）
- Modify: `apps/web/src/pages/canvas/video-editor/components/PreviewPlayer.tsx`（三按钮）
- Modify: `apps/web/src/pages/canvas/video-editor/components/AssetPanel.tsx`（生成结果分组）
- Modify: `apps/web/src/pages/canvas/video-editor/components/timeline/TimelinePanel.tsx`（:189-192 落轨 setMediaInfo 补 `mimeType: payload.mimeType`——R4-5②，与 Task 1 的 setMediaInfo 保 mimeType 双保险）
- Test: `shadowJob.test.ts`、`PreviewPlayer.ai.test.tsx`（新）、editorStore 既有测试文件追加

- [x] **Step 1: 写 editorStore 扩展失败测试（shadowJobs/generatedMediaIds）**

editorStore.test.ts 追加：

```ts
it('shadowJobs 状态机字段：startShadowJob/updateShadowJob/removeShadowJob + generatedMediaIds', () => {
  const s = useEditorStore.getState();
  s.startShadowJob('shadow-video-1', 'video');
  expect(useEditorStore.getState().shadowJobs['shadow-video-1']).toEqual({ kind: 'video', status: 'running' });
  s.updateShadowJob('shadow-video-1', { status: 'downloading' });
  expect(useEditorStore.getState().shadowJobs['shadow-video-1'].status).toBe('downloading');
  s.addGeneratedMedia('media-9', { name: '生成音频', durationSec: 10 });
  expect(useEditorStore.getState().generatedMediaIds).toEqual(['media-9']);
  expect(useEditorStore.getState().mediaInfo['media-9']).toMatchObject({ name: '生成音频', durationSec: 10 });
  s.removeShadowJob('shadow-video-1');
  expect(useEditorStore.getState().shadowJobs['shadow-video-1']).toBeUndefined();
});
```

- [x] **Step 2: 写 shadowJob 失败测试（决策 2 + R5-P1-4：进入即轮询读 ydoc 判完成——done 不消费，socket 只 race error；R6-P2-1 initial 早失败）**

```ts
// apps/web/src/pages/canvas/video-editor/hooks/shadowJob.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const statusHandlers = new Set<(p: unknown) => void>();
vi.mock('@/services/executionSocket', () => ({
  subscribeNodeStatus: (h: (p: unknown) => void) => { statusHandlers.add(h); return () => statusHandlers.delete(h); },
}));
const readDoc = vi.fn();
vi.mock('@/stores/canvasCollabRuntime', () => ({ readNodeFileIdFromDoc: (...a: unknown[]) => readDoc(...a) }));
const removeShadowApi = vi.fn();
const batchApi = vi.fn();
vi.mock('@/api/videoProjectApi', () => ({ removeShadowNode: (...a: unknown[]) => removeShadowApi(...a), regenerateNode: vi.fn() }));
vi.mock('@/api/mediaApi', () => ({ batchGetMedia: (...a: unknown[]) => batchApi(...a) }));
vi.mock('antd', () => ({ message: { success: vi.fn(), error: vi.fn() } }));

import { watchShadowJob } from './shadowJob';
import { useEditorStore } from '../store/editorStore';
import { useCanvasStore } from '@/stores/canvasStore';

beforeEach(() => {
  vi.resetModules(); statusHandlers.clear();
  readDoc.mockReset(); removeShadowApi.mockReset(); batchApi.mockReset();
  batchApi.mockResolvedValue([{ id: 'm9', url: 'http://u', originalName: 'a.mp3', mimeType: 'audio/mpeg', metadata: { durationSec: 9 } }]);
  removeShadowApi.mockResolvedValue(undefined);
  useCanvasStore.setState({ projectId: 'wf1' } as never); // R1（P1-7）：不设 projectId 则 finally 不调 removeShadowNode——断言必红
});
```

**测试写法说明**：状态机拆纯函数导出 `watchShadowJob(shadowNodeId: string, kind: 'video'|'audio', hint: {name: string; durationSec?: number}): Promise<void>`（订阅→done→轮询→收尾全流程），组件 hook 只做订阅绑定。测试直接调 `watchShadowJob`：

```ts
describe('watchShadowJob（A1 影子状态机——决策 2 读 doc 判完成）', () => {
  // R6-P1-B：readNodeFileIdFromDoc 是同步函数（string|null）——mock 必须用 mockReturnValue 系；
  // mockResolvedValue 返回 thenable（恒 truthy）会被 if (fid) 当"已命中"，用例 1 假通过、用例 2 必红
  it('doc 已有 fileId（轮询立即命中）：全流程成功（含 mimeType 回填）', async () => {
    readDoc.mockReturnValue('m9');
    const p = watchShadowJob('shadow-audio-1', 'audio', { name: 'x', durationSec: 9 });
    await p;
    const st = useEditorStore.getState();
    expect(readDoc).toHaveBeenCalledWith('shadow-audio-1');
    expect(batchApi).toHaveBeenCalledWith(['m9']);
    expect(st.generatedMediaIds).toContain('m9');
    expect(st.mediaInfo['m9'].url).toBe('http://u');
    expect(st.mediaInfo['m9'].mimeType).toBe('audio/mpeg'); // P1-7：拖拽判轨依据
    expect(removeShadowApi).toHaveBeenCalledWith('wf1', 'shadow-audio-1');
  });

  it('doc 未回写 → 2s 轮询直至出现；期间 done 到达被忽略（R5-P1-4：判完成唯一依据是 doc——fake timers）', async () => {
    vi.useFakeTimers();
    try { // R7-P3：失败路径不污染同文件后续用例（fake timers 必须恢复）
      readDoc.mockReturnValueOnce(null).mockReturnValueOnce(null).mockReturnValueOnce('m8');
      const p = watchShadowJob('shadow-audio-2', 'audio', { name: 'y' });
      // 干扰输入：注入 done 事件——断言它被忽略（轮询仍按 2s 节奏独立推进，不被 done 提前/错结）
      statusHandlers.forEach((h) => h({ nodeId: 'shadow-audio-2', status: 'done' }));
      await vi.advanceTimersByTimeAsync(2100);
      await vi.advanceTimersByTimeAsync(2100);
      await p;
      expect(readDoc).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });

  it('error 事件 → 失败提示 + removeShadow + 不入生成结果', async () => {
    const p = watchShadowJob('shadow-audio-3', 'audio', { name: 'z' });
    statusHandlers.forEach((h) => h({ nodeId: 'shadow-audio-3', status: 'error', error: '模型超时' }));
    await p;
    expect(removeShadowApi).toHaveBeenCalled();
    expect(useEditorStore.getState().generatedMediaIds).toEqual([]); // R1：原 not.toContain(expect.anything()) 是恒真无效断言
  });

  it('R6-P2-1：initial success=false（regenerate HTTP 已带失败结果）→ 立即失败不进轮询', async () => {
    readDoc.mockReturnValue(null); // 即便 doc 永无 fileId 也不该等到 120s
    const p = watchShadowJob('shadow-audio-4', 'audio', { name: 'w' }, { success: false, errors: ['扣费失败'] });
    await p;
    expect(removeShadowApi).toHaveBeenCalled();
    expect(useEditorStore.getState().generatedMediaIds).toEqual([]);
    expect(readDoc).not.toHaveBeenCalled(); // 未进轮询
  });
});
```

- [x] **Step 3: 实现**

canvasCollabRuntime.ts 追加导出（模块级 `doc` 变量已存在——L204/L226 实证）：

```ts
/** A1 影子产物读取（决策 2：spec"必须读 doc"——前端内存 ydoc 直读，零网络）。
 *  返回 null = doc 无该节点或尚无 fileId（ai-download 异步回写未完成）。
 *  R4-10：doc 形状已实证——fillDoc（ydocBuilder.ts:40-43）/后端 writeNodeData（collab-document.service.ts:82-93）
 *  均为 nodes→Y.Map、data→Y.Map、键名 fileId；instanceof 守卫替代 as 强转（结构异常返回 null 不抛）。 */
export function readNodeFileIdFromDoc(nodeId: string): string | null {
  if (!doc) return null;
  const node = doc.getMap('nodes').get(nodeId);
  if (!(node instanceof Y.Map)) return null;
  const data = node.get('data');
  if (!(data instanceof Y.Map)) return null;
  const fid = data.get('fileId');
  return typeof fid === 'string' ? fid : null;
}
```

editorStore.ts 追加（state 与 actions；**两新字段必须加进 reset()（:138-143）**——R1 核实 editorStore 无 openEditor，reset 是编辑器重开的清理点，漏加会跨工程残留）：

```ts
// state 字段：
shadowJobs: {} as Record<string, { kind: 'video' | 'audio'; status: 'running' | 'downloading' | 'error'; error?: string }>;
generatedMediaIds: [] as string[];
// actions：
startShadowJob(shadowNodeId: string, kind: 'video' | 'audio') { set((s) => ({ shadowJobs: { ...s.shadowJobs, [shadowNodeId]: { kind, status: 'running' } } })); },
updateShadowJob(shadowNodeId: string, patch: Partial<{ status: 'running' | 'downloading' | 'error'; error: string }>) { set((s) => ({ shadowJobs: { ...s.shadowJobs, [shadowNodeId]: { ...s.shadowJobs[shadowNodeId], ...patch } } })); },
removeShadowJob(shadowNodeId: string) { set((s) => { const next = { ...s.shadowJobs }; delete next[shadowNodeId]; return { shadowJobs: next }; }); },
// R1（P0-6）：mergeMediaInfo 形参是 Record<string, MediaInfo>（editorStore:157-163 Object.entries 消费）——非 entries 数组
addGeneratedMedia(mediaId: string, info: MediaInfo) { get().mergeMediaInfo({ [mediaId]: info }); set((s) => ({ generatedMediaIds: [...s.generatedMediaIds, mediaId] })); },
```

**MediaInfo 的 `mimeType?: string` 字段已在 Task 1 落地**（R4 前移——setMediaInfo 保护断言依赖该字段；P1-7 动机不变：生成结果拖拽 drop 按 mimeType 前缀判轨，缺字段拖音频轨被拒）。本 Task 不再重复扩接口。

（watchShadowJob 的 batchGetMedia 回填处同步写 mimeType：`mimeType = row.mimeType`——BatchMediaItem 含该字段；团队素材/上传路径的 mimeType 回填见 Task 12。）

shadowJob.ts：

```ts
// apps/web/src/pages/canvas/video-editor/hooks/shadowJob.ts
import { useEffect } from 'react';
import { message } from 'antd';
import { useEditorStore } from '../store/editorStore';
import { subscribeNodeStatus } from '@/services/executionSocket';
import { readNodeFileIdFromDoc } from '@/stores/canvasCollabRuntime';
import { removeShadowNode } from '@/api/videoProjectApi';
import { batchGetMedia } from '@/api/mediaApi';
import { useCanvasStore } from '@/stores/canvasStore';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

/** A1 影子状态机（决策 2 + R5-P1-4）：判完成唯一依据 = ydoc 影子节点 fileId 轮询，**进入即启动**（立即首探 + 2s 间隔、120s 超时）。
 *  R5-P1-4 勘误：regenerate 的 HTTP 响应晚于 execute 内首次 done（execution.service.ts:157-159）——事后订阅必错过首个 done；
 *  download job 失败/卡住时无第二次 done，纯等 done 会永挂。故 socket 仅贡献 **error 提前失败**，done 不再消费。
 *  成功/失败均 removeShadow 回流。 */
export async function watchShadowJob(
  shadowNodeId: string,
  kind: 'video' | 'audio',
  hint: { name: string; durationSec?: number },
  initial?: { success: boolean; errors?: string[] }, // R6-P2-1：regenerate HTTP 响应自带的 execute 结果——success=false 时立即失败（error 事件在订阅前已 emit，错过即 120s 干等）
): Promise<void> {
  useEditorStore.getState().startShadowJob(shadowNodeId, kind);
  useEditorStore.getState().updateShadowJob(shadowNodeId, { status: 'downloading' });
  try {
    if (initial && initial.success === false) throw new Error(initial.errors?.[0] || '生成失败');
    const fileId = await pollFileId(shadowNodeId);
    // 补 url/name/duration（batch 单查，mediaId=uuid）
    let name = hint.name; let durationSec = hint.durationSec; let url: string | undefined; let mimeType: string | undefined;
    try {
      const rows = await batchGetMedia([fileId]);
      const row = rows[0];
      if (row) {
        url = row.url;
        name = row.originalName || name;
        mimeType = row.mimeType; // P1-7：拖拽落轨按 mimeType 判 kind——缺失音频产物拖不进音频轨
        durationSec = (row.metadata as { durationSec?: number } | undefined)?.durationSec ?? durationSec;
      }
    } catch { /* 详情失败不阻断入库——url 后续 AssetPanel 刷新再补 */ }
    // R4-6：kind 兜底 mimeType——batch 失败是被显式容忍的路径，缺失会让条目 draggable=false 且无提示
    // （静默不可拖）；kind 是权威来源（watchShadowJob 入参），不重犯 N10 的音频错标 video（kind=audio 时给 audio/*）
    if (!mimeType) mimeType = kind === 'audio' ? 'audio/mpeg' : 'video/mp4';
    useEditorStore.getState().addGeneratedMedia(fileId, { name, durationSec, ...(url ? { url } : {}), mimeType });
    void message.success(kind === 'audio' ? '音频生成完成，已入资产面板' : '视频生成完成，已入资产面板');
  } catch (err) {
    useEditorStore.getState().updateShadowJob(shadowNodeId, { status: 'error', error: String((err as Error).message ?? err) });
    void message.error(`生成失败：${(err as Error).message ?? '未知错误'}`);
  } finally {
    const workflowId = useCanvasStore.getState().projectId;
    if (workflowId) void removeShadowNode(workflowId, shadowNodeId).catch(() => { /* 删除失败留影子，__ephemeral 全局排除不扣费 */ });
    useEditorStore.getState().removeShadowJob(shadowNodeId);
  }
}

/** doc 轮询（完成判据）+ socket error 提前失败（race，共用 settled 防双结算）。done 不消费（R5-P1-4）。 */
function pollFileId(shadowNodeId: string): Promise<string> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let off: () => void = () => {}; // R6-P3：占位先行——finish 与 off 互相引用，避免闭包前向引用可读性陷阱
    const finish = (fn: () => void) => { if (settled) return; settled = true; off(); if (timer) clearTimeout(timer); fn(); };
    off = subscribeNodeStatus((p) => {
      if (p.nodeId !== shadowNodeId || p.status !== 'error' || settled) return;
      finish(() => reject(new Error(p.error || '生成失败')));
    });
    const tick = () => {
      if (settled) return;
      const fid = readNodeFileIdFromDoc(shadowNodeId);
      if (fid) return finish(() => resolve(fid));
      if (Date.now() - start > POLL_TIMEOUT_MS) return finish(() => reject(new Error('产物下载超时（120s）')));
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
  });
}
```

（不建"收起清 shadowJobs"hook：编辑器关闭后 socket 订阅仍有效（单例画布级），在途 job 继续走到 done/error 由 finally 清态——重进编辑器 shadowBusy 状态正确延续；generatedMediaIds 若 editorStore openEditor 全量 reset 则随之清空，接受（跨会话拖入经画布产物节点路径）。useEffect import 若因删 hook 成孤儿则一并清。）

PreviewPlayer.tsx 控制条追加三按钮（紫色文字按钮组，播放控制右侧）：

```tsx
// PreviewPlayer.tsx 控制条（L34-74 区域）追加：
const playhead = useEditorStore((s) => s.playhead);
const selectedClipId = useEditorStore((s) => s.selectedClipId);
const data = useEditorStore((s) => s.data);
const shadowBusy = useEditorStore((s) => Object.keys(s.shadowJobs).length > 0);
const nodes = useNodeStore((s) => s.nodes); // 左面板可读整个 nodeStore（编辑器挂画布根层——spec §二 挂载结构）

// 添加字幕（本地——spec §4 表）：
const onAddSubtitle = () => {
  if (!data) return;
  let track = data.tracks.find((t) => t.type === 'subtitle');
  let trackId = track?.id;
  if (!trackId) { trackId = useEditorStore.getState().addTrack('subtitle'); } // addTrack 返回值以现码为准（若 void 则从 set 后 state 取尾轨）
  useEditorStore.getState().addSubtitleClip(trackId, playhead);
};
// 生成音频（R1 决策 3 定案：置灰 + 登记偏离——后端无 callAudioGen 执行分支，audioGen 影子会被当图片生成；
// R2-N9：无输入弹层无 state，仅渲染置灰按钮）
// 片段重拍：
const selectedClip = selectedClipId ? data?.clips[selectedClipId] : undefined;
const retakeSource = selectedClip && 'sourceNodeId' in selectedClip
  ? nodes[selectedClip.sourceNodeId as string] : undefined;
// R4-7：排除产物节点（type 同为 videoGen，但 origin='video-edit' 无 prompt/model）——后端 regenerate 只校验类型
// （video-project.service.ts:87-88），放行会空 prompt 触发一次真实生成/莫名失败；产物节点是终点不参与重拍（验收 13 口径）
const canRetake = retakeSource?.type === 'videoGen'
  && (retakeSource.data as { origin?: string } | undefined)?.origin !== 'video-edit'; // 仅真实视频分支（spec §4）——imageGen 源/产物节点置灰
const onRetake = () => {
  if (!retakeSource) return;
  Modal.confirm({
    title: '片段重拍', content: '将消耗团队积分，确认重新生成该片段的视频？',
    onOk: async () => {
      try {
        const workflowId = useCanvasStore.getState().projectId;
        if (!workflowId) return;
        const { shadowNodeId, result } = await regenerateNode({ workflowId, sourceNodeId: retakeSource.id, kind: 'video' });
        // R6-P2-1：result 透传——早失败（扣费失败/参数错）在 HTTP 往返内已 emit error（订阅错过），靠 initial 立即反馈
        void watchShadowJob(shadowNodeId, 'video', { name: `${(retakeSource.data as { label?: string })?.label ?? '重拍'}` }, result);
      } catch (err) {
        void message.error(`重拍请求失败：${(err as Error).message}`); // R7-P3：HTTP 4xx/网络错——antd confirm onOk reject 只停 loading 无任何提示
      }
    },
  });
};

// JSX（控制条按钮区，撤销/重做/分割/删除 之后）：
<div className="flex items-center gap-2 ml-2 pl-2 border-l border-[#E5E7EB]" style={{ borderLeftStyle: 'solid' }}>
  <button type="button" className="text-[12px] text-[#6C5CE7]" onClick={onAddSubtitle}>添加字幕</button>
  {/* R4-8：Chromium 不对 disabled 表单控件派发 mouse 事件——Tooltip 直接包 disabled 按钮无 hover（antd FAQ 同款），
      内包 <span className="inline-block"> 承接 mouseenter（验收 17 的 Tooltip 文案核对依赖此结构） */}
  <Tooltip title="音频生成暂未接入，待供应商接入后开放">
    <span className="inline-block">
      <button type="button" disabled className="text-[12px] text-[#6C5CE7] disabled:opacity-40" data-testid="gen-audio-btn">生成音频</button>
    </span>
  </Tooltip>
  <Tooltip title={canRetake ? '将消耗团队积分' : '选中带源视频片段后可重拍'}>
    <span className="inline-block">
      <button type="button" disabled={!canRetake || shadowBusy} className="text-[12px] text-[#6C5CE7] disabled:opacity-40" onClick={onRetake}>片段重拍</button>
    </span>
  </Tooltip>
</div>
```

（preflight:false 红线：border-l 配 borderLeftStyle solid 已写；button 字号写在自身 ✓。addTrack 返回值与 addSubtitleClip 的 trackId 参数语义以 editorStore 现码为准适配。生成音频恒 disabled——输入弹层与相关 state **不落地**（YAGNI），二期实化时再随 callAudioGen 一起恢复。新增 import（Modal/useNodeStore/useCanvasStore/regenerateNode/watchShadowJob）随改造一并加——**Tooltip 已在 PreviewPlayer.tsx:2 导入无需重复**（R4-8）。TimelinePanel.tsx:189-192 落轨 setMediaInfo 补一行 `mimeType: payload.mimeType`（R4-5②——payload.mimeType 就在手 :182-183 已消费，与 Task 1 的 setMediaInfo 保字段双保险）。）

AssetPanel.tsx 两处——① :18 全集资产 merge 补 `mimeType: i.mimeType`（R5-P2：AssetItem extends BatchMediaItem 含 mimeType，只传 name/duration/url 会让画布产物的 mimeType 永缺——落轨后 P0-7/R4-5 的保护链断在源头）；② "全集资产"分组之后加"生成结果"分组：

```tsx
const generatedMediaIds = useEditorStore((s) => s.generatedMediaIds);
const mediaInfo = useEditorStore((s) => s.mediaInfo);
// JSX（全集资产列表后）：
{generatedMediaIds.length > 0 && (
  <>
    <div className="px-3 pt-2 pb-1 text-[12px] font-medium text-[#4E5969]">生成结果</div>
    <ul className="list-none pl-0">
      {generatedMediaIds.map((mediaId) => {
        const info = mediaInfo[mediaId];
        return (
          // R1（P1-7）+R2-N10+R3-5：mimeType 必有才可拖（draggable 随其有无）——拒绝来源不明资产，而非错型入库；
          // 空串/缺失判 image 落视频轨会建空白图片片，'video/mp4' 兜底会把音频产物建成 video 片黑屏
          <li key={mediaId} draggable={Boolean(info?.mimeType)} onDragStart={(e) => e.dataTransfer.setData('application/x-clip', JSON.stringify({ mediaId, mimeType: info?.mimeType ?? '', originalName: info?.name ?? mediaId, durationSec: info?.durationSec }))} className="...">
            {/* 与全集资产条目同款缩略图+名称+时长布局——拷贝现有条目 JSX 改数据源 */}
          </li>
        );
      })}
    </ul>
  </>
)}
```

（条目 JSX 与全集资产同款拷贝；sourceNodeId 省略——素材库来源不建边 ✓ spec §二 规则 1；mimeType 来源见 watchShadowJob 的 batchGetMedia 回填。）

- [x] **Step 4: PreviewPlayer AI 按钮测试（组件级）**

```tsx
// PreviewPlayer.ai.test.tsx 核心 3 用例（mock 同文件既有 PreviewPlayer.test.tsx 的 store/media 结构）：
it('添加字幕：播放头处建 3s 字幕片段（无字幕轨时先建轨）', async () => {
  // 夹具 data 无 subtitle 轨 → click 添加字幕 → tracks 多一条 subtitle 轨 + clips 多 3s SubtitleClip
});
it('生成音频恒置灰（决策 3 登记偏离）', () => {
  // button[data-testid=gen-audio-btn] disabled 恒真——无 audioGen 节点也置灰（后端无执行分支）
});
it('片段重拍全流程：选中带 sourceNodeId 的视频片段 → 积分确认 Modal → regenerateNode(kind:video) → watchShadowJob 驱动', async () => {
  // mock regenerateNode resolve { shadowNodeId: 's1' }、mock watchShadowJob——断言 kind:'video' 与源节点 id
});
it('选中图片片段（imageGen 源）→ 片段重拍置灰', () => {
  // canRetake false 断言
});
it('源是产物节点（videoGen + origin=video-edit）→ 片段重拍置灰（R4-7：产物节点是终点不参与重拍——后端只校验类型会放行空 prompt 生成）', () => {
  // 夹具 nodes：sourceNodeId 指向 { type:'videoGen', data:{ origin:'video-edit', fileId:'f', label:'x' } } 节点
  // → canRetake false 断言（disabled）
});
```

- [x] **Step 5: 跑测试 + 全量回归 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/ && pnpm -C apps/web exec tsc -b
git add apps/web/src && git commit -m "feat(video-editor): AI 三按钮——添加字幕/片段重拍（生成音频置灰登记偏离）+ 生成结果入资产面板 + ydoc 影子读取（TDD）"
```

---

### Task 12: 遗留①——资产面板团队素材实化 + "+新建"上传

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/hooks/useTeamAssets.ts`
- Modify: `apps/web/src/pages/canvas/video-editor/components/AssetPanel.tsx`
- Test: `useTeamAssets.test.ts`、AssetPanel.test.tsx 追加

- [x] **Step 1: 写 useTeamAssets 失败测试**

```ts
// apps/web/src/pages/canvas/video-editor/hooks/useTeamAssets.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react'; // R5：act 支撑 teamId 后置写入用例

const getFiles = vi.fn();
vi.mock('axios', () => ({ default: { get: (...a: unknown[]) => getFiles(...a) } }));

import { useTeamAssets } from './useTeamAssets';

beforeEach(() => { getFiles.mockReset(); });

describe('useTeamAssets（团队素材库实化——spec §4 左面板"全集资产 = 画布产物 + 团队素材库"）', () => {
  it('GET /api/material/files（无 folderId 全量）→ 过滤 video/audio/image mimeType → mediaId 条目', async () => {
    getFiles.mockResolvedValue({
      data: { success: true, data: [
        { id: 'mv1', originalName: 'a.mp4', mimeType: 'video/mp4', url: 'https://minio/flowai/a', thumbnailUrl: null },
        { id: 'ma1', originalName: 'b.mp3', mimeType: 'audio/mpeg', url: 'https://minio/flowai/b' },
        { id: 'mi1', originalName: 'c.png', mimeType: 'image/png', url: 'https://minio/flowai/c' },
        { id: 'mx1', originalName: 'd.pdf', mimeType: 'application/pdf', url: 'https://minio/flowai/d' },
      ] },
    });
    const { result } = renderHook(() => useTeamAssets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map((i) => i.mediaId)).toEqual(['mv1', 'ma1', 'mi1']); // pdf 剔除
    expect(result.current.items[0].url).toContain('/flowai/a');
  });
  it('接口失败 → 空列表不抛错', async () => {
    getFiles.mockRejectedValue(new Error('net'));
    const { result } = renderHook(() => useTeamAssets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
  });
  it('editorStore.teamId 非空 → 请求带 teamId query（R4-9：画布团队对齐，material files 回落默认团队）', async () => {
    getFiles.mockResolvedValue({ data: { success: true, data: [] } });
    const { useEditorStore } = await import('../store/editorStore');
    useEditorStore.setState({ teamId: 'team-9' } as never);
    const { result } = renderHook(() => useTeamAssets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getFiles).toHaveBeenCalledWith('/api/material/files?teamId=team-9');
    useEditorStore.setState({ teamId: null } as never); // 清理——不污染其它用例
  });
  it('R5-P1-5：挂载时 teamId 为 null（loadProject 未回）→ 先默认团队；teamId 到达后自动重拉带 query', async () => {
    getFiles.mockResolvedValue({ data: { success: true, data: [] } });
    const { useEditorStore } = await import('../store/editorStore');
    useEditorStore.setState({ teamId: null } as never);
    const { result } = renderHook(() => useTeamAssets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getFiles).toHaveBeenLastCalledWith('/api/material/files'); // 首次：默认团队
    act(() => useEditorStore.setState({ teamId: 'team-9' } as never)); // loadProject 异步回写（真实时序）
    await waitFor(() => expect(getFiles).toHaveBeenLastCalledWith('/api/material/files?teamId=team-9'));
    useEditorStore.setState({ teamId: null } as never); // 清理
  });
});
```

- [x] **Step 2: 写 AssetPanel 上传用例（追加到 AssetPanel.test.tsx）**

**R4-10：挂 useTeamAssets 后组件 mount 即发 axios.get——既有 AssetPanel 用例会打真 XHR（jsdom → localhost，被 catch 但慢且吵）。文件顶部（既有 mock 区）先加 axios mock（句柄模块级暴露，下方上传用例断言复用）**：

```ts
const axiosGet = vi.fn().mockResolvedValue({ data: { success: true, data: [] } });
const axiosPost = vi.fn().mockResolvedValue({ status: 200 });
vi.mock('axios', () => ({ default: { get: (...a: unknown[]) => axiosGet(...a), post: (...a: unknown[]) => axiosPost(...a) } }));
```

上传用例本体：

```tsx
it('"+新建"上传：presignUpload → FormData POST → confirmUpload → 刷新团队素材 + mergeMediaInfo（遗留①：上传产物入面板）', async () => {
  const presign = vi.fn().mockResolvedValue({ fileId: 'up-1', uploadUrl: 'https://minio/flowai/up', key: 'k', fields: { policy: 'p' } });
  const confirmUp = vi.fn().mockResolvedValue({});
  // mock '@/api/storageApi' { presignUpload, confirmUpload }；axios 已由文件顶部统一 mock（axiosPost 句柄复用）
  // 夹具 file → 触发 input change（fireEvent.change(input, { target: { files: [file] } })）
  // 断言：presign 以 type:'uploaded' **且 projectId 透传**（R4-9——画布团队归属）调用；confirmUp({fileId:'up-1',...}); 团队素材列表刷新含 up-1
  // （夹具前置：useCanvasStore.setState({ projectId: 'wf1' })——expect(presign).toHaveBeenCalledWith(expect.objectContaining({ type: 'uploaded', projectId: 'wf1' }))）
});
```

- [x] **Step 3: 实现**

```ts
// apps/web/src/pages/canvas/video-editor/hooks/useTeamAssets.ts
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useEditorStore } from '../store/editorStore'; // R5-P2-3：load 内消费 store——无 import 则 TS2304

export interface TeamAssetItem { mediaId: string; name: string; mimeType: string; url?: string; thumbnailUrl?: string | null; durationSec?: number; }

const MEDIA_MIME_PREFIXES = ['video/', 'audio/', 'image/'];

/** 团队素材库（material files 接口全量——folderId 不传）。
 *  mediaId = file.id（MaterialService 查 Media 表同源——执行时核实 getFilesByFolderId 返回的 id 即 mediaId）。
 *  url 经 /flowai 同源改写（materialLibraryStore L131-137 同款）。
 *  R4-9：teamId 取画布所属团队（editorStore.teamId——Task 10 loadProject 存，byNode 返回整行含 teamId）——
 *  画布属非默认团队时面板展示的是该团队素材（与上传侧 presign projectId 解析同源；file.controller:15-23 透传 teamId query ✓）。
 *  teamId 为空（理论上编辑器打开后必非空）回落默认团队。 */
export function useTeamAssets(refreshKey?: number): { items: TeamAssetItem[]; loading: boolean } { // R8-5：reload 无消费者已删
  const [items, setItems] = useState<TeamAssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  // R5-P1-5：teamId 必须 selector 订阅（非 getState 快照）——AssetPanel 随 Shell 打开即挂载，loadProject 是
  // async（upsert 返回后才写 teamId），首次 effect 时 getState().teamId 恒 null → 请求默认团队且不再重跑。
  const teamId = useEditorStore(s => s.teamId);
  const reqRef = useRef(0); // R6-P2-2：teamId null→实值切换时两个 in-flight 并存——先发响应后到会覆盖新态，序号守卫同 ExportModal quotaReqRef 模式
  const load = () => {
    const req = ++reqRef.current;
    setLoading(true);
    // R1（P1-9）：绝不传 type 参数——material.service.ts:29 传 type 会强制 where.type='generated' 滤掉 uploaded！
    // 也不传 folderId：不传只返回根目录文件（service:26 where folderId null）——一期接受，登记（深层目录素材经素材库管理入口移动）
    axios.get(teamId ? `/api/material/files?teamId=${encodeURIComponent(teamId)}` : '/api/material/files')
      .then((res) => {
        if (reqRef.current !== req) return; // 过期响应丢弃（新请求已发出）
        const files = (res.data?.data ?? []) as Array<Record<string, unknown>>;
        const mapped = files
          .filter((f) => typeof f.mimeType === 'string' && MEDIA_MIME_PREFIXES.some((p) => (f.mimeType as string).startsWith(p)))
          .map((f) => ({
            mediaId: String(f.id),
            name: String(f.originalName ?? f.name ?? f.id),
            mimeType: String(f.mimeType),
            url: typeof f.url === 'string' ? f.url.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai') : undefined,
            thumbnailUrl: typeof f.thumbnailUrl === 'string' ? f.thumbnailUrl.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai') : null,
            durationSec: (f.metadata as { durationSec?: number } | null)?.durationSec,
          }));
        setItems(mapped);
        // P1-9：团队素材必须进 mediaInfo——否则 addClip 兜底 5s、渲染/导出缺 url 黑帧（P0-7 修复后 url 不再被 drop 擦除）
        useEditorStore.getState().mergeMediaInfo(Object.fromEntries(mapped.map((m) => [m.mediaId, {
          name: m.name, durationSec: m.durationSec, url: m.url, mimeType: m.mimeType,
        }])));
      })
      .catch(() => { if (reqRef.current === req) setItems([]); }) // 守卫同 then——过期失败不清新列表
      .finally(() => { if (reqRef.current === req) setLoading(false); }); // 过期请求的 finally 不得提前清掉新请求的 loading
  };
  useEffect(load, [refreshKey, teamId]); // eslint-disable-line react-hooks/exhaustive-deps —— R5-P1-5：teamId 进 deps、null→实值自动重拉（load 为组件内函数，本仓惯例直接抑制）；R8-5：原稿 reload 无消费者已删（AssetPanel 经 teamKey→refreshKey 触发重拉）
  return { items, loading };
}
```

**执行核实点（响应实形）**：material files 返回字段名（id/originalName/mimeType/url/thumbnailUrl/metadata）以 `material.service.ts getFilesByFolderId` 的 select 与 `materialLibraryStore.loadFiles`（L119-139）消费实形为准——若 url/thumbnailUrl 已是后端改写好的相对路径则去掉前端 replace；axios baseURL 前缀按 materialLibraryStore 同款（直接 '/api/material/files'）。

AssetPanel.tsx——全集资产分组后加"团队素材"分组 + 顶部"+新建"上传：

```tsx
const [teamKey, setTeamKey] = useState(0); // 上传完成后 +1 触发团队素材刷新
const [uploading, setUploading] = useState(false); // R4-10：声明补全——按钮 loading/disabled 消费
const team = useTeamAssets(teamKey);
// "+新建"（搜索框右侧；uploading 态 label 加 disabled 样式防重复选文件）：
<label className={`...紫色文字按钮样式...${uploading ? ' opacity-40 pointer-events-none' : ''}`} data-testid="asset-upload-btn">
  + 新建
  <input type="file" className="hidden" accept="video/*,audio/*,image/*"
    onChange={async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      setUploading(true);
      try {
        // R4-9：传 projectId——后端解析画布 teamId + assertMember（storage.service.ts:20-24 三级回落第 1 级），
        // 不传落用户默认团队：画布属非默认团队时上传归属错团队且计其配额（素材库页 materialLibraryStore:218-219 两者都传同款动机）
        const { fileId, uploadUrl, key, fields } = await presignUpload({ fileName: file.name, fileSize: file.size, fileType: file.type, type: 'uploaded', projectId: useCanvasStore.getState().projectId ?? undefined });
        const fd = new FormData();
        Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
        fd.append('file', file);
        await axios.post(uploadUrl.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai'), fd);
        await confirmUpload({ fileId, key, fileSize: file.size });
        setTeamKey((n) => n + 1); // 刷新团队素材列表——url/durationSec/mimeType 由 useTeamAssets 的 load 内统一 mergeMediaInfo 回填（R1：上传回调不再手写 merge，Record 形状由 load 统一处理）
        void message.success('上传完成');
      } catch (err) { void message.error(`上传失败：${(err as Error).message}`); }
      finally { setUploading(false); }
    }} />
</label>

// 团队素材分组（全集资产之后、生成结果之前——spec L280 顺序：全集资产在前）：
<div className="px-3 pt-2 pb-1 text-[12px] font-medium text-[#4E5969]">团队素材</div>
<ul className="list-none pl-0">
  {team.items.map((it) => (
    <li key={it.mediaId} draggable onDragStart={(e) => e.dataTransfer.setData('application/x-clip', JSON.stringify({ mediaId: it.mediaId, mimeType: it.mimeType, originalName: it.name, durationSec: it.durationSec }))}
      className="...与全集资产条目同款布局...">
      {/* 缩略图/名称/时长——团队素材无"已添加"标记派生（addedMediaIds 判定天然生效：mediaId 相同即显示） */}
    </li>
  ))}
</ul>
{team.items.length === 0 && !team.loading && <div className="px-3 py-2 text-[12px] text-[#86909C]">暂无团队素材</div>}
```

（原 L54-55 死占位 `团队素材（Plan 3）` 删除；拖拽 payload 与全集资产同构——addClip 消费 mediaId 落轨。）

- [x] **Step 4: 跑测试 + 全量回归 + 提交**

```bash
pnpm -C apps/web exec vitest run src/pages/canvas/video-editor/hooks/useTeamAssets.test.ts src/pages/canvas/video-editor/components/AssetPanel.test.tsx && pnpm -C apps/web exec tsc -b
git add apps/web/src && git commit -m "feat(video-editor): 资产面板全集范围实化——团队素材分组 + 新建上传走 presign（遗留①，TDD）"
```

---

### Task 13: 29 条全量浏览器验收 + 回归 + 完成判定

**Files:** 无新文件（修复改对应源文件；本任务勾选全部 checkbox 并写执行期验收记录）

- [x] **Step 1: 启动环境并准备素材**

按项目启动流程记忆（本地 PG/Redis/MinIO + api(3000)/web(5173)）。素材：Plan 3 验收遗留的注入媒体（985e5a36 10.1s 带音轨视频 / 纯视频 5.4s / 0.png / mp3）+ 经 `useCanvasStore.addNode(type, pos, { fileId, status:'done' })` 建产物节点（Plan 3 Task 14 预授权路径；**status 用 'done'**——R1：'success' 不在 nodeStore 联合类型 'idle'|'loading'|'done'|'error' 内，显示虽不受影响但夹具应对齐真实类型）；片段重拍验收需画布含真实 videoGen 节点（data.model 有效——积分消耗真实发生，**涉及第三方 API 费用，执行前征询用户**；不可行时降级为 API 层单测佐证 + socket 状态机活模块直驱佐证并登记）。

- [x] **Step 2: Plan 4 重点条目逐项验收（preview 工具）**

| spec 条目 | 验收点 | 手段 |
|---|---|---|
| 11 | 导出 720p/1080p E2E：弹层选档→进度→完成 toast；素材库"视频"tab 可见产物（generated 通道，缩略图为 0.1×时长处帧非第 1 秒黑场） | preview 全流程 + DB 查询（psql 经 Prisma 查 Media）|
| 12 | 产物节点自动创建 + auto-out 边、位置右侧水平排开；重复导出独立节点（导出 1/导出 2）；工具栏收敛（隐藏 高清/解析/音频分离/截帧；保留 剪辑/下载/全屏）；旧 trim 可用 | snapshot + 点击核对 |
| 13 | 画布同时含空剪辑节点 + 已导出产物节点 → "全部执行"只跑真正待生成节点（两类跳过、不报错不扣费、无 loading 闪烁） | 画布操作 + Network/DB |
| 14 | WebCodecs 不支持：入口按解码能力置灰（Plan 2 已验，回归）；导出弹层 VideoEncoder 检测拦截文案 | 回归 + 弹层文案核对 |
| 16 | 导出中取消（进度条取消按钮→terminate）；导出中关闭页面 beforeunload 拦截；反复进出编辑器 10 次无 AudioContext 泄漏（Plan 3 已验，回归） | 操作 + console 计数 |
| 17 | **片段重拍 A1（单分支——生成音频已登记偏离置灰，决策 3）**：积分明示（Modal 确认）、shadowNodeId 回流、__ephemeral 不闪现（画布无重排——Plan 2 onRemote 短路）、产物入"生成结果"分组可拖入时间轴（音频 mimeType 拖对应轨实测以重拍视频产物为准）；生成音频按钮置灰 + Tooltip 文案核对 | preview + 活模块直驱 |
| 18 | 配额不足导出前拦截（exportPrecheck 4xx→弹层禁用+提示）；删除剪辑节点后 VideoProject 级联删除（DB 核对）；上游素材删除后片段标红且导出弹层 missing-media 拦截 | DB + 操作 |
| 22 | A1 全程画布无闪烁（onRemote shadow- 短路——节点列表/分组 bounds 无重排） | 活模块直驱 + 观察 |
| 23 | 存量节点 data 的 regenerate 成功（含嵌套 prompt 对象节点 JSON 深拷） | 活模块直驱 |
| 24 | 产物上传直传：presigned POST FormData 2xx、confirm statObject 实际大小落库（无 ±1024 误杀） | Network + DB size 字段核对 |
| 25 | Socket 单例：打开 N 个视频/音频/图片节点后 /execution 实例数 1（DevTools WS 连接数）；卸载不残留；subscribeNodeStatus 收到不在 nodeStore 的 shadowNodeId 事件 | DevTools Network WS 面板 |
| 28 | 图片 AI 编辑结果回流：editMode 编辑完成经 subscribeNodeEditResult 回填 fileId 退出编辑态（**坏监听修复实证**——需真实图片编辑链路，不可行时单测佐证+登记） | 操作/单测佐证 |
| 29 | 孤儿 auto 边（Plan 2 单测已验）：删剪辑节点后 ydoc `auto:{editId}:*` 消失、删产物节点后 `auto-out:*` 消失、重开画布无悬空 | 操作 + 活模块读 doc |
| —（遗留①） | 团队素材分组出数据（uploaded/generated 全可见）可拖入三类轨；"+新建"上传走 presign 入面板 | preview 全流程 |
| —（遗留②） | 首开编辑器 url 回填前 seek 缺图片层 → url 就绪后自动补帧出画（无需再次 seek——R2-N1② 代数尾追后为强保证，与 Task 1 口径一致） | 快速操作验证 |
| —（遗留③） | openSink 失败 console 有 `[video-cache]` warn（可临时改坏一个 url 实测） | console_logs |
| —（FSA） | Chromium 下导出前弹保存位置选择器、导出产物直写本地文件可播放；产物同时正确登记上传（fileHandle.getFile 双通道） | preview 全流程 + 本地文件播放 |
| —（音画） | 导出 MP4 音画同步、变速段音调不变、crossfade 段音频线性淡化（与预览听感一致） | 本地播放器人工判定 |
| —（R6/R7 AAC 冒烟） | native 分支真实编码已在 Task 8 Step 6 冒烟（音画同步）；polyfill 分支**登记为发布前人工验证项**（R7-P2-2：`--disable-blink-features=WebCodecs` 连 VideoEncoder 一起禁——precheck 即拦、导出走不完，原手段作废；开发机 Chromium native AAC 恒可用、无法复现 native-false） | Task 13 复跑一次 native 冒烟回归（Task 9-12 改动后）；polyfill 守卫序列（注册→复测→仍 false 抛 unsupported）由 Task 4 capabilities.test 同款逻辑单测佐证 + 随完成记录登记人工验证 |

- [x] **Step 3: 其余条目快速回归（1-10/15/19-21/26-27）**

Plan 1-3 已验条目回归走查（冒烟级：菜单入口/连线同步/撤销互斥/自动保存/快捷键隔离/预览播放/字幕/转场/关键帧），发现回归缺陷按 TDD 修复复验。

**随验收登记的 spec 覆盖边界（R1/P2 定案）**：① spec §L121 左面板"已连线"次级标记——可选项，一期不做（登记）；② spec §L359 Safari 四能力矩阵降级提示——本 plan 仅实现 Chromium/Firefox 实测，Safari 矩阵与前置 UI 降级登记为发布前人工验证项；③ "生成结果"分组、资产面板分组顺序（全集资产→团队素材→生成结果）、拖拽 payload 形状、导出按钮预置灰均为**实现自定**（spec 未明文，验收按本 plan 定案核对）；④ **R5 登记重拍"可替换"语义**：spec §四"新视频入库可替换"——一期实现为"产物入生成结果分组、人工拖入时间轴原位附近替换"（无自动替换选中片段动作），按人工拖替口径验收；⑤ **R8-3 登记重拍 HTTP 语义**：regenerate 的 HTTP 响应等整轮生成结束才返回（execution.service :97 await）——生成段进度由 Modal confirm loading 承载（shadowJobs 状态只覆盖下载落库段）；网络层失败（生产网关超时截断等）时影子节点不可回收残留（__ephemeral 不渲染不扣费，ydoc 留垃圾）——一期接受，二期候选"前端预生成 shadowNodeId + 先订阅后发请求"（见后续节）。

- [x] **Step 4: 缺陷修复循环**

发现 → 复现测试 → TDD 修复 → 复验（缺陷与修复登记回本文件执行期记录）。

- [x] **Step 5: 全量回归 + 提交收尾**

```bash
pnpm -C apps/web exec tsc -b
pnpm -C apps/web test && pnpm -C apps/api test
git add -A && git commit -m "test(video-editor): Plan 4 浏览器验收通过（29 条全量 + 遗留①②③闭环 + FSA/直传/单例实测）"
```

- [x] **Step 6: 写执行期验收记录与完成判定**（沿用 Plan 3 格式：逐项结论表 + 发现登记 + 完成判定清单——tsc 0 error、web/api 全绿、29 条覆盖说明、登记偏离汇总）

---

## Plan 4 完成判定

- `pnpm -C apps/web exec tsc -b` 0 error；`pnpm -C apps/web test` 全绿（预计新增 65+ 用例：socket 单例 6 + precheck/eta ~12 + mixdown 9 + controller 8 + client 3 + ExportModal 5 + upload/product-node 5 + 工具栏 1 + VideoGenNode 标题 1 + shadowJob 4 + AI 按钮 5 + teamAssets 4 + AssetPanel 上传 1 + 遗留②③+url 保护 4）；`pnpm -C apps/api test` 全绿（precheck 2）
- spec 附录 B 阶段 7/8 落地核对：
  - 阶段 7：Worker 导出 controller（mock 先行 ✓）→ 真实编码 E2E（Task 8/13 ✓）→ 产物登记 + 产物节点上画布（Task 10 ✓，origin 标记 + 工具栏全量收敛 ✓）
  - 阶段 8：socket 单例前置（Task 2/3，5 创建点 ✓）→ AI 三按钮（Task 11，A1 契约 ✓——添加字幕/片段重拍落地，生成音频置灰登记偏离）→ 护栏（Task 4/10，§8 边界表 ✓）→ 29 条验收（Task 13 ✓）
- 遗留①②③全部闭环（Task 12/1 + 验收实测）
- 登记偏离汇总（写进完成记录）：**生成音频置灰——后端无 callAudioGen 执行分支，spec §4 该项与验收 17 对应分支偏离，二期随音频供应商接入实化（决策 3 用户拍板）**；node:edit-result 坏监听修复（决策 1——spec v3.5 R7 轮记载被实测证伪）；**Worker 音频装配换 AudioSampleSource raw f32（决策 8 R5 勘误——Web Audio [Exposed=Window] 不进 Worker，spec §七 L342 同一假设需勘误）**；VideoFrame close 纪律等价断言（决策 6，spec §九 L382）；mixdown 128 样本块（决策 9）；FSA 优先/Buffer 回退 + createWritable 失败回退（决策 4 用户拍板）；收起不 fitView + addNode 抢选中态登记（决策 5 用户拍板）；done 消息 buffer transfer 零拷贝（R5-P1-3）；watchShadowJob done 不消费、doc 轮询唯一判据 + regenerate result 早失败透传（R5-P1-4/R6-P2-1）；missing-url 前置拦截（R5-P1-6）；Worker AAC polyfill 注册后复测守卫（hasAudio 条件式下沉，R7-P2-1）+ native 冒烟提前 Task 8 Step 6 / polyfill 分支登记发布前人工验证（R6-P2-3/R7-P2-2）；ETA 消息每 30 帧节流；码率 5/12Mbps 实现自定口径（决策 10）；material files 仅根目录（folderId 不传）；"已连线"标记、Safari 矩阵与重拍"人工拖替"口径登记（Task 13 Step 3）
- **AI 三按钮真实积分消耗验收（Task 13 Step 1）执行前征询用户**——不可行时降级佐证并登记

## 后续（无 Plan 5）

spec v3.6 全部范围（附录 B 阶段 0-8）随本 plan 收官。二期候选（spec YAGNI 节登记，不在本期）：服务端导出、自定义转场参数、多比例、断点续传、音频分块流式混音、等功率 crossfade、重拍前端预生成 shadowNodeId（RegenerateDto 可选参数——消除 HTTP 长挂与网络失败留影子，R8-3）。


---

## 执行期验收记录（Task 13，2026-09-11）

### 浏览器实测通过（preview 工具，Chromium + 本地全栈）

| 条目 | 结论 | 证据 |
|---|---|---|
| spec 11 导出 E2E | ✅ | UI 全流程：导出按钮（已激活）→ 弹层（选档/时长/预计体积/"直写本地文件"提示/开始按钮可点）→ 两段进度（mix→encode 100%+eta）→ 完成 Modal 关闭 |
| spec 12 产物节点 | ✅ | "多轨剪辑 · 导出 1"自动上画布（右侧偏移）+ auto-out 确定性边；重复导出"导出 2"（x+400）+ 第二条边；工具栏收敛（剪辑/裁剪/下载/全屏保留，高清/解析/截帧/音频分离隐藏） |
| spec 16 取消导出 | ✅ | mix 阶段取消 → terminate → 回 config 态可重开 |
| spec 24 直传三步 | ✅ | DB 实查：Media status='completed'、size=10852424 与本地 blob 精确一致（无 ±1024 误杀）、metadata 完整（resolution/durationSec 16.5/videoProjectId） |
| spec 17 生成音频置灰 | ✅ | 恒 disabled + Tooltip；添加字幕可点 |
| 遗留① 团队素材 | ✅ | 资产面板三分组齐（全集资产/团队素材/生成结果），团队素材分组**出数据**（uploaded 素材可见、8 个 draggable 条目） |
| AAC native 真实编码 | ✅ | Task 8 冒烟：产物经 mediabunny Input 读轨 = video(avc) + **audio(aac)** 双轨（修复前仅 avc）、16.5s、960×540 |
| 回归冒烟 | ✅ | 添加字幕（3s 片建轨）+ 撤销/重做闭环；编辑器正常打开（reset/ready） |
| 全量回归 | ✅ | tsc -b 0 error；web 241 文件 2419 用例全绿；api 127 文件 983 用例全绿 |

### 单测佐证 + 登记条目

- **spec 25 socket 单例**：架构保证（5 创建点全迁 subscribe 不建连）+ executionSocket 6+2 用例；**真机 DevTools WS 面板核对登记人工验证**。
- **spec 18 配额 4xx**：exportPrecheck 端点单测（配额不足透抛）+ ExportModal 拦截分支单测；真实配额打满未造（影响环境）。
- **遗留② url 回填补帧**：Task 1 单测强保证（含代数尾追 pending 路径）；浏览器时序难造（url 由 batchGetMedia 首开回填，实测加载完成即有）。
- **遗留③ openSink warn**：Task 1 单测（三形态 warn 计数+冷却）；浏览器实测被 VideoCacheService entry 缓存防御（同 mediaId 不重开 sink）——坏 url 仅对**新** mediaId 触发，属缓存正确行为。
- **spec 13 全部执行跳过**：画布层"全部执行"按钮未在可视区定位；跳过逻辑（origin 排除/done 跳过）有单测。
- **spec 29 孤儿边 / 18 级联删除**：Plan 2/3 单测与验收覆盖；本轮未重复删节点（保护测试数据）。
- **spec 28 图片 AI 编辑回流**：subscribeNodeEditResult 分流单测 + ImageGenNode 组件级钉子测试（Task 3 补）；真实图片编辑链路登记人工验证。
- **polyfill AAC 分支**（R7-P2-2）：开发机 Chromium native AAC 恒可用无法复现 native-false；守卫序列由 capabilities.test 同款逻辑佐证；**登记发布前人工验证**。

### 人工待验（三项，随本记录知会用户）

1. **音画同步听验**：下载目录 `plan4-task8-smoke-720p.mp4`（10.85MB、16.5s、双轨）——本地播放器核对音画同步/变速段音调/crossfade 淡化。
2. **FSA 真机直写**：自动化 stub 了 showSaveFilePicker（原生对话框无法脚本交互）走 Buffer 路径；FSA 保存对话框+直写本地+产物正确上传需人工点一次导出（Chromium 默认路径）。
3. **A1 片段重拍真实积分链路**（spec 17/22/23）：需真实 videoGen 源节点 + 第三方 API 积分消耗——**执行前征询用户**；不可行时以 shadowJob 状态机 4 用例 + readNodeFileIdFromDoc 单测佐证。

### 执行期发现与修复汇总（Task 1-13 全程）

| 发现 | 修复 |
|---|---|
| **读侧 Web Audio 勘误（重大）**：decodeMediaPcm 的 AudioBufferSink 产出 Window-only AudioBuffer——Worker 内 ReferenceError → 导出**静默无音轨**（R1-R8 八轮均漏，R5-P0 写侧勘误的同构翻版） | decode.ts 新增 decodeMediaPcmRaw（AudioSampleSink + copyTo f32-planar + close 纪律），worker 切换（1dbf0589）；复验产物双轨 ✓ |
| plan"socketRef 恒 null"前提错误（spec 审查发现） | trim/separate 通道接回单例恢复 socket 推送+10s 轮询原语义（2d7bcaa0） |
| startExport 在 pickSaveFile await 窗口可重入（双 Worker 双配额） | startingRef 同步锁（8cfe3da4） |
| beforeunload 随 Modal 卸载失效（R2-N12 验收依据事实错误） | 模块级守卫 arm/disarm（8cfe3da4） |
| 上传无 mime/大小校验（pdf 隐形上传） | 客户端前置守卫 + 负路径用例（2e4a93d4） |
| uploaded 素材 metadata.durationSec 后端从不产生（落轨恒 5s） | **登记一期缺口**：Task 12 review I-1——视频/音频上传素材拖入时间轴兜底 5s（editorStore ?? Infinity 允许人工拖边缘修正）；二期补客户端探测回写 |
| material files 响应双层 data 信封（plan 模板单层会崩） | 执行核实点落地修正（64ef4245，materialLibraryStore 先例佐证） |
| dev server HMR 陈旧（Shell 跑中间版本代码致编辑器 idle） | dev server 重启复验（验收环境操作，非代码缺陷） |

### 完成判定

- `tsc -b` 0 error ✅；web 2419 全绿 ✅；api 983 全绿 ✅
- spec 附录 B 阶段 7/8 落地 ✅（Worker 导出 controller→真实编码 E2E→产物登记+上画布；socket 单例 5 创建点→AI 三按钮→护栏→29 条验收）
- 遗留①②③闭环 ✅（①团队素材实化实测出数据；②③单测强保证+实测路径被缓存正确防御）
- 登记偏离汇总：生成音频置灰（决策 3）；读侧 AudioBufferSink 勘误（执行期）；重拍 HTTP 长挂/留影子（R8-3 边界⑤）；watchShadowJob doc 轮询唯一判据；polyfill 分支人工验证登记；uploaded durationSec 一期缺口登记
- 13 任务 66 步 checkbox 全勾 ✅；提交链：8b2e15c0 → bf6a23a0 → 57c3ba35 → 3d1e0be4 → 2d7bcaa0 → 8a36af12 → 74f13e2a → 289bf1c1 → 382e3c97 → a247ec60 → 5e518a3a → 1dbf0589 → 61ea6a19 → d195b2a1 → 8cfe3da4 → 9cc5aaa5 → 64ef4245 → 2e4a93d4
