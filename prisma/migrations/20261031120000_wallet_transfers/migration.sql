-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'TRANSFER';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "toAmount" DECIMAL(19,4),
ADD COLUMN     "toWalletCurrency" TEXT,
ADD COLUMN     "toWalletId" TEXT;

-- CreateIndex
CREATE INDEX "Expense_toWalletId_idx" ON "Expense"("toWalletId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

