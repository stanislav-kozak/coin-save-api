import * as argon2 from 'argon2';

export async function findMatchingToken<T extends { tokenHash: string }>(
  candidates: T[],
  presentedToken: string,
): Promise<T | undefined> {
  for (const candidate of candidates) {
    try {
      if (await argon2.verify(candidate.tokenHash, presentedToken)) {
        return candidate;
      }
    } catch {
      // Malformed hash — treat as a non-match rather than throwing.
    }
  }
  return undefined;
}
