import { TransactionType } from '@prisma/client';

// Types an expense or a recurring rule can be created with. TRANSFER rows
// only come from the transfers endpoints.
export const ENTRY_TYPES = [
  TransactionType.EXPENSE,
  TransactionType.INCOME,
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
