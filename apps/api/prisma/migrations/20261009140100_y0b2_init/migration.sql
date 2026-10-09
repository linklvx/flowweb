-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "LightingTaskStatus" AS ENUM ('pending', 'processing', 'success', 'failed');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('basic', 'pro', 'max', 'ultra');

-- CreateEnum
CREATE TYPE "SubscriptionPeriod" AS ENUM ('monthly', 'quarterly', 'annually');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'expired', 'upgraded');

-- CreateEnum
CREATE TYPE "SubscriptionOrderType" AS ENUM ('new_purchase', 'upgrade', 'renewal');

-- CreateEnum
CREATE TYPE "SubscriptionOrderStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CreditType" AS ENUM ('regular', 'subscription');

-- CreateEnum
CREATE TYPE "AuditTargetType" AS ENUM ('subscription', 'subscription_plan', 'point', 'order', 'TEAM', 'TEAM_MEMBER', 'PROJECT', 'PROJECT_MEMBER', 'COLLAB_LEASE');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "TeamStatus" AS ENUM ('ACTIVE', 'DISBANDED');

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TeamCreditTransactionType" AS ENUM ('recharge', 'subscription_grant', 'expire_clear', 'register_grant', 'upgrade_clear', 'admin_grant', 'admin_clear', 'release', 'refund', 'reserve', 'settle');

-- CreateEnum
CREATE TYPE "TeamSubscriptionStatus" AS ENUM ('active', 'expired');

-- CreateEnum
CREATE TYPE "TeamOrderStatus" AS ENUM ('PENDING', 'SUCCESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "RechargeKind" AS ENUM ('credits', 'subscription');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('PROJECT_OWNER', 'PROJECT_EDITOR', 'PROJECT_VIEWER');

-- CreateEnum
CREATE TYPE "VideoWorkStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "IntentStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'VOIDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "image" TEXT,
    "phoneNumber" VARCHAR(20),
    "phoneNumberVerified" BOOLEAN NOT NULL DEFAULT false,
    "wechatOpenid" VARCHAR(64),
    "wechatUnionid" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "password" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "message" VARCHAR(200) NOT NULL,
    "linkText" VARCHAR(32),
    "linkUrl" VARCHAR(500),
    "bgColor" VARCHAR(16) NOT NULL DEFAULT '#0f2761',
    "textColor" VARCHAR(16) NOT NULL DEFAULT '#ffffff',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentCard" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "coverUrl" TEXT NOT NULL,
    "tags" TEXT[],
    "desc" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeBanner" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(128),
    "subtitle" VARCHAR(256),
    "linkUrl" VARCHAR(500),
    "imageKey" VARCHAR(255) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeBanner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "folderId" TEXT,
    "projectId" TEXT,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "parentId" TEXT,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIModel" (
    "id" TEXT NOT NULL,
    "nodeTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiUrl" TEXT NOT NULL,
    "apiKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelResolution" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelDuration" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelDuration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "nodeTypeId" TEXT NOT NULL,
    "modelId" TEXT,
    "resolutionId" TEXT,
    "durationId" TEXT,
    "creditCost" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL DEFAULT 'flowai',
    "key" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "projectId" TEXT,
    "nodeId" TEXT,
    "taskId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "type" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "folderId" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "thumbnailKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "teamId" TEXT NOT NULL,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MaterialFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LightingTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "projectId" TEXT,
    "originalImageUrl" VARCHAR(512) NOT NULL,
    "resultImageUrl" VARCHAR(512),
    "resultMediaId" TEXT,
    "params" JSONB NOT NULL,
    "status" "LightingTaskStatus" NOT NULL DEFAULT 'pending',
    "costCredits" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "LightingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoTrimTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "startTime" DOUBLE PRECISION NOT NULL,
    "endTime" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "outputFileId" TEXT,
    "errorMsg" TEXT,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "VideoTrimTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoSeparateTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'split',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "videoFileId" TEXT,
    "audioFileId" TEXT,
    "errorMsg" TEXT,
    "errorType" TEXT,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "VideoSeparateTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoProject" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL,
    "monthlyCredits" INTEGER NOT NULL,
    "storageLimitBytes" BIGINT NOT NULL,
    "priceMonthly" INTEGER NOT NULL,
    "originalPriceMonthly" INTEGER NOT NULL DEFAULT 0,
    "priceQuarterly" INTEGER NOT NULL,
    "originalPriceQuarterly" INTEGER NOT NULL DEFAULT 0,
    "priceAnnually" INTEGER NOT NULL,
    "originalPriceAnnually" INTEGER NOT NULL DEFAULT 0,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "UserSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL,
    "period" "SubscriptionPeriod" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "paidAmount" INTEGER NOT NULL,
    "totalCredits" INTEGER NOT NULL,
    "totalDays" INTEGER NOT NULL,
    "consumedCredits" INTEGER NOT NULL DEFAULT 0,
    "subscribedAt" TIMESTAMP(3) NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "nextGrantDate" TIMESTAMP(3) NOT NULL,
    "grantCount" INTEGER NOT NULL DEFAULT 1,
    "previousSubId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionOrder" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "period" "SubscriptionPeriod" NOT NULL,
    "type" "SubscriptionOrderType" NOT NULL,
    "originalAmount" INTEGER NOT NULL,
    "payableAmount" INTEGER NOT NULL,
    "prorationAmount" INTEGER,
    "fromSubscriptionId" TEXT,
    "fromPlanId" TEXT,
    "status" "SubscriptionOrderStatus" NOT NULL DEFAULT 'PENDING',
    "pricingSnapshot" JSONB,
    "payChannel" VARCHAR(32) NOT NULL DEFAULT 'wechat',
    "prepayId" VARCHAR(64),
    "transactionId" VARCHAR(64),
    "payerOpenid" VARCHAR(64),
    "paidAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "delayCloseJobId" TEXT,
    "notifySummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "operatorName" TEXT NOT NULL,
    "teamId" TEXT,
    "targetType" "AuditTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "TeamStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "monthlyQuota" INTEGER NOT NULL DEFAULT 0,
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
    "teamId" TEXT NOT NULL,
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
    "teamId" TEXT NOT NULL,
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
    "teamId" TEXT NOT NULL,
    "payerUserId" TEXT NOT NULL,
    "amountFen" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "kind" "RechargeKind" NOT NULL DEFAULT 'credits',
    "planId" TEXT,
    "status" "TeamOrderStatus" NOT NULL DEFAULT 'PENDING',
    "prepayId" VARCHAR(64),
    "transactionId" VARCHAR(64),
    "payerOpenid" VARCHAR(64),
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
    "stateSeq" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasDoc_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasDocUpdate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "update" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanvasDocUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollabLease" (
    "scope" TEXT NOT NULL,
    "owner" TEXT,
    "epoch" BIGINT NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3),
    "renewedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CollabLease_pkey" PRIMARY KEY ("scope")
);

-- CreateTable
CREATE TABLE "VideoWork" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "authorName" VARCHAR(64) NOT NULL,
    "categoryId" TEXT,
    "videoKey" VARCHAR(512) NOT NULL,
    "videoMediaId" TEXT,
    "coverKey" VARCHAR(512),
    "canvasProjectId" TEXT,
    "durationSec" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "VideoWorkStatus" NOT NULL DEFAULT 'DRAFT',
    "allowViewProcess" BOOLEAN NOT NULL DEFAULT false,
    "allowClone" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoCategory" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoTag" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoWorkSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "carouselEnabled" BOOLEAN NOT NULL DEFAULT true,
    "carouselScope" TEXT NOT NULL DEFAULT 'all',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoWorkSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Style" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "coverKey" TEXT NOT NULL,
    "authorName" TEXT,
    "isCommercial" BOOLEAN NOT NULL DEFAULT false,
    "promptText" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Style_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleRecentUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleRecentUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationIntent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "paramsHash" TEXT NOT NULL,
    "status" "IntentStatus" NOT NULL DEFAULT 'RUNNING',
    "jobId" TEXT,
    "creditsConsumed" INTEGER NOT NULL DEFAULT 0,
    "reservedCredits" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "resultRef" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_wechatOpenid_key" ON "User"("wechatOpenid");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE INDEX "ContentCard_active_sortOrder_idx" ON "ContentCard"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "HomeBanner_active_sortOrder_idx" ON "HomeBanner"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Template_projectId_key" ON "Template"("projectId");

-- CreateIndex
CREATE INDEX "Template_folderId_idx" ON "Template"("folderId");

-- CreateIndex
CREATE INDEX "Template_userId_idx" ON "Template"("userId");

-- CreateIndex
CREATE INDEX "Template_teamId_idx" ON "Template"("teamId");

-- CreateIndex
CREATE INDEX "CanvasProject_userId_idx" ON "CanvasProject"("userId");

-- CreateIndex
CREATE INDEX "CanvasProject_teamId_idx" ON "CanvasProject"("teamId");

-- CreateIndex
CREATE INDEX "Folder_teamId_idx" ON "Folder"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "NodeType_key_key" ON "NodeType"("key");

-- CreateIndex
CREATE INDEX "AIModel_nodeTypeId_active_idx" ON "AIModel"("nodeTypeId", "active");

-- CreateIndex
CREATE INDEX "AIModel_nodeTypeId_sortOrder_idx" ON "AIModel"("nodeTypeId", "sortOrder");

-- CreateIndex
CREATE INDEX "ModelResolution_modelId_idx" ON "ModelResolution"("modelId");

-- CreateIndex
CREATE INDEX "ModelDuration_modelId_idx" ON "ModelDuration"("modelId");

-- CreateIndex
CREATE INDEX "PricingRule_nodeTypeId_idx" ON "PricingRule"("nodeTypeId");

-- CreateIndex
CREATE INDEX "PricingRule_modelId_idx" ON "PricingRule"("modelId");

-- CreateIndex
CREATE INDEX "Media_userId_idx" ON "Media"("userId");

-- CreateIndex
CREATE INDEX "Media_teamId_idx" ON "Media"("teamId");

-- CreateIndex
CREATE INDEX "Media_projectId_idx" ON "Media"("projectId");

-- CreateIndex
CREATE INDEX "Media_nodeId_idx" ON "Media"("nodeId");

-- CreateIndex
CREATE INDEX "Media_taskId_idx" ON "Media"("taskId");

-- CreateIndex
CREATE INDEX "Media_expiresAt_idx" ON "Media"("expiresAt");

-- CreateIndex
CREATE INDEX "Media_userId_folderId_createdAt_idx" ON "Media"("userId", "folderId", "createdAt");

-- CreateIndex
CREATE INDEX "Media_userId_isFavorite_idx" ON "Media"("userId", "isFavorite");

-- CreateIndex
CREATE INDEX "Media_type_status_deletedAt_idx" ON "Media"("type", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "MaterialFolder_teamId_idx" ON "MaterialFolder"("teamId");

-- CreateIndex
CREATE INDEX "MaterialFolder_userId_sortOrder_idx" ON "MaterialFolder"("userId", "sortOrder");

-- CreateIndex
CREATE INDEX "MaterialFolder_userId_deletedAt_idx" ON "MaterialFolder"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "LightingTask_userId_idx" ON "LightingTask"("userId");

-- CreateIndex
CREATE INDEX "LightingTask_teamId_idx" ON "LightingTask"("teamId");

-- CreateIndex
CREATE INDEX "LightingTask_status_idx" ON "LightingTask"("status");

-- CreateIndex
CREATE INDEX "VideoTrimTask_nodeId_idx" ON "VideoTrimTask"("nodeId");

-- CreateIndex
CREATE INDEX "VideoTrimTask_userId_idx" ON "VideoTrimTask"("userId");

-- CreateIndex
CREATE INDEX "VideoTrimTask_teamId_idx" ON "VideoTrimTask"("teamId");

-- CreateIndex
CREATE INDEX "VideoSeparateTask_nodeId_idx" ON "VideoSeparateTask"("nodeId");

-- CreateIndex
CREATE INDEX "VideoSeparateTask_userId_idx" ON "VideoSeparateTask"("userId");

-- CreateIndex
CREATE INDEX "VideoSeparateTask_teamId_idx" ON "VideoSeparateTask"("teamId");

-- CreateIndex
CREATE INDEX "VideoSeparateTask_sourceFileId_idx" ON "VideoSeparateTask"("sourceFileId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoProject_sourceNodeId_key" ON "VideoProject"("sourceNodeId");

-- CreateIndex
CREATE INDEX "VideoProject_teamId_idx" ON "VideoProject"("teamId");

-- CreateIndex
CREATE INDEX "VideoProject_userId_idx" ON "VideoProject"("userId");

-- CreateIndex
CREATE INDEX "VideoProject_workflowId_idx" ON "VideoProject"("workflowId");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_isActive_sort_idx" ON "SubscriptionPlan"("isActive", "sort");

-- CreateIndex
CREATE INDEX "UserSubscription_userId_idx" ON "UserSubscription"("userId");

-- CreateIndex
CREATE INDEX "UserSubscription_planId_idx" ON "UserSubscription"("planId");

-- CreateIndex
CREATE INDEX "UserSubscription_status_nextGrantDate_idx" ON "UserSubscription"("status", "nextGrantDate");

-- CreateIndex
CREATE INDEX "UserSubscription_status_currentPeriodEnd_idx" ON "UserSubscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionOrder_orderNo_key" ON "SubscriptionOrder"("orderNo");

-- CreateIndex
CREATE INDEX "AuditLog_operatorId_idx" ON "AuditLog"("operatorId");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_teamId_createdAt_idx" ON "AuditLog"("teamId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- CreateIndex
CREATE INDEX "Team_status_idx" ON "Team"("status");

-- CreateIndex
CREATE INDEX "Team_ownerId_idx" ON "Team"("ownerId");

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
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE INDEX "VideoWork_status_sortOrder_publishedAt_idx" ON "VideoWork"("status", "sortOrder", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "VideoWork_categoryId_status_idx" ON "VideoWork"("categoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VideoCategory_name_key" ON "VideoCategory"("name");

-- CreateIndex
CREATE INDEX "VideoCategory_active_sortOrder_idx" ON "VideoCategory"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "VideoTag_name_key" ON "VideoTag"("name");

-- CreateIndex
CREATE INDEX "VideoTag_active_sortOrder_idx" ON "VideoTag"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "StyleCategory_name_key" ON "StyleCategory"("name");

-- CreateIndex
CREATE INDEX "StyleCategory_active_sortOrder_idx" ON "StyleCategory"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "Style_active_sortOrder_usageCount_id_idx" ON "Style"("active", "sortOrder", "usageCount" DESC, "id");

-- CreateIndex
CREATE INDEX "Style_categoryId_active_idx" ON "Style"("categoryId", "active");

-- CreateIndex
CREATE INDEX "StyleFavorite_userId_createdAt_idx" ON "StyleFavorite"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StyleFavorite_userId_styleId_key" ON "StyleFavorite"("userId", "styleId");

-- CreateIndex
CREATE INDEX "StyleRecentUsage_userId_lastUsedAt_idx" ON "StyleRecentUsage"("userId", "lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StyleRecentUsage_userId_styleId_key" ON "StyleRecentUsage"("userId", "styleId");

-- CreateIndex
CREATE INDEX "GenerationIntent_projectId_nodeId_status_idx" ON "GenerationIntent"("projectId", "nodeId", "status");

-- CreateIndex
CREATE INDEX "GenerationIntent_jobId_idx" ON "GenerationIntent"("jobId");

-- CreateIndex
CREATE INDEX "GenerationIntent_status_completedAt_idx" ON "GenerationIntent"("status", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationIntent_projectId_intentId_key" ON "GenerationIntent"("projectId", "intentId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasProject" ADD CONSTRAINT "CanvasProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasProject" ADD CONSTRAINT "CanvasProject_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIModel" ADD CONSTRAINT "AIModel_nodeTypeId_fkey" FOREIGN KEY ("nodeTypeId") REFERENCES "NodeType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelResolution" ADD CONSTRAINT "ModelResolution_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AIModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelDuration" ADD CONSTRAINT "ModelDuration_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AIModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_nodeTypeId_fkey" FOREIGN KEY ("nodeTypeId") REFERENCES "NodeType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AIModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "ModelResolution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_durationId_fkey" FOREIGN KEY ("durationId") REFERENCES "ModelDuration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MaterialFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialFolder" ADD CONSTRAINT "MaterialFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MaterialFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialFolder" ADD CONSTRAINT "MaterialFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialFolder" ADD CONSTRAINT "MaterialFolder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LightingTask" ADD CONSTRAINT "LightingTask_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoTrimTask" ADD CONSTRAINT "VideoTrimTask_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoSeparateTask" ADD CONSTRAINT "VideoSeparateTask_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "CanvasProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamBalance" ADD CONSTRAINT "TeamBalance_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSubscription" ADD CONSTRAINT "TeamSubscription_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSubscription" ADD CONSTRAINT "TeamSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TeamPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamJoinRequest" ADD CONSTRAINT "TeamJoinRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamJoinRequest" ADD CONSTRAINT "TeamJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamJoinRequest" ADD CONSTRAINT "TeamJoinRequest_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasDoc" ADD CONSTRAINT "CanvasDoc_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasDocUpdate" ADD CONSTRAINT "CanvasDocUpdate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoWork" ADD CONSTRAINT "VideoWork_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VideoCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Style" ADD CONSTRAINT "Style_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "StyleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleFavorite" ADD CONSTRAINT "StyleFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleFavorite" ADD CONSTRAINT "StyleFavorite_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleRecentUsage" ADD CONSTRAINT "StyleRecentUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleRecentUsage" ADD CONSTRAINT "StyleRecentUsage_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============ 以下为 Prisma diff 不可见的 raw 对象（census 搬运——来源旧迁移原文，实测定义粘自 Step 0 探针 2026-10-09） ============

-- 1. append 序列（协作写命脉——丢=每次 nextval 抛错；来源旧 20260828044715:63 原文）
CREATE SEQUENCE "canvas_doc_update_seq";

-- 2. 九条 partial unique 索引（Prisma 表达不了 partial WHERE——原文搬运）
CREATE UNIQUE INDEX "team_owner_default_unique" ON "Team"("ownerId") WHERE "isDefault" = true;

CREATE UNIQUE INDEX "folder_team_root_name_unique" ON "Folder"("teamId", "name") WHERE "parentId" IS NULL;

CREATE UNIQUE INDEX "folder_team_parent_name_unique" ON "Folder"("teamId", "parentId", "name") WHERE "parentId" IS NOT NULL;

CREATE UNIQUE INDEX "material_folder_team_root_name_unique" ON "MaterialFolder"("teamId", "name") WHERE "parentId" IS NULL;

CREATE UNIQUE INDEX "material_folder_team_parent_name_unique" ON "MaterialFolder"("teamId", "parentId", "name") WHERE "parentId" IS NOT NULL;

CREATE UNIQUE INDEX "user_subscription_one_active" ON "UserSubscription"("userId") WHERE status = 'active';

CREATE UNIQUE INDEX "team_subscription_one_active" ON "TeamSubscription"("teamId") WHERE status = 'active';

CREATE UNIQUE INDEX "announcement_single_active" ON "Announcement"("active") WHERE "active";

-- generation-intent.service.ts claim P2002 分义直依赖（来源旧 20260930062038:47 原文）
CREATE UNIQUE INDEX "generation_intent_active_node_unique"
ON "GenerationIntent"("projectId", "nodeId")
WHERE status = 'RUNNING';

-- 3. 约束形态唯一（pg_constraint 口径——verify-indexes 块按约束断言，勿改建索引形态；
--    来源旧 20261006120655:20；schema @@unique 对应的 diff 裸索引行已删——ADD CONSTRAINT 同名冲突）
ALTER TABLE "CanvasDocUpdate" ADD CONSTRAINT "CanvasDocUpdate_projectId_seq_key" UNIQUE ("projectId", "seq");

-- 4. CollabLease 种子行（幂等；来源旧 20261006120655:23 原文）
INSERT INTO "CollabLease" ("scope", "owner", "epoch") VALUES ('primary', NULL, 0)
ON CONFLICT ("scope") DO NOTHING;

-- Y0b-2 squash：Y0b-1 守卫头（空表断言）随起草文件退役——本 init 为唯一真源，fresh replay 恒空表。
-- AlterTable
ALTER TABLE "GenerationIntent" ADD COLUMN     "creditCost" INTEGER NOT NULL,
ADD COLUMN     "durationId" TEXT,
ADD COLUMN     "modelId" TEXT,
ADD COLUMN     "pricingRuleId" TEXT,
ADD COLUMN     "resolutionId" TEXT,
ADD COLUMN     "teamId" TEXT NOT NULL;

-- AlterTable（Y0b-2 裁定 5：AIModel provider slug 化+两新列——列先于下方 INSERT）
ALTER TABLE "AIModel" ADD COLUMN     "apiModelName" TEXT,
ADD COLUMN     "providerLabel" TEXT;

-- AlterTable
ALTER TABLE "TeamCreditTransaction" ADD COLUMN     "balanceDelta" INTEGER NOT NULL,
ADD COLUMN     "frozenDelta" INTEGER NOT NULL,
ADD COLUMN     "reversesId" TEXT,
ADD COLUMN     "seq" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "GenerationIntent_teamId_idx" ON "GenerationIntent"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamCreditTransaction_reversesId_key" ON "TeamCreditTransaction"("reversesId");

-- AddForeignKey
ALTER TABLE "GenerationIntent" ADD CONSTRAINT "GenerationIntent_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "PricingRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ====== Y0b-1 DB 级不变量（raw——Prisma 不支持 partial index/CHECK） ======
-- 定价自然键真唯一（PG15+ NULLS NOT DISTINCT——kind 级 modelId IS NULL 行同受约束）。
CREATE UNIQUE INDEX "pricing_rule_natural_key" ON "PricingRule"("nodeTypeId", "modelId", "resolutionId", "durationId") NULLS NOT DISTINCT;
-- 余额非负（F5）。
ALTER TABLE "TeamBalance" ADD CONSTRAINT "balance_non_negative" CHECK ("credits" >= 0 AND "subscriptionCredits" >= 0);
-- 定价与意图非负（Z 终裁 CHECK 全家——空库免费）。
ALTER TABLE "PricingRule" ADD CONSTRAINT "pricing_credit_cost_non_negative" CHECK ("creditCost" >= 0);
ALTER TABLE "GenerationIntent" ADD CONSTRAINT "intent_credit_cost_non_negative" CHECK ("creditCost" >= 0 AND "reservedCredits" >= 0 AND "creditsConsumed" >= 0);
-- 台账 amount 派生强制（Z8）。
ALTER TABLE "TeamCreditTransaction" ADD CONSTRAINT "ledger_amount_derived"
  CHECK ("amount" = CASE WHEN "balanceDelta" <> 0 THEN "balanceDelta" ELSE "frozenDelta" END);
-- 账户域幂等锚（Z9）：money_in 类每事件每池至多一条 + referenceId 必填。
CREATE UNIQUE INDEX "money_in_once" ON "TeamCreditTransaction"("type", "referenceId", "creditType")
  WHERE "type" IN ('recharge', 'subscription_grant', 'expire_clear', 'register_grant');
ALTER TABLE "TeamCreditTransaction" ADD CONSTRAINT "money_in_reference_required"
  CHECK ("type" NOT IN ('recharge', 'subscription_grant', 'expire_clear', 'register_grant') OR "referenceId" IS NOT NULL);
-- 冻结悬留直查（Z11 性能补偿：生命周期门与第四分支的 reservedCredits>0 扫描）。
CREATE INDEX "generation_intent_frozen_partial" ON "GenerationIntent"("teamId") WHERE "reservedCredits" > 0;
-- 孤儿/不可释放扫描性能（四轮 Z38）：T5 巡检 5min 档扫 type='reserve' 全表的 partial 化。
CREATE INDEX "ledger_reserve_open_partial" ON "TeamCreditTransaction"("createdAt") WHERE type = 'reserve';

-- ====== 定价数据进迁移（Z16+三轮 Z29——主链全家+kind 级：固定 id 常量原样搬自 seed.ts；
-- 定价真源=迁移；seed.ts 对应段 upsert-by-id/key 幂等共存） ======
-- ① 主链 NodeType（seed.ts 同名四键——id 用固定常量）
INSERT INTO "NodeType" ("id", "key", "name", "description", "active", "createdAt", "updatedAt") VALUES
  ('node-type-text', 'text', '文本生成', '文本Prompt输入与优化', true, now(), now()),
  ('node-type-image', 'image', '图片生成', '文生图、图生图', true, now(), now()),
  ('node-type-image-ext', 'imageExt', '图片扩展', '图片扩展节点', true, now(), now()),
  ('node-type-video', 'video', '视频生成', '文生视频、图生视频', true, now(), now())
ON CONFLICT ("key") DO NOTHING;

-- ② kind 级 NodeType（Z5——编辑 4 kind 的 modelId IS NULL 规则载体；multiImageGen 并入 Z31 显式 4xx 不建规则——mock 管线禁定价，四轮 Z37）
INSERT INTO "NodeType" ("id", "key", "name", "active", "createdAt", "updatedAt") VALUES
  ('node-type-outpaint', 'outpaint', '局部重绘（外扩）', true, now(), now()),
  ('node-type-erase', 'erase', '擦除', true, now(), now()),
  ('node-type-redraw', 'redraw', '局部重绘', true, now(), now()),
  ('node-type-lighting', 'lighting', '打光', true, now(), now())
ON CONFLICT ("key") DO NOTHING;

-- ③ AIModel（id=seed 固定常量；apiKey 迁移置 NULL——env 密钥由 seed.ts 补写；
-- Y0b-2 裁定 5 终态：provider=slug+apiModelName/providerLabel 三列；sdxl/dalle/gpt4 无外呼实现=双钉 inactive）
INSERT INTO "AIModel" ("id", "nodeTypeId", "name", "provider", "apiModelName", "providerLabel", "apiUrl", "apiKey", "sortOrder", "recommended", "active", "createdAt", "updatedAt") VALUES
  ('seed-model-hy-image', 'node-type-image', 'HY-Image-V3.0', 'tencent', 'hy-image-v3.0', '腾讯混元', 'https://tokenhub.tencentmaas.com/v1/api/image', NULL, 0, true, true, now(), now()),
  ('seed-model-sdxl', 'node-type-image', 'Stable Diffusion XL', 'stability', NULL, 'Stability AI', 'https://api.stability.ai/v1/generation', NULL, 1, false, false, now(), now()),
  ('seed-model-dalle', 'node-type-image', 'DALL-E 3', 'openai', NULL, 'OpenAI', 'https://api.openai.com/v1/images/generations', NULL, 2, false, false, now(), now()),
  ('seed-model-gpt4', 'node-type-text', 'GPT-4o', 'openai', NULL, 'OpenAI', 'https://api.openai.com/v1/chat/completions', NULL, 1, false, false, now(), now()),
  ('seed-model-kimi', 'node-type-text', 'Kimi K2.6', 'moonshot', 'kimi-k2.6', 'Moonshot AI', 'https://api.moonshot.cn/v1', NULL, 2, true, true, now(), now()),
  ('seed-model-hy-video', 'node-type-video', 'HY-Video 1.5', 'tencent', 'hy-video-1.5', 'Tencent Maas', 'https://tokenhub.tencentmaas.com/v1/api/video', NULL, 1, true, true, now(), now())
ON CONFLICT ("id") DO NOTHING;

-- ④ 分辨率/时长（固定 id——resolver 归一化与覆盖度门禁的键集来源；列集以 schema/seed.ts 实测校准）
INSERT INTO "ModelResolution" ("id", "modelId", "label", "width", "height", "createdAt") VALUES
  ('seed-res-hy-1024', 'seed-model-hy-image', '1024×1024', 1024, 1024, now()),
  ('seed-res-hy-2048', 'seed-model-hy-image', '2048×2048', 2048, 2048, now()),
  ('seed-res-hy-512', 'seed-model-hy-image', '512×512', 512, 512, now()),
  ('seed-res-sdxl-1024', 'seed-model-sdxl', '1024×1024', 1024, 1024, now()),
  ('seed-res-sdxl-2048', 'seed-model-sdxl', '2048×2048', 2048, 2048, now()),
  ('seed-res-dalle-1024', 'seed-model-dalle', '1024×1024', 1024, 1024, now()),
  ('seed-res-dalle-512', 'seed-model-dalle', '512×512', 512, 512, now())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ModelDuration" ("id", "modelId", "label", "seconds", "createdAt") VALUES
  ('seed-dur-5', 'seed-model-hy-video', '5秒', 5, now()),
  ('seed-dur-10', 'seed-model-hy-video', '10秒', 10, now()),
  ('seed-dur-15', 'seed-model-hy-video', '15秒', 15, now())
ON CONFLICT ("id") DO NOTHING;

-- ⑤ 主链规则（seed.ts 原价目——text (model,null,null)、image (model,res,null)、video (model,null,dur)；价目已与 seed.ts 现值逐条比对一致）
INSERT INTO "PricingRule" ("id", "nodeTypeId", "modelId", "resolutionId", "durationId", "creditCost", "active", "createdAt", "updatedAt") VALUES
  ('seed-pricing-gpt4', 'node-type-text', 'seed-model-gpt4', NULL, NULL, 2, true, now(), now()),
  ('seed-pricing-kimi', 'node-type-text', 'seed-model-kimi', NULL, NULL, 2, true, now(), now()),
  ('seed-pricing-sdxl-1024', 'node-type-image', 'seed-model-sdxl', 'seed-res-sdxl-1024', NULL, 3, true, now(), now()),
  ('seed-pricing-sdxl-2048', 'node-type-image', 'seed-model-sdxl', 'seed-res-sdxl-2048', NULL, 6, true, now(), now()),
  ('seed-pricing-dalle-1024', 'node-type-image', 'seed-model-dalle', 'seed-res-dalle-1024', NULL, 5, true, now(), now()),
  ('seed-pricing-dalle-512', 'node-type-image', 'seed-model-dalle', 'seed-res-dalle-512', NULL, 2, true, now(), now()),
  ('seed-pricing-hy-img-512', 'node-type-image', 'seed-model-hy-image', 'seed-res-hy-512', NULL, 3, true, now(), now()),
  ('seed-pricing-hy-img-1024', 'node-type-image', 'seed-model-hy-image', 'seed-res-hy-1024', NULL, 5, true, now(), now()),
  ('seed-pricing-hy-img-2048', 'node-type-image', 'seed-model-hy-image', 'seed-res-hy-2048', NULL, 10, true, now(), now()),
  ('seed-pricing-hy-video-5', 'node-type-video', 'seed-model-hy-video', NULL, 'seed-dur-5', 10, true, now(), now()),
  ('seed-pricing-hy-video-10', 'node-type-video', 'seed-model-hy-video', NULL, 'seed-dur-10', 18, true, now(), now()),
  ('seed-pricing-hy-video-15', 'node-type-video', 'seed-model-hy-video', NULL, 'seed-dur-15', 25, true, now(), now())
ON CONFLICT DO NOTHING;   -- 冲突目标=pricing_rule_natural_key（本文件先建）

-- ⑥ kind 级规则（Z5：modelId IS NULL——编辑 4 kind；承接 CREDIT_COST_PER_EDIT 旧值 1；multiImageGen 不建——Z37）
INSERT INTO "PricingRule" ("id", "nodeTypeId", "modelId", "resolutionId", "durationId", "creditCost", "active", "createdAt", "updatedAt")
SELECT 'seed-pricing-kind-' || k."key", k."id", NULL, NULL, NULL, 1, true, now(), now()
FROM "NodeType" k WHERE k."key" IN ('outpaint','erase','redraw','lighting')
ON CONFLICT DO NOTHING;

-- ====== Y0b-2 T1（squash 终态追加）：心跳/deadline/idemKey+幂等键+索引集+台账触发器 ======
-- AlterTable（Z68/Z83/Z82/Z79/Z69/Z100）
ALTER TABLE "GenerationIntent" ADD COLUMN     "heartbeatAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "deadlineAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "idemKey" TEXT NOT NULL,
ADD COLUMN     "gestureKey" TEXT,
ADD COLUMN     "providerTaskId" TEXT;

-- AlterTable
ALTER TABLE "TeamCreditTransaction" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex（进 datamodel 的三件——Z107 普通唯一/复合）
CREATE UNIQUE INDEX "GenerationIntent_idemKey_key" ON "GenerationIntent"("idemKey");

CREATE UNIQUE INDEX "TeamCreditTransaction_idempotencyKey_key" ON "TeamCreditTransaction"("idempotencyKey");

CREATE INDEX "GenerationIntent_projectId_nodeId_status_createdAt_idx" ON "GenerationIntent"("projectId", "nodeId", "status", "createdAt");

-- CreateIndex（保持 partial 的四件——migration-SQL-only 不进 datamodel：谓词与 WHERE 严格匹配防计划器弃用+diff 词汇外零棘轮）
CREATE INDEX "GenerationIntent_running_deadline_idx" ON "GenerationIntent"("deadlineAt") WHERE "status" = 'RUNNING';

CREATE INDEX "GenerationIntent_running_heartbeat_idx" ON "GenerationIntent"("heartbeatAt") WHERE "status" = 'RUNNING';

CREATE INDEX "GenerationIntent_frozen_user_idx" ON "GenerationIntent"("teamId", "userId") WHERE "reservedCredits" > 0;

CREATE INDEX "TeamCreditTransaction_settle_user_month_idx" ON "TeamCreditTransaction"("teamId", "operatorUserId", "createdAt") WHERE "type" IN ('settle', 'refund');

-- 台账唯一写入口=DB 触发器（Z51/Z89——跨进程/raw/未来调用者结构性拦截；通行证=SET LOCAL app.ledger_tx）
CREATE OR REPLACE FUNCTION ledger_guard() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.ledger_tx', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'LEDGER_SINGLE_WRITER: % 写操作必须经 CreditLedgerService 事务（SET LOCAL app.ledger_tx）', TG_TABLE_NAME;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER team_credit_transaction_guard BEFORE INSERT OR UPDATE OR DELETE ON "TeamCreditTransaction"
  FOR EACH ROW EXECUTE FUNCTION ledger_guard();

CREATE TRIGGER team_balance_guard BEFORE INSERT OR UPDATE OR DELETE ON "TeamBalance"
  FOR EACH ROW EXECUTE FUNCTION ledger_guard();
