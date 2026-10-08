import { Prisma } from '@prisma/client';

// A converted budget limit: rounded to whole units (half up) so it stays a
// "nice" number for the user, and never below 1 (0 would mean no budget).
export function convertMonthlyLimit(
  limit: Prisma.Decimal.Value,
  rate: Prisma.Decimal.Value,
): Prisma.Decimal {
  return Prisma.Decimal.max(
    new Prisma.Decimal(limit)
      .times(rate)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP),
    1,
  );
}
