# FlowWeb v3.01 备份

**备份时间**: 2026-05-25
**Git Tag**: `v3.01`
**提交**: `5183389`

## 版本说明

核心功能完成版本。包含以下内容：

### 核心功能
- **自定义 Canvas 音频波形渲染**: 250 固定采样点，统一的波形密度不受音频长度影响
- **Mode B 滚动模式**: 播放头固定在视口中央，波形从右向左滚动
- **青色 #38bdf8 主题**: 已播放部分青色，未播放部分白色
- **拖拽 Seek**: 点击定位播放位置（已知问题：拖拽连续 seek 不生效，仅 click 单次 seek 可用）
- **播放按钮**: 深灰色 (#3a3a3a) 圆底，居中 SVG 图标
- **播放头**: 青色三角 + 竖线 + hover 时间提示
- **边缘渐变**: 左右两侧线性渐变遮罩

### 技术架构
- wavesurfer.js: 仅作音频引擎（解码/播放/seek）
- Canvas 2D: 自定义波形渲染
- 250 固定采样点: 归一化 0~1，0.05 底噪
- LRU 缓存 (max 50): 按 audioUrl 缓存峰值数据
- High-DPI: devicePixelRatio 缩放
- rAF 滚动循环: 播放时持续重绘

### 已知问题
- **拖拽连续 Seek 无效**: mousedown 点击可 seek，但拖拽时 mousemove 不持续触发 seek。React Flow 画布事件拦截问题。已尝试多种方案（capture-phase stopPropagation、全局 window mousemove + stopImmediatePropagation）未解决。

## 备份内容

| 文件 | 说明 |
|------|------|
| `flowweb-v3.01.bundle` | 完整 Git 仓库 bundle (61MB) |
| `database.sql` | PostgreSQL 数据库完整 dump (356KB, 3266 行) |
| `.env` | 后端环境变量配置 |
| `schema.prisma` | Prisma ORM schema |
| `README.md` | 本文件 |

## 回滚步骤

### 1. 恢复代码
```bash
cd D:/flowweb
git checkout v3.01
# 或者从 bundle 恢复:
# git clone backups/v3.01/flowweb-v3.01.bundle D:/flowweb-restored
```

### 2. 恢复数据库
```bash
export PGPASSWORD=flowweb_dev
"D:/programfiles/PostgreSQL/16/bin/psql.exe" -h localhost -U flowweb -d flowweb -f backups/v3.01/database.sql
```

### 3. 恢复配置
```bash
cp backups/v3.01/.env apps/api/.env
cp backups/v3.01/schema.prisma apps/api/prisma/schema.prisma
```

### 4. 重启服务
```bash
pnpm dev
```

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v3.01 | 2026-05-25 | 核心功能完成，播放按钮样式优化 |
| v2.10 | 2026-05-24 | 音频波形 V2 前端优化（第一个备份点） |
