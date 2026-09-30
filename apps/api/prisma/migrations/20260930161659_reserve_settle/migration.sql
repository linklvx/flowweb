-- AlterEnum
ALTER TYPE "TeamCreditTransactionType" ADD VALUE 'reserve';

-- AlterEnum
ALTER TYPE "TeamCreditTransactionType" ADD VALUE 'settle';

-- AlterTable
ALTER TABLE "GenerationIntent" ADD COLUMN "reservedCredits" INTEGER NOT NULL DEFAULT 0;
