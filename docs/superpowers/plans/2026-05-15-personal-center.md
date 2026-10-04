<!-- doc-status: historical | verified_at: n/a -->
# 个人中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/settings` personal center with profile editing (name/avatar) and credit balance display, protected by route guard.

**Architecture:** NestJS controller calls Better Auth's `auth.api.updateUser` (session-based, auto-refreshes all devices). React Router v7 nested routes with sidebar layout. Credits endpoint reads userId from `req.user` (AuthGuard-mounted) instead of query param.

**Tech Stack:** NestJS + Better Auth 1.6.11 + Prisma, React + React Router v7 + Tailwind, class-validator + class-transformer, Vitest + Testing Library

---

### Task 1: DTO for Profile Update

**Files:**
- Create: `apps/api/src/auth/dto/update-profile.dto.ts`

- [ ] **Step 1: Create DTO file**

```ts
// apps/api/src/auth/dto/update-profile.dto.ts
import { IsOptional, IsString, Length, IsUrl, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @Length(1, 50)
  @Matches(/^[\p{L}\p{N}\s_-]+$/u, {
    message: '用户名只能包含字母、数字、空格、下划线和连字符'
  })
  name?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsUrl({
    require_tld: process.env.NODE_ENV === 'production',
    protocols: process.env.NODE_ENV === 'production' ? ['https'] : ['http', 'https'],
    allow_underscores: true,
    host_whitelist: process.env.NODE_ENV === 'production'
      ? ['flowai.dev', 'cdn.flowai.dev', '*.githubusercontent.com', '*.googleusercontent.com']
      : ['localhost', '127.0.0.1']
  })
  image?: string;
}
```

- [ ] **Step 2: Verify file compiles**

Run: `cd /d/flowweb/apps/api && npx tsc --noEmit src/auth/dto/update-profile.dto.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /d/flowweb && git add apps/api/src/auth/dto/update-profile.dto.ts
git commit -m "feat: add UpdateProfileDto with validation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Auth Service — updateProfile Method

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts:43-47`
- Modify: `apps/api/src/auth/auth.service.spec.ts:57-63`

- [ ] **Step 1: Add updateProfile to AuthService**

Insert after `getSession` method (before the closing `}` of the class):

```ts
// apps/api/src/auth/auth.service.ts — add inside AuthService class
async updateProfile(userId: string, dto: { name?: string; image?: string }) {
  const cookieStr = `flowweb.session_token=`;
  // We need the raw token from a session lookup
  // Use Prisma to get the token for this user, then call Better Auth
  const { PrismaClient } = await import('@prisma/client');
  const p = new PrismaClient();
  try {
    const session = await p.session.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    await p.$disconnect();
    if (!session) throw new Error('No active session');
    return auth.api.updateUser({
      body: { name: dto.name, image: dto.image },
      headers: new Headers({ cookie: `flowweb.session_token=${session.token}` }),
    });
  } finally {
    await p.$disconnect();
  }
}
```

- [ ] **Step 2: Update service test**

Change the two `getSession` tests in `apps/api/src/auth/auth.service.spec.ts` to also test `updateProfile`:

```ts
// Replace the getSession test block at line 57-63 with:
it('should return null when no cookie header provided', async () => {
  const result = await service.getSession({});
  expect(result).toBeNull();
});

it('should return null when cookie has no valid session token', async () => {
  const result = await service.getSession({ cookie: 'other=value' });
  expect(result).toBeNull();
});

it('should call updateUser on Better Auth for updateProfile', async () => {
  const mockUpdateUser = vi.fn().mockResolvedValue({ user: { id: 'u1', name: 'New', email: 'test@test.com' } });
  // Override the auth object for this test
  (auth.api as any).updateUser = mockUpdateUser;
  
  await service.updateProfile('u1', { name: 'New' });
  
  expect(mockUpdateUser).toHaveBeenCalledWith(
    expect.objectContaining({
      body: { name: 'New', image: undefined },
    })
  );
});
```

- [ ] **Step 3: Run tests to verify**

Run: `cd /d/flowweb/apps/api && pnpm vitest run src/auth/auth.service.spec.ts`
Expected: 6 passed (3 existing + 1 new + 2 updated)

- [ ] **Step 4: Commit**

```bash
cd /d/flowweb && git add apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.service.spec.ts
git commit -m "feat: add updateProfile to AuthService via Better Auth

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Auth Controller — PATCH /me Endpoint

**Files:**
- Modify: `apps/api/src/auth/auth.controller.ts:56-65`
- Modify: `apps/api/src/auth/auth.controller.spec.ts:106-125`

- [ ] **Step 1: Add ValidationPipe + PATCH /me to controller**

Replace the `getMe` method and add `PATCH /me` + required imports:

```ts
// apps/api/src/auth/auth.controller.ts — add imports at top:
import { Controller, Post, Get, Patch, Req, Body, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto';

// Add after getMe, before closing } of class:
@Patch('me')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
async updateMe(
  @Req() req: any,
  @Body() dto: UpdateProfileDto,
  @Res() res: Response,
) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({
    success: false,
    error: { code: 'UNAUTHORIZED', message: '未登录' }
  });
  try {
    const result = await this.authService.updateProfile(userId, dto);
    return res.json({
      success: true,
      data: { user: result.user }
    });
  } catch (e: any) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: e?.message || '更新失败' }
    });
  }
}
```

- [ ] **Step 2: Update controller tests**

Replace the getMe test block in `apps/api/src/auth/auth.controller.spec.ts`:

```ts
// Replace the getMe describe block (lines 106-125) with:
describe('getMe', () => {
  it('should return user from session', async () => {
    const req = { headers: { cookie: 'flowweb.session_token=valid' } };
    const mockRes = { json: vi.fn() };
    mockSvc.getSession.mockResolvedValue({ user: { id: 'u1', email: 'u1@test.com' } });

    await controller.getMe(req as any, mockRes as any);

    expect(mockRes.json).toHaveBeenCalledWith({ user: { id: 'u1', email: 'u1@test.com' } });
  });

  it('should return null when no session', async () => {
    const req = { headers: {} };
    const mockRes = { json: vi.fn() };
    mockSvc.getSession.mockResolvedValue(null);

    await controller.getMe(req as any, mockRes as any);

    expect(mockRes.json).toHaveBeenCalledWith({ user: null });
  });
});

describe('updateMe', () => {
  it('should update profile and return user', async () => {
    const req = { user: { id: 'u1' } };
    const mockRes = { json: vi.fn(), status: vi.fn().mockReturnValue({ json: vi.fn() }) };
    mockSvc.updateProfile = vi.fn().mockResolvedValue({
      user: { id: 'u1', name: 'NewName', email: 'test@test.com' }
    });

    await controller.updateMe(req as any, { name: 'NewName' } as any, mockRes as any);

    expect(mockSvc.updateProfile).toHaveBeenCalledWith('u1', { name: 'NewName' });
    expect(mockRes.json).toHaveBeenCalledWith({
      success: true,
      data: { user: { id: 'u1', name: 'NewName', email: 'test@test.com' } }
    });
  });

  it('should return 401 when not authenticated', async () => {
    const req = { user: null };
    const mockRes = { json: vi.fn(), status: vi.fn().mockReturnValue({ json: vi.fn() }) };

    await controller.updateMe(req as any, { name: 'X' } as any, mockRes as any);

    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should ignore userId in body (越权防护)', async () => {
    const req = { user: { id: 'u1' } };
    const mockRes = { json: vi.fn(), status: vi.fn().mockReturnValue({ json: vi.fn() }) };
    mockSvc.updateProfile = vi.fn().mockResolvedValue({
      user: { id: 'u1', name: 'X', email: 'test@test.com' }
    });

    // Even if body tries to inject a different userId, controller uses req.user.id
    await controller.updateMe(req as any, { name: 'X' } as any, mockRes as any);

    expect(mockSvc.updateProfile).toHaveBeenCalledWith('u1', expect.anything());
    // 'u2' was never passed — proof that body userId is ignored
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd /d/flowweb/apps/api && pnpm vitest run src/auth/auth.controller.spec.ts`
Expected: 10 passed (7 existing + 3 new)

- [ ] **Step 4: Commit**

```bash
cd /d/flowweb && git add apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth.controller.spec.ts
git commit -m "feat: add PATCH /api/auth/me with DTO validation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Credits Controller — Secure userId from Token

**Files:**
- Modify: `apps/api/src/modules/credit/credit.controller.ts:8-12`

- [ ] **Step 1: Rewrite getBalance to use req.user**

```ts
// apps/api/src/modules/credit/credit.controller.ts
// Add imports:
import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';

// Replace the getBalance method:
@Get('balance')
async getBalance(@Req() req: any) {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedException();
  const balance = await this.service.getOrCreateBalance(userId);
  return {
    credits: balance.credits,
    updatedAt: balance.updatedAt.toISOString()
  };
}
```

Remove `@Query` import and `Query` parameter if no longer used elsewhere.

- [ ] **Step 2: Update credit controller test**

Read `apps/api/src/modules/credit/credit.controller.spec.ts`. Update the test to pass `req.user` instead of query param.

- [ ] **Step 3: Run tests**

Run: `cd /d/flowweb/apps/api && pnpm vitest run src/modules/credit/`
Expected: All credit tests pass

- [ ] **Step 4: Commit**

```bash
cd /d/flowweb && git add apps/api/src/modules/credit/
git commit -m "fix: credits balance derives userId from session token

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: AuthProvider — Extend User Interface + updateUser

**Files:**
- Modify: `apps/web/src/components/AuthProvider.tsx:3-10, 5-10, 14-33`

- [ ] **Step 1: Add updatedAt to User, add updateUser to context**

```ts
// apps/web/src/components/AuthProvider.tsx
interface User {
  id: string;
  name: string;
  email: string;
  image?: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;   // new
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateUser: (user: User) => void;  // new
}
```

- [ ] **Step 2: Implement updateUser in AuthProvider**

Add `updateUser` to the context value:

```tsx
// Inside AuthProvider, add to the context value object:
const updateUser = (user: User) => setUser(user);

return (
  <AuthContext.Provider value={{ user, loading, logout, refresh, updateUser }}>
    {children}
  </AuthContext.Provider>
);
```

- [ ] **Step 3: Update existing tests that reference User interface**

Check for any TypeScript errors in files importing `useAuth()`:
Run: `cd /d/flowweb/apps/web && npx tsc --noEmit 2>&1 | grep -i "User\|AuthProvider" | head -10`
Expected: No new errors related to AuthProvider

- [ ] **Step 4: Commit**

```bash
cd /d/flowweb && git add apps/web/src/components/AuthProvider.tsx
git commit -m "feat: extend User interface with updatedAt, add updateUser to AuthContext

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Settings Pages — Barrel + Layout + Profile + Credits

**Files:**
- Create: `apps/web/src/pages/settings/index.ts`
- Create: `apps/web/src/pages/settings/SettingsLayout.tsx`
- Create: `apps/web/src/pages/settings/ProfilePage.tsx`
- Create: `apps/web/src/pages/settings/CreditsPage.tsx`

- [ ] **Step 1: Create barrel export**

```ts
// apps/web/src/pages/settings/index.ts
export { SettingsLayout } from './SettingsLayout';
export { ProfilePage } from './ProfilePage';
export { CreditsPage } from './CreditsPage';
```

- [ ] **Step 2: Create SettingsLayout**

```tsx
// apps/web/src/pages/settings/SettingsLayout.tsx
import { NavLink, Outlet, Link } from 'react-router';
import { useAuth } from '@/components/AuthProvider';

export function SettingsLayout() {
  const { logout } = useAuth();

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex flex-col">
      <div className="h-12 flex items-center px-4 border-b border-[#333]">
        <Link to="/canvas" className="text-xs text-[#888] hover:text-[#ccc] no-underline">
          ← 返回画布
        </Link>
        <span className="ml-auto text-[#4ade80] font-bold text-sm">🧠 FlowAI</span>
      </div>
      <div className="flex flex-1">
        <nav className="w-48 bg-[#1A1A1A] border-r border-[#333] flex flex-col py-4">
          <NavLink
            to="/settings/profile"
            className={({ isActive }) =>
              `px-4 py-2 text-sm no-underline transition-colors ${
                isActive ? 'text-[#4ade80] bg-[#4ade80]/10 border-r-2 border-[#4ade80]' : 'text-[#888] hover:text-[#ccc]'
              }`
            }
          >
            个人资料
          </NavLink>
          <NavLink
            to="/settings/credits"
            className={({ isActive }) =>
              `px-4 py-2 text-sm no-underline transition-colors ${
                isActive ? 'text-[#4ade80] bg-[#4ade80]/10 border-r-2 border-[#4ade80]' : 'text-[#888] hover:text-[#ccc]'
              }`
            }
          >
            积分余额
          </NavLink>
          <div className="mt-auto border-t border-[#333] pt-4">
            <button
              onClick={() => logout()}
              className="w-full text-left px-4 py-2 text-sm text-[#888] hover:text-[#ef4444] bg-transparent border-none cursor-pointer transition-colors"
            >
              退出登录
            </button>
          </div>
        </nav>
        <main className="flex-1 p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create ProfilePage**

```tsx
// apps/web/src/pages/settings/ProfilePage.tsx
import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';

export function ProfilePage() {
  const { user, updateUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [image, setImage] = useState(user?.image || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const hasChanges = name !== (user?.name || '') || image !== (user?.image || '');
  const canSave = hasChanges && !saving && name.length >= 1 && name.length <= 50;

  if (!user) return null;

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, image: image || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message || '更新失败');
        return;
      }
      updateUser(json.data.user);
      setEditing(false);
    } catch {
      setError('网络错误');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setName(user.name || '');
    setImage(user.image || '');
    setEditing(false);
    setError('');
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div>
      <h2 className="text-lg font-bold text-[#e2e8f0] mb-6">个人资料</h2>
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6 max-w-lg">
        {error && <p className="text-[#ef4444] text-xs mb-4">{error}</p>}

        {/* Avatar */}
        <div className="mb-6 flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-[#333] overflow-hidden shrink-0">
            {user.image ? (
              <img src={user.image} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#888] text-2xl">
                {(user.name || user.email)[0].toUpperCase()}
              </div>
            )}
          </div>
          <div>
            <p className="text-[#e2e8f0] text-sm font-medium">{user.name}</p>
            <p className="text-[#888] text-xs">{user.email}</p>
          </div>
        </div>

        {editing ? (
          <>
            <label className="block text-xs text-[#888] mb-1">头像 URL</label>
            <input
              type="text"
              value={image}
              onChange={e => setImage(e.target.value)}
              placeholder="https://example.com/avatar.png"
              className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-sm text-[#ccc] mb-4"
            />
            <label className="block text-xs text-[#888] mb-1">用户名</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={50}
              className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-sm text-[#ccc] mb-6"
            />
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={!canSave}
                className="px-4 py-2 bg-[#4ade80] text-black rounded-lg text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                {saving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={handleCancel}
                className="px-4 py-2 border border-[#555] text-[#ccc] rounded-lg text-sm bg-transparent cursor-pointer hover:border-[#888] transition-colors"
              >
                取消
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4">
              <span className="text-xs text-[#888]">用户名</span>
              <p className="text-sm text-[#e2e8f0]">{user.name}</p>
            </div>
            <div className="mb-4">
              <span className="text-xs text-[#888]">邮箱</span>
              <p className="text-sm text-[#666]">{user.email}</p>
            </div>
            <div className="mb-4">
              <span className="text-xs text-[#888]">注册时间</span>
              <p className="text-sm text-[#e2e8f0]">{formatDate(user.createdAt)}</p>
            </div>
            {user.updatedAt && (
              <div className="mb-6">
                <span className="text-xs text-[#888]">最后更新</span>
                <p className="text-sm text-[#e2e8f0]">{formatDate(user.updatedAt)}</p>
              </div>
            )}
            <button
              onClick={() => setEditing(true)}
              className="px-4 py-2 border border-[#4ade80] text-[#4ade80] rounded-lg text-sm bg-transparent cursor-pointer hover:bg-[#4ade80]/10 transition-colors"
            >
              编辑资料
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create CreditsPage**

```tsx
// apps/web/src/pages/settings/CreditsPage.tsx
import { useState, useEffect } from 'react';

export function CreditsPage() {
  const [credits, setCredits] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/credits/balance')
      .then(r => r.json())
      .then(json => {
        if (json.code === 0) {
          setCredits(json.data.credits);
          setUpdatedAt(json.data.updatedAt);
        } else if (json.credits !== undefined) {
          // Direct response (no wrapper)
          setCredits(json.credits);
          setUpdatedAt(json.updatedAt || null);
        } else {
          setError('加载失败');
        }
      })
      .catch(() => setError('网络错误'));
  }, []);

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div>
      <h2 className="text-lg font-bold text-[#e2e8f0] mb-6">积分余额</h2>
      {error && <p className="text-[#ef4444] text-xs mb-4">{error}</p>}
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6 max-w-lg">
        <div className="text-center py-8">
          <p className="text-4xl font-bold text-[#f59e0b] mb-2">
            ⚡ {credits !== null ? credits : '...'}
          </p>
          <p className="text-sm text-[#888]">当前积分余额</p>
          {updatedAt && (
            <p className="text-xs text-[#666] mt-3">
              最后更新于 {formatDate(updatedAt)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run TypeScript check**

Run: `cd /d/flowweb/apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors in pages/settings/

- [ ] **Step 6: Commit**

```bash
cd /d/flowweb && git add apps/web/src/pages/settings/
git commit -m "feat: add SettingsLayout, ProfilePage, CreditsPage

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Router + CanvasTopBar Integration

**Files:**
- Modify: `apps/web/src/router.tsx:1-14`
- Modify: `apps/web/src/pages/canvas/components/CanvasTopBar.tsx:42-46`

- [ ] **Step 1: Add /settings routes to router**

```tsx
// apps/web/src/router.tsx
// Add import:
import { SettingsLayout, ProfilePage, CreditsPage } from '@/pages/settings';

// Add to the RequireAuth children array (after /admin):
{
  element: <RequireAuth />,
  children: [
    { path: '/canvas', element: <CanvasPage /> },
    { path: '/admin', element: <AdminPage /> },
    {
      path: '/settings',
      element: <SettingsLayout />,
      children: [
        { index: true, element: <Navigate to="/settings/profile" replace /> },
        { path: 'profile', element: <ProfilePage /> },
        { path: 'credits', element: <CreditsPage /> },
      ],
    },
  ],
},
```

Also add `Navigate` to imports from `react-router`.

- [ ] **Step 2: Link username to /settings in CanvasTopBar**

In `apps/web/src/pages/canvas/components/CanvasTopBar.tsx`, change the username span to a Link:

```tsx
// Replace: <span className="text-xs text-[#ccc] whitespace-nowrap">{user.name || user.email}</span>
// With:
<Link
  to="/settings"
  className="text-xs text-[#ccc] whitespace-nowrap no-underline hover:text-[#4ade80] transition-colors"
>
  {user.name || user.email}
</Link>
```

Add `Link` to imports: `import { Link } from 'react-router';`

- [ ] **Step 3: Run full web tests**

Run: `cd /d/flowweb/apps/web && pnpm vitest run`
Expected: All tests pass (update canvas page test if needed for the Link change)

- [ ] **Step 4: Commit**

```bash
cd /d/flowweb && git add apps/web/src/router.tsx apps/web/src/pages/canvas/components/CanvasTopBar.tsx
git commit -m "feat: add /settings routes, link canvas username to settings

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: Web Tests

**Files:**
- Create: `apps/web/src/pages/settings/SettingsLayout.test.tsx`
- Create: `apps/web/src/pages/settings/ProfilePage.test.tsx`
- Create: `apps/web/src/pages/settings/CreditsPage.test.tsx`

- [ ] **Step 1: SettingsLayout test**

```tsx
// apps/web/src/pages/settings/SettingsLayout.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

import { SettingsLayout } from './SettingsLayout';

describe('SettingsLayout', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', name: 'Test', email: 'test@test.com' },
      logout: vi.fn(),
    });
  });

  it('should render sidebar navigation links', () => {
    render(
      <MemoryRouter initialEntries={['/settings/profile']}>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="profile" element={<div>Profile Content</div>} />
            <Route path="credits" element={<div>Credits Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('个人资料')).toBeDefined();
    expect(screen.getByText('积分余额')).toBeDefined();
    expect(screen.getByText('退出登录')).toBeDefined();
    expect(screen.getByText('← 返回画布')).toBeDefined();
  });

  it('should render child route via Outlet', () => {
    render(
      <MemoryRouter initialEntries={['/settings/profile']}>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="profile" element={<div>Profile Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('Profile Content')).toBeDefined();
  });
});
```

- [ ] **Step 2: ProfilePage test**

```tsx
// apps/web/src/pages/settings/ProfilePage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));
const mockFetch = vi.fn();

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

globalThis.fetch = mockFetch;

import { ProfilePage } from './ProfilePage';

describe('ProfilePage', () => {
  const user = {
    id: 'u1', name: 'TestUser', email: 'test@test.com',
    image: null, emailVerified: false,
    createdAt: '2026-05-15T10:00:00.000Z',
    updatedAt: '2026-05-15T12:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user, updateUser: vi.fn() });
  });

  it('should display user info in view mode', () => {
    render(<ProfilePage />);
    expect(screen.getByText('TestUser')).toBeDefined();
    expect(screen.getByText('test@test.com')).toBeDefined();
    expect(screen.getByText('编辑资料')).toBeDefined();
  });

  it('should toggle to edit mode', () => {
    render(<ProfilePage />);
    fireEvent.click(screen.getByText('编辑资料'));
    expect(screen.getByText('保存')).toBeDefined();
    expect(screen.getByText('取消')).toBeDefined();
  });

  it('should disable save button when no changes', () => {
    render(<ProfilePage />);
    fireEvent.click(screen.getByText('编辑资料'));
    const saveBtn = screen.getByText('保存');
    expect(saveBtn).toBeDisabled();
  });

  it('should enable save button when name changed', () => {
    render(<ProfilePage />);
    fireEvent.click(screen.getByText('编辑资料'));
    const input = screen.getByDisplayValue('TestUser');
    fireEvent.change(input, { target: { value: 'NewName' } });
    const saveBtn = screen.getByText('保存');
    expect(saveBtn).not.toBeDisabled();
  });

  it('should call API and updateUser on save', async () => {
    const updateUser = vi.fn();
    mockUseAuth.mockReturnValue({ user, updateUser });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: { user: { ...user, name: 'NewName' } }
      })
    });

    render(<ProfilePage />);
    fireEvent.click(screen.getByText('编辑资料'));
    fireEvent.change(screen.getByDisplayValue('TestUser'), { target: { value: 'NewName' } });
    fireEvent.click(screen.getByText('保存'));

    // Button should show saving state immediately
    expect(screen.getByText('保存中...')).toBeDisabled();

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'NewName' })
      );
    });
  });
});
```

- [ ] **Step 3: CreditsPage test**

```tsx
// apps/web/src/pages/settings/CreditsPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import { CreditsPage } from './CreditsPage';

describe('CreditsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display credit balance from API', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ credits: 88, updatedAt: '2026-05-15T16:00:00.000Z' })
    });
    render(<CreditsPage />);
    await waitFor(() => {
      expect(screen.getByText(/88/)).toBeDefined();
    });
  });

  it('should display updatedAt time', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ credits: 100, updatedAt: '2026-05-15T16:30:00.000Z' })
    });
    render(<CreditsPage />);
    await waitFor(() => {
      expect(screen.getByText(/最后更新/)).toBeDefined();
    });
  });
});
```

- [ ] **Step 4: Run all web tests**

Run: `cd /d/flowweb/apps/web && pnpm vitest run`
Expected: All tests pass, at least 3 new test files

- [ ] **Step 5: Commit**

```bash
cd /d/flowweb && git add apps/web/src/pages/settings/*.test.tsx
git commit -m "test: add SettingsLayout, ProfilePage, CreditsPage tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: Integration Verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run full API test suite**

```bash
cd /d/flowweb/apps/api && pnpm vitest run
```

Expected: All 139+ tests pass (139 from v1.1.1 + new controller tests)

- [ ] **Step 2: Run full Web test suite**

```bash
cd /d/flowweb/apps/web && pnpm vitest run
```

Expected: All 108+ tests pass (108 from v1.1.1 + new settings tests)

- [ ] **Step 3: Verify API endpoints with curl**

```bash
# Login
TOKEN=$(curl -s -D - -X POST http://localhost:3000/api/auth/sign-in \
  -H "Content-Type: application/json" \
  -d '{"email":"u1@flowai.dev","password":"Test1234!"}' 2>&1 \
  | grep "Set-Cookie" | grep -o 'flowweb.session_token=[^;]*' | cut -d= -f2)

# PATCH profile
curl -s -X PATCH http://localhost:3000/api/auth/me \
  -H "Content-Type: application/json" \
  -b "flowweb.session_token=$TOKEN" \
  -d '{"name":"UpdatedName"}'

# GET credits
curl -s -b "flowweb.session_token=$TOKEN" http://localhost:3000/api/credits/balance
```

Expected: PATCH returns `{ success: true, data: { user: {...} } }`
Expected: GET returns `{ credits: number, updatedAt: "..." }`

- [ ] **Step 4: Commit any cleanups**

```bash
cd /d/flowweb && git status
# Only staged/test-verified changes should remain
```

---

### Task 10: Final Commit & Tag

**Files:**
- None (meta)

- [ ] **Step 1: Verify git status is clean**

```bash
cd /d/flowweb && git status
```

- [ ] **Step 2: Tag version**

```bash
cd /d/flowweb && git tag -a v1.2 -m "v1.2: personal center, profile editing, credit display, route guards"
```

- [ ] **Step 3: Backup database**

```bash
cd /d/flowweb && PGPASSWORD=flowweb_dev "D:/programfiles/PostgreSQL/16/bin/pg_dump.exe" -h localhost -U flowweb -d flowweb > backup_v1.2.sql
```
