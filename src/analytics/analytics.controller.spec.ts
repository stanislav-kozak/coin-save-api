import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';

describe('AnalyticsController', () => {
  let app: INestApplication;
  const analyticsService = {
    getAnalytics: vi.fn(),
    exportExpensesCsv: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [{ provide: AnalyticsService, useValue: analyticsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SpaceMemberGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /spaces/:spaceId/analytics forwards from/to/walletIds and returns the service result', async () => {
    analyticsService.getAnalytics.mockResolvedValue({ currency: 'EUR' });

    const res = await request(app.getHttpServer())
      .get('/spaces/s1/analytics?from=2026-06-01&to=2026-06-30&walletIds=w1,w2')
      .expect(200);

    expect(analyticsService.getAnalytics).toHaveBeenCalledWith('s1', {
      from: '2026-06-01',
      to: '2026-06-30',
      walletIds: ['w1', 'w2'],
    });
    expect(res.body).toEqual({ currency: 'EUR' });
  });

  it('GET /spaces/:spaceId/analytics rejects a missing from/to with 400', async () => {
    await request(app.getHttpServer())
      .get('/spaces/s1/analytics?from=2026-06-01')
      .expect(400);
  });

  it('GET /spaces/:spaceId/expenses.csv returns text/csv with Content-Disposition', async () => {
    analyticsService.exportExpensesCsv.mockResolvedValue(
      'Date,Wallet\n2026-06-01,Cash',
    );

    const res = await request(app.getHttpServer())
      .get('/spaces/s1/expenses.csv?from=2026-06-01&to=2026-06-30')
      .expect(200);

    expect(analyticsService.exportExpensesCsv).toHaveBeenCalledWith('s1', {
      from: '2026-06-01',
      to: '2026-06-30',
    });
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="expenses.csv"',
    );
    expect(res.text).toBe('Date,Wallet\n2026-06-01,Cash');
  });

  it('GET /spaces/:spaceId/expenses.csv does not leak CSV headers onto an error response', async () => {
    analyticsService.exportExpensesCsv.mockRejectedValueOnce(
      new AppException(
        ERROR_CODES.INVALID_PERIOD,
        400,
        'from must not be after to',
      ),
    );

    const res = await request(app.getHttpServer())
      .get('/spaces/s1/expenses.csv?from=2026-06-10&to=2026-06-01')
      .expect(400);

    expect(res.headers['content-type']).not.toContain('text/csv');
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.body).toMatchObject({ code: 'INVALID_PERIOD' });
  });
});
