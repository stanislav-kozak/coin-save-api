import { HttpException, HttpStatus } from '@nestjs/common';
import { HealthController } from './health.controller';

function buildController(
  overrides: { queryRaw?: ReturnType<typeof vi.fn> } = {},
) {
  const prisma = {
    $queryRaw:
      overrides.queryRaw ?? vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  };
  const controller = new HealthController(prisma as never);
  return { controller, prisma };
}

describe('HealthController', () => {
  it('returns 200 with db.status "up" and a numeric uptime when the database is reachable', async () => {
    const { controller } = buildController();

    const result = await controller.check();

    expect(result).toEqual({
      status: 'ok',
      db: { status: 'up' },
      uptime: expect.any(Number) as number,
    });
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });

  it('throws a 503 with db.status "down" and the error message when the database is unreachable', async () => {
    const { controller } = buildController({
      queryRaw: vi.fn().mockRejectedValue(new Error('connection refused')),
    });

    try {
      await controller.check();
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const httpError = error as HttpException;
      expect(httpError.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(httpError.getResponse()).toEqual({
        status: 'error',
        db: { status: 'down', error: 'connection refused' },
        uptime: expect.any(Number) as number,
      });
    }
  });
});
