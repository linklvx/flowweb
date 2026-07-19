-- Prisma auto-generated DDL (applied via prisma db push 2026-07-19)

-- CreateTable
CREATE TABLE "subscription_banner" (
    "id" TEXT NOT NULL DEFAULT 'subscription-banner-singleton',
    "title" VARCHAR(64) NOT NULL,
    "subtitle" VARCHAR(200) NOT NULL,
    "backgroundImageUrl" VARCHAR(500),
    "backgroundImageKey" VARCHAR(255),
    "countdownEndAt" TIMESTAMP(3),
    "autoExtend" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_banner_pkey" PRIMARY KEY ("id")
);
