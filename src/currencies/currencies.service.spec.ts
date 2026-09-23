import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrencyService } from './currencies.service';
import { AppException } from '../common/exceptions/app.exception';
import {
  buildPrismaMock,
  type PrismaMock,
} from '../../test/helpers/prisma-mock';

function buildService(
  overrides: {
    prisma?: Partial<{ [K in keyof PrismaMock]: Partial<PrismaMock[K]> }>;
  } = {},
) {
  const basePrisma = {
    exchangeRate: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
  };
  const prisma = buildPrismaMock(basePrisma, overrides.prisma);
  const service = new CurrencyService(prisma as never);
  return { service, prisma };
}

function fetchOk(rates: Record<string, number>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ rates }),
  });
}

function fetchFailing(status = 503) {
  return vi.fn().mockResolvedValue({ ok: false, status });
}

describe('CurrencyService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 1 when from and to are the same currency, without touching Prisma or fetch', async () => {
    const fetchSpy = fetchOk({});
    vi.stubGlobal('fetch', fetchSpy);
    const { service, prisma } = buildService();

    const rate = await service.getRate('UAH', 'UAH', new Date('2026-06-15'));

    expect(rate.toNumber()).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.exchangeRate.findUnique).not.toHaveBeenCalled();
  });

  it('returns the rate directly when a matching row is already cached', async () => {
    const fetchSpy = fetchOk({});
    vi.stubGlobal('fetch', fetchSpy);
    const { service, prisma } = buildService({
      prisma: {
        exchangeRate: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ rate: new Prisma.Decimal('45.5') }),
        },
      },
    });

    const rate = await service.getRate('EUR', 'UAH', new Date('2026-06-15'));

    expect(rate.toNumber()).toBe(45.5);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.exchangeRate.upsert).not.toHaveBeenCalled();
  });

  it('computes a cross rate from two cached EUR rows without calling fetch', async () => {
    const fetchSpy = fetchOk({});
    vi.stubGlobal('fetch', fetchSpy);
    const findUnique = vi.fn().mockImplementation(({ where }) => {
      const key = where.date_fromCurrency_toCurrency;
      if (key.fromCurrency === 'EUR' && key.toCurrency === 'USD') {
        return Promise.resolve({ rate: new Prisma.Decimal('1.1') });
      }
      if (key.fromCurrency === 'EUR' && key.toCurrency === 'UAH') {
        return Promise.resolve({ rate: new Prisma.Decimal('45.1') });
      }
      return Promise.resolve(null);
    });
    const { service } = buildService({
      prisma: { exchangeRate: { findUnique } },
    });

    const rate = await service.getRate('USD', 'UAH', new Date('2026-06-15'));

    expect(rate.toNumber()).toBeCloseTo(45.1 / 1.1, 8);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches and upserts historical rates on a cache miss, then returns the computed cross rate', async () => {
    const fetchSpy = fetchOk({ USD: 1.1, UAH: 45.2 });
    vi.stubGlobal('fetch', fetchSpy);
    const { service, prisma } = buildService();

    const rate = await service.getRate('USD', 'UAH', new Date('2026-06-15'));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('api.frankfurter.dev/v1/2026-06-15');
    expect(calledUrl).toContain('from=EUR');
    expect(prisma.exchangeRate.upsert).toHaveBeenCalledTimes(2); // one per key in the mocked response body
    expect(rate.toNumber()).toBeCloseTo(45.2 / 1.1, 8);
  });

  it('falls back to the most recent cached EUR rate when the API call fails', async () => {
    vi.stubGlobal('fetch', fetchFailing(503));
    const { service } = buildService({
      prisma: {
        exchangeRate: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ rate: new Prisma.Decimal('0.85') }),
        },
      },
    });

    const rate = await service.getRate('EUR', 'GBP', new Date('2026-06-20'));

    expect(rate.toNumber()).toBe(0.85);
  });

  it('throws CURRENCY_API_UNAVAILABLE (503) when nothing is cached and the API is down', async () => {
    vi.stubGlobal('fetch', fetchFailing(503));
    const { service } = buildService();

    try {
      await service.getRate('EUR', 'JPY', new Date('2026-09-01'));
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  });

  it('convert multiplies the amount by the resolved rate', async () => {
    const { service } = buildService({
      prisma: {
        exchangeRate: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ rate: new Prisma.Decimal('1.2') }),
        },
      },
    });

    const result = await service.convert(
      new Prisma.Decimal(100),
      'EUR',
      'USD',
      new Date('2026-07-01'),
    );

    expect(result.toNumber()).toBeCloseTo(120, 8);
  });

  it('supportedCurrencies returns the whitelist', () => {
    const { service } = buildService();

    expect(service.supportedCurrencies()).toContain('UAH');
    expect(service.supportedCurrencies()).toContain('EUR');
    expect(service.supportedCurrencies().length).toBe(15);
  });

  it('refreshDailyRates fetches latest rates and upserts them without throwing on failure', async () => {
    vi.stubGlobal('fetch', fetchFailing(500));
    const { service } = buildService();

    await expect(service.refreshDailyRates()).resolves.toBeUndefined();
  });

  it("refreshDailyRates upserts today's rates on success", async () => {
    const fetchSpy = fetchOk({ USD: 1.08 });
    vi.stubGlobal('fetch', fetchSpy);
    const { service, prisma } = buildService();

    await service.refreshDailyRates();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('api.frankfurter.dev/v1/latest');
    expect(prisma.exchangeRate.upsert).toHaveBeenCalledTimes(1);
  });
});
