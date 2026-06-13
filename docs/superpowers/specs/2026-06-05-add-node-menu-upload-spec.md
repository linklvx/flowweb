# Spec: AddNodeMenu 上传按钮功能实现

## 版本
- Spec 版本: 1.1
- 日期: 2026-06-07
- 状态: 已确认

## 需求概述

Canvas 页面左侧悬浮工具栏 + 号菜单中的「上传」按钮目前点击后打开素材库弹窗。需要改为：点击后弹出文件选择对话框，选择文件后直接在画布上创建对应类型的节点并加载文件。

## 现有行为

```
点击「上传」→ materialLibraryOpen() → 打开素材库 Modal
                                   → 不创建任何画布节点
```

## 目标行为

```
点击「上传」→ 弹出文件选择对话框（accept="image/*,video/*,audio/*"）
           → 用户选择文件：
               → 上传文件到 MinIO（复用现有 presignUpload → axios POST → confirmUpload 流程）
               → 根据 MIME 类型创建对应画布节点（居中放置，加载所选文件）
               → 关闭菜单
           → 用户取消选择：
               → 菜单保持打开，允许再次点击上传
```

## 关键约束

1. **复用现有上传机制**：使用 `storageApi.ts` 的 `presignUpload` + `confirmUpload`，直接 POST 到 MinIO
2. **复用现有节点创建**：使用 `canvasStore.addNode()` 创建节点，然后通过 `nodeStore.updateConfig()` 设置文件引用
3. **节点类型映射**：MIME type → UI type → React Flow type
   - `image/*` → `image` → `imageGen`
   - `video/*` → `video` → `videoGen`
   - `audio/*` → `audio` → `audioGen`
4. **节点数据字段**：
   - 图片节点: `referenceImage` (ImageGenNode 用此字段显示图片)
   - 视频节点: `referenceVideo` (VideoGenNode 用此字段显示视频)
   - 音频节点: `referenceAudio` (AudioGenNode 用此字段显示音频)
5. **节点居中位置计算**：复用现有 `handleItemClick` 中已有的计算逻辑
   ```typescript
   const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
   const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
   addNode(type, { x: centerX - 125, y: centerY - 30 });
   ```

## 交互细节

### 文件选择取消
- 用户点击文件对话框「取消」→ 菜单保持打开状态
- 用户可再次点击「上传」按钮重新选择文件

### 防重复点击（上传中状态）
- 上传过程中「上传」按钮显示 loading 状态（文字变为 "上传中..."，不可点击）
- 上传完成（无论成功/失败）后恢复按钮状态
- 防止在上传过程中重复触发生成多个节点

### 上传期间菜单行为
- 上传过程中菜单保持打开（用户可以看到进度）
- 用户仍可通过点击遮罩层或按 Escape 关闭菜单（关闭后上传仍会在后台完成，但不创建节点——简化处理）
- 上传完成且成功创建节点后，自动关闭菜单

## 与素材库的关系

- `confirmUpload` 流程会自动创建 Media 记录（`type: 'uploaded'`），文件会出现在系统中
- 本次实现**不需要**在上传后将文件移动到素材库文件夹
- 文件可在历史记录页面中通过「图片历史」「视频历史」「音频历史」查看（取决于 `mimeType` 前缀过滤）
- 这是一个隐性的有益特性，无需额外开发

## 非功能需求

- **上传进度**：不显示进度百分比，仅显示 loading 状态（按钮文字 "上传中..."）
- **多文件**：暂不支持多文件选择，每次只选一个文件
- **错误处理**：上传失败时 console.error，不阻塞 UI，菜单不关闭
- **文件类型校验**：仅在 `<input accept>` 层面限制，不做 JS 二次校验

## 涉及文件

| 文件 | 修改类型 |
|------|----------|
| `apps/web/src/pages/canvas/components/AddNodeMenu.tsx` | 修改 upload 分支逻辑 |
| `apps/web/src/pages/canvas/components/AddNodeMenu.test.tsx` | 新增测试 |

## 验收标准

- [ ] 点击「上传」按钮弹出系统文件选择对话框
- [ ] 文件对话框接受图片、视频、音频文件类型
- [ ] 选择图片文件后，画布上出现 ImageGenNode 并显示所选图片
- [ ] 选择视频文件后，画布上出现 VideoGenNode 并显示所选视频
- [ ] 选择音频文件后，画布上出现 AudioGenNode 并显示所选音频
- [ ] 节点出现在画布视口中心位置
- [ ] 上传过程中「上传」按钮显示 "上传中..." 且不可点击
- [ ] 用户取消文件选择后，菜单保持打开
- [ ] 上传完成后菜单自动关闭
- [ ] 上传失败时输出错误信息，菜单状态正常
- [ ] 现有菜单项（文本、图片节点、视频节点等）行为不受影响

## 测试用例

在 `AddNodeMenu.test.tsx` 中新增：

1. **文件选择触发**：点击「上传」按钮触发 `<input type="file">` 点击
2. **上传流程**：选择图片文件后调用 `presignUpload` + `confirmUpload`
3. **节点创建**：上传成功后调用 `canvasStore.addNode` 创建对应类型节点，并在 nodeStore 中设置文件引用
4. **上传失败**：上传失败后输出错误，不创建节点，不关闭菜单
5. **取消选择**：用户取消文件选择后菜单保持打开
6. **Loading 状态**：上传过程中按钮显示 "上传中..." 且不可点击
7. **其他菜单项不受影响**：点击文本/图片/视频/音频/堆叠图片等菜单项行为不变
