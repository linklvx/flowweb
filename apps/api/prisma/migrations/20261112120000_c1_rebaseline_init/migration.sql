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
CREATE TYPE "TeamStatus" AS ENUM ('ACTIVE', 'DISBANDED', 'DISBANDING');

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
CREATE TYPE "MaintenanceStage" AS ENUM ('REQUESTED', 'FREEZING', 'DRAINING', 'DRAINED', 'EXPORTING', 'REBUILDING', 'SWITCHING', 'VERIFYING', 'COMPLETED', 'FAILED', 'ABORTED');

-- CreateEnum
CREATE TYPE "VideoWorkStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "IntentStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'VOIDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ArtifactState" AS ENUM ('none', 'materializing', 'stored', 'failed');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "ProbeState" AS ENUM ('pending', 'running', 'done', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "ProjectionState" AS ENUM ('pending', 'projecting', 'projected', 'orphaned', 'superseded', 'dead');

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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

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
    "accessTokenExpiresAt" TIMESTAMPTZ(3),
    "refreshTokenExpiresAt" TIMESTAMPTZ(3),
    "scope" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "teamId" TEXT NOT NULL,
    "lifecycleState" TEXT NOT NULL DEFAULT 'ACTIVE',
    "origin" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CanvasProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "parentId" TEXT,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

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
    "apiModelName" TEXT,
    "providerLabel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AIModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelResolution" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelDuration" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

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
    "size" BIGINT NOT NULL,
    "projectId" TEXT,
    "nodeId" TEXT,
    "taskId" TEXT,
    "status" "MediaStatus" NOT NULL DEFAULT 'pending',
    "type" TEXT NOT NULL,
    "metadata" JSONB,
    "sourceUrl" TEXT,
    "sourceUrlExpiresAt" TIMESTAMPTZ(3),
    "processingLeaseUntil" TIMESTAMPTZ(3),
    "processingAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextMaterializeAt" TIMESTAMPTZ(3),
    "probeState" "ProbeState" NOT NULL DEFAULT 'pending',
    "probeAttempts" INTEGER NOT NULL DEFAULT 0,
    "probeError" VARCHAR(512),
    "probeFailureKind" TEXT,
    "probeLeaseUntil" TIMESTAMPTZ(3),
    "probeRunId" TEXT,
    "nextProbeAt" TIMESTAMPTZ(3),
    "probedAt" TIMESTAMPTZ(3),
    "factVersion" BIGINT NOT NULL DEFAULT 0,
    "naturalWidth" INTEGER,
    "naturalHeight" INTEGER,
    "naturalRotation" INTEGER,
    "naturalSource" TEXT,
    "sniffedMimeType" TEXT,
    "pendingExpiresAt" TIMESTAMPTZ(3),
    "clientUploadId" TEXT,
    "sourceRegistrationKey" TEXT,
    "sourceIntentRowId" TEXT,
    "sourceExecSeq" BIGINT,
    "artifactIndex" INTEGER NOT NULL DEFAULT 0,
    "objectKey" TEXT,
    "objectSha256" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),
    "folderId" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "thumbnailKey" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "deletionState" TEXT NOT NULL DEFAULT 'ACTIVE',
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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_banner" (
    "id" TEXT NOT NULL DEFAULT 'subscription-banner-singleton',
    "title" VARCHAR(64) NOT NULL,
    "subtitle" VARCHAR(200) NOT NULL,
    "backgroundImageUrl" VARCHAR(500),
    "backgroundImageKey" VARCHAR(255),
    "countdownEndAt" TIMESTAMPTZ(3),
    "autoExtend" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

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
    "subscribedAt" TIMESTAMPTZ(3) NOT NULL,
    "currentPeriodStart" TIMESTAMPTZ(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMPTZ(3) NOT NULL,
    "nextGrantDate" TIMESTAMPTZ(3) NOT NULL,
    "grantCount" INTEGER NOT NULL DEFAULT 1,
    "previousSubId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

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
    "paidAt" TIMESTAMPTZ(3),
    "expiredAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "delayCloseJobId" TEXT,
    "notifySummary" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "TeamStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
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
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamBalance" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "subscriptionCredits" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

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
    "balanceDelta" INTEGER NOT NULL,
    "frozenDelta" INTEGER NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reversesId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeamPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSubscription" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "TeamSubscriptionStatus" NOT NULL DEFAULT 'active',
    "paidAmount" INTEGER NOT NULL,
    "currentPeriodStart" TIMESTAMPTZ(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

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
    "paidAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeamRechargeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamJoinRequest" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "decidedBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasDoc" (
    "projectId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "schemaVersion" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "vacuumEpoch" INTEGER NOT NULL DEFAULT 0,
    "currentSnapshotRev" BIGINT NOT NULL DEFAULT 0,
    "walCheckpointSeq" BIGINT NOT NULL DEFAULT 0,
    "pgSeq" BIGINT NOT NULL DEFAULT 0,
    "purgeBelowSeq" BIGINT,
    "maintenanceId" TEXT,
    "mediaBindingSeq" BIGINT NOT NULL DEFAULT 0,
    "bindingsDirty" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CanvasDoc_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "SystemHistory" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "historyId" TEXT NOT NULL,
    "epochStartedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SystemHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuntimeFeedCursor" (
    "projectId" TEXT NOT NULL,
    "lastSeq" BIGINT NOT NULL DEFAULT 0,
    "minRetainedSeq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "RuntimeFeedCursor_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "CanvasDocSnapshot" (
    "projectId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "snapshotRev" BIGINT NOT NULL,
    "stateSeq" BIGINT NOT NULL,
    "state" BYTEA NOT NULL,
    "stateHash" CHAR(64) NOT NULL,
    "vacuumEpoch" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanvasDocSnapshot_pkey" PRIMARY KEY ("projectId","generation","snapshotRev")
);

-- CreateTable
CREATE TABLE "DocAuditEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceOperation" (
    "maintenanceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" "MaintenanceStage" NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "sourceGeneration" INTEGER NOT NULL,
    "targetGeneration" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "cutoffPgSeq" BIGINT NOT NULL,
    "drainedAt" TIMESTAMPTZ(3),
    "error" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "leaseOwner" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MaintenanceOperation_pkey" PRIMARY KEY ("maintenanceId")
);

-- CreateTable
CREATE TABLE "ExecutionRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "historyId" TEXT NOT NULL,
    "docSeq" BIGINT NOT NULL,
    "frozenDocSeq" BIGINT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ADMITTED',
    "reservedCredit" INTEGER NOT NULL DEFAULT 0,
    "totalCredit" INTEGER NOT NULL DEFAULT 0,
    "planHash" CHAR(64) NOT NULL,
    "inputHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ExecutionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionNodePlan" (
    "requestId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "model" TEXT,
    "resolution" TEXT,
    "styleId" TEXT,
    "pricingRuleId" TEXT,
    "creditCost" INTEGER NOT NULL DEFAULT 0,
    "reservedCredit" INTEGER NOT NULL DEFAULT 0,
    "paramsHash" CHAR(64) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "generationIntentId" TEXT,
    "execSeq" BIGINT,

    CONSTRAINT "ExecutionNodePlan_pkey" PRIMARY KEY ("requestId","nodeId")
);

-- CreateTable
CREATE TABLE "ExecutionInput" (
    "requestId" TEXT NOT NULL,
    "encoding" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "rawBytes" INTEGER NOT NULL,
    "storedBytes" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionInput_pkey" PRIMARY KEY ("requestId")
);

-- CreateTable
CREATE TABLE "RuntimeEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "feedSeq" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "docSeq" BIGINT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuntimeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeExecution" (
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "execSeq" BIGINT NOT NULL,
    "nodeVersion" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "errorCode" TEXT,
    "artifactRev" INTEGER,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NodeExecution_pkey" PRIMARY KEY ("projectId","nodeId")
);

-- CreateTable
CREATE TABLE "ExecutionOutbox" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "businessKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "claimOwner" TEXT,
    "claimUntilMs" BIGINT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ExecutionOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterializeRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "expectedExecSeq" BIGINT NOT NULL,
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterializeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundObligation" (
    "id" TEXT NOT NULL,
    "intentRowId" TEXT NOT NULL,
    "execSeq" BIGINT NOT NULL,
    "reversesId" TEXT NOT NULL,
    "creditAmount" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RefundObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageReservation" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "upperBoundBytes" BIGINT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StorageReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectManifest" (
    "id" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "claimOwner" TEXT,
    "claimUntil" BIGINT,
    "state" TEXT NOT NULL DEFAULT 'LIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ObjectManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeLifecycle" (
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "lifecycleSeq" BIGINT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "state" TEXT NOT NULL,
    "walSeq" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeLifecycle_pkey" PRIMARY KEY ("projectId","nodeId","lifecycleSeq")
);

-- CreateTable
CREATE TABLE "DeliveryFence" (
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "fenceSeq" BIGINT NOT NULL,
    "state" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeliveryFence_pkey" PRIMARY KEY ("projectId","nodeId")
);

-- CreateTable
CREATE TABLE "LifecycleObligation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "walSeq" BIGINT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimOwner" TEXT,
    "claimUntilMs" BIGINT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LifecycleObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasDocUpdate" (
    "projectId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "seq" BIGINT NOT NULL,
    "firstWalSeq" BIGINT NOT NULL,
    "frameCount" INTEGER NOT NULL,
    "updateHash" CHAR(64) NOT NULL,
    "actorRanges" JSONB,
    "update" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanvasDocUpdate_pkey" PRIMARY KEY ("projectId","generation","seq")
);

-- CreateTable
CREATE TABLE "CanvasDocCoalesced" (
    "projectId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "seq" BIGINT NOT NULL,
    "updateHash" CHAR(64) NOT NULL,
    "sourceSeq" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanvasDocCoalesced_pkey" PRIMARY KEY ("projectId","generation","seq")
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
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VideoWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoCategory" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VideoCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoTag" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VideoTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoWorkSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "carouselEnabled" BOOLEAN NOT NULL DEFAULT true,
    "carouselScope" TEXT NOT NULL DEFAULT 'all',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VideoWorkSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Style_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleRecentUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleRecentUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationIntent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "paramsHash" TEXT NOT NULL,
    "status" "IntentStatus" NOT NULL DEFAULT 'RUNNING',
    "jobId" TEXT,
    "pricingRuleId" TEXT,
    "modelId" TEXT,
    "resolutionId" TEXT,
    "durationId" TEXT,
    "creditCost" INTEGER NOT NULL,
    "creditsConsumed" INTEGER NOT NULL DEFAULT 0,
    "reservedCredits" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "resultRef" TEXT,
    "error" TEXT,
    "heartbeatAt" TIMESTAMPTZ(3) NOT NULL,
    "deadlineAt" TIMESTAMPTZ(3) NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "idemKey" TEXT NOT NULL,
    "gestureKey" TEXT,
    "traceId" TEXT,
    "providerTaskId" TEXT,
    "execSeq" BIGINT NOT NULL,
    "reservedExecSeq" BIGINT,
    "execProjectedExecSeq" BIGINT,
    "resultText" TEXT,
    "claimArtifactRev" INTEGER,
    "providerRequestId" TEXT,
    "executionRequestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "GenerationIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeArtifact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'primary',
    "targetField" TEXT NOT NULL,
    "targetItemId" TEXT NOT NULL DEFAULT '',
    "mediaId" TEXT,
    "resultText" TEXT,
    "source" TEXT NOT NULL DEFAULT 'generated',
    "sourceIntentRowId" TEXT,
    "sourceExecSeq" BIGINT,
    "artifactIndex" INTEGER NOT NULL DEFAULT 0,
    "state" "ArtifactState" NOT NULL DEFAULT 'none',
    "rev" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NodeArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtifactProjection" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "artifactRev" INTEGER NOT NULL,
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "targetField" TEXT NOT NULL,
    "targetItemId" TEXT NOT NULL DEFAULT '',
    "mediaId" TEXT,
    "resultText" TEXT,
    "state" "ProjectionState" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMPTZ(3),
    "runId" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" VARCHAR(512),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ArtifactProjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaBinding" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'primary',
    "targetField" TEXT NOT NULL DEFAULT 'fileId',
    "targetItemId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaFact" (
    "mediaId" TEXT NOT NULL,
    "factType" TEXT NOT NULL,
    "factVersion" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MediaFact_pkey" PRIMARY KEY ("mediaId","factType")
);

-- CreateTable
CREATE TABLE "ProjectionBackfillState" (
    "projectId" TEXT NOT NULL,
    "backfillEpoch" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "verifiedSeq" BIGINT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProjectionBackfillState_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "ReconcileAction" (
    "id" TEXT NOT NULL,
    "intentRowId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "traceId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconcileAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollabJobCursor" (
    "job" TEXT NOT NULL,
    "lastKey" TEXT,
    "lastGap" JSONB,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CollabJobCursor_pkey" PRIMARY KEY ("job")
);

-- CreateTable
CREATE TABLE "ProjectErasureRun" (
    "erasureId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "parentRunId" TEXT,
    "teamId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "stage" TEXT,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimOwner" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "heartbeatAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "manifestPath" TEXT,
    "manifestSha256" CHAR(64),
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProjectErasureRun_pkey" PRIMARY KEY ("erasureId")
);

-- CreateTable
CREATE TABLE "CollabOpsGate" (
    "gate" TEXT NOT NULL,
    "projectId" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "version" BIGINT NOT NULL DEFAULT 0,
    "frozenAt" TIMESTAMPTZ(3),
    "frozenBy" TEXT,
    "unfrozenAt" TIMESTAMPTZ(3),
    "reason" TEXT,

    CONSTRAINT "CollabOpsGate_pkey" PRIMARY KEY ("gate","projectId")
);

-- CreateTable
CREATE TABLE "CanaryPin" (
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CAPTURING',
    "generation" INTEGER NOT NULL,
    "snapshotRev" BIGINT NOT NULL,
    "stateSeq" BIGINT NOT NULL,
    "pgSeqAt" BIGINT NOT NULL,
    "contentHash" CHAR(64),
    "semanticDigest" CHAR(64),
    "hashSkipped" BOOLEAN NOT NULL DEFAULT false,
    "hashVersion" INTEGER NOT NULL,
    "stateVector" BYTEA,
    "leaseUntil" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CanaryPin_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "CollabCanaryCursor" (
    "projectId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "lastCheckedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastResult" TEXT NOT NULL,
    "nextDueAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CollabCanaryCursor_pkey" PRIMARY KEY ("projectId")
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
CREATE INDEX "CanvasProject_lifecycleState_idx" ON "CanvasProject"("lifecycleState");

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
CREATE INDEX "Media_status_nextMaterializeAt_idx" ON "Media"("status", "nextMaterializeAt");

-- CreateIndex
CREATE INDEX "Media_probeState_nextProbeAt_idx" ON "Media"("probeState", "nextProbeAt");

-- CreateIndex
CREATE INDEX "Media_status_pendingExpiresAt_idx" ON "Media"("status", "pendingExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Media_bucket_key_key" ON "Media"("bucket", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Media_teamId_clientUploadId_key" ON "Media"("teamId", "clientUploadId");

-- CreateIndex
CREATE UNIQUE INDEX "Media_sourceRegistrationKey_key" ON "Media"("sourceRegistrationKey");

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
CREATE UNIQUE INDEX "TeamCreditTransaction_reversesId_key" ON "TeamCreditTransaction"("reversesId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamCreditTransaction_idempotencyKey_key" ON "TeamCreditTransaction"("idempotencyKey");

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
CREATE INDEX "DocAuditEvent_projectId_createdAt_idx" ON "DocAuditEvent"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceOperation_idempotencyKey_key" ON "MaintenanceOperation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MaintenanceOperation_projectId_status_idx" ON "MaintenanceOperation"("projectId", "status");

-- CreateIndex
CREATE INDEX "ExecutionRequest_projectId_state_expiresAt_idx" ON "ExecutionRequest"("projectId", "state", "expiresAt");

-- CreateIndex
CREATE INDEX "ExecutionRequest_teamId_state_idx" ON "ExecutionRequest"("teamId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionRequest_projectId_requestId_key" ON "ExecutionRequest"("projectId", "requestId");

-- CreateIndex
CREATE INDEX "ExecutionNodePlan_requestId_order_idx" ON "ExecutionNodePlan"("requestId", "order");

-- CreateIndex
CREATE INDEX "ExecutionInput_expiresAt_idx" ON "ExecutionInput"("expiresAt");

-- CreateIndex
CREATE INDEX "RuntimeEvent_projectId_generation_feedSeq_idx" ON "RuntimeEvent"("projectId", "generation", "feedSeq");

-- CreateIndex
CREATE INDEX "RuntimeEvent_projectId_createdAt_idx" ON "RuntimeEvent"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RuntimeEvent_projectId_feedSeq_key" ON "RuntimeEvent"("projectId", "feedSeq");

-- CreateIndex
CREATE INDEX "ExecutionOutbox_projectId_state_claimUntilMs_idx" ON "ExecutionOutbox"("projectId", "state", "claimUntilMs");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionOutbox_projectId_generation_businessKey_key" ON "ExecutionOutbox"("projectId", "generation", "businessKey");

-- CreateIndex
CREATE INDEX "MaterializeRun_projectId_state_idx" ON "MaterializeRun"("projectId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "RefundObligation_intentRowId_execSeq_key" ON "RefundObligation"("intentRowId", "execSeq");

-- CreateIndex
CREATE UNIQUE INDEX "StorageReservation_mediaId_key" ON "StorageReservation"("mediaId");

-- CreateIndex
CREATE INDEX "StorageReservation_teamId_state_idx" ON "StorageReservation"("teamId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectManifest_objectKey_key" ON "ObjectManifest"("objectKey");

-- CreateIndex
CREATE INDEX "ObjectManifest_state_claimUntil_idx" ON "ObjectManifest"("state", "claimUntil");

-- CreateIndex
CREATE INDEX "NodeLifecycle_projectId_nodeId_isCurrent_idx" ON "NodeLifecycle"("projectId", "nodeId", "isCurrent");

-- CreateIndex
CREATE INDEX "LifecycleObligation_projectId_state_claimUntilMs_idx" ON "LifecycleObligation"("projectId", "state", "claimUntilMs");

-- CreateIndex
CREATE UNIQUE INDEX "LifecycleObligation_projectId_nodeId_kind_walSeq_key" ON "LifecycleObligation"("projectId", "nodeId", "kind", "walSeq");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasDocUpdate_projectId_generation_updateHash_key" ON "CanvasDocUpdate"("projectId", "generation", "updateHash");

-- CreateIndex
CREATE INDEX "CanvasDocCoalesced_projectId_generation_updateHash_idx" ON "CanvasDocCoalesced"("projectId", "generation", "updateHash");

-- CreateIndex
CREATE INDEX "VideoWork_status_sortOrder_publishedAt_idx" ON "VideoWork"("status", "sortOrder", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "VideoWork_categoryId_status_idx" ON "VideoWork"("categoryId", "status");

-- CreateIndex
CREATE INDEX "VideoWork_videoMediaId_idx" ON "VideoWork"("videoMediaId");

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
CREATE UNIQUE INDEX "GenerationIntent_idemKey_key" ON "GenerationIntent"("idemKey");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationIntent_execSeq_key" ON "GenerationIntent"("execSeq");

-- CreateIndex
CREATE INDEX "GenerationIntent_projectId_nodeId_status_idx" ON "GenerationIntent"("projectId", "nodeId", "status");

-- CreateIndex
CREATE INDEX "GenerationIntent_projectId_nodeId_status_createdAt_idx" ON "GenerationIntent"("projectId", "nodeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationIntent_teamId_idx" ON "GenerationIntent"("teamId");

-- CreateIndex
CREATE INDEX "GenerationIntent_jobId_idx" ON "GenerationIntent"("jobId");

-- CreateIndex
CREATE INDEX "GenerationIntent_traceId_idx" ON "GenerationIntent"("traceId");

-- CreateIndex
CREATE INDEX "GenerationIntent_status_completedAt_idx" ON "GenerationIntent"("status", "completedAt");

-- CreateIndex
CREATE INDEX "GenerationIntent_status_execProjectedExecSeq_idx" ON "GenerationIntent"("status", "execProjectedExecSeq");

-- CreateIndex
CREATE INDEX "GenerationIntent_providerTaskId_idx" ON "GenerationIntent"("providerTaskId");

-- CreateIndex
CREATE INDEX "GenerationIntent_executionRequestId_idx" ON "GenerationIntent"("executionRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationIntent_projectId_intentId_key" ON "GenerationIntent"("projectId", "intentId");

-- CreateIndex
CREATE INDEX "NodeArtifact_mediaId_idx" ON "NodeArtifact"("mediaId");

-- CreateIndex
CREATE INDEX "NodeArtifact_teamId_state_idx" ON "NodeArtifact"("teamId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "NodeArtifact_projectId_nodeId_role_targetField_targetItemId_key" ON "NodeArtifact"("projectId", "nodeId", "role", "targetField", "targetItemId");

-- CreateIndex
CREATE UNIQUE INDEX "NodeArtifact_sourceIntentRowId_sourceExecSeq_artifactIndex_key" ON "NodeArtifact"("sourceIntentRowId", "sourceExecSeq", "artifactIndex");

-- CreateIndex
CREATE INDEX "ArtifactProjection_state_nextAttemptAt_idx" ON "ArtifactProjection"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ArtifactProjection_artifactId_idx" ON "ArtifactProjection"("artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactProjection_artifactId_artifactRev_key" ON "ArtifactProjection"("artifactId", "artifactRev");

-- CreateIndex
CREATE INDEX "MediaBinding_mediaId_idx" ON "MediaBinding"("mediaId");

-- CreateIndex
CREATE INDEX "MediaBinding_projectId_nodeId_idx" ON "MediaBinding"("projectId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaBinding_projectId_nodeId_role_targetField_targetItemId_key" ON "MediaBinding"("projectId", "nodeId", "role", "targetField", "targetItemId");

-- CreateIndex
CREATE INDEX "ReconcileAction_intentRowId_idx" ON "ReconcileAction"("intentRowId");

-- CreateIndex
CREATE INDEX "ReconcileAction_createdAt_idx" ON "ReconcileAction"("createdAt");

-- CreateIndex
CREATE INDEX "ProjectErasureRun_state_updatedAt_idx" ON "ProjectErasureRun"("state", "updatedAt");

-- CreateIndex
CREATE INDEX "ProjectErasureRun_scopeType_scopeId_idx" ON "ProjectErasureRun"("scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "ProjectErasureRun_parentRunId_idx" ON "ProjectErasureRun"("parentRunId");

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
ALTER TABLE "CanvasDocSnapshot" ADD CONSTRAINT "CanvasDocSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "GenerationIntent" ADD CONSTRAINT "GenerationIntent_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "PricingRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaBinding" ADD CONSTRAINT "MediaBinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFact" ADD CONSTRAINT "MediaFact_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 以下为 Prisma diff 不可见的 raw 对象（C1-1 rebaseline——旧链 census 逐字搬运；本 init 为唯一真源）
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- 1. 执行代际全局单调序列（execSeq nextval 两处=claim/rearm 显式取号；列无默认——20261021060000 裁定）
CREATE SEQUENCE "exec_seq" AS BIGINT;

-- 2. partial unique / partial index / NULLS NOT DISTINCT（Prisma 不可表达——旧链原文）
CREATE UNIQUE INDEX "team_owner_default_unique" ON "Team"("ownerId") WHERE "isDefault" = true;

CREATE UNIQUE INDEX "folder_team_root_name_unique" ON "Folder"("teamId", "name") WHERE "parentId" IS NULL;

CREATE UNIQUE INDEX "folder_team_parent_name_unique" ON "Folder"("teamId", "parentId", "name") WHERE "parentId" IS NOT NULL;

CREATE UNIQUE INDEX "material_folder_team_root_name_unique" ON "MaterialFolder"("teamId", "name") WHERE "parentId" IS NULL;

CREATE UNIQUE INDEX "material_folder_team_parent_name_unique" ON "MaterialFolder"("teamId", "parentId", "name") WHERE "parentId" IS NOT NULL;

CREATE UNIQUE INDEX "user_subscription_one_active" ON "UserSubscription"("userId") WHERE status = 'active';

CREATE UNIQUE INDEX "team_subscription_one_active" ON "TeamSubscription"("teamId") WHERE status = 'active';

CREATE UNIQUE INDEX "announcement_single_active" ON "Announcement"("active") WHERE "active";

CREATE UNIQUE INDEX "generation_intent_active_node_unique"
ON "GenerationIntent"("projectId", "nodeId")
WHERE status = 'RUNNING';

CREATE UNIQUE INDEX "pricing_rule_natural_key" ON "PricingRule"("nodeTypeId", "modelId", "resolutionId", "durationId") NULLS NOT DISTINCT;

CREATE UNIQUE INDEX "money_in_once" ON "TeamCreditTransaction"("type", "referenceId", "creditType")
  WHERE "type" IN ('recharge', 'subscription_grant', 'expire_clear', 'register_grant');

CREATE INDEX "generation_intent_frozen_partial" ON "GenerationIntent"("teamId") WHERE "reservedCredits" > 0;

CREATE INDEX "ledger_reserve_open_partial" ON "TeamCreditTransaction"("createdAt") WHERE type = 'reserve';

CREATE INDEX "GenerationIntent_running_deadline_idx" ON "GenerationIntent"("deadlineAt") WHERE "status" = 'RUNNING';

CREATE INDEX "GenerationIntent_running_heartbeat_idx" ON "GenerationIntent"("heartbeatAt") WHERE "status" = 'RUNNING';

CREATE INDEX "GenerationIntent_frozen_user_idx" ON "GenerationIntent"("teamId", "userId") WHERE "reservedCredits" > 0;

CREATE INDEX "TeamCreditTransaction_settle_user_month_idx" ON "TeamCreditTransaction"("teamId", "operatorUserId", "createdAt") WHERE "type" IN ('settle', 'refund');

-- 活跃维护 partial unique：一项目一活跃（stage 不在三终态）
CREATE UNIQUE INDEX "maintenance_operation_one_active_idx" ON "MaintenanceOperation" ("projectId")
WHERE "stage" NOT IN ('COMPLETED'::"MaintenanceStage", 'FAILED'::"MaintenanceStage", 'ABORTED'::"MaintenanceStage");

-- NodeLifecycle 当前行 partial unique（历史行保留）
CREATE UNIQUE INDEX "NodeLifecycle_projectId_nodeId_current_key" ON "NodeLifecycle"("projectId", "nodeId") WHERE "isCurrent";

-- 擦除 run active 态 scope 唯一（DONE/FAILED 后允许新 run；dryRun 不占真实唯一）
CREATE UNIQUE INDEX "project_erasure_active_uq" ON "ProjectErasureRun"("scopeType","scopeId")
WHERE state IN ('PENDING','RUNNING','DRAINING','WAITING_CHILDREN','PURGING_DB','PURGING_OBJECTS','PURGING_CACHE','VERIFYING')
  AND "dryRun" = false;

-- C1-1 评估采纳（C3a-8 质量评审移交）：binding backfill 枚举/COUNT 部分索引——谓词逐字对齐
-- projection-backfill.runner.ts enumeratePage/countCandidates 两查询（index-only scan：keyset 分页
-- ORDER BY "projectId" + COUNT）；稳态行（两条件皆假）不入索引，日常 append 的 HOT 不受影响
-- （旧/新元组皆不满足谓词=无索引项变动）。
CREATE INDEX "canvas_doc_binding_backfill_partial" ON "CanvasDoc"("projectId")
WHERE "bindingsDirty" = true OR "mediaBindingSeq" < "pgSeq";

-- 3. CHECK 约束（Prisma 无 CHECK 语法——旧链原文）
ALTER TABLE "TeamBalance" ADD CONSTRAINT "balance_non_negative" CHECK ("credits" >= 0 AND "subscriptionCredits" >= 0);

ALTER TABLE "PricingRule" ADD CONSTRAINT "pricing_credit_cost_non_negative" CHECK ("creditCost" >= 0);

ALTER TABLE "GenerationIntent" ADD CONSTRAINT "intent_credit_cost_non_negative" CHECK ("creditCost" >= 0 AND "reservedCredits" >= 0 AND "creditsConsumed" >= 0);

ALTER TABLE "TeamCreditTransaction" ADD CONSTRAINT "ledger_amount_derived"
  CHECK ("amount" = CASE WHEN "balanceDelta" <> 0 THEN "balanceDelta" ELSE "frozenDelta" END);

ALTER TABLE "TeamCreditTransaction" ADD CONSTRAINT "money_in_reference_required"
  CHECK ("type" NOT IN ('recharge', 'subscription_grant', 'expire_clear', 'register_grant') OR "referenceId" IS NOT NULL);

ALTER TABLE "CanvasDoc" ADD CONSTRAINT "canvas_doc_watermark_order_check" CHECK ("pgSeq" <= "walCheckpointSeq");

ALTER TABLE "SystemHistory" ADD CONSTRAINT "system_history_single_row_check" CHECK ("id" = 1);

ALTER TABLE "CanvasDocSnapshot" ADD CONSTRAINT "canvas_doc_snapshot_state_size_check" CHECK (octet_length("state") <= 16777216);

ALTER TABLE "CanvasDocUpdate"
  ADD CONSTRAINT "canvas_doc_update_payload_le_16mib" CHECK (octet_length("update") <= 16777216),
  ADD CONSTRAINT "canvas_doc_update_seq_ge_first_wal_seq" CHECK ("seq" >= "firstWalSeq"),
  ADD CONSTRAINT "canvas_doc_update_frame_count_pos" CHECK ("frameCount" > 0);

ALTER TABLE "NodeArtifact" ADD CONSTRAINT "node_artifact_role_domain" CHECK ("role" IN ('primary'));

ALTER TABLE "NodeArtifact" ADD CONSTRAINT "node_artifact_target_field_domain" CHECK ("targetField" IN ('fileId', 'result'));

ALTER TABLE "ArtifactProjection" ADD CONSTRAINT "artifact_projection_target_field_domain" CHECK ("targetField" IN ('fileId', 'result'));

ALTER TABLE "MediaBinding" ADD CONSTRAINT "media_binding_target_field_domain" CHECK ("targetField" IN ('fileId', 'referenceImage', 'referenceVideo', 'referenceAudio', 'images', 'allImages', 'trimmedFileId', 'videoFileId', 'audioFileId'));

ALTER TABLE "MediaFact" ADD CONSTRAINT "MediaFact_factType_check" CHECK ("factType" IN ('state','natural'));

ALTER TABLE "Media" ADD CONSTRAINT "Media_deletionState_check" CHECK ("deletionState" IN ('ACTIVE','DELETING'));

ALTER TABLE "ProjectionBackfillState" ADD CONSTRAINT "ProjectionBackfillState_state_check" CHECK ("state" IN ('PENDING','RUNNING','DONE','FAILED'));

-- 4. 台账唯一写入口=DB 触发器（Z51/Z89——通行证=SET LOCAL app.ledger_tx）
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

-- 5. updatedAt 触发器（spec §3.3 C1-2）：skip_updated_at 首行 GUC 通道（restore 运维）；
--    INSERT 仅 NULL 设（保 restore/backfill/测试显式历史值）；UPDATE 始终 now()
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.skip_updated_at', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."updatedAt" IS NULL THEN
      NEW."updatedAt" = now();
    END IF;
  ELSE
    NEW."updatedAt" = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "set_updated_at_User" BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_Account" BEFORE INSERT OR UPDATE ON "Account" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_Session" BEFORE INSERT OR UPDATE ON "Session" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_Verification" BEFORE INSERT OR UPDATE ON "Verification" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_Announcement" BEFORE INSERT OR UPDATE ON "Announcement" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_ContentCard" BEFORE INSERT OR UPDATE ON "ContentCard" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_HomeBanner" BEFORE INSERT OR UPDATE ON "HomeBanner" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_Template" BEFORE INSERT OR UPDATE ON "Template" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_CanvasProject" BEFORE INSERT OR UPDATE ON "CanvasProject" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_Folder" BEFORE INSERT OR UPDATE ON "Folder" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_NodeType" BEFORE INSERT OR UPDATE ON "NodeType" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_AIModel" BEFORE INSERT OR UPDATE ON "AIModel" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_PricingRule" BEFORE INSERT OR UPDATE ON "PricingRule" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_Media" BEFORE INSERT OR UPDATE ON "Media" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_MaterialFolder" BEFORE INSERT OR UPDATE ON "MaterialFolder" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_VideoProject" BEFORE INSERT OR UPDATE ON "VideoProject" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_SubscriptionPlan" BEFORE INSERT OR UPDATE ON "SubscriptionPlan" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_subscription_banner" BEFORE INSERT OR UPDATE ON "subscription_banner" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_UserSubscription" BEFORE INSERT OR UPDATE ON "UserSubscription" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_SubscriptionOrder" BEFORE INSERT OR UPDATE ON "SubscriptionOrder" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_SystemSetting" BEFORE INSERT OR UPDATE ON "SystemSetting" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_Team" BEFORE INSERT OR UPDATE ON "Team" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_TeamBalance" BEFORE INSERT OR UPDATE ON "TeamBalance" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_TeamPlan" BEFORE INSERT OR UPDATE ON "TeamPlan" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_TeamSubscription" BEFORE INSERT OR UPDATE ON "TeamSubscription" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_TeamRechargeOrder" BEFORE INSERT OR UPDATE ON "TeamRechargeOrder" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_CanvasDoc" BEFORE INSERT OR UPDATE ON "CanvasDoc" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_SystemHistory" BEFORE INSERT OR UPDATE ON "SystemHistory" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_MaintenanceOperation" BEFORE INSERT OR UPDATE ON "MaintenanceOperation" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_ExecutionRequest" BEFORE INSERT OR UPDATE ON "ExecutionRequest" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_NodeExecution" BEFORE INSERT OR UPDATE ON "NodeExecution" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_ExecutionOutbox" BEFORE INSERT OR UPDATE ON "ExecutionOutbox" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_RefundObligation" BEFORE INSERT OR UPDATE ON "RefundObligation" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_StorageReservation" BEFORE INSERT OR UPDATE ON "StorageReservation" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_ObjectManifest" BEFORE INSERT OR UPDATE ON "ObjectManifest" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_DeliveryFence" BEFORE INSERT OR UPDATE ON "DeliveryFence" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_LifecycleObligation" BEFORE INSERT OR UPDATE ON "LifecycleObligation" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_VideoWork" BEFORE INSERT OR UPDATE ON "VideoWork" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_VideoCategory" BEFORE INSERT OR UPDATE ON "VideoCategory" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_VideoTag" BEFORE INSERT OR UPDATE ON "VideoTag" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_VideoWorkSetting" BEFORE INSERT OR UPDATE ON "VideoWorkSetting" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_Style" BEFORE INSERT OR UPDATE ON "Style" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_GenerationIntent" BEFORE INSERT OR UPDATE ON "GenerationIntent" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_NodeArtifact" BEFORE INSERT OR UPDATE ON "NodeArtifact" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_MediaFact" BEFORE INSERT OR UPDATE ON "MediaFact" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_ProjectionBackfillState" BEFORE INSERT OR UPDATE ON "ProjectionBackfillState" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_CollabJobCursor" BEFORE INSERT OR UPDATE ON "CollabJobCursor" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "set_updated_at_ProjectErasureRun" BEFORE INSERT OR UPDATE ON "ProjectErasureRun" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- 种子数据（旧链原文搬运——定价真源=迁移；seed.ts 对应段 upsert-by-id/key 幂等共存）
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ① 主链 NodeType（seed.ts 同名四键——id 用固定常量）
INSERT INTO "NodeType" ("id", "key", "name", "description", "active", "createdAt", "updatedAt") VALUES
  ('node-type-text', 'text', '文本生成', '文本Prompt输入与优化', true, now(), now()),
  ('node-type-image', 'image', '图片生成', '文生图、图生图', true, now(), now()),
  ('node-type-image-ext', 'imageExt', '图片扩展', '图片扩展节点', true, now(), now()),
  ('node-type-video', 'video', '视频生成', '文生视频、图生视频', true, now(), now())
ON CONFLICT ("key") DO NOTHING;

-- ② kind 级 NodeType（Z5——编辑 4 kind 的 modelId IS NULL 规则载体；multiImageGen 不建规则——Z37）
INSERT INTO "NodeType" ("id", "key", "name", "active", "createdAt", "updatedAt") VALUES
  ('node-type-outpaint', 'outpaint', '局部重绘（外扩）', true, now(), now()),
  ('node-type-erase', 'erase', '擦除', true, now(), now()),
  ('node-type-redraw', 'redraw', '局部重绘', true, now(), now()),
  ('node-type-lighting', 'lighting', '打光', true, now(), now())
ON CONFLICT ("key") DO NOTHING;

-- ③ AIModel（id=seed 固定常量；apiKey 迁移置 NULL——env 密钥由 seed.ts 补写）
INSERT INTO "AIModel" ("id", "nodeTypeId", "name", "provider", "apiModelName", "providerLabel", "apiUrl", "apiKey", "sortOrder", "recommended", "active", "createdAt", "updatedAt") VALUES
  ('seed-model-hy-image', 'node-type-image', 'HY-Image-V3.0', 'tencent', 'hy-image-v3.0', '腾讯混元', 'https://tokenhub.tencentmaas.com/v1/api/image', NULL, 0, true, true, now(), now()),
  ('seed-model-sdxl', 'node-type-image', 'Stable Diffusion XL', 'stability', NULL, 'Stability AI', 'https://api.stability.ai/v1/generation', NULL, 1, false, false, now(), now()),
  ('seed-model-dalle', 'node-type-image', 'DALL-E 3', 'openai', NULL, 'OpenAI', 'https://api.openai.com/v1/images/generations', NULL, 2, false, false, now(), now()),
  ('seed-model-gpt4', 'node-type-text', 'GPT-4o', 'openai', NULL, 'OpenAI', 'https://api.openai.com/v1/chat/completions', NULL, 1, false, false, now(), now()),
  ('seed-model-kimi', 'node-type-text', 'Kimi K2.6', 'moonshot', 'kimi-k2.6', 'Moonshot AI', 'https://api.moonshot.cn/v1', NULL, 2, true, true, now(), now()),
  ('seed-model-hy-video', 'node-type-video', 'HY-Video 1.5', 'tencent', 'hy-video-1.5', 'Tencent Maas', 'https://tokenhub.tencentmaas.com/v1/api/video', NULL, 1, true, true, now(), now())
ON CONFLICT ("id") DO NOTHING;

-- ④ 分辨率/时长（固定 id——resolver 归一化与覆盖度门禁的键集来源）
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

-- ⑤ 主链规则（text (model,null,null)、image (model,res,null)、video (model,null,dur)）
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

-- ⑥ kind 级规则（Z5：modelId IS NULL——编辑 4 kind；承接 CREDIT_COST_PER_EDIT 旧值 1）
INSERT INTO "PricingRule" ("id", "nodeTypeId", "modelId", "resolutionId", "durationId", "creditCost", "active", "createdAt", "updatedAt")
SELECT 'seed-pricing-kind-' || k."key", k."id", NULL, NULL, NULL, 1, true, now(), now()
FROM "NodeType" k WHERE k."key" IN ('outpaint','erase','redraw','lighting')
ON CONFLICT DO NOTHING;

-- ⑦ CollabLease 种子行（幂等）
INSERT INTO "CollabLease" ("scope", "owner", "epoch") VALUES ('primary', NULL, 0)
ON CONFLICT ("scope") DO NOTHING;

-- ⑧ SystemHistory 引导行（安装语义非运行时自动修复；启动校验 fail-closed）
INSERT INTO "SystemHistory" ("id", "historyId", "epochStartedAt", "updatedAt")
VALUES (1, gen_random_uuid()::text, now(), now())
ON CONFLICT DO NOTHING;

-- ⑨ CollabOpsGate 全局哨兵行（gate='compact', projectId=''——compact 两行校验常驻半边）
INSERT INTO "CollabOpsGate" ("gate", "projectId", "state") VALUES ('compact', '', 'OPEN') ON CONFLICT DO NOTHING;
