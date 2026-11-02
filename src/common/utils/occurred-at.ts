import { HttpStatus } from '@nestjs/common';
import { AppException } from '../exceptions/app.exception';
import { ERROR_CODES } from '../constants/error-codes';

const MAX_PAST_YEARS = 5;
// Phones whose clock runs a little fast send "now" slightly in the future;
// tolerate that instead of rejecting every just-made expense.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** When a transaction happened: not in the future, at most 5 years back. */
export function parseOccurredAt(occurredAt: string): Date {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) {
    throw new AppException(
      ERROR_CODES.INVALID_OCCURRED_AT,
      HttpStatus.BAD_REQUEST,
      'occurredAt is not a valid date',
    );
  }
  const now = new Date();
  if (date.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
    throw new AppException(
      ERROR_CODES.INVALID_OCCURRED_AT,
      HttpStatus.BAD_REQUEST,
      'occurredAt cannot be in the future',
    );
  }
  const earliestAllowed = new Date(now);
  earliestAllowed.setFullYear(earliestAllowed.getFullYear() - MAX_PAST_YEARS);
  if (date.getTime() < earliestAllowed.getTime()) {
    throw new AppException(
      ERROR_CODES.INVALID_OCCURRED_AT,
      HttpStatus.BAD_REQUEST,
      `occurredAt cannot be more than ${MAX_PAST_YEARS} years in the past`,
    );
  }
  return date;
}
