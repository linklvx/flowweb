# MinIO 持久化启动方案

## 背景

MinIO 未纳入项目启动系统，每次手动启动时可能使用不同数据目录，导致历史上传文件丢失。

**当前问题：**

1. `launch.json` 只有 `web` 和 `api`，MinIO 需手动启动
2. 数据目录过去使用绝对路径 `D:\flowweb\flowweb.dataminio`，团队协作不友好
3. 无法一键启动所有服务

## 目标

- MinIO 纳入 `launch.json`，与 web/api 统一管理
- 数据目录使用项目相对路径，支持团队协作
- 一条命令启动全部服务

## 设计

### 目录结构调整

```
flowweb/
├── .claude/
│   └── launch.json          ← 修改，新增 minio / minio-reset
├── flowweb.data/             ← 新增数据目录
│   └── minio/                ← MinIO 数据（自动创建）
├── .gitignore                ← 新增 flowweb.data/
```

### launch.json 变更

新增两个条目，修改现有条目使用相对路径：

#### minio（日常启动）

```json
{
  "name": "minio",
  "runtimeExecutable": "minio.exe",
  "runtimeArgs": ["server", "./flowweb.data/minio", "--console-address", ":9001"],
  "port": 9000,
  "cwd": "${workspaceFolder}",
  "env": {
    "MINIO_ROOT_USER": "minioadmin",
    "MINIO_ROOT_PASSWORD": "minioadmin"
  }
}
```

#### minio-reset（重置数据）

```json
{
  "name": "minio-reset",
  "runtimeExecutable": "cmd.exe",
  "runtimeArgs": [
    "/c",
    "if exist .\\flowweb.data\\minio rmdir /s /q .\\flowweb.data\\minio && minio.exe server .\\flowweb.data\\minio --console-address :9001"
  ],
  "port": 9000,
  "cwd": "${workspaceFolder}",
  "env": {
    "MINIO_ROOT_USER": "minioadmin",
    "MINIO_ROOT_PASSWORD": "minioadmin"
  }
}
```

#### compounds — 一键启动全部服务

```json
{
  "compounds": [
    {
      "name": "All Services",
      "configurations": ["minio", "api", "web"]
    }
  ]
}
```

效果：`preview_start all` 一条命令依次启动 MinIO → API → Web。

#### 现有条目路径修正

`api` 和 `web` 的 `cwd` 从 `D:\\flowweb` 改为 `${workspaceFolder}`。

### 启动流程

```
preview_start all                   ← 一键启动（推荐）
preview_start minio → api → web     ← 分步启动
```

已运行时 `preview_start` 自动复用现有进程。

### 地址一览

| 服务 | 地址 | 凭证 |
|------|------|------|
| MinIO API | `http://localhost:9000` | minioadmin / minioadmin |
| MinIO Console | `http://localhost:9001` | minioadmin / minioadmin |
| API | `http://localhost:3000` | — |
| Web | `http://localhost:5173` | — |

### .gitignore

新增行：

```
flowweb.data/
```

### 团队准备

所有开发者执行：

```
winget install MinIO.Minio
```

MinIO 通过 WinGet 安装后自动加入 PATH。

## 边界情况

| 场景 | 行为 |
|------|------|
| MinIO 已运行 | `preview_start` 复用现有进程 |
| 数据目录不存在 | MinIO 自动创建 `.flowweb.data/minio/` |
| 未安装 MinIO | `preview_start` 报错 "minio.exe not found" |
| 需清空测试数据 | 使用 `preview_start minio-reset` |
| Windows cmd 路径分隔符 | `minio-reset` 使用 `\` 而非 `/` |

## 不变更的部分

- PostgreSQL / Redis → 系统服务，开机自启
- `.env` → MinIO 配置已正确
- 存储/上传代码 → 无需改动
- 现有 `flowweb.dataminio/` 目录 → 手动迁移旧数据到 `flowweb.data/minio/` 后删除

## 验证标准

1. `preview_start all` → MinIO → API → Web 依次启动成功
2. MinIO Console `localhost:9001` 可访问，bucket `flowai` 自动创建
3. 上传图片到素材库 → 文件持久化到 `./flowweb.data/minio/`
4. 重启项目 → 之前上传的图片在素材库中正常显示
5. `preview_start minio-reset` → 数据清空无报错，MinIO 重新启动
