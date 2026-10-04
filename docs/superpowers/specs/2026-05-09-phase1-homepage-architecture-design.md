<!-- doc-status: historical | verified_at: n/a -->
# Phase 1: Homepage + Base Architecture Design

> **Status:** Approved
> **Date:** 2026-05-09
> **Scope:** Project scaffolding, homepage UI, backend API foundation

## 1. Overview

Build the foundational architecture for the AI multimodal content creation SaaS platform. Phase 1 delivers a working Turborepo monorepo with a React frontend homepage and NestJS backend API, setting the stage for the canvas/node system in Phase 2.

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | Turborepo + pnpm workspace |
| Frontend | React 18.3.1 + TypeScript 5.6.3 (strict) + Vite 5.4.14 |
| UI | Ant Design 5.22.5 + Tailwind CSS 3.4.21 |
| State | Zustand 4.5.5 |
| Routing | React Router v7 |
| Backend | NestJS 10.4.18 + TypeScript (strict) |
| ORM | Prisma 5.25.3 + PostgreSQL 16.8 |
| Testing | Vitest (unified frontend + backend) |
| Shared Types | OpenAPI auto-generated → `packages/shared` |

> **Note:** 中间件（Redis / BullMQ / MinIO）、可观测性（Prometheus / Grafana / Sentry）、Keycloak 均纳入技术栈，但延后至 Phase2+ 落地，Phase1 仅搭建基础架构。

## 3. Project Structure

```
flowweb/
├── apps/
│   ├── web/                         # Vite + React 18
│   │   ├── src/
│   │   │   ├── components/          # 全局公共组件
│   │   │   │   ├── ui/             # Ant Design 二次封装
│   │   │   │   └── layout/         # 全局布局
│   │   │   ├── pages/              # 页面（小写目录 = 路由）
│   │   │   │   ├── home/
│   │   │   │   │   ├── page.tsx              # 主页容器
│   │   │   │   │   ├── index.ts              # 导出
│   │   │   │   │   └── components/           # 首页私有组件
│   │   │   │   │       ├── AnnouncementBanner.tsx
│   │   │   │   │       ├── Navbar.tsx
│   │   │   │   │       ├── HeroSection.tsx
│   │   │   │   │       ├── ContentSection.tsx
│   │   │   │   │       └── ContentCard.tsx
│   │   │   │   └── canvas/
│   │   │   │       ├── page.tsx
│   │   │   │       ├── index.ts
│   │   │   │       └── components/
│   │   │   ├── stores/             # Zustand stores
│   │   │   ├── hooks/              # 自定义 hooks
│   │   │   ├── api/                # API 请求层
│   │   │   ├── router.tsx          # 路由配置
│   │   │   └── App.tsx
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   └── package.json
│   │
│   └── api/                        # NestJS 10
│       ├── src/
│       │   ├── config/             # 环境变量、配置
│       │   ├── filters/            # 全局异常过滤器
│       │   ├── interceptors/       # 全局拦截器
│       │   ├── modules/
│       │   │   ├── health/         # 健康检查模块
│       │   │   └── content/        # 首页内容模块
│       │   ├── prisma/             # Prisma 服务封装
│       │   └── main.ts
│       ├── prisma/
│       │   └── schema.prisma
│       └── package.json
│
├── packages/
│   └── shared/                     # 前后端共享包
│       ├── src/
│       │   ├── api/                # OpenAPI 自动生成类型
│       │   ├── types/              # 手动编写共享类型
│       │   ├── constants/          # 共享常量
│       │   └── utils/              # 共用工具函数
│       └── package.json
│
├── .gitignore
├── .eslintrc.base.json             # 全栈统一 ESLint 规范
├── docker-compose.yml              # PostgreSQL + Redis + MinIO
├── turbo.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

## 4. Frontend Architecture

### 4.1 Component Tree (Three-Layer Nesting)

```
App
├── RouterProvider (React Router v7)
│   ├── HomePage (route: /)
│   │   ├── TopBar
│   │   │   ├── AnnouncementBanner    (40px, dismissible)
│   │   │   └── Navbar                (64px, #1A1A1A)
│   │   │       ├── Logo
│   │   │       └── NavActions        (templates/membership/login)
│   │   ├── HeroSection
│   │   │   ├── HeroTitle
│   │   │   ├── HeroDescription
│   │   │   └── CTAButton             ("开始创作", brand green)
│   │   ├── ContentSection
│   │   │   ├── SectionHeader
│   │   │   └── ContentGrid           (4-column grid)
│   │   │       └── ContentCard[]     (cover/title/tags/desc)
│   │   └── FloatingButtons
│   │       └── AIAssistantFAB        (fixed bottom-right)
│   │
│   └── CanvasPage (route: /canvas)   [Phase 2 placeholder]
```

### 4.2 Routes

| Path | Page | Phase |
|------|------|-------|
| `/` | HomePage | P1 |
| `/canvas` | CanvasPage (placeholder) | P2 |
| `/canvas/:id` | Project Canvas | P2 |

### 4.3 Zustand Stores (Phase 1)

**announcementStore:**
```typescript
interface AnnouncementState {
  visible: boolean
  message: string
  linkUrl?: string
  dismiss(): void
}
```

**contentStore:**
```typescript
interface ContentState {
  cards: ContentCard[]
  loading: boolean
  error: string | null
  fetchCards(): Promise<void>
}
```

### 4.4 Key Types

> `ContentCard` 等通用基础类型统一归入 `packages/shared/src/types/`，前后端共用，由 OpenAPI 自动生成 + 手动类型复用。

```typescript
// packages/shared/src/types/models.ts
interface ContentCard {
  id: string
  title: string
  coverUrl: string
  tags: string[]
  desc: string
}
```

```typescript
// packages/shared/src/types/nav.ts
export enum NavActionKey {
  Templates = 'templates',
  Membership = 'membership',
  Login = 'login',
}

interface NavAction {
  key: NavActionKey
  label: string
  icon?: ReactNode
  variant: 'primary' | 'outline' | 'ghost'
  onClick: () => void
}
```

## 5. Backend Architecture

### 5.1 NestJS Modules

```
AppModule
├── PrismaModule (@Global) — PrismaService singleton
├── ConfigModule (@Global) — .env validation (zod)
├── HealthModule
│   ├── HealthController — GET /api/health
│   └── HealthService — DB connectivity check
├── ContentModule
│   ├── ContentController
│   │   ├── GET /api/content/cards
│   │   └── GET /api/announcements/active
│   └── ContentService
└── Global Filters
    ├── HttpExceptionFilter — unified error format
    └── TransformInterceptor — unified success format
```

### 5.2 Prisma Schema

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
  strict   = true
}

model Announcement {
  id         String    @id @default(cuid())
  message    String
  linkUrl    String?
  active     Boolean   @default(true)
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  @@index([active])
}

model ContentCard {
  id         String    @id @default(cuid())
  title      String
  coverUrl   String
  tags       String[]
  desc       String
  sortOrder  Int       @default(0)
  active     Boolean   @default(true)
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  @@index([active, sortOrder])
}
```

### 5.3 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check with DB status |
| GET | `/api/content/cards` | Active cards, ordered by sortOrder |
| GET | `/api/announcements/active` | Current active announcement (max 1) |

### 5.4 Response Format

```typescript
// Success
{ code: 0, data: T, message: "ok" }

// Error
{ code: -1, data: null, message: "error description" }
```

- `code: 0` — 成功
- `code: -1` — 系统级错误
- `code: 1000+` — 业务自定义错误码（Phase 2+ 扩展）

### 5.5 OpenAPI & Shared Types Workflow

1. NestJS `@nestjs/swagger` 自动生成 OpenAPI 规范
2. `openapi-typescript` 生成 TS 类型至 `packages/shared/src/api/`
3. 前后端统一从 `@flowweb/shared` 导入类型，保持全栈类型强一致
4. 类型生成集成到 Turborepo 构建链路，开发时自动更新

## 6. Testing Strategy (TDD)

### 6.1 Principles
- NO production code without a failing test first
- Unified Vitest across frontend and backend
- Real code over mocks (mock only external boundaries)
- Each component/function: test → fail → implement → pass → refactor

### 6.2 Frontend Tests
- Component rendering tests (vitest + @testing-library/react)
- Store logic tests (Zustand actions/state)
- API layer tests (vitest + msw for HTTP mocking)
- Page integration tests

### 6.3 Backend Tests
- Controller tests (@nestjs/testing + supertest)
- Service unit tests (pure logic, no DB)
- Prisma service tests (against test DB or mocked)
- E2E tests (supertest against full NestJS app)

### 6.4 Test File Convention

- 前端组件 / 逻辑：`*.test.tsx`（React 组件）或 `*.test.ts`（纯逻辑）
- 后端 Nest 规范：`*.spec.ts`
- 测试文件与源码同级存放，不单独集中目录

```
// Example
pages/home/components/ContentCard.tsx
pages/home/components/ContentCard.test.tsx

api/src/modules/content/content.service.ts
api/src/modules/content/content.service.spec.ts
```

## 7. Development Environment

### 7.1 Docker Compose

```yaml
services:
  postgres:
    image: postgres:16
    ports: ["5432:5432"]
    environment:
      POSTGRES_USER: flowweb
      POSTGRES_PASSWORD: flowweb_dev
      POSTGRES_DB: flowweb
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7
    ports: ["6379:6379"]
    volumes:
      - redis_data:/data
    restart: unless-stopped

  minio:
    image: minio/minio:latest
    ports: ["9000:9000", "9001:9001"]
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio_data:/data
    command: server /data --console-address ":9001"
    restart: unless-stopped

volumes:
  pgdata:
  redis_data:
  minio_data:
```

数据库连接地址通过 `.env` 统一管理：

```env
# apps/api/.env
DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
```

### 7.2 Commands
```bash
pnpm install                # Install all deps
pnpm dev                    # Run web + api via Turborepo
pnpm test                   # Run all tests
turbo run build             # Build all packages
```

## 8. What's NOT in Phase 1
- Canvas/Node engine (@xyflow/react)
- User authentication (Keycloak)
- Model configuration & billing
- Workflow orchestration
- Socket.io real-time sync
- Redis/BullMQ queues
- MinIO object storage usage
- Observability (Prometheus/Grafana/Sentry)
