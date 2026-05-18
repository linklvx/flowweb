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

