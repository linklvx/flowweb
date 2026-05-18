generator client {
  provider = "prisma-client-js"
  strict   = "true"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id             String          @id
  name           String
  email          String          @unique
  emailVerified  Boolean
  image          String?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  accounts       Account[]
  canvasProjects CanvasProject[]
  sessions       Session[]
  templates      Template[]
  balance        UserBalance?
}

model Account {
  id                    String    @id
  userId                String
  scope                 String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  accessToken           String?
  accessTokenExpiresAt  DateTime?
  accountId             String
  idToken               String?
  password              String?
  providerId            String
  refreshToken          String?
  refreshTokenExpiresAt DateTime?
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([providerId, accountId])
  @@index([userId])
}

model Session {
  id        String   @id
  userId    String
  token     String   @unique
  expiresAt DateTime
  ipAddress String?
  userAgent String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model Announcement {
  id        String   @id @default(cuid())
  message   String
  linkUrl   String?
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([active])
}

model ContentCard {
  id        String   @id @default(cuid())
  title     String
  coverUrl  String
  tags      String[]
  desc      String
  sortOrder Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([active, sortOrder])
}

model Template {
  id           String            @id @default(cuid())
  name         String
  description  String?
  coverUrl     String?
  dataUrl      String?
  templateData Json?
  userId       String
  isPublic     Boolean           @default(false)
  importCount  Int               @default(0)
  category     TemplateCategory?
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt
  projectId    String?
  user         User              @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([name, userId])
  @@index([userId])
  @@index([isPublic])
  @@index([category])
  @@index([importCount])
}

model CanvasProject {
  id        String       @id @default(cuid())
  name      String
  viewport  Json         @default("{\"x\": 0, \"y\": 0, \"zoom\": 1}")
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt
  userId    String?
  edges     CanvasEdge[]
  nodes     CanvasNode[]
  user      User?        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model CanvasNode {
  id        String        @id @default(cuid())
  projectId String
  type      String
  position  Json
  data      Json
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
  project   CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
}

model CanvasEdge {
  id        String        @id @default(cuid())
  projectId String
  sourceId  String
  targetId  String
  project   CanvasProject @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
}

model NodeType {
  id           String        @id @default(cuid())
  name         String
  key          String        @unique
  description  String?
  active       Boolean       @default(true)
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  models       AIModel[]
  pricingRules PricingRule[]
}

model AIModel {
  id           String            @id @default(cuid())
  nodeTypeId   String
  name         String
  provider     String
  apiUrl       String
  apiKey       String?
  sortOrder    Int               @default(0)
  recommended  Boolean           @default(false)
  active       Boolean           @default(true)
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt
  nodeType     NodeType          @relation(fields: [nodeTypeId], references: [id], onDelete: Cascade)
  durations    ModelDuration[]
  resolutions  ModelResolution[]
  pricingRules PricingRule[]

  @@index([nodeTypeId, active])
  @@index([nodeTypeId, sortOrder])
}

model ModelResolution {
  id           String        @id @default(cuid())
  modelId      String
  label        String
  width        Int
  height       Int
  createdAt    DateTime      @default(now())
  model        AIModel       @relation(fields: [modelId], references: [id], onDelete: Cascade)
  pricingRules PricingRule[]

  @@index([modelId])
}

model ModelDuration {
  id           String        @id @default(cuid())
  modelId      String
  label        String
  seconds      Int
  createdAt    DateTime      @default(now())
  model        AIModel       @relation(fields: [modelId], references: [id], onDelete: Cascade)
  pricingRules PricingRule[]

  @@index([modelId])
}

model PricingRule {
  id           String           @id @default(cuid())
  nodeTypeId   String
  modelId      String
  resolutionId String?
  durationId   String?
  creditCost   Int
  active       Boolean          @default(true)
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
  duration     ModelDuration?   @relation(fields: [durationId], references: [id])
  model        AIModel          @relation(fields: [modelId], references: [id], onDelete: Cascade)
  nodeType     NodeType         @relation(fields: [nodeTypeId], references: [id], onDelete: Cascade)
  resolution   ModelResolution? @relation(fields: [resolutionId], references: [id])

  @@unique([nodeTypeId, modelId, resolutionId, durationId])
  @@index([nodeTypeId])
  @@index([modelId])
}

model UserBalance {
  id        String   @id @default(cuid())
  userId    String   @unique
  credits   Int      @default(100)
  version   Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

enum TemplateCategory {
  OFFICIAL
  COMMUNITY
}


┌─────────────────────────────────────────────────────────┐
│  Update available 5.22.0 -> 7.8.0                       │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘
