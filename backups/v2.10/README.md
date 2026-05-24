# FlowWeb v2.10 备份

**日期:** 2026-05-24
**Git Tag:** v2.10
**Git Commit:** fdeda47
**描述:** 音频波形 V2 前端优化 — Custom Canvas 渲染 (250 固定采样点)、播放头居中 DOM 叠加、边缘渐变、拖拽 Seek (已知问题: 拖拽实时 Seek 无效)

## 备份内容

| 文件 | 说明 |
|------|------|
| `flowweb-v2.10.bundle` | 完整 Git 仓库打包 (所有分支、标签) |
| `.env` | API 环境变量 (数据库、Redis、MinIO、API Keys) |
| `schema.prisma` | 数据库 Schema |
| `README.md` | 本文件 |

## 数据库备份

PostgreSQL `flowweb` 数据库需手动备份:
```bash
PGPASSWORD=flowweb_dev pg_dump -h localhost -U flowweb -d flowweb --no-owner --no-acl > database.sql
```

## 回滚步骤

1. 解包 Git bundle:
```bash
git clone backups/v2.10/flowweb-v2.10.bundle flowweb-restored
cd flowweb-restored
git checkout v2.10
```

2. 恢复 .env:
```bash
cp backups/v2.10/.env apps/api/.env
```

3. 恢复数据库:
```bash
PGPASSWORD=flowweb_dev psql -h localhost -U flowweb -d flowweb < backups/v2.10/database.sql
```

4. 安装依赖并启动:
```bash
pnpm install
pnpm dev
```

## 变更摘要 (42967dc → fdeda47)

| 文件 | 变更 |
|------|------|
| `useWaveformPeaks.ts` | 新增: 250 归一化峰值计算 + LRU 缓存 |
| `useCanvasRenderer.ts` | 新增: Canvas 2D 渲染 + rAF 滚动循环 |
| `useDragSeek.ts` | 新增: 拖拽 Seek + 捕获阶段事件隔离 |
| `AudioWaveform.tsx` | 重写: Canvas+DOM 渲染替代 wavesurfer 可视化 |
| `AudioGenNode.tsx` | 修改: 节点尺寸 400×260 → 548×280 |

## 已知问题

- **拖拽实时连续 Seek 无效**: mousedown 点击可以 seek，但拖拽时 mousemove 无法持续触发 seek。React Flow 事件隔离不够彻底。
