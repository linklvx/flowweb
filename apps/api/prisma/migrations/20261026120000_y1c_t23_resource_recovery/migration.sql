-- Y1c T23（迁移三——P3 资源族）：StorageReservation（上传配额预留状态机）+ObjectManifest
-- （对象登记+delete-claim）+IntentStatus 枚举扩 'UNKNOWN'（text 链外呼结果不明档——reserve 保留
-- 不自动重呼）。迁移串行纪律：时间戳序在迁移二 20261025120000 之后（T7→T21→T23）。
-- MaterializeRun（迁移二已建）本卡零 DDL 变更——state 值域 T23 消费定形（RUNNING→COMPLETED|FAILED|
-- FENCED，注释见 schema.prisma）；#4 族分离：expectedExecSeq=执行代际族。

-- AlterEnum
ALTER TYPE "IntentStatus" ADD VALUE 'UNKNOWN';

-- CreateTable
CREATE TABLE "StorageReservation" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "upperBoundBytes" BIGINT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectManifest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorageReservation_mediaId_key" ON "StorageReservation"("mediaId");

-- CreateIndex
CREATE INDEX "StorageReservation_teamId_state_idx" ON "StorageReservation"("teamId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectManifest_objectKey_key" ON "ObjectManifest"("objectKey");

-- CreateIndex
CREATE INDEX "ObjectManifest_state_claimUntil_idx" ON "ObjectManifest"("state", "claimUntil");
