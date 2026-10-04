<!-- doc-status: historical | verified_at: n/a -->
# Phase 7: Better Auth User Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded `default-user` with Better Auth JWT dual-token authentication — register, login, session guards, Socket.io auth, Redis blacklist, frontend login pages.

**Architecture:** `better-auth` as NestJS middleware, JWT access+refresh tokens, Argon2id password hashing, global AuthGuard with public route whitelist, @better-auth/react on frontend, Redis for refresh token blacklist.

**Tech Stack:** better-auth, @better-auth/react, @nestjs/throttler, Argon2id, Redis, Prisma, React 18

---

## File Structure Map

```
New files:
  apps/api/src/auth/
    auth.ts                       [Better Auth server config]
    auth.guard.ts                 [NestJS AuthGuard]
    auth.middleware.ts            [Express middleware to mount Better Auth]
    auth.service.ts               [Wrap Better Auth APIs for NestJS]
    auth.controller.ts            [Sign-in/up/out/refresh/session endpoints]
    auth.module.ts                [NestJS module]
    *.spec.ts                     [Tests]

  apps/web/src/pages/login/
    page.tsx, index.ts            [Login page]
  apps/web/src/pages/register/
    page.tsx, index.ts            [Register page]
  apps/web/src/components/
    AuthProvider.tsx              [@better-auth/react provider]

Modified files:
  apps/api/prisma/schema.prisma   [Add User relation to UserBalance]
  apps/api/src/main.ts            [Mount Better Auth middleware + Throttler]
  apps/api/src/app.module.ts      [Import AuthModule + ThrottlerModule]
  apps/api/src/modules/gateway/execution.gateway.ts  [Add Socket.io auth middleware]
  apps/web/src/router.tsx         [Add /login, /register, auth guards]
  apps/web/src/pages/home/components/Navbar.tsx      [User info + login/out]
  apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx  [Token in Socket.io]
  apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx  [Token in Socket.io]
  apps/web/src/pages/canvas/page.tsx  [Auth check]
```

---

### Task 1: Install Dependencies + Prisma Update

**Files:**
- Modify: `apps/api/package.json` — add `better-auth`, `@nestjs/throttler`
- Modify: `apps/web/package.json` — add `@better-auth/react`
- Modify: `apps/api/prisma/schema.prisma` — add User relation to UserBalance

- [ ] **Step 1: Install packages**

```bash
cd apps/api && pnpm add better-auth @nestjs/throttler
cd apps/web && pnpm add @better-auth/react
```

- [ ] **Step 2: Update Prisma schema**

Find the `UserBalance` model in `apps/api/prisma/schema.prisma`. Add the `user` relation:

Before:
```prisma
model UserBalance {
  id        String   @id @default(cuid())
  userId    String   @unique
  ...
}
```

Add AFTER userId:
```prisma
  user      User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
```

Wait — since Better Auth creates the `user` table via its own migration, we need to run Better Auth migrations first. For now, add a comment in the schema and we'll add the relation after Better Auth tables exist.

Actually, the cleaner approach: add a `User` model reference that Prisma can introspect. Since Better Auth creates the user table with specific column names, we just add:

```prisma
model User {
  id            String    @id
  name          String
  email         String    @unique
  emailVerified Boolean
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  accounts      Account[]
  sessions      Session[]
  balance       UserBalance?
}

model Account {
  id                String  @id
  userId            String
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([provider, providerAccountId])
}

model Session {
  id        String   @id
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  token     String   @unique
  expiresAt DateTime
  ipAddress String?
  userAgent String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Then update UserBalance:
```prisma
model UserBalance {
  id        String   @id @default(cuid())
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  credits   Int      @default(100)
  version   Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 3: Run DB push + Commit**

```bash
cd apps/api && npx prisma db push
git add apps/api/package.json apps/web/package.json pnpm-lock.yaml apps/api/prisma/schema.prisma
git commit -m "feat: add better-auth deps and Prisma User/Account/Session models"
```

---

### Task 2: Better Auth Server Configuration

**Files:**
- Create: `apps/api/src/auth/auth.ts`
- Modify: `apps/api/src/main.ts` — mount auth middleware

- [ ] **Step 1: Create Better Auth config**

```typescript
// apps/api/src/auth/auth.ts
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    cookiePrefix: 'flowweb',
    useArgon2id: true,
  },
  trustedOrigins: ['http://localhost:5173'],
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
});
```

- [ ] **Step 2: Mount middleware in main.ts**

Read `apps/api/src/main.ts`. Add AFTER `const app = await NestFactory.create(AppModule)` and BEFORE `app.useGlobalFilters`:

```typescript
import { auth } from './auth/auth';
import { toNodeHandler } from 'better-auth/node';

// Mount Better Auth handler at /api/auth
const authHandler = toNodeHandler(auth);
app.use('/api/auth', (req: any, res: any, next: any) => {
  if (req.url.startsWith('/sign-in') || req.url.startsWith('/sign-up') ||
      req.url.startsWith('/sign-out') || req.url.startsWith('/refresh') ||
      req.url.startsWith('/session')) {
    return authHandler(req, res);
  }
  next();
});
```

- [ ] **Step 3: Verify compilation + Commit**

```bash
cd apps/api && npx tsc --noEmit
git add apps/api/src/auth/auth.ts apps/api/src/main.ts
git commit -m "feat: configure Better Auth server with Prisma adapter and Argon2id"
```

---

### Task 3: Auth Module — NestJS Integration

**Files:**
- Create: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/app.module.ts` — import AuthModule

- [ ] **Step 1: Create AuthService**

```typescript
// auth.service.ts
import { Injectable } from '@nestjs/common';
import { auth } from './auth';

@Injectable()
export class AuthService {
  async signIn(email: string, password: string) {
    return auth.api.signInEmail({ body: { email, password } });
  }

  async signUp(email: string, password: string, name: string) {
    return auth.api.signUpEmail({ body: { email, password, name } });
  }

  async signOut(sessionToken: string) {
    return auth.api.signOut({ headers: new Headers({ cookie: `flowweb.session_token=${sessionToken}` }) });
  }

  async getSession(headers: Headers) {
    return auth.api.getSession({ headers });
  }
}
```

- [ ] **Step 2: Create AuthController** (wrapper for the middleware — thin pass-through)

```typescript
// auth.controller.ts — backed by the middleware in main.ts
// The actual auth routes are handled by Better Auth's toNodeHandler.
// This controller provides a NestJS-friendly wrapper for guard integration.
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';

@Controller('api/auth')
export class AuthController {
  @Get('me')
  @UseGuards(AuthGuard)
  getMe(@Req() req: any) {
    return { user: req.user };
  }
}
```

- [ ] **Step 3: Create AuthModule + add to AppModule**

```typescript
// auth.module.ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
```

Add `AuthModule` to `apps/api/src/app.module.ts` imports.

- [ ] **Step 4: Commit**

```bash
cd apps/api && npx tsc --noEmit
git add apps/api/src/auth/ apps/api/src/app.module.ts
git commit -m "feat: add AuthModule with service and controller"
```

---

### Task 4: AuthGuard — Global Guard + Public Route Whitelist

**Files:**
- Create: `apps/api/src/auth/auth.guard.ts`
- Modify: `apps/api/src/app.module.ts` — register as APP_GUARD

- [ ] **Step 1: Write FAILING test**

```typescript
// auth.guard.spec.ts
import { AuthGuard } from './auth.guard';
import { describe, it, expect, vi } from 'vitest';

describe('AuthGuard', () => {
  const guard = new AuthGuard();

  const PUBLIC_PATHS = [
    '/api/health', '/api/content/cards', '/api/node-types/image/models',
    '/api/auth/sign-in', '/api/auth/sign-up', '/api/announcements/active',
  ];

  PUBLIC_PATHS.forEach(path => {
    it(`should allow public path: ${path}`, () => {
      const ctx = { switchToHttp: () => ({ getRequest: () => ({ path, headers: {} }) }) };
      expect(guard.canActivate(ctx as any)).toBe(true);
    });
  });

  it('should reject protected path without session', async () => {
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ path: '/api/execution/execute', headers: {} }) }) };
    await expect(guard.canActivate(ctx as any)).rejects.toThrow();
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement AuthGuard**

```typescript
// auth.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { auth } from './auth';

const PUBLIC_PREFIXES = [
  '/api/health', '/api/content', '/api/node-types', '/api/auth',
  '/api/announcements', '/api/pricing/calculate',
];

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const path = request.path;

    // Allow public routes
    if (PUBLIC_PREFIXES.some(p => path.startsWith(p))) {
      return true;
    }

    // Verify session
    try {
      const session = await auth.api.getSession({
        headers: new Headers(request.headers as any),
      });
      if (!session) throw new Error('Unauthorized');
      request.user = session.user;
      return true;
    } catch {
      throw new (require('@nestjs/common').UnauthorizedException)('Unauthorized');
    }
  }
}
```

- [ ] **Step 3: Register as global guard**

In `apps/api/src/app.module.ts`, add to providers:
```typescript
{ provide: APP_GUARD, useClass: AuthGuard }
```

- [ ] **Step 4: Run tests + Commit**

```bash
cd apps/api && pnpm test -- --run
git add apps/api/src/auth/auth.guard.ts apps/api/src/auth/auth.guard.spec.ts apps/api/src/app.module.ts
git commit -m "feat: add global AuthGuard with public route whitelist"
```

---

### Task 5: Rate Limiting — ThrottlerModule

**Files:**
- Modify: `apps/api/src/app.module.ts` — add ThrottlerModule

- [ ] **Step 1: Register ThrottlerModule + Apply guards**

```typescript
// In app.module.ts:
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]), // 10 req/min global
    // ... existing imports
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Apply specific rate limits to auth controller**

```typescript
// auth.controller.ts — add decorators:
import { Throttle } from '@nestjs/throttler';

@Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 req/min for all auth endpoints
@Controller('api/auth')
```

- [ ] **Step 3: Commit**

```bash
cd apps/api && pnpm test -- --run
git add apps/api/src/app.module.ts apps/api/src/auth/auth.controller.ts
git commit -m "feat: add rate limiting with ThrottlerModule"
```

---

### Task 6: Socket.io Auth Middleware

**Files:**
- Modify: `apps/api/src/modules/gateway/execution.gateway.ts`

- [ ] **Step 1: Add token verification middleware**

Read the current `execution.gateway.ts`. Add middleware that verifies the token from `socket.handshake.auth.token`:

```typescript
import { auth } from '../../auth/auth';

// In ExecutionGateway class, add:
afterInit() {
  this.server.use(async (socket: any, next: any) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const session = await auth.api.getSession({
        headers: new Headers({ cookie: `flowweb.session_token=${token}` }),
      });
      if (!session) throw new Error('Invalid');
      socket.data.userId = session.user.id;
      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
cd apps/api && npx tsc --noEmit
git add apps/api/src/modules/gateway/execution.gateway.ts
git commit -m "feat: add Socket.io auth middleware with token verification"
```

---

### Task 7: Redis Token Blacklist (Sign-out + Token Rotation)

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`

- [ ] **Step 1: Add Redis blacklist logic**

```typescript
// In auth.service.ts — add Redis client
const Redis = require('ioredis');
const redis = new Redis({ host: 'localhost', port: 6379 });

@Injectable()
export class AuthService {
  async signOutWithBlacklist(sessionToken: string) {
    // Add refresh token to blacklist with TTL
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: `flowweb.session_token=${sessionToken}` }),
    });
    if (session?.session?.expiresAt) {
      const ttl = Math.max(0, Math.floor((new Date(session.session.expiresAt).getTime() - Date.now()) / 1000));
      await redis.set(`blacklist:${sessionToken}`, '1', 'EX', ttl);
    }
    return auth.api.signOut({
      headers: new Headers({ cookie: `flowweb.session_token=${sessionToken}` }),
    });
  }

  async isBlacklisted(token: string): Promise<boolean> {
    return (await redis.get(`blacklist:${token}`)) !== null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd apps/api && npx tsc --noEmit
git add apps/api/src/auth/auth.service.ts
git commit -m "feat: add Redis refresh token blacklist for sign-out"
```

---

### Task 8: Frontend — Login + Register Pages

**Files:**
- Create: `apps/web/src/pages/login/page.tsx`, `index.ts`
- Create: `apps/web/src/pages/register/page.tsx`, `index.ts`

- [ ] **Step 1: Create Login page**

```tsx
// login/page.tsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try {
      const res = await fetch('/api/auth/sign-in', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) { setError('邮箱或密码错误'); return; }
      navigate('/canvas');
    } catch { setError('网络错误，请重试'); }
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center">
      <form onSubmit={handleSubmit} className="bg-[#1a1a1a] border border-[#333] rounded-xl p-8 w-96">
        <h1 className="text-xl font-bold text-[#e2e8f0] mb-6">登录 FlowAI</h1>
        {error && <p className="text-red-400 text-xs mb-4">{error}</p>}
        <input type="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)}
          className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-3 text-sm text-[#ccc] mb-3" />
        <input type="password" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)}
          className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-3 text-sm text-[#ccc] mb-4" />
        <button type="submit" className="w-full bg-[#4ade80] text-black font-bold py-3 rounded-lg cursor-pointer text-sm">
          登录
        </button>
        <p className="text-xs text-[#888] mt-4 text-center">
          还没有账号？<Link to="/register" className="text-[#4ade80]">注册</Link>
        </p>
      </form>
    </div>
  );
}
```

```typescript
// login/index.ts
export { LoginPage } from './page';
```

- [ ] **Step 2: Create Register page** (similar pattern)

Same structure as Login but with name field and POST to `/api/auth/sign-up`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/login/ apps/web/src/pages/register/
git commit -m "feat: add login and register pages"
```

---

### Task 9: Frontend — AuthProvider + Navbar + Route Guards

**Files:**
- Create: `apps/web/src/components/AuthProvider.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/pages/home/components/Navbar.tsx`

- [ ] **Step 1: Create AuthProvider**

```tsx
// components/AuthProvider.tsx
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface User { id: string; email: string; name: string; }

const AuthContext = createContext<{
  user: User | null; loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
}>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json())
      .then(d => { if (d.user) setUser(d.user); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    // Login is handled by sign-in page directly
  };

  const register = async (email: string, password: string, name: string) => {
    // Register is handled by sign-up page directly
  };

  const logout = async () => {
    await fetch('/api/auth/sign-out', { method: 'POST' });
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, register, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
```

- [ ] **Step 2: Update router.tsx**

```typescript
import { LoginPage } from '@/pages/login';
import { RegisterPage } from '@/pages/register';

// Add routes:
{ path: '/login', element: <LoginPage /> },
{ path: '/register', element: <RegisterPage /> },
```

- [ ] **Step 3: Update Navbar — show user info**

Read `Navbar.tsx`. Replace the hardcoded "登录" button with:
```tsx
// Import useAuth
import { useAuth } from '@/components/AuthProvider';

// In component:
const { user, logout } = useAuth();

// Replace nav actions:
{user ? (
  <>
    <span className="text-xs text-[#f59e0b]">⚡ {credits} 积分</span>
    <span className="text-xs text-[#ccc]">{user.name || user.email}</span>
    <button onClick={logout} className="px-3 py-1.5 rounded-md text-xs border border-[#888] text-[#ccc]">退出</button>
  </>
) : (
  <Link to="/login" className="px-3 py-1.5 rounded-md text-xs border border-[#888] text-[#ccc] no-underline">登录</Link>
)}
```

- [ ] **Step 4: Commit**

```bash
cd apps/web && pnpm test -- --run
git add apps/web/src/components/AuthProvider.tsx apps/web/src/router.tsx apps/web/src/pages/home/components/Navbar.tsx
git commit -m "feat: add AuthProvider, Navbar user info, and route guards"
```

---

### Task 10: Full Stack Integration Verification

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc -b --noEmit
```

- [ ] **Step 3: E2E test auth flow**

```bash
# Register
curl -X POST http://localhost:3000/api/auth/sign-up \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@flowai.dev","password":"Test1234!","name":"Test"}'

# Login
curl -X POST http://localhost:3000/api/auth/sign-in \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@flowai.dev","password":"Test1234!"}' -c /tmp/cookies

# Session
curl http://localhost:3000/api/auth/session -b /tmp/cookies
```

- [ ] **Step 4: Verify file structure + Report**

---

## Verification Checklist

- [ ] `pnpm test` — all tests pass
- [ ] TypeScript compilation clean
- [ ] `POST /api/auth/sign-up` creates user
- [ ] `POST /api/auth/sign-in` returns session token
- [ ] `GET /api/auth/session` returns user info
- [ ] Protected routes (/api/execution) reject unauthenticated requests
- [ ] Public routes (/api/health, /api/content) serve without auth
- [ ] Socket.io rejects connections without token
- [ ] Login page renders at `/login`
- [ ] Register page renders at `/register`
- [ ] Navbar shows user info when logged in
- [ ] Rate limiting blocks after 5 attempts
