import {
  addDays,
  countDaysInclusive,
  DEFAULT_TIME_ZONE,
  endOfZonedDay,
  startOfZonedDay,
  toCalendarDate,
  toZonedDate,
} from './time-zone';

const KYIV = 'Europe/Kyiv';

describe('time-zone utils', () => {
  it('defaults to Kyiv, like the cron jobs', () => {
    expect(DEFAULT_TIME_ZONE).toBe(KYIV);
  });

  it('starts a Kyiv day at the right UTC instant (summer, UTC+3)', () => {
    expect(startOfZonedDay('2026-10-01', KYIV).toISOString()).toBe(
      '2026-09-30T21:00:00.000Z',
    );
    expect(endOfZonedDay('2026-10-01', KYIV).toISOString()).toBe(
      '2026-10-01T20:59:59.999Z',
    );
  });

  it('starts a Kyiv day at the right UTC instant (winter, UTC+2)', () => {
    expect(startOfZonedDay('2026-01-15', KYIV).toISOString()).toBe(
      '2026-01-14T22:00:00.000Z',
    );
  });

  it('handles DST changes: 23h day in spring, 25h day in autumn', () => {
    // 2026-03-29: clocks jump 03:00 -> 04:00
    expect(startOfZonedDay('2026-03-29', KYIV).toISOString()).toBe(
      '2026-03-28T22:00:00.000Z',
    );
    expect(endOfZonedDay('2026-03-29', KYIV).toISOString()).toBe(
      '2026-03-29T20:59:59.999Z',
    );
    // 2026-10-25: clocks go back 04:00 -> 03:00
    expect(startOfZonedDay('2026-10-25', KYIV).toISOString()).toBe(
      '2026-10-24T21:00:00.000Z',
    );
    expect(endOfZonedDay('2026-10-25', KYIV).toISOString()).toBe(
      '2026-10-25T21:59:59.999Z',
    );
  });

  it('works for UTC and far-away zones', () => {
    expect(startOfZonedDay('2026-06-01', 'UTC').toISOString()).toBe(
      '2026-06-01T00:00:00.000Z',
    );
    expect(
      startOfZonedDay('2026-06-01', 'America/New_York').toISOString(),
    ).toBe('2026-06-01T04:00:00.000Z');
  });

  it('gives the calendar date an instant falls on in a zone', () => {
    // 30.09 18:00 in Kyiv belongs to September, 01.10 01:00 to October
    expect(toZonedDate(new Date('2026-09-30T15:00:00Z'), KYIV)).toBe(
      '2026-09-30',
    );
    expect(toZonedDate(new Date('2026-09-30T22:00:00Z'), KYIV)).toBe(
      '2026-10-01',
    );
  });

  it('reads date-only values as-is and timestamps in the zone', () => {
    expect(toCalendarDate('2026-10-01', KYIV)).toBe('2026-10-01');
    expect(toCalendarDate('2026-09-30T21:30:00.000Z', KYIV)).toBe('2026-10-01');
  });

  it('does calendar-day arithmetic across month ends', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(countDaysInclusive('2026-06-01', '2026-06-30')).toBe(30);
    expect(countDaysInclusive('2026-03-01', '2026-03-31')).toBe(31);
  });
});
