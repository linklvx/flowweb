# 全栈快照备份 (Full-Stack Snapshot Backup)

版本节点（核心功能稳定后）执行完整备份，覆盖应用层、数据层、存储层、缓存层。每层独立备份独立恢复，不依赖任何单一工具。

## 备份结构

```
backups/vX.X/
├── BACKUP.md              # 版本信息、凭证、恢复步骤
├── code/
│   ├── flowweb-vX.X-source.zip   # git archive 源码包
│   └── config-files/
│       ├── api.env                # 环境变量（密钥/连接串）
│       ├── .gitignore / package.json / turbo.json 等 # 项目元配置
│       ├── claude/                # .claude 配置（launch.json 等）
│       ├── superpowers/           # .superpowers 配置（brainstorm 等）
│       └── services/redis/        # Redis 服务配置
├── db/
│   ├── flowweb.dump        # pg_dump -Fc 自定义格式
│   └── flowweb_plain.sql   # pg_dump 纯文本 SQL
├── minio/
│   ├── main_data/          # .data/minio 完整复制
│   └── shadow_data/        # flowweb.data/minio 完整复制
└── redis/
    └── dump.rdb            # Redis RDB 快照
```

## 执行步骤

### 1. 锁定版本

```bash
git tag vX.X -m "vX.X: 描述"
git branch backup/vX.X
```

### 2. 备份源码

```bash
# git archive 源码 zip
git archive --format=zip HEAD -o backups/vX.X/code/flowweb-vX.X-source.zip

# 手动复制 .gitignore 排除的配置文件
cp apps/api/.env backups/vX.X/code/config-files/api.env
cp -r .claude backups/vX.X/code/config-files/claude
cp -r .superpowers backups/vX.X/code/config-files/superpowers
cp services/redis/redis.windows.conf backups/vX.X/code/config-files/services/redis/
cp .gitignore package.json turbo.json tsconfig.base.json pnpm-workspace.yaml pnpm-lock.yaml \
   backups/vX.X/code/config-files/
```

### 3. 备份数据库

```bash
# 自定义格式（推荐用于恢复）
pg_dump -h localhost -U flowweb -d flowweb -Fc --no-owner --no-acl \
  -f backups/vX.X/db/flowweb.dump

# 纯文本 SQL（兼容性备选）
pg_dump -h localhost -U flowweb -d flowweb --no-owner --no-acl \
  -f backups/vX.X/db/flowweb_plain.sql
```

### 4. 备份 MinIO

```bash
cp -r .data/minio/* backups/vX.X/minio/main_data/
cp -r flowweb.data/minio/* backups/vX.X/minio/shadow_data/
```

### 5. 备份 Redis

```bash
cp "C:\Program Files\Redis\dump.rdb" backups/vX.X/redis/dump.rdb
```

## 恢复步骤

### 数据库
```bash
# 方式 A: pg_restore（推荐）
pg_restore -h localhost -U flowweb -d flowweb -c --if-exists backups/vX.X/db/flowweb.dump

# 方式 B: psql（纯文本）
psql -h localhost -U flowweb -d flowweb -f backups/vX.X/db/flowweb_plain.sql
```

### MinIO
```bash
cp -r backups/vX.X/minio/main_data/* .data/minio/
cp -r backups/vX.X/minio/shadow_data/* flowweb.data/minio/
```

### Redis
```bash
cp backups/vX.X/redis/dump.rdb "C:\Program Files\Redis\dump.rdb"
```

### 代码
```bash
git checkout vX.X                    # 从 Git tag
# 或
unzip backups/vX.X/code/flowweb-vX.X-source.zip -d .
cp backups/vX.X/code/config-files/api.env apps/api/.env
pnpm install
```

## 设计原则

- **每层独立**：即使 Git 仓库损坏也能从 code/ 目录完整还原
- **双格式数据库**：`-Fc` 高效恢复 + 纯文本 SQL 兼容备选
- **完整存储层**：对象存储（MinIO）数据直接文件复制，不依赖工具导出
- **双重锚定**：Git tag + backup 分支防止误删
- **自文档化**：BACKUP.md 记录恢复步骤，无需外部知识
