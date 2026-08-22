-- AlterTable
ALTER TABLE "CanvasNode" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "CanvasNode_parentId_idx" ON "CanvasNode"("parentId");

-- AddForeignKey
ALTER TABLE "CanvasNode" ADD CONSTRAINT "CanvasNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CanvasNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
