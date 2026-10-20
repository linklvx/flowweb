-- CreateEnum
CREATE TYPE "ArtifactState" AS ENUM ('none', 'materializing', 'stored', 'failed');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "ProbeState" AS ENUM ('pending', 'running', 'done', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "ProjectionState" AS ENUM ('pending', 'projecting', 'projected', 'orphaned', 'superseded', 'dead');

-- CreateEnum
CREATE TYPE "MediaFactState" AS ENUM ('pending', 'published', 'dead');

-- Y1b T2（Z18''-v13b）：全局单调执行代际序列——置于 GenerationIntent ALTER 之前
-- （execSeq 列 DEFAULT nextval 引用本序列，PG 在 ALTER 时即校验引用对象存在；
-- nextval 两处=claim/rearm 事务显式取号，列默认仅 createMany 兜底——裁定2）
CREATE SEQUENCE "exec_seq" AS BIGINT;

-- AlterTable
ALTER TABLE "CanvasDoc" ADD COLUMN     "schemaVersion" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "GenerationIntent" ADD COLUMN     "execProjectedExecSeq" BIGINT,
ADD COLUMN     "execSeq" BIGINT NOT NULL DEFAULT nextval('exec_seq'),
ADD COLUMN     "providerRequestId" TEXT,
ADD COLUMN     "reservedExecSeq" BIGINT,
ADD COLUMN     "resultText" TEXT;

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "clientUploadId" TEXT,
ADD COLUMN     "factVersion" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "nextMaterializeAt" TIMESTAMP(3),
ADD COLUMN     "nextProbeAt" TIMESTAMP(3),
ADD COLUMN     "pendingExpiresAt" TIMESTAMP(3),
ADD COLUMN     "probeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "probeError" VARCHAR(512),
ADD COLUMN     "probeFailureKind" TEXT,
ADD COLUMN     "probeLeaseUntil" TIMESTAMP(3),
ADD COLUMN     "probeRunId" TEXT,
ADD COLUMN     "probeState" "ProbeState" NOT NULL DEFAULT 'pending',
ADD COLUMN     "probedAt" TIMESTAMP(3),
ADD COLUMN     "processingAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "processingLeaseUntil" TIMESTAMP(3),
ADD COLUMN     "sourceRegistrationKey" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "sourceUrlExpiresAt" TIMESTAMP(3),
DROP COLUMN "status",
ADD COLUMN     "status" "MediaStatus" NOT NULL DEFAULT 'pending';

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "leaseUntil" TIMESTAMP(3),
    "runId" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectedAt" TIMESTAMP(3),

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaFactOutbox" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "factVersion" BIGINT NOT NULL,
    "factType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" "MediaFactState" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "MediaFactOutbox_pkey" PRIMARY KEY ("id")
);

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
CREATE INDEX "MediaFactOutbox_state_nextAttemptAt_idx" ON "MediaFactOutbox"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MediaFactOutbox_mediaId_idx" ON "MediaFactOutbox"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaFactOutbox_mediaId_projectId_factVersion_key" ON "MediaFactOutbox"("mediaId", "projectId", "factVersion");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationIntent_execSeq_key" ON "GenerationIntent"("execSeq");

-- CreateIndex
CREATE INDEX "GenerationIntent_status_execProjectedExecSeq_idx" ON "GenerationIntent"("status", "execProjectedExecSeq");

-- CreateIndex
CREATE INDEX "GenerationIntent_providerTaskId_idx" ON "GenerationIntent"("providerTaskId");

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

-- AddForeignKey
ALTER TABLE "MediaBinding" ADD CONSTRAINT "MediaBinding_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============ 以下为 Prisma diff 不可见的 raw 对象（canvas_doc_update_seq 同款模式） ============
-- （CREATE SEQUENCE "exec_seq" 已上移至 AlterTable 段之前——execSeq DEFAULT 引用需先行存在）

-- Y1b T2（v11.1 域约束白名单——Prisma 无 CHECK 语法，raw SQL）
ALTER TABLE "NodeArtifact" ADD CONSTRAINT "node_artifact_role_domain" CHECK ("role" IN ('primary'));
ALTER TABLE "NodeArtifact" ADD CONSTRAINT "node_artifact_target_field_domain" CHECK ("targetField" IN ('fileId', 'result'));
ALTER TABLE "ArtifactProjection" ADD CONSTRAINT "artifact_projection_target_field_domain" CHECK ("targetField" IN ('fileId', 'result'));
ALTER TABLE "MediaBinding" ADD CONSTRAINT "media_binding_target_field_domain" CHECK ("targetField" IN ('fileId', 'referenceImage', 'images', 'allImages', 'trimmedFileId', 'videoFileId', 'audioFileId'));
