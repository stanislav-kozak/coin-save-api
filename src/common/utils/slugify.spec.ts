import { slugify } from './slugify';

describe('slugify', () => {
  it('lowercases and replaces whitespace with dashes', () => {
    expect(slugify('Family Budget')).toBe('family-budget');
  });

  it('strips characters outside a-z0-9 and dashes', () => {
    expect(slugify("O'Brien's Space!")).toBe('obriens-space');
  });

  it('returns an empty string when there are no ASCII alphanumerics', () => {
    expect(slugify('Сім’я')).toBe('');
  });
});
