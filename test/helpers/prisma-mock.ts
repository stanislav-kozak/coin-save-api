import type { Mock } from 'vitest';

export type PrismaMock = Record<string, Record<string, Mock>>;

/**
 * Merges per-table so an override like `{ membership: { count } }` only
 * replaces the named methods on that table instead of wiping out the rest
 * of its default mocks (e.g. `delete`), which a plain top-level
 * `{ ...defaults, ...overrides }` spread would do.
 */
export function buildPrismaMock<T extends PrismaMock>(
  defaults: T,
  overrides: Partial<{ [K in keyof T]: Partial<T[K]> }> = {},
): T {
  return Object.fromEntries(
    Object.keys(defaults).map((table) => [
      table,
      { ...defaults[table], ...(overrides[table as keyof T] ?? {}) },
    ]),
  ) as T;
}
