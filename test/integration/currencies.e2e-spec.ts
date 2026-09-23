import { execSync } from 'child_process';
import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { CurrenciesModule } from '../../src/currencies/currencies.module';
import { CurrencyService } from '../../src/currencies/currencies.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AppException } from '../../src/common/exceptions/app.exception';
import { ERROR_CODES } from '../../src/common/constants/error-codes';

describe('CurrencyService (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let moduleRef: TestingModule;
  let service: CurrencyService;
  let prisma: PrismaService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('coinsave_test')
      .withUsername('postgres')
      .withPassword('postgres')
      .start();

    process.env.DATABASE_URL = container.getConnectionUri();

    execSync('npx prisma migrate deploy', {
      env: process.env,
      stdio: 'inherit',
    });

    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, CurrenciesModule],
    }).compile();

    service = moduleRef.get(CurrencyService);
    prisma = moduleRef.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    await moduleRef.close();
    await container.stop();
  });

  beforeEach(async () => {
    await prisma.exchangeRate.deleteMany();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 1 for identical currencies without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const rate = await service.getRate('UAH', 'UAH', new Date('2026-06-15'));

    expect(rate.toNumber()).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches, persists, and reuses historical rates for a real cache miss', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ rates: { USD: 1.1, UAH: 45.2 } }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const rate = await service.getRate('USD', 'UAH', new Date('2026-06-15'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rate.toNumber()).toBeCloseTo(45.2 / 1.1, 6);

    const cachedRate = await service.getRate(
      'USD',
      'UAH',
      new Date('2026-06-15'),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(cachedRate.toNumber()).toBeCloseTo(45.2 / 1.1, 6);
  });

  it('falls back to the most recent cached EUR rate when the API is unavailable', async () => {
    const seedFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ rates: { GBP: 0.85 } }),
    });
    vi.stubGlobal('fetch', seedFetch);
    await service.getRate('EUR', 'GBP', new Date('2026-01-01'));

    const failingFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', failingFetch);

    const rate = await service.getRate('EUR', 'GBP', new Date('2026-06-20'));

    expect(rate.toNumber()).toBe(0.85);
  });

  it('throws CURRENCY_API_UNAVAILABLE (503) when nothing is cached and the API is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );

    try {
      await service.getRate('EUR', 'JPY', new Date('2026-09-05'));
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      expect((error as AppException).getResponse()).toMatchObject({
        code: ERROR_CODES.CURRENCY_API_UNAVAILABLE,
      });
    }
  });

  it('convert multiplies a real resolved rate by the amount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ rates: { USD: 1.2 } }),
      }),
    );

    const converted = await service.convert(
      new Prisma.Decimal(100),
      'EUR',
      'USD',
      new Date('2026-07-10'),
    );

    expect(converted.toNumber()).toBeCloseTo(120, 6);
  });

  it('refreshDailyRates persists rows queryable by supportedCurrencies codes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ rates: { PLN: 4.3 } }),
      }),
    );

    await service.refreshDailyRates();

    const rate = await service.getRate('EUR', 'PLN', new Date());
    expect(rate.toNumber()).toBe(4.3);
  });
});
