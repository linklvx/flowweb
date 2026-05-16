# FlowWeb v1.5 备份

**日期**: 2026-05-16
**版本**: v1.5
**Git Commit**: (即将提交)

## 内容

- `schema.sql` — 数据库结构 (Prisma db pull)
- `schema.prisma` — Prisma Schema 定义
- `api_data_templates.json` — 模板广场API数据
- `../dump.rdb` — Redis 数据（项目根目录）

## 版本新增功能

v1.5 主要改进首页导航系统和用户中心：

- **导航条重构**：移除重复积分显示，新增首页/模板广场/文档中心/我的作品导航链接
- **宽度策略统一**：max-w-[1640px] + px-5 md:px-10 lg:px-[120px] 响应式padding
- **登录后行为**：首页登录后留在首页（redirect=/），不再跳转canvas
- **首字母圆形头像**：支持头像图片/首字母自动fallback
- **antd Dropdown深色主题**：用户头像悬停下拉菜单
- **赚积分入口**：GiftOutlined图标 + 椭圆药丸样式
- **导航栏当前页加粗**：首页/模板广场/我的作品活动状态指示
- **模板广场+用户中心**：统一导航条和内容宽度
- **我的模板→我的作品**：全局重命名
- **响应式布局**：兼容PC端不同分辨率

## 测试状态

- Web: 120 tests passed (28 files)
- API: tests pass
