import * as argon2 from 'argon2';
import { findMatchingToken } from './find-matching-token';

describe('findMatchingToken', () => {
  it('returns the candidate whose hash matches the presented token', async () => {
    const rawToken = 'a'.repeat(64);
    const tokenHash = await argon2.hash(rawToken);
    const candidates = [
      { id: '1', tokenHash: 'not-a-match' },
      { id: '2', tokenHash },
    ];

    const result = await findMatchingToken(candidates, rawToken);

    expect(result?.id).toBe('2');
  });

  it('returns undefined when no candidate matches', async () => {
    const candidates = [
      { id: '1', tokenHash: await argon2.hash('other-token') },
    ];

    const result = await findMatchingToken(candidates, 'a'.repeat(64));

    expect(result).toBeUndefined();
  });
});
