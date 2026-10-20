-- DropIndex（S0.1 2026-10-20：factType 入键——旧三列唯一索引退役）
DROP INDEX "MediaFactOutbox_mediaId_projectId_factVersion_key";

-- CreateIndex
CREATE UNIQUE INDEX "MediaFactOutbox_mediaId_projectId_factType_factVersion_key" ON "MediaFactOutbox"("mediaId", "projectId", "factType", "factVersion");
