/*
  Warnings:

  - You are about to drop the `CreditTransaction` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RechargeOrder` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserBalance` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserBalanceTransaction` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "UserBalance" DROP CONSTRAINT "UserBalance_userId_fkey";

-- DropTable
DROP TABLE "CreditTransaction";

-- DropTable
DROP TABLE "RechargeOrder";

-- DropTable
DROP TABLE "UserBalance";

-- DropTable
DROP TABLE "UserBalanceTransaction";

-- DropEnum
DROP TYPE "BalanceTxType";

-- DropEnum
DROP TYPE "CreditReferenceType";

-- DropEnum
DROP TYPE "CreditTransactionType";

-- DropEnum
DROP TYPE "RechargeOrderStatus";

-- RenameIndex
ALTER INDEX "team_owner_id_idx" RENAME TO "Team_ownerId_idx";
