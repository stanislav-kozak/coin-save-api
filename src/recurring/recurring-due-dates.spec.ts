import {
  computeDueDates,
  computeNextOccurrenceDate,
  lastDueDateBefore,
} from './recurring-due-dates';

describe('computeDueDates', () => {
  it('skips the starting month when the clamped day falls before startDate, generates from next month', () => {
    const dueDates = computeDueDates({
      startDate: new Date('2026-01-20T00:00:00.000Z'),
      endDate: null,
      dayOfMonth: 15,
      lastGeneratedAt: null,
      now: new Date('2026-03-01T00:00:00.000Z'),
    });

    expect(dueDates).toEqual([new Date('2026-02-15T00:00:00.000Z')]);
  });

  it('includes the starting month when the clamped day falls on or after startDate', () => {
    const dueDates = computeDueDates({
      startDate: new Date('2026-01-10T00:00:00.000Z'),
      endDate: null,
      dayOfMonth: 15,
      lastGeneratedAt: null,
      now: new Date('2026-01-31T00:00:00.000Z'),
    });

    expect(dueDates).toEqual([new Date('2026-01-15T00:00:00.000Z')]);
  });

  it('clamps dayOfMonth=31 to the 28th in a non-leap February', () => {
    const dueDates = computeDueDates({
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: null,
      dayOfMonth: 31,
      lastGeneratedAt: new Date('2026-01-15T00:00:00.000Z'),
      now: new Date('2026-02-28T00:00:00.000Z'),
    });

    expect(dueDates).toEqual([new Date('2026-02-28T00:00:00.000Z')]);
  });

  it('clamps dayOfMonth=31 to the 29th in a leap February', () => {
    const dueDates = computeDueDates({
      startDate: new Date('2028-01-01T00:00:00.000Z'),
      endDate: null,
      dayOfMonth: 31,
      lastGeneratedAt: new Date('2028-01-15T00:00:00.000Z'),
      now: new Date('2028-02-29T00:00:00.000Z'),
    });

    expect(dueDates).toEqual([new Date('2028-02-29T00:00:00.000Z')]);
  });

  it('starts from the month after lastGeneratedAt, not from startDate', () => {
    const dueDates = computeDueDates({
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: null,
      dayOfMonth: 5,
      lastGeneratedAt: new Date('2026-03-05T00:00:00.000Z'),
      now: new Date('2026-04-30T00:00:00.000Z'),
    });

    expect(dueDates).toEqual([new Date('2026-04-05T00:00:00.000Z')]);
  });

  it('stops at endDate when endDate is before now', () => {
    const dueDates = computeDueDates({
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-03-10T00:00:00.000Z'),
      dayOfMonth: 5,
      lastGeneratedAt: new Date('2026-01-05T00:00:00.000Z'),
      now: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(dueDates).toEqual([
      new Date('2026-02-05T00:00:00.000Z'),
      new Date('2026-03-05T00:00:00.000Z'),
    ]);
  });

  it('uses now as the upper bound when endDate is null', () => {
    const dueDates = computeDueDates({
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: null,
      dayOfMonth: 5,
      lastGeneratedAt: new Date('2026-01-05T00:00:00.000Z'),
      now: new Date('2026-03-04T00:00:00.000Z'),
    });

    expect(dueDates).toEqual([new Date('2026-02-05T00:00:00.000Z')]);
  });

  it('generates every missed month in one pass when inactive for a long time', () => {
    const dueDates = computeDueDates({
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: null,
      dayOfMonth: 1,
      lastGeneratedAt: new Date('2026-01-01T00:00:00.000Z'),
      now: new Date('2026-05-15T00:00:00.000Z'),
    });

    expect(dueDates).toEqual([
      new Date('2026-02-01T00:00:00.000Z'),
      new Date('2026-03-01T00:00:00.000Z'),
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-05-01T00:00:00.000Z'),
    ]);
  });

  it('returns an empty array when no due date has arrived yet', () => {
    const dueDates = computeDueDates({
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: null,
      dayOfMonth: 20,
      lastGeneratedAt: null,
      now: new Date('2026-06-10T00:00:00.000Z'),
    });

    expect(dueDates).toEqual([]);
  });

  it('includes the starting month when startDate has a non-midnight time component', () => {
    const dueDates = computeDueDates({
      startDate: new Date('2026-06-15T15:00:00.000Z'),
      endDate: null,
      dayOfMonth: 15,
      lastGeneratedAt: null,
      now: new Date('2026-06-20T00:00:00.000Z'),
    });

    expect(dueDates).toEqual([new Date('2026-06-15T00:00:00.000Z')]);
  });
});

describe('computeNextOccurrenceDate', () => {
  it('returns the same-month date when lastGeneratedAt is null and the clamped day is on/after startDate', () => {
    const result = computeNextOccurrenceDate({
      startDate: new Date('2026-01-10T00:00:00.000Z'),
      endDate: null,
      dayOfMonth: 15,
      lastGeneratedAt: null,
    });

    expect(result).toEqual(new Date('2026-01-15T00:00:00.000Z'));
  });

  it('skips to next month when lastGeneratedAt is null and the clamped day is before startDate', () => {
    const result = computeNextOccurrenceDate({
      startDate: new Date('2026-01-20T00:00:00.000Z'),
      endDate: null,
      dayOfMonth: 15,
      lastGeneratedAt: null,
    });

    expect(result).toEqual(new Date('2026-02-15T00:00:00.000Z'));
  });

  it('returns the month after lastGeneratedAt', () => {
    const result = computeNextOccurrenceDate({
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: null,
      dayOfMonth: 5,
      lastGeneratedAt: new Date('2026-03-05T00:00:00.000Z'),
    });

    expect(result).toEqual(new Date('2026-04-05T00:00:00.000Z'));
  });

  it('clamps dayOfMonth to the last day of a non-leap February', () => {
    const result = computeNextOccurrenceDate({
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: null,
      dayOfMonth: 31,
      lastGeneratedAt: new Date('2026-01-15T00:00:00.000Z'),
    });

    expect(result).toEqual(new Date('2026-02-28T00:00:00.000Z'));
  });

  it('clamps dayOfMonth to the last day of a leap February', () => {
    const result = computeNextOccurrenceDate({
      startDate: new Date('2028-01-01T00:00:00.000Z'),
      endDate: null,
      dayOfMonth: 31,
      lastGeneratedAt: new Date('2028-01-15T00:00:00.000Z'),
    });

    expect(result).toEqual(new Date('2028-02-29T00:00:00.000Z'));
  });

  it('returns null when the next occurrence would fall after endDate', () => {
    const result = computeNextOccurrenceDate({
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-03-01T00:00:00.000Z'),
      dayOfMonth: 5,
      lastGeneratedAt: new Date('2026-03-05T00:00:00.000Z'),
    });

    expect(result).toBeNull();
  });

  it('returns the occurrence when it falls exactly on endDate', () => {
    const result = computeNextOccurrenceDate({
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-04-05T00:00:00.000Z'),
      dayOfMonth: 5,
      lastGeneratedAt: new Date('2026-03-05T00:00:00.000Z'),
    });

    expect(result).toEqual(new Date('2026-04-05T00:00:00.000Z'));
  });
});

describe('lastDueDateBefore', () => {
  const before = new Date('2026-08-15T12:00:00.000Z');
  const startDate = new Date('2026-01-01T00:00:00.000Z');
  const utc = (d: string) => new Date(`${d}T00:00:00.000Z`);

  it("returns last month's due date when this month's is still ahead", () => {
    expect(lastDueDateBefore({ startDate, dayOfMonth: 20, before })).toEqual(
      utc('2026-07-20'),
    );
  });

  it("treats today's due date as not yet passed", () => {
    expect(lastDueDateBefore({ startDate, dayOfMonth: 15, before })).toEqual(
      utc('2026-07-15'),
    );
  });

  it("returns this month's due date once it has passed", () => {
    expect(lastDueDateBefore({ startDate, dayOfMonth: 10, before })).toEqual(
      utc('2026-08-10'),
    );
  });

  it('returns null when no due date has passed since startDate', () => {
    expect(
      lastDueDateBefore({
        startDate: utc('2026-08-01'),
        dayOfMonth: 20,
        before,
      }),
    ).toBeNull();
  });

  it('clamps to the last day of a short month', () => {
    expect(
      lastDueDateBefore({
        startDate,
        dayOfMonth: 31,
        before: new Date('2026-03-15T12:00:00.000Z'),
      }),
    ).toEqual(utc('2026-02-28'));
  });
});
