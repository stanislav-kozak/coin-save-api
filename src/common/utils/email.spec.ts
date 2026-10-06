import { emailMatches, normalizeEmail } from './email';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Olena.K@Example.COM ')).toBe(
      'olena.k@example.com',
    );
  });
});

describe('emailMatches', () => {
  it('builds a case-insensitive Prisma filter on the normalized email', () => {
    expect(emailMatches(' A@B.co ')).toEqual({
      equals: 'a@b.co',
      mode: 'insensitive',
    });
  });
});
