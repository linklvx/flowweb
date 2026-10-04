<!-- doc-status: historical | verified_at: n/a -->
# 历史记录页面 实现计划

> 2026-06-06 | Spec: [history-page-design](../specs/2026-06-06-history-page-design.md)

## 概述

新增历史记录页面：全屏 Modal + 左侧 3 个固定分类 + 右侧复用 FileGrid，后端新增 type 筛选 + count 统计。

---

## Task 1: 后端 — material.service 新增 type 参数支持

**Files:**
- Modify: `apps/api/src/modules/material-library/services/material.service.ts`

- [ ] **Step 1: `getFilesByFolderId` 新增可选 `type` 参数**

在 `getFilesByFolderId(userId, folderId)` 增加第三个参数 `type?: 'image' | 'video' | 'audio'`，根据 type 按 mimeType 前缀筛选。

- [ ] **Step 2: 新增 `getFileCounts` 方法**

```typescript
async getFileCounts(userId: string): Promise<{ image: number; video: number; audio: number }> {
  const counts = await this.prisma.media.groupBy({
    by: ['mimeType'],
    where: { userId, deletedAt: null },
    _count: true,
  });
  // aggregate by type prefix
}
```

- [ ] **Step 3: Commit**

---

## Task 2: 后端 — file.controller 新增 type 参数和 count 端点

**Files:**
- Modify: `apps/api/src/modules/material-library/controllers/file.controller.ts`

- [ ] **Step 1: `getFiles` 接收 `@Query('type')` 参数**
- [ ] **Step 2: 新增 `GET /files/count` 端点**
- [ ] **Step 3: Commit**

---

## Task 3: 前端 — historyStore 状态管理

**Files:**
- Create: `apps/web/src/stores/historyStore.ts`
- Create: `apps/web/src/stores/__tests__/historyStore.test.ts`

- [ ] **Step 1: 编写 historyStore 测试（TDD 红）**

```typescript
// 关键测试用例
describe('historyStore', () => {
  it('should have initial state with isOpen=false')
  it('should open/close modal')
  it('should set activeTab and load files')
  it('should load file counts on open')
  it('should enter/exit batch mode')
  it('should toggle file selection')
  it('should select all files')
  it('should batch delete files')
  it('should delete single file')
  it('should toggle favorite')
  it('should set file grid size')
});
```

- [ ] **Step 2: 运行测试确认失败**
- [ ] **Step 3: 实现 historyStore**
- [ ] **Step 4: 运行测试确认通过**
- [ ] **Step 5: Commit**

---

## Task 4: 前端 — HistorySidebar 组件

**Files:**
- Create: `apps/web/src/components/HistoryPage/HistorySidebar.tsx`
- Create: `apps/web/src/components/HistoryPage/__tests__/HistorySidebar.test.tsx`

3 个固定分类项，显示名称和数量，当前选中高亮。

- [ ] **Step 1: 编写测试**
- [ ] **Step 2: 运行测试确认失败**
- [ ] **Step 3: 实现组件**
- [ ] **Step 4: 运行测试确认通过**
- [ ] **Step 5: Commit**

---

## Task 5: 前端 — HistoryModal 组件

**Files:**
- Create: `apps/web/src/components/HistoryPage/HistoryModal.tsx`
- Create: `apps/web/src/components/HistoryPage/__tests__/HistoryModal.test.tsx`

全屏 Modal，左侧 HistorySidebar + 右侧 FileGrid + ZoomControl + 批量工具栏。

- [ ] **Step 1: 编写测试**
- [ ] **Step 2: 运行测试确认失败**
- [ ] **Step 3: 实现组件**
- [ ] **Step 4: 运行测试确认通过**
- [ ] **Step 5: Commit**

---

## Task 6: 前端 — 集成到 Canvas 页面

**Files:**
- Modify: `apps/web/src/pages/canvas/components/NodePalette.tsx`
- Modify: `apps/web/src/pages/canvas/page.tsx`

- [ ] **Step 1: NodePalette 历史按钮绑定 `historyStore.open()`**
- [ ] **Step 2: page.tsx 挂载 `<HistoryModal />`**
- [ ] **Step 3: 更新相关测试**
- [ ] **Step 4: TypeScript 编译检查**
- [ ] **Step 5: Commit**

---

## Task 7: E2E 验证

- [ ] 点击历史记录按钮 → Modal 打开
- [ ] 左侧 3 个分类切换正常，数量正确
- [ ] 文件列表加载、缩放滑块生效
- [ ] 批量选择、批量删除正常
- [ ] 单个文件收藏、删除正常
- [ ] 点击空白关闭、Escape 关闭
