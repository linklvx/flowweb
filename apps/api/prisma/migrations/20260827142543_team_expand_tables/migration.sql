-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "TeamStatus" AS ENUM ('ACTIVE', 'DISBANDED');

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TeamCreditTransactionType" AS ENUM ('recharge', 'subscription_grant', 'consumption', 'expire_clear', 'register_grant', 'admin_adjust');

-- CreateEnum
CREATE TYPE "TeamSubscriptionStatus" AS ENUM ('active', 'expired');

-- CreateEnum
CREATE TYPE "TeamOrderStatus" AS ENUM ('PENDING', 'SUCCESS', 'CLOSED');

-- AlterTable
ALTER TABLE "CanvasProject" ADD COLUMN     "teamId" TEXT;

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "teamId" TEXT;

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "TeamStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "monthlyQuota" INTEGER NOT NULL DEFAULT 0,
    "monthlyPeriod" TEXT,
    "monthlyUsed" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamBalance" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "subscriptionCredits" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamCreditTransaction" (
    "id" TEXT NOT NULL,
    "teamId" TEXT,
    "operatorUserId" TEXT,
    "amount" INTEGER NOT NULL,
    "type" "TeamCreditTransactionType" NOT NULL,
    "creditType" "CreditType" NOT NULL,
    "referenceId" TEXT,
    "balanceAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamCreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyCredits" INTEGER NOT NULL,
    "storageLimitBytes" BIGINT NOT NULL,
    "seatLimit" INTEGER NOT NULL,
    "priceMonthly" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSubscription" (
    "id" TEXT NOT NULL,
    "teamId" TEXT,
    "planId" TEXT NOT NULL,
    "status" "TeamSubscriptionStatus" NOT NULL DEFAULT 'active',
    "paidAmount" INTEGER NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamRechargeOrder" (
    "id" TEXT NOT NULL,
    "outTradeNo" TEXT NOT NULL,
    "teamId" TEXT,
    "payerUserId" TEXT NOT NULL,
    "amountFen" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "status" "TeamOrderStatus" NOT NULL DEFAULT 'PENDING',
    "prepayId" VARCHAR(64),
    "transactionId" VARCHAR(64),
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamRechargeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamJoinRequest" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasDoc" (
    "projectId" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasDoc_pkey" PRIMARY KEY ("projectId")
);

-- CreateIndex
CREATE INDEX "Team_status_idx" ON "Team"("status");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamBalance_teamId_key" ON "TeamBalance"("teamId");

-- CreateIndex
CREATE INDEX "TeamCreditTransaction_teamId_createdAt_idx" ON "TeamCreditTransaction"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "TeamCreditTransaction_referenceId_idx" ON "TeamCreditTransaction"("referenceId");

-- CreateIndex
CREATE INDEX "TeamPlan_isActive_sort_idx" ON "TeamPlan"("isActive", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "TeamSubscription_teamId_key" ON "TeamSubscription"("teamId");

-- CreateIndex
CREATE INDEX "TeamSubscription_status_currentPeriodEnd_idx" ON "TeamSubscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "TeamRechargeOrder_outTradeNo_key" ON "TeamRechargeOrder"("outTradeNo");

-- CreateIndex
CREATE INDEX "TeamRechargeOrder_teamId_createdAt_idx" ON "TeamRechargeOrder"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "TeamRechargeOrder_status_expiresAt_idx" ON "TeamRechargeOrder"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "TeamJoinRequest_teamId_status_idx" ON "TeamJoinRequest"("teamId", "status");

-- CreateIndex
CREATE INDEX "TeamJoinRequest_userId_idx" ON "TeamJoinRequest"("userId");

-- CreateIndex
CREATE INDEX "CanvasProject_teamId_idx" ON "CanvasProject"("teamId");

-- AddForeignKey
ALTER TABLE "CanvasProject" ADD CONSTRAINT "CanvasProject_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamBalance" ADD CONSTRAINT "TeamBalance_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamCreditTransaction" ADD CONSTRAINT "TeamCreditTransaction_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSubscription" ADD CONSTRAINT "TeamSubscription_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSubscription" ADD CONSTRAINT "TeamSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TeamPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRechargeOrder" ADD CONSTRAINT "TeamRechargeOrder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamJoinRequest" ADD CONSTRAINT "TeamJoinRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamJoinRequest" ADD CONSTRAINT "TeamJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamJoinRequest" ADD CONSTRAINT "TeamJoinRequest_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasDoc" ADD CONSTRAINT "CanvasDoc_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
