# Plan: TD-15 删除清理链路实况对齐（方案 B：移除死调用）

日期：2026-08-22
Spec：docs/superpowers/specs/td15-canvas-cleanup-realignment.md（已确认：D1=B / D2=TD-8 收窄维持 / D3=不动；P1 TDD 顺序、P2 删除边界已落实）
总原则：测试先行红→绿（P1）；单原子 commit；总门禁 web 全量测试 + tsc -b 双绿。
执行顺序（S1）：第四批随手清已落地（a20bab1/c939c20/…/825b8d0），本批在其后执行；nodeStore.ts 修改区域与 4a/4b 不重叠（4a 动 :128-129、4b 动 :90/:254，本批动 :229-232/:469-511），无顺序冲突。

## 任务 1：测试翻转（先红）

### 1.1 nodeStore.test.ts

- 用例 16（async resource cleanup，~:282-330，B1 对齐 16a/16b 翻转方式）：`expect(fetchSpy).toHaveBeenCalled()` → **`expect(fetchSpy).not.toHaveBeenCalled()`**（该测试作用域内唯一可能的 fetch 即清理 DELETE——现码必发故红，删码后零调用故绿）；无消费方的 `deleteCalls` 过滤变量连带删；保留「节点已移除」断言；用例名改为不再暗示资源清理
- 用例 16a（root refs，~:340-359）与 16b（legacy nested refs，~:363-389）：`storageDeletes` 断言改为 `toHaveLength(0)`；保留节点移除断言；16b 保留 legacy 嵌套数据形状（验证数据形状不再影响删除行为）
- 确认 fetchSpy mock 本身保留（零调用断言需要 spy）

### 1.2 useImageUpload.test.ts

- 用例 10（~:524-545）：`toHaveBeenCalledWith('/api/storage/files/img-1', {method:'DELETE'})` → `mockFetchFn.mock.calls.filter(c => c[0] === '/api/storage/files/img-1').length === 0`（或等价 not 断言）；updatePromptImages 过滤断言保留
- ~:598 批量删除用例（img-a）：同上翻转；库存过滤断言保留
- 运行确认红（新断言失败于现存 DELETE 调用）

## 任务 2：实现删除（转绿）

### 2.1 nodeStore.ts deleteNode（:469-511）

删除后目标形态：

```ts
deleteNode: async (nodeId: string) => {
  const newNodes = { ...get().nodes };
  delete newNodes[nodeId];
  set({ nodes: newNodes });
},
```

- 四个 if 清理分支（image/multiImage/videoGen/audioGen）整体删除，含 TD-11 D1 注释（语义已由本批 spec 记载）
- `const node = getNode(...)` 无剩余消费方 → 连带删
- `async` 签名保留（调用方 await，零风险）

### 2.2 nodeStore.ts mergeImageRefs（:229-232）

- 仅剩调用方即上述两分支 → 函数与注释整体删除（S2：该函数为 TD-2 时期既有代码，原用于持久化旧嵌套数据兼容收集删除引用；4b 仅调整过其参数类型，随调用方退役而整体退役）
- 实现时 grep 复核零残留引用

### 2.3 useImageUpload.ts deleteImage（:172-184）

删除后目标形态：

```ts
async function deleteImage(imageId: string): Promise<void> {
  const currentImages = getLatestAllImages();
  const filtered = currentImages.filter((img) => img.id !== imageId);
  updatePromptImages(filtered);
}
```

- try/fetch/catch 块删除；注释 `// DELETE from server` 一并删

### 2.4 孤立项清理

- nodeStore.ts 顶部若有仅供 mergeImageRefs 使用的 import → 连带删（实现时 tsc/ESLint 提示为准）
- isImageNode/isMultiImageNode/isVideoGenNode/isAudioGenNode 为导出工具（组件在用）→ 不动

## 任务 3：总门禁

- `pnpm --filter @flowweb/web test` 全绿；`pnpm tsc -b` 零错误

## 任务 4：浏览器差分验证

（S3：以下节点 ID/markrA 为**开发态本地数据**，复用时替换为自己环境中的任意 imageGen 节点）

1. 准备：画布 A（cmt31uetj...）的 markerA imageGen 节点——编辑 localStorage 快照给其 data 注入 `allImages: [{ id: 'fake-ref-td15', url: '', name: '', status: 'success' }]`，reload（localStorage 兜底恢复生效）
2. 清空网络面板记录；删除 markerA 节点（DOM 删除按钮/流程）
3. 断言：网络面板**零** `/api/storage/files` DELETE 请求；`GET /api/material/files?type=image` 前后数量一致
4. （差分意义：旧码必发 `DELETE /api/storage/files/fake-ref-td15` 404——新码零调用即证明）
5. 恢复 localStorage 注入（删除 fake-ref 字段或还原原值，避免污染开发态）

## 任务 5：台账清账 + 原子 commit + hash 回填

- TD-15 → 已清账（双实证 + 方案 B 对齐：D1 语义扩展 imageGen/trim，画布删除不再触发文件清理）
- TD-8 收窄：现状改为「软删 Media 行的 MinIO 对象回收（画布侧不再产生孤儿）；上线前评估维持」
- 原子 commit：

```
refactor(web): drop dead canvas file-cleanup calls (TD-15)

- the six DELETE /api/storage/files/:id calls have been silent 404s
  since inception — the route never existed; recon showed the fix is
  not to add it: Media rows are library/history assets (soft-delete
  is the product semantic), and generated fileIds are history that
  TD-11 D1 already preserves for video/audio. dropping the calls
  formalizes the actual behavior with zero runtime change
- mergeImageRefs retired along with its only callers
```

- commit 后 hash 回填已清账行（微 docs commit）

## 回滚路径

单 commit revert → 四分支与 6 处调用全量恢复（revert 无部分状态）。
