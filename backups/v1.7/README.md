# v1.7 Backup

**日期**: 2026-05-18
**版本**: v1.7
**基础**: v1.6

## 新增功能

### Canvas 画布
- 纯黑背景 (#000000) + 点阵纹理 (Dots, #555555, gap 16px)
- NodePalette 宽度缩小至 w-28 (112px)

### 文本节点 (TextInputNode) 现代化重设计
- 深色扁平卡片风格: bg-[#222222], border-[#3a3a3a], 无阴影/渐变
- 尺寸: 360×210, placeholder "点击输入文本..."
- 标题外置（卡片左上角上方），支持内联编辑（Enter/blur 保存，Escape 取消）
- 底部配置面板 (TextConfigPanel): 650×140, 反向缩放固定大小
- Run 按钮: 灰色圆角矩形 (bg-[#3a3a3a]) + SVG 向上箭头
- Select 元素: 扁平深色风格 (bg-white/10, border-0, 无 focus ring)
- 移除所有输入框边框线条

### 图片/视频节点 UI 对齐
- ImageGenNode: 与 TextInputNode 统一的扁平卡片风格
- VideoGenNode: 同上
- 配置面板: bg-transparent, 无阴影

### 认证弹窗 (AuthModal)
- 首页导航栏点击「登录/注册」弹出居中模态窗口
- X 关闭按钮（右上角），移除页签切换（底部文字链接切换）
- 深色背景遮罩 (bg-black/60)，位置偏上 (pt-[18vh])
- 无路由跳转，登录成功自动刷新用户状态

### 导航条与用户系统
- 登录后积分自动显示（不须刷新页面）
- 退出登录后积分清除（不显示旧数据）
- 所有页面退出登录均跳转至首页（Navbar/CanvasTopBar/SettingsLayout）

### 模板与设置页面
- 移除模板卡片边框 (border-0)
- 移除设置列表项边框 (border-0)

## 文件
- `schema.sql` — 完整数据库 DDL
- `schema.prisma` — Prisma Schema
- `.env` — API 环境配置
- `api_data.json` — 全量数据库数据导出

## 测试状态
- Web: 134 tests passed (30 files)
- 所有测试通过 ✅
