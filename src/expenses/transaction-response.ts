import type { Prisma } from '@prisma/client';

// Every transaction response carries the destination wallet's name, so a
// transfer row ("Monobank → Cash") renders without loading archived wallets.
export const transactionInclude = {
  toWallet: { select: { name: true } },
} satisfies Prisma.ExpenseInclude;

export type TransactionWithToWallet = Prisma.ExpenseGetPayload<{
  include: typeof transactionInclude;
}>;

export type TransactionResponse = Omit<TransactionWithToWallet, 'toWallet'> & {
  toWalletName: string | null;
};

export function toTransactionResponse({
  toWallet,
  ...transaction
}: TransactionWithToWallet): TransactionResponse {
  return { ...transaction, toWalletName: toWallet?.name ?? null };
}
