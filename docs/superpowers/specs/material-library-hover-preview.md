<!-- doc-status: historical | verified_at: n/a -->
# Spec: 素材库文件卡片 Hover 预览弹窗

> 版本：v2（整合架构审核反馈）

## 概述
鼠标悬停到素材库的图片/视频卡片上时，弹出预览浮窗，展示媒体内容、文件信息和"应用到画布"操作按钮。

---

## 一、触发与交互

| 规则 | 值 | 说明 |
|---|---|---|
| 进入延迟 | 300ms | 过滤快速划过（业界主流：Figma 250ms, Notion 300ms） |
| 离开延迟 | 150ms | 保证卡片→弹窗间隙不关闭，比进入短保证流畅 |
| 弹窗可 hover | 是 | 用户需要点击按钮 |
| 关闭条件 | 鼠标离开卡片 AND 离开弹窗 | antd Popover 原生支持 |
| 间隙容错 | ≤ 4px | antd Popover 原生支持，配合 150ms 延迟覆盖 |
| 触屏设备 | 不触发 hover 预览 | 点击卡片保持原有交互 |
| 键盘无障碍（可选） | Tab 聚焦 300ms 显示，失焦 150ms 关闭 | 低优先级，可后置 |

---

## 二、弹窗视觉规格

### 容器（Popover body）
- 宽度：280px
- 最大高度：无动态变量约束（内容高度基本固定 ~313px）；兜底用 `max-h-[calc(100vh-32px)]`
- 圆角：16px (`rounded-2xl`)
- 边框：1px solid `white/10`
- 背景：`#262626`
- 阴影：`shadow-2xl`
- 无箭头（`arrow={false}`）
- 无默认内边距（`classNames.body: "p-0"`）

### Antd Popover 配置
```tsx
<Popover
  arrow={false}
  placement="right"
  mouseEnterDelay={0.3}
  mouseLeaveDelay={0.15}
  zIndex={1050}
  classNames={{ body: "p-0" }}
  content={<FilePreviewPopoverContent file={file} />}
  onOpenChange={handleOpenChange}
>
  <div>{/* FileCard 内容 */}</div>
</Popover>
```

### 媒体区（上半部分）
- 背景：`#0F0F0F`
- 高度：flex-basis 225px，flex-1
- 内容居中，overflow hidden
- 图片/视频：`max-h-full max-w-full object-contain`

### 信息区（下半部分）
- padding：8px
- 布局：flex flex-col gap-2

### 文件名行
- 文件名：14px (text-sm), font-weight 500, `text-white/90`, truncate
- 原生 `title` 属性：完整文件名（零成本提升可用性）
- 视频图标：16x16 SVG 播放三角，`text-white/40`, shrink-0

### 日期行
- 格式：`创建于 YYYY/M/D HH:mm:ss`
- 14px (text-sm), font-weight 400, `text-white/40`

### 按钮
- 高度：40px，全宽
- 圆角：8px
- 背景：`#646464`，hover: `#757575`
- 文字：14px, font-weight 600, `#FAFAFA`
- 文案：「应用到画布」
- 点击后显示 loading 状态，防止重复点击

### 加载失败占位
- 背景：`#0F0F0F`
- 居中 24px 图片破损图标
- 12px 浅灰文字 "加载失败"

### 过渡动画
- 淡入：100ms
- 淡出：80ms

---

## 三、媒体生命周期管理

通过 Popover 的 `onOpenChange(open: boolean)` 回调控制：

### open=true（弹窗展示）
1. 图片：先渲染缩略图（thumbnailUrl），再异步加载原图（url）
2. 视频：创建 video 元素，`preload="metadata"`（仅拉封面）；弹窗完全展示后设置 src 触发加载
3. 视频属性：autoplay, loop, muted, playsinline, disablePictureInPicture

### open=false（弹窗关闭）
1. 视频：`pause()` + `currentTime = 0`
2. 取消未完成的原图/视频请求（AbortController）
3. 清理 DOM 引用，释放资源

---

## 四、性能边界

| 规则 | 实现 |
|---|---|
| 快速划过 | 仅保留最后一次触发的预览（取消前次 AbortController） |
| 图片渐进加载 | 缩略图 → 原图（AbortController 可中断） |
| 视频按需加载 | open=true 时才设置 src，open=false 时暂停+重置 |
| 视频封面 | 复用缩略图作 poster，减少空白闪烁 |

---

## 五、定位策略

- Ant Design Popover，`placement="right"`
- 自动边界碰撞翻转（antd 内置）
- Portal 挂载到 `document.body`（antd 默认），天然规避 overflow hidden
- `z-index: 1050`（高于素材库抽屉和画布节点）

---

## 六、「应用到画布」按钮

### 6.1 架构：通过 canvasStore 解耦

在 `canvasStore.ts` 新增：

```typescript
// 状态
pendingMediaFile: MaterialFile | null;

// 方法
requestAddMediaNode: (file: MaterialFile) => void;
```

在 `CanvasView.tsx` 新增 useEffect 监听 `pendingMediaFile`，当值非空时：

1. 获取 `reactFlowWrapper` ref 的 DOM 容器
2. 计算容器可视中心：
   ```typescript
   const bounds = reactFlowWrapper.current.getBoundingClientRect();
   const centerScreenX = bounds.left + bounds.width / 2;
   const centerScreenY = bounds.top + bounds.height / 2;
   ```
3. 转换为画布坐标：
   ```typescript
   screenToFlowPosition({
     x: centerScreenX - bounds.left,  // = bounds.width / 2
     y: centerScreenY - bounds.top,   // = bounds.height / 2
   })
   ```
4. 根据 MIME 类型创建节点：
   - `image/*` → `canvasStore.addNode('image', position)`
   - `video/*` → `canvasStore.addNode('video', position)`
5. 新节点自动设为选中状态（addNode 已内置）
6. 将节点的 file 数据写入 nodeStore
7. 清除 `pendingMediaFile`

### 6.2 FilePreviewPopover 按钮点击流程

1. 按钮进入 loading 状态
2. 调用 `useCanvasStore.getState().requestAddMediaNode(file)`
3. 调用 `useMaterialLibraryStore.getState().close()` 关闭素材库
4. Popover 自动关闭（antd Popover 在点击 content 内非 trigger 区域时默认关闭）

---

## 七、文件影响范围

| 操作 | 文件 | 说明 |
|---|---|---|
| **新增** | `FilePreviewPopover.tsx` | 独立预览弹窗组件，封装 Popover + 媒体内容 + 生命周期 |
| **新增** | `FilePreviewPopover.test.tsx` | 预览弹窗测试 |
| **修改** | `FileCard.tsx` | 引入 FilePreviewPopover，包裹卡片内容，判断媒体类型 |
| **修改** | `FileCard.test.tsx` | 补充 hover 预览相关测试 |
| **修改** | `canvasStore.ts` | 新增 `pendingMediaFile` + `requestAddMediaNode` 方法 |
| **修改** | `CanvasView.tsx` | 新增 useEffect 监听 pendingMediaFile 并创建节点 |

不需要修改 `MaterialLibraryModal.tsx`（通过 store 方法关闭，无需 props 透传）。

---

## 八、文件类型过滤

仅 `image/*` 和 `video/*` MIME 类型的文件触发预览弹窗。其他类型（文档、音频等）不触发。
