-- CreateEnum
CREATE TYPE "RechargeKind" AS ENUM ('credits', 'subscription');

-- AlterTable
ALTER TABLE "TeamRechargeOrder" ADD COLUMN     "kind" "RechargeKind" NOT NULL DEFAULT 'credits',
ADD COLUMN     "planId" TEXT;

