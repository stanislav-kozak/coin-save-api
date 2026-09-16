import { extractSpaceId } from './space.decorator';

describe('extractSpaceId', () => {
  it('reads spaceId from route params first', () => {
    const request = {
      params: { spaceId: 'space-1' },
      body: { spaceId: 'space-2' },
    };
    expect(extractSpaceId(request)).toBe('space-1');
  });

  it('falls back to the request body', () => {
    const request = { params: {}, body: { spaceId: 'space-2' } };
    expect(extractSpaceId(request)).toBe('space-2');
  });

  it('returns undefined when neither is present', () => {
    const request = { params: {}, body: {} };
    expect(extractSpaceId(request)).toBeUndefined();
  });
});
