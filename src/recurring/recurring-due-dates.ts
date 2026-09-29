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

    if (dueDate.getTime() < startDate.getTime()) {
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
