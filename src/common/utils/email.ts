// Emails are stored trimmed and lowercased; lookups are case-insensitive as
// well, so accounts created before normalization (e.g. "Olena@B.com") are
// still found.
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

export const emailMatches = (email: string) => ({
  equals: normalizeEmail(email),
  mode: 'insensitive' as const,
});
