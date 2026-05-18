# v1.8 Backup

**日期**: 2026-05-19
**版本**: v1.8
**基础**: v1.7 (checkpoint-toolbar)

## 新增功能

### Tiptap WYSIWYG 富文本编辑器
- @tiptap/react@2.10.0 + @tiptap/starter-kit@2.10.0
- 文本节点从 Markdown textarea 升级为 WYSIWYG 富文本编辑
- EditorContent 替换 textarea，content 字段存储 HTML 字符串

### 悬浮工具栏 (TextNodeToolbar)
- H1/H2/H3/正文、加粗/斜体、UL/OL/HR 按钮，调用 Tiptap chain commands
- 按钮激活状态高亮（bg-white/20），editor 事件订阅驱动重渲染
- exec 空值安全包装器（useEditor 初始返回 null）
- onMouseDown preventDefault 保持编辑器焦点
- 富文本剪贴板：ClipboardItem API + execCommand 降级
- nodeStore 接口不变（content: string）

### 背景颜色选择器
- 工具栏最左侧颜色圆点按钮 → 毛玻璃下拉面板
- 7 个预设色：红/橙/黄/绿/青/蓝/紫 + 重置按钮
- 选中颜色后编辑器区域背景立即变色
- 点击外部自动关闭

### 全屏编辑弹窗 (TextNodeFullscreen)
- createPortal 渲染到 document.body，不受画布缩放影响
- 暗色主题（bg-[#272729], border-[#3F3F46], backdrop-blur-sm）
- 内嵌工具栏：H1/H2/H3/正文/加粗/斜体/UL/OL/HR/复制
- 关闭方式：X 按钮 / Esc 键 / 背景遮罩点击
- 响应式宽度：max-w-3xl → 2xl:max-w-5xl

### UI 优化
- 工具栏浅灰色边框（border-[#555]）
- 编辑器细透明滚动条（4px, scrollbar-color: thin）
- 全屏弹窗 min-h-0 修复空内容滚动条
- overflow-x-hidden 消除横向滚动条

### Editor 安全保护
- useEditor 初始 null 安全（exec guard）
- useEffect cleanup 销毁 editor（防止内存泄漏）
- editor.on('selectionUpdate'/'transaction') 驱动 active states

## 文件
- `schema.sql` — 完整数据库 DDL（Prisma db pull）
- `schema.prisma` — Prisma Schema
- `.env` — API 环境配置
- `api_data.json` — 全量数据库数据导出（15 张表）

## 数据库快照
| 表 | 行数 |
|----|------|
| Users | 5 |
| Accounts | 3 |
| Sessions | 93 |
| Announcements | 1 |
| ContentCards | 8 |
| Templates | 4 |
| CanvasProjects | 618 |
| CanvasNodes | 84 |
| CanvasEdges | 57 |
| NodeTypes | 3 |
| AIModels | 6 |
| ModelResolutions | 7 |
| ModelDurations | 3 |
| PricingRules | 12 |
| UserBalances | 3 |

## 测试状态
- Web: 163 tests passed (32 files)
- 所有测试通过 ✅

## Git 标签
- `v1.8` (annotated tag, commit 8b3b76f)
