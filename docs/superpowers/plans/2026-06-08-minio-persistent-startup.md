<!-- doc-status: historical | verified_at: n/a -->
# MinIO 持久化启动方案 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MinIO 纳入 launch.json 统一管理，数据目录使用项目相对路径，支持 `preview_start all` 一键启动

**Architecture:** 纯配置变更 — 修改 `.claude/launch.json` 和 `.gitignore`，不涉及代码改动

**Tech Stack:** MinIO (WinGet), Claude Code launch.json

---

### Task 1: 更新 .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 添加 flowweb.data/ 到 .gitignore**

在 `.gitignore` 末尾添加一行：

```
flowweb.data/
```

- [ ] **Step 2: 验证 .gitignore 变更**

```bash
git diff .gitignore
```

预期：新增 `flowweb.data/` 一行。

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add flowweb.data/ to .gitignore

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: 修正现有 launch.json 路径

**Files:**
- Modify: `.claude/launch.json`

- [ ] **Step 1: 修改 web 和 api 的 cwd**

将 `web` 和 `api` 条目的 `"cwd": "D:\\flowweb"` 改为 `"cwd": "${workspaceFolder}"`。

修改前：
```json
{
  "name": "web",
  "runtimeExecutable": "npx",
  "runtimeArgs": ["turbo", "run", "dev", "--filter=@flowweb/web"],
  "port": 5173,
  "cwd": "D:\\flowweb"
},
{
  "name": "api",
  "runtimeExecutable": "npx",
  "runtimeArgs": ["turbo", "run", "dev", "--filter=@flowweb/api"],
  "port": 3000,
  "cwd": "D:\\flowweb"
}
```

修改后：
```json
{
  "name": "web",
  "runtimeExecutable": "npx",
  "runtimeArgs": ["turbo", "run", "dev", "--filter=@flowweb/web"],
  "port": 5173,
  "cwd": "${workspaceFolder}"
},
{
  "name": "api",
  "runtimeExecutable": "npx",
  "runtimeArgs": ["turbo", "run", "dev", "--filter=@flowweb/api"],
  "port": 3000,
  "cwd": "${workspaceFolder}"
}
```

- [ ] **Step 2: 验证 JSON 格式有效**

```bash
node -e "JSON.parse(require('fs').readFileSync('.claude/launch.json','utf8')); console.log('OK')"
```

预期：输出 `OK`

- [ ] **Step 3: Commit**

```bash
git add .claude/launch.json
git commit -m "refactor: use workspaceFolder variable in launch.json cwd

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: 新增 MinIO 启动条目

**Files:**
- Modify: `.claude/launch.json`

- [ ] **Step 1: 在 configurations 尾部添加 minio 条目**

在 `configurations` 数组末尾（`]` 之前）添加：

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

完整的 launch.json 此时应包含三个条目：`minio`、`web`（修改后）、`api`（修改后）。

- [ ] **Step 2: 验证 JSON 格式有效**

```bash
node -e "JSON.parse(require('fs').readFileSync('.claude/launch.json','utf8')); console.log('OK')"
```

预期：输出 `OK`

- [ ] **Step 3: Commit**

```bash
git add .claude/launch.json
git commit -m "feat: add minio to launch.json for persistent storage

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: 新增 minio-reset 重置条目

**Files:**
- Modify: `.claude/launch.json`

- [ ] **Step 1: 在 configurations 尾部添加 minio-reset 条目**

在 `configurations` 数组末尾（`]` 之前）添加：

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

- [ ] **Step 2: 验证 JSON 格式有效**

```bash
node -e "JSON.parse(require('fs').readFileSync('.claude/launch.json','utf8')); console.log('OK')"
```

预期：输出 `OK`

- [ ] **Step 3: Commit**

```bash
git add .claude/launch.json
git commit -m "feat: add minio-reset to launch.json for test data cleanup

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: 新增 compounds 一键启动

**Files:**
- Modify: `.claude/launch.json`

- [ ] **Step 1: 添加 compounds 配置**

在顶层 JSON 对象中添加 `compounds` 字段（与 `configurations` 同级）：

```json
  "compounds": [
    {
      "name": "All Services",
      "configurations": ["minio", "api", "web"]
    }
  ]
```

最终的 `.claude/launch.json` 完整结构：

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "web",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["turbo", "run", "dev", "--filter=@flowweb/web"],
      "port": 5173,
      "cwd": "${workspaceFolder}"
    },
    {
      "name": "api",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["turbo", "run", "dev", "--filter=@flowweb/api"],
      "port": 3000,
      "cwd": "${workspaceFolder}"
    },
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
    },
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
  ],
  "compounds": [
    {
      "name": "All Services",
      "configurations": ["minio", "api", "web"]
    }
  ]
}
```

- [ ] **Step 2: 验证 JSON 格式有效**

```bash
node -e "JSON.parse(require('fs').readFileSync('.claude/launch.json','utf8')); console.log('OK')"
```

预期：输出 `OK`

- [ ] **Step 3: Commit**

```bash
git add .claude/launch.json
git commit -m "feat: add compounds for one-click all-services startup

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: 端到端验证

**Files:**
- 无新增文件
- 验证 `preview_start minio` 和 `preview_start all`

- [ ] **Step 1: 停止所有现有服务**

停止当前运行的 MinIO、API、Web 进程。

```bash
taskkill /f /im minio.exe 2>nul & taskkill /f /im node.exe 2>nul
```

或通过 preview_stop 停止已有服务。

- [ ] **Step 2: 启动 MinIO 并验证**

```bash
# 通过 preview_start 启动
preview_start minio
```

验证：
- 进程 `minio.exe` 在运行
- `curl -s http://localhost:9000` 返回 MinIO 响应
- `ls flowweb.data/minio/` 存在（自动创建）

- [ ] **Step 3: 启动全部服务并验证**

```bash
preview_start all
```

验证：
- MinIO 端口 9000 响应
- API 端口 3000 响应：`curl -s http://localhost:3000/api/health`
- Web 端口 5173 响应

- [ ] **Step 4: 上传文件并验证持久化**

1. 打开 `http://localhost:5173` 登录
2. 进入素材库，上传一张测试图片
3. 确认文件显示在素材库中
4. 检查 MinIO 数据目录存在对应文件：
   ```bash
   find flowweb.data/minio -type f -name "*.png" | head -5
   ```
5. 重启项目：停止所有服务 → `preview_start all`
6. 确认之前上传的图片仍在素材库中显示

- [ ] **Step 5: 验证 minio-reset**

```bash
preview_start minio-reset
```

验证：
- MinIO 启动成功，无 "系统找不到指定的文件" 错误
- 数据目录已清空重创

- [ ] **Step 6: 最终 Commit（如有验证调整）**

```bash
git status
```

如有调整，commit；否则无需额外提交。
