-- Drop redundant indexes replaced by composite
DROP INDEX IF EXISTS "Media_userId_folderId_idx";
DROP INDEX IF EXISTS "Media_userId_createdAt_idx";

-- Create optimized composite index for primary access pattern:
-- getFilesByFolderId: WHERE userId + folderId + ORDER BY createdAt DESC
CREATE INDEX "Media_userId_folderId_createdAt_idx" ON "Media"("userId", "folderId", "createdAt" DESC);
