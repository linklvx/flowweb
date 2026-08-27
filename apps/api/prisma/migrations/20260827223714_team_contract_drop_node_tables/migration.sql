-- DropForeignKey
ALTER TABLE "CanvasEdge" DROP CONSTRAINT "CanvasEdge_projectId_fkey";

-- DropForeignKey
ALTER TABLE "CanvasNode" DROP CONSTRAINT "CanvasNode_parentId_fkey";

-- DropForeignKey
ALTER TABLE "CanvasNode" DROP CONSTRAINT "CanvasNode_projectId_fkey";

-- AlterTable
ALTER TABLE "CanvasProject" DROP COLUMN "version",
DROP COLUMN "viewport",
ALTER COLUMN "teamId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Media" ALTER COLUMN "teamId" SET NOT NULL;

-- DropTable
DROP TABLE "CanvasEdge";

-- DropTable
DROP TABLE "CanvasNode";

