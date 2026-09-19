# Phase 1: Homepage + Base Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a working Turborepo monorepo with React homepage (announcement banner, navbar, hero, content grid, AI assistant FAB) + NestJS backend API (health, content cards, announcements) with TDD throughout.

**Architecture:** Turborepo monorepo with pnpm workspaces. Three packages: `apps/web` (Vite + React 18), `apps/api` (NestJS 10), `packages/shared` (shared types). Frontend uses three-layer nested component tree with Zustand state. Backend uses NestJS modules with Prisma ORM + PostgreSQL. All code written test-first with unified Vitest.

**Tech Stack:** React 18.3.1, TypeScript 5.6.3 (strict), Vite 5.4.14, Ant Design 5.22.5, Tailwind CSS 3.4.21, Zustand 4.5.5, React Router v7, NestJS 10.4.18, Prisma 5.25.3, PostgreSQL 16, Vitest

---

## File Structure Map

```
flowweb/
├── docker-compose.yml                    [Create]
├── turbo.json                            [Create]
├── pnpm-workspace.yaml                   [Create]
├── tsconfig.base.json                     [Create]
├── .eslintrc.base.json                    [Create]
├── .gitignore                            [Create]
├── package.json                          [Create]
├── packages/shared/
│   ├── src/
│   │   ├── api/                          [Create — OpenAPI auto-gen target]
│   │   ├── types/
│   │   │   ├── models.ts                 [Create]
│   │   │   └── nav.ts                    [Create]
│   │   └── constants/                    [Create]
│   ├── tsconfig.json                     [Create]
│   └── package.json                      [Create]
├── apps/api/
│   ├── src/
│   │   ├── config/
│   │   │   └── env.ts                    [Create]
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts  [Create]
│   │   ├── interceptors/
│   │   │   └── transform.interceptor.ts  [Create]
│   │   ├── modules/
│   │   │   ├── health/
│   │   │   │   ├── health.module.ts      [Create]
│   │   │   │   ├── health.controller.ts  [Create]
│   │   │   │   └── health.service.ts     [Create]
│   │   │   └── content/
│   │   │       ├── content.module.ts     [Create]
│   │   │       ├── content.controller.ts [Create]
│   │   │       └── content.service.ts    [Create]
│   │   ├── prisma/
│   │   │   ├── prisma.module.ts          [Create]
│   │   │   └── prisma.service.ts         [Create]
│   │   └── main.ts                       [Create]
│   ├── prisma/
│   │   └── schema.prisma                 [Create]
│   ├── tsconfig.json                     [Create]
│   └── package.json                      [Create]
├── apps/web/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                       [Create]
│   │   │   └── layout/                   [Create]
│   │   ├── pages/
│   │   │   ├── home/
│   │   │   │   ├── page.tsx              [Create]
│   │   │   │   ├── index.ts              [Create]
│   │   │   │   └── components/
│   │   │   │       ├── AnnouncementBanner.tsx    [Create]
│   │   │   │       ├── Navbar.tsx                [Create]
│   │   │   │       ├── HeroSection.tsx           [Create]
│   │   │   │       ├── ContentSection.tsx        [Create]
│   │   │   │       └── ContentCard.tsx           [Create]
│   │   │   └── canvas/
│   │   │       ├── page.tsx              [Create — placeholder]
│   │   │       └── index.ts              [Create]
│   │   ├── stores/
│   │   │   ├── announcementStore.ts      [Create]
│   │   │   └── contentStore.ts           [Create]
│   │   ├── api/
│   │   │   └── client.ts                 [Create]
│   │   ├── router.tsx                    [Create]
│   │   └── App.tsx                       [Create]
│   ├── index.html                         [Create]
│   ├── vite.config.ts                     [Create]
│   ├── tailwind.config.ts                 [Create]
│   ├── tsconfig.json                      [Create]
│   └── package.json                       [Create]
```

---

## Group 1: Infrastructure Scaffolding

### Task 1.1: Docker Compose — Development Environment

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Write docker-compose.yml**

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

- [ ] **Step 2: Start containers and verify**

```bash
docker compose up -d
docker compose ps
```

Expected: postgres, redis, minio all `healthy` or `running`.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add Docker Compose dev environment (postgres, redis, minio)"
```

---

### Task 1.2: Root Package Configuration

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.eslintrc.base.json`, `.gitignore`

- [ ] **Step 1: Write root package.json**

```json
{
  "name": "flowweb",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "5.6.3"
  }
}
```

- [ ] **Step 2: Write pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Write turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": []
    },
    "lint": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **Step 4: Write tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 5: Write .eslintrc.base.json**

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/strict"
  ],
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
  }
}
```

- [ ] **Step 6: Write .gitignore**

```
node_modules/
dist/
.env
.env.local
*.log
.superpowers/
.turbo/
```

- [ ] **Step 7: Install dependencies**

```bash
pnpm install
```

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .eslintrc.base.json .gitignore pnpm-lock.yaml
git commit -m "feat: add root monorepo config (Turborepo, pnpm workspace, TS base, ESLint)"
```

---

## Group 2: Shared Package

### Task 2.1: Shared Package — Types and Constants

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types/models.ts`, `packages/shared/src/types/nav.ts`

- [ ] **Step 1: Write failing test for types**

```bash
# packages/shared/src/types/models.ts does not exist yet — test verifies types compile
```

Since shared package is pure types (no runtime logic), we verify via `tsc --noEmit`.

**Test file:** `packages/shared/src/__tests__/types.test-d.ts` (Note: compile-time types, we verify by building)

For the shared package, verification is compilation-based rather than unit-test-based. The test is: does the downstream consumer compile?

- [ ] **Step 2: Write shared package.json**

```json
{
  "name": "@flowweb/shared",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc --noEmit",
    "test": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "5.6.3"
  }
}
```

- [ ] **Step 3: Write shared tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write types/models.ts**

```typescript
export interface ContentCard {
  id: string
  title: string
  coverUrl: string
  tags: string[]
  desc: string
}
```

- [ ] **Step 5: Write types/nav.ts**

```typescript
export enum NavActionKey {
  Templates = 'templates',
  Membership = 'membership',
  Login = 'login',
}
```

- [ ] **Step 6: Write barrel index.ts**

```typescript
export { type ContentCard } from './types/models';
export { NavActionKey } from './types/nav';
```

- [ ] **Step 7: Verify compilation**

```bash
cd packages/shared && pnpm test
```

Expected: `tsc --noEmit` passes with no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/
git commit -m "feat: add @flowweb/shared package with ContentCard and NavActionKey types"
```

---

## Group 3: Backend Foundation

### Task 3.1: Backend NestJS Scaffold

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/nest-cli.json`
- Create: `apps/api/src/main.ts`, `apps/api/src/config/env.ts`

- [ ] **Step 1: Write failing test for main.ts bootstrap**

```typescript
// apps/api/src/__tests__/main.spec.ts
// This is created AFTER src files exist — we write the test first conceptually
// then watch it fail because the module doesn't bootstrap yet

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';

describe('App Bootstrap', () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('should bootstrap and listen on configured port', async () => {
    // We'll implement this after scaffold exists
  });
});
```

- [ ] **Step 2: Write apps/api/package.json**

```json
{
  "name": "@flowweb/api",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint \"{src,test}/**/*.ts\""
  },
  "dependencies": {
    "@flowweb/shared": "workspace:*",
    "@nestjs/common": "10.4.18",
    "@nestjs/core": "10.4.18",
    "@nestjs/platform-express": "10.4.18",
    "@nestjs/swagger": "^7.4.0",
    "@prisma/client": "5.25.3",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@nestjs/cli": "10.4.18",
    "@nestjs/testing": "10.4.18",
    "@types/node": "^20.11.0",
    "prisma": "5.25.3",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0",
    "vitest": "^2.1.0",
    "eslint": "^8.57.0",
    "typescript": "5.6.3"
  }
}
```

- [ ] **Step 3: Write apps/api/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "target": "ES2022"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Write apps/api/nest-cli.json**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src"
}
```

- [ ] **Step 5: Write config/env.ts**

```typescript
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  REDIS_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    process.exit(1);
  }
  return result.data;
}
```

- [ ] **Step 6: Write config/env.spec.ts**

```typescript
// apps/api/src/config/env.spec.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateEnv } from './env';

describe('validateEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should validate correct environment variables', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/db';
    process.env.PORT = '3000';
    const env = validateEnv();
    expect(env.DATABASE_URL).toBe('postgresql://localhost:5432/db');
    expect(env.PORT).toBe(3000);
  });

  it('should default PORT to 3000 when not set', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/db';
    const env = validateEnv();
    expect(env.PORT).toBe(3000);
  });

  it('should exit when DATABASE_URL is missing', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    validateEnv();
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });
});
```

- [ ] **Step 7: Verify test fails then passes**

```bash
cd apps/api && pnpm test -- --run
```

Expected: 2 pass, 1 fail (exit test may behave differently — adjust as needed).

- [ ] **Step 8: Write vitest.config.ts**

```typescript
// apps/api/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 9: Install dependencies**

```bash
cd apps/api && pnpm install
```

- [ ] **Step 10: Verify tests pass**

```bash
cd apps/api && pnpm test -- --run
```

- [ ] **Step 11: Commit**

```bash
git add apps/api/package.json apps/api/tsconfig.json apps/api/nest-cli.json apps/api/vitest.config.ts apps/api/src/config/ apps/api/pnpm-lock.yaml
git commit -m "feat: add NestJS scaffold with env validation (zod)"
```

---

### Task 3.2: Backend — Prisma Service

**Files:**
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/prisma/prisma.service.ts`, `apps/api/src/prisma/prisma.module.ts`
- Create: `apps/api/.env`

- [ ] **Step 1: Write Prisma schema**

```prisma
// apps/api/prisma/schema.prisma
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

- [ ] **Step 2: Write .env**

```env
# apps/api/.env
DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb
PORT=3000
```

- [ ] **Step 3: Run Prisma migration**

```bash
cd apps/api && npx prisma migrate dev --name init
```

Expected: migration created and applied successfully.

- [ ] **Step 4: Write failing test for PrismaService**

```typescript
// apps/api/src/prisma/prisma.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';
import { describe, it, expect, beforeEach } from 'vitest';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should connect on module init', async () => {
    await service.onModuleInit();
    // If no error thrown, connection succeeded
  });
});
```

- [ ] **Step 5: Implement PrismaService**

```typescript
// apps/api/src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

- [ ] **Step 6: Implement PrismaModule**

```typescript
// apps/api/src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 7: Verify tests pass**

```bash
cd apps/api && pnpm test -- --run
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/ apps/api/src/prisma/ apps/api/.env
git commit -m "feat: add Prisma schema, migration, and service module"
```

---

### Task 3.3: Backend — Global Filters & Interceptors

**Files:**
- Create: `apps/api/src/filters/http-exception.filter.ts`
- Create: `apps/api/src/interceptors/transform.interceptor.ts`

- [ ] **Step 1: Write failing test for HttpExceptionFilter**

```typescript
// apps/api/src/filters/http-exception.filter.spec.ts
import { HttpExceptionFilter } from './http-exception.filter';
import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, it, expect } from 'vitest';

describe('HttpExceptionFilter', () => {
  it('should format HttpException response', () => {
    const filter = new HttpExceptionFilter();
    const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);

    const mockJson = vi.fn();
    const mockStatus = vi.fn().mockReturnValue({ json: mockJson });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({ url: '/api/test' }),
      }),
    };

    filter.catch(exception, host as any);
    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const callArg = mockJson.mock.calls[0][0];
    expect(callArg.code).toBe(-1);
    expect(callArg.data).toBeNull();
    expect(callArg.message).toBe('Test error');
  });
});
```

- [ ] **Step 2: Implement HttpExceptionFilter**

```typescript
// apps/api/src/filters/http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const message = exception.message;

    response.status(status).json({
      code: -1,
      data: null,
      message,
    });
  }
}
```

- [ ] **Step 3: Write failing test for TransformInterceptor**

```typescript
// apps/api/src/interceptors/transform.interceptor.spec.ts
import { TransformInterceptor } from './transform.interceptor';
import { of } from 'rxjs';
import { describe, it, expect } from 'vitest';

describe('TransformInterceptor', () => {
  it('should wrap success response', async () => {
    const interceptor = new TransformInterceptor();
    const context = {
      switchToHttp: () => ({
        getResponse: () => ({ statusCode: 200 }),
      }),
    };

    const next = { handle: () => of({ id: '123', title: 'test' }) };
    const result$ = interceptor.intercept(context as any, next as any);

    const result = await new Promise((resolve) => result$.subscribe(resolve));
    expect(result).toEqual({
      code: 0,
      data: { id: '123', title: 'test' },
      message: 'ok',
    });
  });
});
```

- [ ] **Step 4: Implement TransformInterceptor**

```typescript
// apps/api/src/interceptors/transform.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface WrappedResponse<T> {
  code: number;
  data: T;
  message: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, WrappedResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<WrappedResponse<T>> {
    return next.handle().pipe(
      map(data => ({
        code: 0,
        data,
        message: 'ok',
      })),
    );
  }
}
```

- [ ] **Step 5: Verify all tests pass**

```bash
cd apps/api && pnpm test -- --run
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/filters/ apps/api/src/interceptors/
git commit -m "feat: add global HttpExceptionFilter and TransformInterceptor"
```

---

### Task 3.4: Backend — Health Module

**Files:**
- Create: `apps/api/src/modules/health/health.module.ts`, `health.controller.ts`, `health.service.ts`

- [ ] **Step 1: Write failing test for HealthService**

```typescript
// apps/api/src/modules/health/health.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach } from 'vitest';

describe('HealthService', () => {
  let service: HealthService;
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = { $queryRaw: vi.fn().mockResolvedValue([{ 1: 1n }]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('should return ok when DB is healthy', async () => {
    const result = await service.check();
    expect(result.status).toBe('ok');
    expect(result.db).toBe(true);
  });

  it('should return db: false when DB query fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const result = await service.check();
    expect(result.db).toBe(false);
  });
});
```

- [ ] **Step 2: Implement HealthService**

```typescript
// apps/api/src/modules/health/health.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface HealthResult {
  status: 'ok' | 'degraded';
  db: boolean;
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthResult> {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }

    return {
      status: db ? 'ok' : 'degraded',
      db,
      timestamp: new Date().toISOString(),
    };
  }
}
```

- [ ] **Step 3: Write failing test for HealthController**

```typescript
// apps/api/src/modules/health/health.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { describe, it, expect, beforeEach } from 'vitest';
import { TransformInterceptor } from '../../interceptors/transform.interceptor';

describe('HealthController', () => {
  let controller: HealthController;
  let service: { check: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = { check: vi.fn().mockResolvedValue({ status: 'ok', db: true, timestamp: '2024-01-01' }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: service }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should return health status', async () => {
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.db).toBe(true);
  });
});
```

- [ ] **Step 4: Implement HealthController**

```typescript
// apps/api/src/modules/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { HealthService, HealthResult } from './health.service';

@Controller('api/health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check(): Promise<HealthResult> {
    return this.healthService.check();
  }
}
```

- [ ] **Step 5: Implement HealthModule**

```typescript
// apps/api/src/modules/health/health.module.ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
```

- [ ] **Step 6: Verify tests pass**

```bash
cd apps/api && pnpm test -- --run
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/health/
git commit -m "feat: add HealthModule with DB connectivity check"
```

---

### Task 3.5: Backend — Content Module

**Files:**
- Create: `apps/api/src/modules/content/content.module.ts`, `content.controller.ts`, `content.service.ts`
- Modify: `apps/api/src/main.ts`

- [ ] **Step 1: Write failing test for ContentService**

```typescript
// apps/api/src/modules/content/content.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ContentService } from './content.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach } from 'vitest';

describe('ContentService', () => {
  let service: ContentService;
  let prisma;

  beforeEach(async () => {
    prisma = {
      contentCard: { findMany: vi.fn() },
      announcement: { findFirst: vi.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  describe('getCards', () => {
    it('should return active cards sorted by sortOrder', async () => {
      const mockCards = [
        { id: '1', title: 'Card 1', coverUrl: 'url1', tags: ['推荐'], desc: 'desc1', sortOrder: 1, active: true, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', title: 'Card 2', coverUrl: 'url2', tags: [], desc: 'desc2', sortOrder: 2, active: true, createdAt: new Date(), updatedAt: new Date() },
      ];
      prisma.contentCard.findMany.mockResolvedValue(mockCards);

      const result = await service.getCards();
      expect(result).toHaveLength(2);
      expect(prisma.contentCard.findMany).toHaveBeenCalledWith({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
      });
    });
  });

  describe('getActiveAnnouncement', () => {
    it('should return the active announcement', async () => {
      const mockAnnounce = { id: 'a1', message: 'Test', linkUrl: null, active: true, createdAt: new Date(), updatedAt: new Date() };
      prisma.announcement.findFirst.mockResolvedValue(mockAnnounce);

      const result = await service.getActiveAnnouncement();
      expect(result).toEqual(mockAnnounce);
    });

    it('should return null when no active announcement', async () => {
      prisma.announcement.findFirst.mockResolvedValue(null);
      const result = await service.getActiveAnnouncement();
      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Implement ContentService**

```typescript
// apps/api/src/modules/content/content.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  async getCards() {
    return this.prisma.contentCard.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getActiveAnnouncement() {
    return this.prisma.announcement.findFirst({
      where: { active: true },
    });
  }
}
```

- [ ] **Step 3: Write failing test for ContentController**

```typescript
// apps/api/src/modules/content/content.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { describe, it, expect, beforeEach } from 'vitest';

describe('ContentController', () => {
  let controller: ContentController;
  let service: {
    getCards: ReturnType<typeof vi.fn>;
    getActiveAnnouncement: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      getCards: vi.fn().mockResolvedValue([]),
      getActiveAnnouncement: vi.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContentController],
      providers: [{ provide: ContentService, useValue: service }],
    }).compile();

    controller = module.get<ContentController>(ContentController);
  });

  it('should return cards', async () => {
    service.getCards.mockResolvedValue([{ id: '1', title: 'Test' }]);
    const result = await controller.getCards();
    expect(result).toHaveLength(1);
  });

  it('should return active announcement', async () => {
    service.getActiveAnnouncement.mockResolvedValue({ id: 'a1', message: 'Hello' });
    const result = await controller.getActiveAnnouncement();
    expect(result.message).toBe('Hello');
  });
});
```

- [ ] **Step 4: Implement ContentController**

```typescript
// apps/api/src/modules/content/content.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ContentService } from './content.service';

@Controller('api/content')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Get('cards')
  getCards() {
    return this.contentService.getCards();
  }
}
```

```typescript
// apps/api/src/modules/content/announcement.controller.ts (separate controller for clean routing)
import { Controller, Get } from '@nestjs/common';
import { ContentService } from './content.service';

@Controller('api/announcements')
export class AnnouncementController {
  constructor(private readonly contentService: ContentService) {}

  @Get('active')
  getActiveAnnouncement() {
    return this.contentService.getActiveAnnouncement();
  }
}
```

- [ ] **Step 5: Implement ContentModule**

```typescript
// apps/api/src/modules/content/content.module.ts
import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { AnnouncementController } from './announcement.controller';
import { ContentService } from './content.service';

@Module({
  controllers: [ContentController, AnnouncementController],
  providers: [ContentService],
})
export class ContentModule {}
```

- [ ] **Step 6: Write AppModule and main.ts**

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { ContentModule } from './modules/content/content.module';

@Module({
  imports: [PrismaModule, HealthModule, ContentModule],
})
export class AppModule {}
```

```typescript
// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { validateEnv } from './config/env';

async function bootstrap() {
  const env = validateEnv();

  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('', { exclude: [] });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  app.enableCors({ origin: 'http://localhost:5173' });

  await app.listen(env.PORT);
}

bootstrap();
```

- [ ] **Step 7: Verify tests pass**

```bash
cd apps/api && pnpm test -- --run
```

- [ ] **Step 8: Start API and verify endpoints**

```bash
cd apps/api && pnpm dev &
sleep 5
curl http://localhost:3000/api/health
curl http://localhost:3000/api/content/cards
curl http://localhost:3000/api/announcements/active
```

Expected: All three return `{ "code": 0, "data": ..., "message": "ok" }`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/content/ apps/api/src/app.module.ts apps/api/src/main.ts
git commit -m "feat: add ContentModule with cards and announcement endpoints"
```

---

## Group 4: Frontend Foundation

### Task 4.1: Frontend Vite + React Scaffold

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`
- Create: `apps/web/index.html`, `apps/web/tailwind.config.ts`
- Create: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`

- [ ] **Step 1: Write failing test for App renders**

```typescript
// apps/web/src/App.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('should render RouterProvider', () => {
    render(<App />);
    // At minimum, App renders without error
    expect(document.body).toBeTruthy();
  });
});
```

- [ ] **Step 2: Write apps/web/package.json**

```json
{
  "name": "@flowweb/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint \"src/**/*.{ts,tsx}\""
  },
  "dependencies": {
    "@flowweb/shared": "workspace:*",
    "antd": "5.22.5",
    "@ant-design/icons": "^5.5.0",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "react-router": "^7.0.0",
    "zustand": "4.5.5"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.0",
    "tailwindcss": "3.4.21",
    "typescript": "5.6.3",
    "vite": "5.4.14",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Write apps/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Write vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
```

- [ ] **Step 5: Write vitest config (in vite.config.ts — append)**

```typescript
/// <reference types="vitest" />
// At top of vite.config.ts, then append:
export default defineConfig({
  // ... existing config
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

- [ ] **Step 6: Write tailwind.config.ts**

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          green: '#4ade80',
          dark: '#1A1A1A',
          darker: '#111',
        },
      },
    },
  },
  plugins: [],
  corePlugins: {
    preflight: false, // Ant Design 自带 reset
  },
};

export default config;
```

> 【已废止 2026-09-19】`preflight: false`（本配置即红线源头）已被 docs/superpowers/specs/2026-09-18-css-base-layer-theme-design.md 推翻并重开（A 段落地）；本条仅存历史档。

- [ ] **Step 7: Write postcss.config.js**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 8: Write index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FlowAI - AI 多模态内容创作平台</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 9: Write main.tsx**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 10: Write index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  background: #0f0f0f;
  color: #e2e8f0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
```

- [ ] **Step 11: Write router.tsx**

```typescript
import { createBrowserRouter } from 'react-router';
import { HomePage } from '@/pages/home';
import { CanvasPage } from '@/pages/canvas';

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/canvas', element: <CanvasPage /> },
]);
```

- [ ] **Step 12: Write App.tsx**

```typescript
import { RouterProvider } from 'react-router';
import { router } from './router';

export function App() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 13: Write test-setup.ts**

```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 14: Write minimal page files (placeholders)**

```typescript
// apps/web/src/pages/canvas/page.tsx
export function CanvasPage() {
  return <div className="p-8 text-center text-gray-500">Canvas — Phase 2</div>;
}
```

```typescript
// apps/web/src/pages/canvas/index.ts
export { CanvasPage } from './page';
```

- [ ] **Step 15: Install dependencies**

```bash
pnpm install
```

- [ ] **Step 16: Verify app compiles**

```bash
cd apps/web && pnpm dev
# Visit http://localhost:5173 — should see blank page (no homepage yet)
```

- [ ] **Step 17: Verify tests pass**

```bash
cd apps/web && pnpm test -- --run
```

- [ ] **Step 18: Commit**

```bash
git add apps/web/
git commit -m "feat: add Vite + React scaffold with Tailwind, React Router, Vitest"
```

---

## Group 5: Frontend Stores

### Task 5.1: Zustand announcementStore

**Files:**
- Create: `apps/web/src/stores/announcementStore.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/src/stores/announcementStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAnnouncementStore } from './announcementStore';

describe('announcementStore', () => {
  beforeEach(() => {
    const { getState, setState } = useAnnouncementStore;
    setState({
      visible: true,
      message: '欢迎来到 FlowAI',
      linkUrl: '/promo',
    });
  });

  it('should initialize with default state', () => {
    const state = useAnnouncementStore.getState();
    expect(state.visible).toBe(true);
    expect(state.message).toBe('欢迎来到 FlowAI');
  });

  it('should dismiss announcement', () => {
    const { dismiss } = useAnnouncementStore.getState();
    dismiss();
    const state = useAnnouncementStore.getState();
    expect(state.visible).toBe(false);
  });
});
```

- [ ] **Step 2: Implement store**

```typescript
// apps/web/src/stores/announcementStore.ts
import { create } from 'zustand';

interface AnnouncementState {
  visible: boolean;
  message: string;
  linkUrl?: string;
  dismiss: () => void;
}

export const useAnnouncementStore = create<AnnouncementState>((set) => ({
  visible: false,
  message: '',
  linkUrl: undefined,
  dismiss: () => set({ visible: false }),
}));
```

- [ ] **Step 3: Verify test passes**

```bash
cd apps/web && pnpm test -- --run apps/web/src/stores/announcementStore.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/stores/announcementStore.ts apps/web/src/stores/announcementStore.test.ts
git commit -m "feat: add announcementStore with dismiss action"
```

---

### Task 5.2: Zustand contentStore

**Files:**
- Create: `apps/web/src/stores/contentStore.ts`
- Create: `apps/web/src/api/client.ts`

- [ ] **Step 1: Write API client**

```typescript
// apps/web/src/api/client.ts
const BASE_URL = '/api';

export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.message);
  }
  return json.data;
}
```

- [ ] **Step 2: Write failing test for contentStore**

```typescript
// apps/web/src/stores/contentStore.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useContentStore } from './contentStore';

// Mock the API client
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '@/api/client';
const mockApiFetch = vi.mocked(apiFetch);

describe('contentStore', () => {
  beforeEach(() => {
    useContentStore.setState({ cards: [], loading: false, error: null });
    vi.clearAllMocks();
  });

  it('should initialize with empty state', () => {
    const state = useContentStore.getState();
    expect(state.cards).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('should fetch cards and update state', async () => {
    const mockCards = [
      { id: '1', title: 'Test', coverUrl: 'url', tags: ['推荐'], desc: 'desc' },
    ];
    mockApiFetch.mockResolvedValue(mockCards);

    await useContentStore.getState().fetchCards();

    const state = useContentStore.getState();
    expect(state.cards).toEqual(mockCards);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('should set error on fetch failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));

    await useContentStore.getState().fetchCards();

    const state = useContentStore.getState();
    expect(state.error).toBe('Network error');
    expect(state.loading).toBe(false);
  });
});
```

- [ ] **Step 3: Implement store**

```typescript
// apps/web/src/stores/contentStore.ts
import { create } from 'zustand';
import type { ContentCard } from '@flowweb/shared';
import { apiFetch } from '@/api/client';

interface ContentState {
  cards: ContentCard[];
  loading: boolean;
  error: string | null;
  fetchCards: () => Promise<void>;
}

export const useContentStore = create<ContentState>((set) => ({
  cards: [],
  loading: false,
  error: null,
  fetchCards: async () => {
    set({ loading: true, error: null });
    try {
      const cards = await apiFetch<ContentCard[]>('/content/cards');
      set({ cards, loading: false });
    } catch (e: unknown) {
      set({ error: (e as Error).message, loading: false });
    }
  },
}));
```

- [ ] **Step 4: Verify test passes**

```bash
cd apps/web && pnpm test -- --run apps/web/src/stores/contentStore.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/contentStore.ts apps/web/src/stores/contentStore.test.ts apps/web/src/api/client.ts
git commit -m "feat: add contentStore with fetchCards and api client"
```

---

## Group 6: Frontend HomePage Components

### Task 6.1: ContentCard Component

**Files:**
- Create: `apps/web/src/pages/home/components/ContentCard.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/src/pages/home/components/ContentCard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentCard } from './ContentCard';
import type { ContentCard as ContentCardType } from '@flowweb/shared';

const mockCard: ContentCardType = {
  id: '1',
  title: '文生图工作流',
  coverUrl: '/placeholder.jpg',
  tags: ['推荐', '热门'],
  desc: '快速生成高质量图片',
};

describe('ContentCard', () => {
  it('should render title', () => {
    render(<ContentCard card={mockCard} />);
    expect(screen.getByText('文生图工作流')).toBeInTheDocument();
  });

  it('should render tags', () => {
    render(<ContentCard card={mockCard} />);
    expect(screen.getByText('推荐')).toBeInTheDocument();
    expect(screen.getByText('热门')).toBeInTheDocument();
  });

  it('should render description', () => {
    render(<ContentCard card={mockCard} />);
    expect(screen.getByText('快速生成高质量图片')).toBeInTheDocument();
  });

  it('should render cover image', () => {
    render(<ContentCard card={mockCard} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/placeholder.jpg');
    expect(img).toHaveAttribute('alt', '文生图工作流');
  });
});
```

- [ ] **Step 2: Implement ContentCard**

```tsx
// apps/web/src/pages/home/components/ContentCard.tsx
import { Card, Tag } from 'antd';
import type { ContentCard as ContentCardType } from '@flowweb/shared';

interface Props {
  card: ContentCardType;
}

export function ContentCard({ card }: Props) {
  return (
    <Card
      hoverable
      className="rounded-xl overflow-hidden bg-[#1a1a1a] border border-[#222] hover:-translate-y-1 hover:shadow-lg transition-all duration-200"
      cover={
        <div className="h-48 bg-[#252525] flex items-center justify-center">
          <img
            src={card.coverUrl}
            alt={card.title}
            className="w-full h-full object-cover"
          />
        </div>
      }
    >
      <h3 className="text-sm font-bold text-[#e2e8f0] mb-2">{card.title}</h3>
      <div className="flex gap-1 mb-2">
        {card.tags.map((tag) => (
          <Tag key={tag} color="green" className="text-xs">
            {tag}
          </Tag>
        ))}
      </div>
      <p className="text-xs text-gray-500">{card.desc}</p>
    </Card>
  );
}
```

- [ ] **Step 3: Verify test passes**

```bash
cd apps/web && pnpm test -- --run apps/web/src/pages/home/components/ContentCard.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/home/components/ContentCard.tsx apps/web/src/pages/home/components/ContentCard.test.tsx
git commit -m "feat: add ContentCard component"
```

---

### Task 6.2: AnnouncementBanner Component

**Files:**
- Create: `apps/web/src/pages/home/components/AnnouncementBanner.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/src/pages/home/components/AnnouncementBanner.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnouncementBanner } from './AnnouncementBanner';

describe('AnnouncementBanner', () => {
  it('should render message', () => {
    render(<AnnouncementBanner message="平台公告：新用户送100积分" />);
    expect(screen.getByText('平台公告：新用户送100积分')).toBeInTheDocument();
  });

  it('should render link when linkUrl provided', () => {
    render(<AnnouncementBanner message="点击查看" linkUrl="/promo" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/promo');
  });

  it('should call onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<AnnouncementBanner message="test" onClose={onClose} />);
    const closeBtn = screen.getByRole('button');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Implement AnnouncementBanner**

```tsx
// apps/web/src/pages/home/components/AnnouncementBanner.tsx
import { CloseOutlined } from '@ant-design/icons';

interface Props {
  message: string;
  linkUrl?: string;
  onClose?: () => void;
}

export function AnnouncementBanner({ message, linkUrl, onClose }: Props) {
  const content = linkUrl ? (
    <a href={linkUrl} className="text-[#e2e8f0] hover:text-[#4ade80] no-underline">
      {message}
    </a>
  ) : (
    <span>{message}</span>
  );

  return (
    <div className="h-10 flex items-center justify-center bg-gradient-to-r from-[#1a1a2e] to-[#16213e] text-sm px-4 relative">
      {content}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute right-4 text-[#94a3b8] hover:text-white bg-transparent border-none cursor-pointer"
          aria-label="关闭通知"
        >
          <CloseOutlined />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify test passes**

```bash
cd apps/web && pnpm test -- --run apps/web/src/pages/home/components/AnnouncementBanner.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/home/components/AnnouncementBanner.tsx apps/web/src/pages/home/components/AnnouncementBanner.test.tsx
git commit -m "feat: add AnnouncementBanner component"
```

---

### Task 6.3: Navbar Component

**Files:**
- Create: `apps/web/src/pages/home/components/Navbar.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/src/pages/home/components/Navbar.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Navbar } from './Navbar';
import { NavActionKey } from '@flowweb/shared';

describe('Navbar', () => {
  it('should render brand logo', () => {
    render(<Navbar />);
    expect(screen.getByText('FlowAI')).toBeInTheDocument();
  });

  it('should render all nav actions', () => {
    render(<Navbar />);
    expect(screen.getByText('模板广场')).toBeInTheDocument();
    expect(screen.getByText('开通会员')).toBeInTheDocument();
    expect(screen.getByText('登录')).toBeInTheDocument();
  });

  it('should call onAction with correct key', () => {
    const onAction = vi.fn();
    render(<Navbar onAction={onAction} />);
    screen.getByText('模板广场').click();
    expect(onAction).toHaveBeenCalledWith(NavActionKey.Templates);
  });
});
```

- [ ] **Step 2: Implement Navbar**

```tsx
// apps/web/src/pages/home/components/Navbar.tsx
import { NavActionKey } from '@flowweb/shared';
import { StarOutlined } from '@ant-design/icons';

interface NavAction {
  key: NavActionKey;
  label: string;
  variant: 'primary' | 'outline' | 'ghost';
  icon?: React.ReactNode;
}

const defaultActions: NavAction[] = [
  { key: NavActionKey.Templates, label: '模板广场', variant: 'outline' },
  { key: NavActionKey.Membership, label: '开通会员', variant: 'outline', icon: <StarOutlined /> },
  { key: NavActionKey.Login, label: '登录', variant: 'ghost' },
];

interface Props {
  actions?: NavAction[];
  onAction?: (key: NavActionKey) => void;
}

export function Navbar({ actions = defaultActions, onAction }: Props) {
  return (
    <nav className="h-16 bg-[#1A1A1A] flex items-center justify-between px-6 shadow-md sticky top-0 z-50 border-b border-[#333]">
      <div className="text-[#4ade80] font-bold text-lg select-none">
        🧠 FlowAI
      </div>
      <div className="flex gap-3">
        {actions.map((action) => {
          const isGreen = action.key === NavActionKey.Templates || action.key === NavActionKey.Membership;
          return (
            <button
              key={action.key}
              onClick={() => onAction?.(action.key)}
              className={`px-4 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors
                ${isGreen
                  ? 'border border-[#4ade80] text-[#4ade80] bg-transparent hover:bg-[#4ade80]/10'
                  : action.key === NavActionKey.Membership
                    ? 'border border-[#f59e0b] text-[#f59e0b] bg-transparent hover:bg-[#f59e0b]/10'
                    : 'border border-[#888] text-[#ccc] bg-transparent hover:bg-[#888]/10'
                }`}
            >
              {action.icon && <span className="mr-1">{action.icon}</span>}
              {action.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 3: Verify test passes**

```bash
cd apps/web && pnpm test -- --run apps/web/src/pages/home/components/Navbar.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/home/components/Navbar.tsx apps/web/src/pages/home/components/Navbar.test.tsx
git commit -m "feat: add Navbar component with nav actions"
```

---

### Task 6.4: HeroSection Component

**Files:**
- Create: `apps/web/src/pages/home/components/HeroSection.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/src/pages/home/components/HeroSection.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeroSection } from './HeroSection';

describe('HeroSection', () => {
  it('should render title and description', () => {
    render(<HeroSection />);
    expect(screen.getByText('AI 多模态内容创作平台')).toBeInTheDocument();
    expect(screen.getByText(/文生文/)).toBeInTheDocument();
  });

  it('should render CTA button', () => {
    render(<HeroSection />);
    expect(screen.getByText('开始创作')).toBeInTheDocument();
  });

  it('should call onStartCreate when CTA clicked', () => {
    const onStartCreate = vi.fn();
    render(<HeroSection onStartCreate={onStartCreate} />);
    fireEvent.click(screen.getByText('开始创作'));
    expect(onStartCreate).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Implement HeroSection**

```tsx
// apps/web/src/pages/home/components/HeroSection.tsx

interface Props {
  onStartCreate?: () => void;
}

export function HeroSection({ onStartCreate }: Props) {
  return (
    <section className="bg-gradient-to-br from-[#0f0f23] to-[#1a1a3e] py-16 px-4 text-center">
      <h1 className="text-4xl font-bold text-[#e2e8f0] mb-3">
        AI 多模态内容创作平台
      </h1>
      <p className="text-sm text-[#94a3b8] mb-8">
        文生文 · 文生图 · 图生图 · 图生视频 · 文生视频
      </p>
      <button
        onClick={onStartCreate}
        className="bg-[#4ade80] text-black font-bold text-lg px-12 py-3 rounded-lg cursor-pointer hover:bg-[#22c55e] transition-colors border-none"
      >
        开始创作
      </button>
    </section>
  );
}
```

- [ ] **Step 3: Verify test passes**

```bash
cd apps/web && pnpm test -- --run apps/web/src/pages/home/components/HeroSection.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/home/components/HeroSection.tsx apps/web/src/pages/home/components/HeroSection.test.tsx
git commit -m "feat: add HeroSection component with CTA"
```

---

### Task 6.5: ContentSection Component

**Files:**
- Create: `apps/web/src/pages/home/components/ContentSection.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/src/pages/home/components/ContentSection.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentSection } from './ContentSection';

// Mock contentStore
vi.mock('@/stores/contentStore', () => ({
  useContentStore: vi.fn(() => ({
    cards: [
      { id: '1', title: 'Card 1', coverUrl: '/a.jpg', tags: ['推荐'], desc: 'desc1' },
      { id: '2', title: 'Card 2', coverUrl: '/b.jpg', tags: [], desc: 'desc2' },
    ],
    loading: false,
    error: null,
    fetchCards: vi.fn(),
  })),
}));

describe('ContentSection', () => {
  it('should render all cards', () => {
    render(<ContentSection />);
    expect(screen.getByText('Card 1')).toBeInTheDocument();
    expect(screen.getByText('Card 2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement ContentSection**

```tsx
// apps/web/src/pages/home/components/ContentSection.tsx
import { useEffect } from 'react';
import { useContentStore } from '@/stores/contentStore';
import { ContentCard } from './ContentCard';

export function ContentSection() {
  const { cards, loading, error, fetchCards } = useContentStore();

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  return (
    <section className="px-6 py-10">
      <h2 className="text-xl font-bold text-[#e2e8f0] mb-6">精选工作流模板</h2>
      {error && (
        <p className="text-red-400 text-sm mb-4">{error}</p>
      )}
      {loading ? (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-64 bg-[#1a1a1a] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {cards.map((card) => (
            <ContentCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Verify test passes**

```bash
cd apps/web && pnpm test -- --run apps/web/src/pages/home/components/ContentSection.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/home/components/ContentSection.tsx apps/web/src/pages/home/components/ContentSection.test.tsx
git commit -m "feat: add ContentSection with grid layout"
```

---

### Task 6.6: AIAssistantFAB Component

**Files:**
- Create: `apps/web/src/pages/home/components/AIAssistantFAB.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/src/pages/home/components/AIAssistantFAB.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AIAssistantFAB } from './AIAssistantFAB';

describe('AIAssistantFAB', () => {
  it('should render a button', () => {
    render(<AIAssistantFAB />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('should call onClick when clicked', () => {
    const onClick = vi.fn();
    render(<AIAssistantFAB onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Implement AIAssistantFAB**

```tsx
// apps/web/src/pages/home/components/AIAssistantFAB.tsx
import { CustomerServiceOutlined } from '@ant-design/icons';

interface Props {
  onClick?: () => void;
}

export function AIAssistantFAB({ onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-8 right-8 w-14 h-14 rounded-full bg-[#4ade80] text-black shadow-lg hover:bg-[#22c55e] hover:scale-110 transition-all duration-200 flex items-center justify-center cursor-pointer border-none z-50"
      aria-label="AI 助手"
    >
      <CustomerServiceOutlined className="text-2xl" />
    </button>
  );
}
```

- [ ] **Step 3: Verify test passes**

```bash
cd apps/web && pnpm test -- --run apps/web/src/pages/home/components/AIAssistantFAB.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/home/components/AIAssistantFAB.tsx apps/web/src/pages/home/components/AIAssistantFAB.test.tsx
git commit -m "feat: add AIAssistantFAB floating button"
```

---

### Task 6.7: HomePage Assembly

**Files:**
- Create: `apps/web/src/pages/home/page.tsx`, `apps/web/src/pages/home/index.ts`

- [ ] **Step 1: Write failing integration test**

```typescript
// apps/web/src/pages/home/page.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { HomePage } from './page';

// Mock all stores
vi.mock('@/stores/contentStore', () => ({
  useContentStore: vi.fn(() => ({
    cards: [],
    loading: false,
    error: null,
    fetchCards: vi.fn(),
  })),
}));

vi.mock('@/stores/announcementStore', () => ({
  useAnnouncementStore: vi.fn(() => ({
    visible: true,
    message: '平台公告',
    dismiss: vi.fn(),
  })),
}));

describe('HomePage', () => {
  const renderHomePage = () =>
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

  it('should render TopBar (announcement + navbar)', () => {
    renderHomePage();
    expect(screen.getByText('平台公告')).toBeInTheDocument();
    expect(screen.getByText('FlowAI')).toBeInTheDocument();
  });

  it('should render HeroSection', () => {
    renderHomePage();
    expect(screen.getByText('AI 多模态内容创作平台')).toBeInTheDocument();
    expect(screen.getByText('开始创作')).toBeInTheDocument();
  });

  it('should render ContentSection', () => {
    renderHomePage();
    expect(screen.getByText('精选工作流模板')).toBeInTheDocument();
  });

  it('should render AI AIAssistantFAB', () => {
    renderHomePage();
    expect(screen.getByLabelText('AI 助手')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement HomePage page.tsx**

```tsx
// apps/web/src/pages/home/page.tsx
import { useAnnouncementStore } from '@/stores/announcementStore';
import { AnnouncementBanner } from './components/AnnouncementBanner';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { ContentSection } from './components/ContentSection';
import { AIAssistantFAB } from './components/AIAssistantFAB';
import { useNavigate } from 'react-router';

export function HomePage() {
  const { visible, message, linkUrl, dismiss } = useAnnouncementStore();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#0f0f0f]">
      {/* TopBar */}
      <div className="sticky top-0 z-40">
        {visible && message && (
          <AnnouncementBanner
            message={message}
            linkUrl={linkUrl}
            onClose={dismiss}
          />
        )}
        <Navbar />
      </div>

      {/* Hero */}
      <HeroSection onStartCreate={() => navigate('/canvas')} />

      {/* Content */}
      <ContentSection />

      {/* Floating */}
      <AIAssistantFAB onClick={() => console.log('AI Assistant clicked')} />
    </div>
  );
}
```

- [ ] **Step 3: Implement barrel index.ts**

```typescript
// apps/web/src/pages/home/index.ts
export { HomePage } from './page';
```

- [ ] **Step 4: Verify tests pass**

```bash
cd apps/web && pnpm test -- --run
```

Expected: all tests pass green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/home/page.tsx apps/web/src/pages/home/index.ts apps/web/src/pages/home/page.test.tsx
git commit -m "feat: assemble HomePage with all components"
```

---

## Group 7: Integration & Seed Data

### Task 7.1: Database Seed Script

**Files:**
- Create: `apps/api/prisma/seed.ts`

- [ ] **Step 1: Write seed script**

```typescript
// apps/api/prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Seed announcement
  await prisma.announcement.upsert({
    where: { id: 'seed-announce-1' },
    update: {},
    create: {
      id: 'seed-announce-1',
      message: '🎉 新用户注册即送100积分，限时优惠中！',
      linkUrl: null,
      active: true,
    },
  });

  // Seed content cards
  const cards = [
    { id: 'seed-card-1', title: '文生图工作流', coverUrl: '/card-covers/text-to-image.jpg', tags: ['推荐', '热门'], desc: '输入Prompt快速生成高质量图片', sortOrder: 1 },
    { id: 'seed-card-2', title: '文生视频工作流', coverUrl: '/card-covers/text-to-video.jpg', tags: ['新上线'], desc: '文本一键转视频', sortOrder: 2 },
    { id: 'seed-card-3', title: '图生图工作流', coverUrl: '/card-covers/image-to-image.jpg', tags: ['推荐'], desc: '风格迁移与图像变换', sortOrder: 3 },
    { id: 'seed-card-4', title: '智能文案助手', coverUrl: '/card-covers/copywriter.jpg', tags: [], desc: 'AI驱动的多平台文案创作', sortOrder: 4 },
    { id: 'seed-card-5', title: 'AI配音工作流', coverUrl: '/card-covers/tts.jpg', tags: ['即将上线'], desc: '文本转语音与多语种配音', sortOrder: 5 },
    { id: 'seed-card-6', title: '视频剪辑工作流', coverUrl: '/card-covers/video-edit.jpg', tags: [], desc: '智能视频裁剪与特效添加', sortOrder: 6 },
    { id: 'seed-card-7', title: '音乐生成工作流', coverUrl: '/card-covers/music.jpg', tags: ['Beta'], desc: 'AI自动作曲与编曲', sortOrder: 7 },
    { id: 'seed-card-8', title: '3D模型生成', coverUrl: '/card-covers/3d.jpg', tags: ['即将上线'], desc: '文字描述生成3D模型', sortOrder: 8 },
  ];

  for (const card of cards) {
    await prisma.contentCard.upsert({
      where: { id: card.id },
      update: {},
      create: card,
    });
  }

  console.log('Seed complete: 1 announcement, 8 content cards');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 2: Add seed script to package.json (apps/api/package.json)**

```json
// Add to "scripts" section:
"prisma": {
  "seed": "tsx prisma/seed.ts"
}
```

Also add `tsx` to devDependencies:
```json
"tsx": "^4.19.0"
```

- [ ] **Step 3: Run seed**

```bash
cd apps/api && npx prisma db seed
```

- [ ] **Step 4: Verify data in DB**

```bash
cd apps/api && npx prisma studio
# Or: psql -U flowweb -d flowweb -c "SELECT * FROM content_cards;"
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/seed.ts apps/api/package.json
git commit -m "feat: add database seed script with 8 cards and 1 announcement"
```

---

### Task 7.2: Full Stack Integration Test

**Files:**
- Create: `apps/api/src/main.spec.ts` (or use curl)

- [ ] **Step 1: Start full stack**

```bash
# Terminal 1: Infrastructure
docker compose up -d

# Terminal 2: Backend
cd apps/api && pnpm dev

# Terminal 3: Frontend
cd apps/web && pnpm dev
```

- [ ] **Step 2: Verify backend endpoints**

```bash
curl http://localhost:3000/api/health
# Expected: {"code":0,"data":{"status":"ok","db":true,"timestamp":"..."},"message":"ok"}

curl http://localhost:3000/api/content/cards
# Expected: {"code":0,"data":[...8 cards...],"message":"ok"}

curl http://localhost:3000/api/announcements/active
# Expected: {"code":0,"data":{...announcement...},"message":"ok"}
```

- [ ] **Step 3: Verify frontend**

Visit http://localhost:5173 and check:
- [ ] Announcement banner visible at top
- [ ] Navbar with logo and nav actions visible
- [ ] Hero section with title, description, CTA visible
- [ ] Content grid with 8 cards visible
- [ ] AI Assistant FAB visible at bottom-right

- [ ] **Step 4: Run all tests**

```bash
pnpm test
```

Expected: All tests pass across all packages.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: complete Phase 1 — homepage with backend API, full stack integration"
```

---

## Verification Checklist

Before considering Phase 1 complete, verify:

- [ ] `docker compose up -d` starts all services cleanly
- [ ] `pnpm install` succeeds in root
- [ ] `pnpm test` passes all tests in all packages
- [ ] `cd apps/api && pnpm dev` starts NestJS on port 3000
- [ ] `cd apps/web && pnpm dev` starts Vite on port 5173
- [ ] `GET /api/health` returns 200 with DB status
- [ ] `GET /api/content/cards` returns 8 seeded cards
- [ ] `GET /api/announcements/active` returns active announcement
- [ ] Homepage renders all components correctly at http://localhost:5173
- [ ] Announcement banner can be dismissed
- [ ] "开始创作" button navigates to `/canvas`
- [ ] No console errors in browser devtools
- [ ] Every new function/component has a test that was seen failing first
