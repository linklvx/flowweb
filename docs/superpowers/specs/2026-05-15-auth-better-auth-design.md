<!-- doc-status: historical | verified_at: n/a -->
# Phase 7: Better Auth User Authentication Design

> **Status:** Approved
> **Date:** 2026-05-15
> **Scope:** @better-auth/react JWT dual-token auth, session-based guards, Socket.io auth middleware, Redis token blacklist, Prisma UserBalance relation

## 1. Overview

Replace hardcoded `default-user` with Better Auth JWT dual-token authentication. Users register/login, sessions persist via refresh token cookie, all protected routes require valid access token. Socket.io connections validated via token in handshake.

## 2. Tech Stack

| Layer | Library |
|-------|---------|
| Backend auth | `better-auth` |
| Password hashing | Built-in (bcrypt) |
| Token type | JWT dual-token (access 15min + refresh 7d) |
| Frontend SDK | `@better-auth/react` |
| Session store | Better Auth built-in (DB) |
| Blacklist | Redis (existing) |
| Rate limiting | `@nestjs/throttler` |

## 3. Database

### 3.1 Better Auth Auto-Generated Tables

`user`, `session`, `account` — managed by Better Auth migrations.

### 3.2 Our Relation

```prisma
model UserBalance {
  id      String @id @default(cuid())
  userId  String @unique
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  credits Int    @default(100)
  version Int    @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## 4. Authentication Flow

```
1. POST /api/auth/sign-in { email, password }
   → Better Auth validates → returns { accessToken, refreshToken }
   → Frontend: accessToken in memory, refreshToken in httpOnly cookie

2. Subsequent API calls:
   Authorization: Bearer <accessToken>
   → AuthGuard → better-auth verify → req.user = { id, email }
   → If expired → client auto-refresh via refresh token cookie

3. Socket.io:
   io('/execution', { auth: { token: accessToken } })
   → middleware verifies token → socket.data.userId
   → On token expiry: reconnect with new token
```

## 5. API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/sign-in` | No | Login |
| POST | `/api/auth/sign-up` | No | Register |
| POST | `/api/auth/sign-out` | Yes | Logout + blacklist + clear |
| POST | `/api/auth/refresh` | Refresh Token | Rotate access token |
| GET | `/api/auth/session` | Yes | Current user session info |

## 6. Guards

```
Global AuthGuard (NestJS)
  Public routes: /api/health, /api/content/*, /api/node-types/*, /api/auth/*, /api/announcements/*
  Protected routes: /api/execution/*, /api/admin/*, /api/projects/*, /api/credits/*
  Gateway: APISIX integration reserved for future
```

## 7. Security

| Measure | Implementation |
|---------|---------------|
| Rate limiting | `@nestjs/throttler` — sign-in/sign-up: 5/min, /refresh: 10/min |
| Password hashing | Argon2id (OWASP recommended, Better Auth native support) |
| Cookie path | `path: "/api/auth/refresh"` — refresh token only sent to refresh endpoint |
| CSRF | Better Auth built-in, `trustedOrigins: ['http://localhost:5173']` |
| Token rotation | Refresh → new refresh token, old → Redis blacklist (TTL = remaining expiry) |
| Blacklist scope | **Only refresh tokens** (access tokens are short-lived, not worth blacklisting) |
| Logout flow | 1. Refresh token → Redis blacklist 2. Clear cookie 3. Clear memory accessToken 4. Disconnect all Socket.io |
| Password strength | Better Auth built-in validation |
| Social login | Reserved — `account` table schema supports OAuth providers |

## 8. Socket.io Auth Middleware

```
Gateway middleware:
  - Extract token from socket.handshake.auth.token
  - Verify via better-auth
  - Set socket.data.userId
  - On 401: reject connection
  - Client: on connect_error → refresh token → reconnect
```

## 9. Frontend Changes

### 9.1 New Files
- `apps/web/src/pages/login/page.tsx`
- `apps/web/src/pages/register/page.tsx`
- `apps/web/src/components/AuthProvider.tsx` (better-auth React provider)

### 9.2 Modified Files
- `apps/web/src/router.tsx` — add /login, /register routes + auth guard
- `apps/web/src/pages/home/components/Navbar.tsx` — show user info or login button
- `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` — add token to Socket.io
- `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx` — add token to Socket.io

### 9.3 User Flow
- Unauthenticated: Navbar shows "登录/注册" → /canvas redirects to /login
- Authenticated: Navbar shows avatar + username + credits + "退出"
- Execution/Admin: requires login

## 10. Environment Config

| Config | Development | Production |
|--------|------------|------------|
| `BETTER_AUTH_SECRET` | dev-secret | env variable |
| `BETTER_AUTH_URL` | `http://localhost:5173` | production URL |
| Cookie Secure | false | true |
| Cookie SameSite | lax | strict |
| Access token TTL | 15 min | 5 min |
| Refresh token TTL | 7 days | 1 day |

## 11. What's NOT in Phase 7

- APISIX gateway integration (reserved)
- Social login (reserved)
- Password reset flow
- Email verification
