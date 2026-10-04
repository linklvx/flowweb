<!-- doc-status: historical | verified_at: n/a -->
# 历史记录页面 需求规格

> 2026-06-06 | 参考：我的素材库页面（MaterialLibraryModal）

## 目标

新增历史记录页面，展示用户在 FlowWeb 平台生成/上传的所有媒体历史文件，按类型分组浏览。

## 参考架构

以 `MaterialLibraryModal` 为蓝本，但大幅简化：
- 去掉左侧文件夹树（FolderTree）
- 去掉"新建文件夹"按钮
- 去掉"选择文件夹"按钮

## 功能需求

### F1: 页面入口
- 点击 Canvas 左侧悬浮工具栏中的"历史记录"按钮打开
- 以全屏 Modal 形式展示（同素材库 90% 宽度）

### F2: 左侧文件夹列表（简化版）
- 3 个默认分类文件夹，不可创建/不可删除/不可改名/不可拖动排序：
  | 文件夹名 | 内容 | 数量显示 |
  |----------|------|----------|
  | 图片历史 | 所有图片文件 | 显示图片总数 |
  | 视频历史 | 所有视频文件 | 显示视频总数 |
  | 音频历史 | 所有音频文件 | 显示音频总数 |
- 文件夹名称不可编辑、不可拖拽排序
- 无右键菜单
- 无"新建文件夹"按钮
- 无"选择文件夹"按钮

### F3: 右侧文件展示区
- 保留 FileGrid 组件（日期分组、文件卡片）
- 保留 FileCard 组件（缩略图、文件名、hover 操作按钮）
- 保留 FileGridZoomControl（缩放滑块 150px-300px）
- 文件按 `createdAt` 倒序排列

### F4: 批量操作
- 保留批量选择模式（checkbox、日期组全选）
- 保留"批量删除"功能
- 去掉"批量移动"功能（没有目标文件夹可移）

### F5: 单个文件操作
- 保留收藏/取消收藏（toggleFavorite）
- 保留删除单个文件

### F6: 数据加载
- 切换分类时加载对应类型文件
- API: `GET /api/material/files?type=image|video|audio`（需后端新增 type 参数）
- API: `GET /api/material/files/count` → `{ image: N, video: N, audio: N }`（需后端新增）

### F7: 空状态
| 分类 | 空状态文案 |
|------|------------|
| 图片历史 | "暂无图片历史记录" |
| 视频历史 | "暂无视频历史记录" |
| 音频历史 | "暂无音频历史记录" |

## 后端修改

| 文件 | 修改内容 |
|------|----------|
| `apps/api/src/modules/material-library/services/material.service.ts` | `getFilesByFolderId` 新增可选 `type` 参数，按 mimeType 前缀筛选 |
| `apps/api/src/modules/material-library/controllers/file.controller.ts` | `getFiles` 接收 `@Query('type')` 参数并传递 |
| `apps/api/src/modules/material-library/services/material.service.ts` | 新增 `getFileCounts` 方法，按 type 分组统计 |
| `apps/api/src/modules/material-library/controllers/file.controller.ts` | 新增 `GET /files/count` 端点 |

## 技术架构

### 文件结构

| 操作 | 路径 | 职责 |
|------|------|------|
| 新建 | `apps/web/src/components/HistoryPage/HistoryModal.tsx` | 顶部 Modal 壳 |
| 新建 | `apps/web/src/components/HistoryPage/HistorySidebar.tsx` | 左侧 3 个分类文件夹 |
| 新建 | `apps/web/src/components/HistoryPage/__tests__/HistoryModal.test.tsx` | Modal 测试 |
| 新建 | `apps/web/src/components/HistoryPage/__tests__/HistorySidebar.test.tsx` | Sidebar 测试 |
| 新建 | `apps/web/src/stores/historyStore.ts` | 历史记录状态管理 |
| 新建 | `apps/web/src/stores/__tests__/historyStore.test.ts` | Store 测试 |
| 修改 | `apps/web/src/pages/canvas/components/NodePalette.tsx` | 历史按钮绑定 onClick |
| 修改 | `apps/web/src/pages/canvas/page.tsx` | 挂载 HistoryModal |
| 修改 | `apps/api/src/modules/material-library/services/material.service.ts` | 新增 type 参数 + count 方法 |
| 修改 | `apps/api/src/modules/material-library/controllers/file.controller.ts` | 新增 type 参数 + count 端点 |

### 复用现有组件
- `FileGrid` + `FileCard`：直接复用
- `FileGridZoomControl`：直接复用
- 不复用 `FolderTree`、`FolderContextMenu`、`FolderInputModal`

### 状态管理

```typescript
interface HistoryState {
  isOpen: boolean;
  activeTab: 'image' | 'video' | 'audio';
  files: MaterialFile[];
  fileCounts: { image: number; video: number; audio: number };
  fileGridSize: number;
  loading: boolean;
  batchMode: boolean;
  selectedFileIds: Set<string>;

  // Actions
  open: () => void;
  close: () => void;
  setActiveTab: (tab: 'image' | 'video' | 'audio') => void;
  loadFiles: () => Promise<void>;
  setFileGridSize: (size: number) => void;
  // Batch
  enterBatchMode: () => void;
  exitBatchMode: () => void;
  toggleFileSelection: (id: string) => void;
  selectAllFiles: () => void;
  batchDelete: () => Promise<void>;
  // Single file
  deleteFile: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
}
```

## 非功能需求

- TypeScript strict 模式
- TDD 开发（先写测试，后实现）
- 测试覆盖率：store 100%，组件关键交互覆盖