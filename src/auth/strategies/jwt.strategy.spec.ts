import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  it('maps the JWT payload to an AuthenticatedUser', () => {
    const config = { get: vi.fn().mockReturnValue('test-secret') };
    const strategy = new JwtStrategy(config as never);

    const result = strategy.validate({ sub: 'u1', email: 'a@b.com' });

    expect(result).toEqual({ id: 'u1', email: 'a@b.com' });
  });
});
