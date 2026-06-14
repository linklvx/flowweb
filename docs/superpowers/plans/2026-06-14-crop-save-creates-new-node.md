# Plan: 裁剪保存改为创建新节点 + 连线

## 变更文件

| 文件 | 变更 |
|------|------|
| `apps/web/src/stores/canvasStore.ts` | 新增 `addChildNode` 方法 |
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` | 修改 `handleCropSave` |
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx` | 新增 crop save 创建节点的测试 |

## Step 1: canvasStore 新增 `addChildNode(sourceId, data)`

- 复用 `addNodeWithEdge` 的定位逻辑（右侧 GAP=40，碰撞检测三个候选位置）
- 新节点类型 = 源节点类型
- 新节点 data = 传入的 `data` 参数（**不**设置 `transformMode`）
- 创建 edge: source → target
- 添加到两个 store（React Flow + nodeStore）
- 返回新节点 ID

## Step 2: 修改 `handleCropSave`

将第 386 行:
```ts
updateConfig(id, { fileId: newId, referenceImage: undefined, editMode: null });
```
替换为:
```ts
updateConfig(id, { editMode: null });
addChildNode(id, { fileId: newId, status: 'done' });
```

## Step 3: 测试

在 `ImageGenNode.test.tsx` 新增测试用例，验证裁剪保存调用 `addChildNode` 创建新节点而非替换原节点 `fileId`。

## 边界条件

- 裁剪失败时 `addChildNode` 不会被调用（错误处理已有）
- 新节点位置碰撞检测确保不与其他节点重叠
- 原节点图片保持不变
