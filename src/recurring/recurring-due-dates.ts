export interface ComputeDueDatesInput {
  startDate: Date;
  endDate: Date | null;
  dayOfMonth: number;
  lastGeneratedAt: Date | null;
  now: Date;
}

// Safety cap so a corrupted/extreme date range can't loop indefinitely —
// 1200 months is 100 years, far beyond any realistic recurring transaction.
const MAX_ITERATIONS = 1200;

function firstOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonthsUtc(date: Date, months: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
}

function lastDayOfMonthUtc(monthStart: Date): number {
  return new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

function clampedDueDate(monthStart: Date, dayOfMonth: number): Date {
  const lastDay = lastDayOfMonthUtc(monthStart);
  const day = Math.min(dayOfMonth, lastDay);
  return new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day),
  );
}

function startOfDayUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function computeDueDates(input: ComputeDueDatesInput): Date[] {
  const { startDate, endDate, dayOfMonth, lastGeneratedAt, now } = input;

  let monthCursor = firstOfMonthUtc(lastGeneratedAt ?? startDate);
  if (lastGeneratedAt) {
    monthCursor = addMonthsUtc(monthCursor, 1);
  }

  const upperBound =
    endDate && endDate.getTime() < now.getTime() ? endDate : now;

  const dueDates: Date[] = [];
  let iterations = 0;

  while (monthCursor.getTime() <= upperBound.getTime()) {
    if (++iterations > MAX_ITERATIONS) {
      break;
    }

    const dueDate = clampedDueDate(monthCursor, dayOfMonth);

    if (dueDate.getTime() < startOfDayUtc(startDate).getTime()) {
      monthCursor = addMonthsUtc(monthCursor, 1);
      continue;
    }
    if (dueDate.getTime() > upperBound.getTime()) {
      break;
    }

    dueDates.push(dueDate);
    monthCursor = addMonthsUtc(monthCursor, 1);
  }

  return dueDates;
}

export interface ComputeNextOccurrenceDateInput {
  startDate: Date;
  endDate: Date | null;
  dayOfMonth: number;
  lastGeneratedAt: Date | null;
}

export function computeNextOccurrenceDate(
  input: ComputeNextOccurrenceDateInput,
): Date | null {
  const { startDate, endDate, dayOfMonth, lastGeneratedAt } = input;

  let monthCursor = firstOfMonthUtc(lastGeneratedAt ?? startDate);
  if (lastGeneratedAt) {
    monthCursor = addMonthsUtc(monthCursor, 1);
  }

  let dueDate = clampedDueDate(monthCursor, dayOfMonth);
  if (dueDate.getTime() < startOfDayUtc(startDate).getTime()) {
    monthCursor = addMonthsUtc(monthCursor, 1);
    dueDate = clampedDueDate(monthCursor, dayOfMonth);
  }

  if (endDate && dueDate.getTime() > endDate.getTime()) {
    return null;
  }

  return dueDate;
}

export interface LastDueDateBeforeInput {
  startDate: Date;
  dayOfMonth: number;
  before: Date;
}

/**
 * The most recent due date strictly before the day of `before` (today's due
 * date counts as not yet passed), or null if none has passed since
 * startDate. Used as lastGeneratedAt when creating or resuming a rule, so
 * occurrences that are already past are not back-filled while this month's
 * upcoming one is still generated.
 */
export function lastDueDateBefore(input: LastDueDateBeforeInput): Date | null {
  const { startDate, dayOfMonth, before } = input;
  const today = startOfDayUtc(before);

  let monthStart = firstOfMonthUtc(today);
  let dueDate = clampedDueDate(monthStart, dayOfMonth);
  if (dueDate.getTime() >= today.getTime()) {
    monthStart = addMonthsUtc(monthStart, -1);
    dueDate = clampedDueDate(monthStart, dayOfMonth);
  }

  return dueDate.getTime() < startOfDayUtc(startDate).getTime()
    ? null
    : dueDate;
}
