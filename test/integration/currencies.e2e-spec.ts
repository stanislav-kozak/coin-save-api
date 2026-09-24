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
import {
  frankfurterOk,
  secondaryOk,
  failing,
  mockFetch,
} from '../helpers/currency-fetch-mock';

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
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);

    const rate = await service.getRate('PLN', 'PLN', new Date('2026-06-15'));

    expect(rate.toNumber()).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches, persists, and reuses historical Frankfurter rates for a real cache miss', async () => {
    const fetchSpy = mockFetch({
      frankfurter: frankfurterOk({ USD: 1.1, PLN: 45.2 }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const rate = await service.getRate('USD', 'PLN', new Date('2026-06-15'));
    // Frankfurter only: neither USD nor PLN needs the secondary provider, so
    // fetchAllRates skips it entirely (Fix 1) instead of always racing both.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rate.toNumber()).toBeCloseTo(45.2 / 1.1, 6);

    const row = await prisma.exchangeRate.findUnique({
      where: {
        date_fromCurrency_toCurrency: {
          date: new Date('2026-06-15T00:00:00.000Z'),
          fromCurrency: 'EUR',
          toCurrency: 'USD',
        },
      },
    });
    expect(row?.source).toBe('frankfurter.dev');

    const cachedRate = await service.getRate(
      'USD',
      'PLN',
      new Date('2026-06-15'),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no new fetch on the cached second call
    expect(cachedRate.toNumber()).toBeCloseTo(45.2 / 1.1, 6);
  });

  it('fetches, persists, and reuses a UAH rate from the secondary provider for a real cache miss', async () => {
    const fetchSpy = mockFetch({
      jsdelivr: secondaryOk({ UAH: 41.65, RUB: 98.66 }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const rate = await service.getRate('EUR', 'UAH', new Date('2026-06-15'));
    expect(rate.toNumber()).toBeCloseTo(41.65, 6);

    const row = await prisma.exchangeRate.findUnique({
      where: {
        date_fromCurrency_toCurrency: {
          date: new Date('2026-06-15T00:00:00.000Z'),
          fromCurrency: 'EUR',
          toCurrency: 'UAH',
        },
      },
    });
    expect(row).not.toBeNull();
    expect(row?.rate.toNumber()).toBeCloseTo(41.65, 6);
    expect(row?.source).toBe('fawazahmed0/currency-api');

    const cachedRate = await service.getRate(
      'EUR',
      'UAH',
      new Date('2026-06-15'),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2); // one round from the first call, no new fetch on the second
    expect(cachedRate.toNumber()).toBeCloseTo(41.65, 6);
  });

  it('falls back to the Cloudflare host when jsdelivr fails for a real cache miss', async () => {
    const fetchSpy = mockFetch({
      jsdelivr: failing(500),
      cloudflare: secondaryOk({ UAH: 41.65 }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const rate = await service.getRate('EUR', 'UAH', new Date('2026-06-15'));

    expect(rate.toNumber()).toBeCloseTo(41.65, 6);
    const calledUrls = fetchSpy.mock.calls.map(([url]: [string]) => url);
    expect(
      calledUrls.some((url: string) => url.includes('currency-api.pages.dev')),
    ).toBe(true);
  });

  it('falls back to the most recent cached EUR rate when both providers are unavailable', async () => {
    // UAH needs the secondary provider, so this genuinely exercises both
    // providers failing (a Frankfurter-only pair would never attempt the
    // secondary provider under Fix 1's conditional fetch).
    const seedFetch = mockFetch({ jsdelivr: secondaryOk({ UAH: 41.5 }) });
    vi.stubGlobal('fetch', seedFetch);
    await service.getRate('EUR', 'UAH', new Date('2026-01-01'));

    const failingFetch = mockFetch({});
    vi.stubGlobal('fetch', failingFetch);

    const rate = await service.getRate('EUR', 'UAH', new Date('2026-06-20'));

    expect(rate.toNumber()).toBe(41.5);
  });

  it('throws CURRENCY_API_UNAVAILABLE (503) when nothing is cached and both providers are down', async () => {
    vi.stubGlobal('fetch', mockFetch({}));

    try {
      // UAH needs the secondary provider, so both providers are genuinely
      // attempted and down here.
      await service.getRate('EUR', 'UAH', new Date('2026-09-05'));
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
      mockFetch({ frankfurter: frankfurterOk({ USD: 1.2 }) }),
    );

    const converted = await service.convert(
      new Prisma.Decimal(100),
      'EUR',
      'USD',
      new Date('2026-07-10'),
    );

    expect(converted.toNumber()).toBeCloseTo(120, 6);
  });

  it('refreshDailyRates persists rows from both providers queryable by supportedCurrencies codes', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        frankfurter: frankfurterOk({ PLN: 4.3 }),
        jsdelivr: secondaryOk({ UAH: 41.5 }),
      }),
    );

    await service.refreshDailyRates();

    const plnRate = await service.getRate('EUR', 'PLN', new Date());
    expect(plnRate.toNumber()).toBe(4.3);

    const uahRate = await service.getRate('EUR', 'UAH', new Date());
    expect(uahRate.toNumber()).toBe(41.5);
  });
});
