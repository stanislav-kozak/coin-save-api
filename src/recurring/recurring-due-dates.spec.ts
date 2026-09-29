import { computeDueDates } from './recurring-due-dates';

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
