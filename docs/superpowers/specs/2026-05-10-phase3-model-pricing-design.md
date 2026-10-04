<!-- doc-status: historical | verified_at: n/a -->
# Phase 3: Model Configuration & Pricing Engine Design

> **Status:** Approved
> **Date:** 2026-05-10
> **Scope:** Admin model management, multi-dimensional pricing, frontend model selection integration

## 1. Overview

Build the backend model configuration system and multi-dimensional pricing engine. Administrators manage which AI models are available per node type, configure pricing rules by resolution/duration, and frontend nodes dynamically load available models with real-time credit display.

## 2. What's In / Out

| Scope | Items |
|-------|-------|
| **In** | NodeType management, AIModel CRUD, ModelResolution/Duration config, PricingRule engine, admin API, frontend model selector integration, real-time credit calculation |
| **Out** | User credit balance system (Phase 3a), API call validation gateway (Phase 4), credit deduction execution (Phase 4) |

## 3. Database Schema (Phase 3 Additions)

### 3.1 New Models

```prisma
model NodeType {
  id          String     @id @default(cuid())
  name        String                           // "文本生成" / "图片生成" / "视频生成"
  key         String     @unique              // "text" / "image" / "video" — maps to canvasNode.type
  description String?
  active      Boolean    @default(true)
  models      AIModel[]
  pricingRules PricingRule[]
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
}

model AIModel {
  id          String     @id @default(cuid())
  nodeTypeId  String
  nodeType    NodeType   @relation(fields: [nodeTypeId], references: [id], onDelete: Cascade)
  name        String                           // "Stable Diffusion XL" / "DALL-E 3"
  provider    String                           // Service provider name
  apiUrl      String                           // API endpoint URL
  apiKey      String?                          // API key (encrypted in production)
  sortOrder   Int        @default(0)          // Frontend display order
  recommended Boolean    @default(false)       // Featured/recommended flag
  active      Boolean    @default(true)        // Online/offline toggle
  resolutions ModelResolution[]
  durations   ModelDuration[]                  // Video only
  pricingRules PricingRule[]
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  @@index([nodeTypeId, active])
  @@index([nodeTypeId, sortOrder])
}

model ModelResolution {
  id        String      @id @default(cuid())
  modelId   String
  model     AIModel     @relation(fields: [modelId], references: [id], onDelete: Cascade)
  label     String                              // "1024×1024" / "2048×2048"
  width     Int                                // 1024
  height    Int                                // 1024
  pricingRules PricingRule[]
  createdAt DateTime    @default(now())

  @@index([modelId])
}

model ModelDuration {
  id        String      @id @default(cuid())
  modelId   String
  model     AIModel     @relation(fields: [modelId], references: [id], onDelete: Cascade)
  label     String                              // "5秒" / "15秒" / "30秒"
  seconds   Int                                // 5 / 15 / 30
  pricingRules PricingRule[]
  createdAt DateTime    @default(now())

  @@index([modelId])
}

model PricingRule {
  id           String          @id @default(cuid())
  nodeTypeId   String
  nodeType     NodeType        @relation(fields: [nodeTypeId], references: [id], onDelete: Cascade)
  modelId      String
  model        AIModel         @relation(fields: [modelId], references: [id], onDelete: Cascade)
  resolutionId String?                                         // Nullable — only for image/video nodes
  resolution   ModelResolution? @relation(fields: [resolutionId], references: [id])
  durationId   String?                                          // Nullable — only for video nodes
  duration     ModelDuration?   @relation(fields: [durationId], references: [id])
  creditCost   Int                                              // Credit cost (integer)
  active       Boolean         @default(true)
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  @@unique([nodeTypeId, modelId, resolutionId, durationId])
  @@index([nodeTypeId])
  @@index([modelId])
}
```

### 3.2 Pricing Rule Matrix

| Node Type | Keys | Example |
|-----------|------|---------|
| text | nodeTypeId + modelId | text + GPT-4 → 2 credits |
| image | nodeTypeId + modelId + resolutionId | image + SD XL + 1024x1024 → 5 credits |
| video | nodeTypeId + modelId + resolutionId + durationId | video + Qwen3.5 + 720p + 15s → 20 credits |

## 4. Backend API

### 4.1 Admin Module — NodeType & Model Management

```
GET    /api/admin/node-types                          List all node types
POST   /api/admin/node-types                          Create node type
PUT    /api/admin/node-types/:id                      Update node type

GET    /api/admin/node-types/:id/models               List models for a node type
POST   /api/admin/node-types/:id/models               Add model to node type
PUT    /api/admin/models/:id                          Update model
POST   /api/admin/models/:id/toggle                   Toggle active/inactive
DELETE /api/admin/models/:id                          Delete model (cascade)

POST   /api/admin/models/:id/resolutions              Add resolution
DELETE /api/admin/models/:id/resolutions/:rid         Remove resolution
POST   /api/admin/models/:id/durations                Add duration
DELETE /api/admin/models/:id/durations/:did           Remove duration
```

### 4.2 Admin Module — Pricing Rules

```
GET    /api/admin/pricing-rules?nodeTypeId=&modelId=  Filter pricing rules
POST   /api/admin/pricing-rules                       Create pricing rule
PUT    /api/admin/pricing-rules/:id                   Update pricing rule
DELETE /api/admin/pricing-rules/:id                   Delete pricing rule
POST   /api/admin/pricing-rules/batch                 Batch create rules (grid)
```

### 4.3 Public API — Frontend Consumption

```
GET    /api/node-types/:key/models                    Get available models for a node type
GET    /api/pricing/calculate?modelId=&resolutionId=&durationId=  Calculate credit cost
```

### 4.4 Response Format

Same as Phase 1/2: `{ code: 0, data: T, message: "ok" }`

## 5. Frontend Changes

### 5.1 ImageConfigPanel Enhancement

Modify `apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx`:

- **Model dropdown**: Load from `GET /api/node-types/image/models` on mount
- **Resolution dropdown**: Load from selected model's `resolutions` array
- **Credit display**: Call `GET /api/pricing/calculate` on model/resolution change
- **Style tags**: Keep hardcoded (not part of pricing in Phase 3)

### 5.2 Admin Pages (Minimal)

New route: `/admin` with sub-routes:

```
apps/web/src/pages/admin/
├── page.tsx                      // Admin layout
├── index.ts
├── components/
│   ├── NodeTypeTabs.tsx          // Tab switcher: 文本/图片/视频
│   ├── ModelTable.tsx            // Model list with CRUD
│   ├── ModelFormModal.tsx        // Add/Edit model form
│   ├── PricingRuleTable.tsx      // Pricing rules grid
│   └── PricingRuleFormModal.tsx  // Add/Edit pricing rule
```

### 5.3 Router Update

Add to `apps/web/src/router.tsx`:
```typescript
{ path: '/admin', element: <AdminPage /> }
```

## 6. Backend Module Structure

```
apps/api/src/modules/admin/
├── admin.module.ts
├── node-type/
│   ├── node-type.controller.ts
│   ├── node-type.service.ts
│   └── *.spec.ts
├── model/
│   ├── model.controller.ts
│   ├── model.service.ts
│   └── *.spec.ts
├── pricing/
│   ├── pricing.controller.ts
│   ├── pricing.service.ts
│   └── *.spec.ts
└── public/                       // Public API (no auth needed)
    ├── public.controller.ts
    ├── public.service.ts
    └── *.spec.ts
```

## 7. Store Extensions

Extend `apps/web/src/stores/nodeStore.ts` to include model list caching:

```typescript
interface SharedState {
  modelLists: Record<string, ModelInfo[]>  // keyed by nodeTypeKey
  fetchModels: (nodeTypeKey: string) => Promise<ModelInfo[]>
}
```

## 8. Testing Strategy (TDD)

- Backend: @nestjs/testing + supertest, mock PrismaService
- Frontend: @testing-library/react + vitest
- Each table: test CRUD, test pricing rule uniqueness constraint
- Test pricing calculation: verify correct credit cost for each combination

## 9. What's NOT in Phase 3

- User credit balance table and API (Phase 3a)
- Credit deduction on API call (Phase 4)
- API key encryption at rest
- Admin authentication/authorization (Phase 4 Keycloak)
- Audit log for pricing changes
