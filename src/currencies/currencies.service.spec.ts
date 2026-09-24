import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrencyService } from './currencies.service';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';
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

function frankfurterOk(rates: Record<string, number>) {
  return { ok: true, status: 200, json: () => Promise.resolve({ rates }) };
}

function secondaryOk(rates: Partial<Record<'UAH' | 'RUB', number>>) {
  const eur: Record<string, number> = {};
  for (const [code, value] of Object.entries(rates)) {
    eur[code.toLowerCase()] = value;
  }
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ date: '2026-06-15', eur }),
  };
}

function failing(status = 503) {
  return { ok: false, status };
}

function mockFetch(routes: {
  frankfurter?: ReturnType<typeof frankfurterOk> | ReturnType<typeof failing>;
  jsdelivr?: ReturnType<typeof secondaryOk> | ReturnType<typeof failing>;
  cloudflare?: ReturnType<typeof secondaryOk> | ReturnType<typeof failing>;
}) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('frankfurter.dev')) {
      return Promise.resolve(routes.frankfurter ?? failing());
    }
    if (url.includes('jsdelivr.net')) {
      return Promise.resolve(routes.jsdelivr ?? failing());
    }
    if (url.includes('currency-api.pages.dev')) {
      return Promise.resolve(routes.cloudflare ?? failing());
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}

describe('CurrencyService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 1 when from and to are the same currency, without touching Prisma or fetch', async () => {
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    const { service, prisma } = buildService();

    const rate = await service.getRate('PLN', 'PLN', new Date('2026-06-15'));

    expect(rate.toNumber()).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.exchangeRate.findUnique).not.toHaveBeenCalled();
  });

  it('returns the rate directly when a matching row is already cached', async () => {
    const fetchSpy = mockFetch({});
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

    const rate = await service.getRate('EUR', 'PLN', new Date('2026-06-15'));

    expect(rate.toNumber()).toBe(45.5);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.exchangeRate.upsert).not.toHaveBeenCalled();
  });

  it('computes a cross rate from two cached EUR rows without calling fetch', async () => {
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    const findUnique = vi.fn().mockImplementation(({ where }) => {
      const key = where.date_fromCurrency_toCurrency;
      if (key.fromCurrency === 'EUR' && key.toCurrency === 'USD') {
        return Promise.resolve({ rate: new Prisma.Decimal('1.1') });
      }
      if (key.fromCurrency === 'EUR' && key.toCurrency === 'PLN') {
        return Promise.resolve({ rate: new Prisma.Decimal('45.1') });
      }
      return Promise.resolve(null);
    });
    const { service } = buildService({
      prisma: { exchangeRate: { findUnique } },
    });

    const rate = await service.getRate('USD', 'PLN', new Date('2026-06-15'));

    expect(rate.toNumber()).toBeCloseTo(45.1 / 1.1, 8);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches and upserts historical Frankfurter rates on a cache miss, then returns the computed cross rate', async () => {
    const fetchSpy = mockFetch({
      frankfurter: frankfurterOk({ USD: 1.1, PLN: 45.2 }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { service, prisma } = buildService();

    const rate = await service.getRate('USD', 'PLN', new Date('2026-06-15'));

    expect(fetchSpy).toHaveBeenCalledTimes(3); // Frankfurter + secondary provider (jsdelivr, then Cloudflare fallback, since both default to failing() here)
    const frankfurterCall = fetchSpy.mock.calls.find(([url]: [string]) =>
      url.includes('frankfurter.dev'),
    );
    expect(frankfurterCall?.[0]).toContain('api.frankfurter.dev/v1/2026-06-15');
    expect(frankfurterCall?.[0]).toContain('from=EUR');
    expect(prisma.exchangeRate.upsert).toHaveBeenCalledTimes(2); // one per key in the Frankfurter response
    expect(rate.toNumber()).toBeCloseTo(45.2 / 1.1, 8);
  });

  it('resolves a secondary-provider currency (UAH) via the jsdelivr endpoint on a cache miss', async () => {
    const fetchSpy = mockFetch({
      jsdelivr: secondaryOk({ UAH: 41.5, RUB: 98.6 }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { service, prisma } = buildService();

    const rate = await service.getRate('EUR', 'UAH', new Date('2026-06-15'));

    expect(rate.toNumber()).toBe(41.5);
    const jsdelivrCall = fetchSpy.mock.calls.find(([url]: [string]) =>
      url.includes('jsdelivr.net'),
    );
    expect(jsdelivrCall?.[0]).toContain(
      '@fawazahmed0/currency-api@2026-06-15/v1/currencies/eur.json',
    );
    expect(prisma.exchangeRate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ toCurrency: 'UAH' }),
      }),
    );
    expect(prisma.exchangeRate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ toCurrency: 'RUB' }),
      }),
    );
  });

  it('falls back to the Cloudflare host when the jsdelivr host fails', async () => {
    const fetchSpy = mockFetch({
      jsdelivr: failing(500),
      cloudflare: secondaryOk({ UAH: 41.5, RUB: 98.6 }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { service } = buildService();

    const rate = await service.getRate('EUR', 'UAH', new Date('2026-06-15'));

    expect(rate.toNumber()).toBe(41.5);
    const calledUrls = fetchSpy.mock.calls.map(([url]: [string]) => url);
    expect(calledUrls.some((url: string) => url.includes('jsdelivr.net'))).toBe(
      true,
    );
    expect(
      calledUrls.some((url: string) => url.includes('currency-api.pages.dev')),
    ).toBe(true);
  });

  it('still resolves a Frankfurter currency when the secondary provider fails entirely', async () => {
    const fetchSpy = mockFetch({
      frankfurter: frankfurterOk({ USD: 1.1 }),
      // jsdelivr and cloudflare both default to failing()
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { service } = buildService();

    const rate = await service.getRate('EUR', 'USD', new Date('2026-06-15'));

    expect(rate.toNumber()).toBe(1.1);
  });

  it('still resolves a secondary-provider currency when Frankfurter fails entirely', async () => {
    const fetchSpy = mockFetch({
      jsdelivr: secondaryOk({ UAH: 41.5 }),
      // frankfurter defaults to failing()
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { service } = buildService();

    const rate = await service.getRate('EUR', 'UAH', new Date('2026-06-15'));

    expect(rate.toNumber()).toBe(41.5);
  });

  it('falls back to the most recent cached EUR rate when both providers fail', async () => {
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
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

  it('throws CURRENCY_API_UNAVAILABLE (503) when nothing is cached and both providers are down', async () => {
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    const { service } = buildService();

    try {
      await service.getRate('EUR', 'JPY', new Date('2026-09-01'));
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

  it('throws CURRENCY_NOT_SUPPORTED (400) for an unsupported currency code, without calling fetch or Prisma', async () => {
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    const { service, prisma } = buildService();

    try {
      await service.getRate('XXX', 'USD', new Date('2026-09-01'));
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect((error as AppException).getResponse()).toMatchObject({
        code: ERROR_CODES.CURRENCY_NOT_SUPPORTED,
      });
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.exchangeRate.findUnique).not.toHaveBeenCalled();
    expect(prisma.exchangeRate.findFirst).not.toHaveBeenCalled();
    expect(prisma.exchangeRate.upsert).not.toHaveBeenCalled();
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

  it('supportedCurrencies returns the whitelist including UAH and RUB', () => {
    const { service } = buildService();

    expect(service.supportedCurrencies()).toContain('PLN');
    expect(service.supportedCurrencies()).toContain('EUR');
    expect(service.supportedCurrencies()).toContain('UAH');
    expect(service.supportedCurrencies()).toContain('RUB');
    expect(service.supportedCurrencies().length).toBe(13);
  });

  it('refreshDailyRates fetches latest rates from both providers and upserts them without throwing on failure', async () => {
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    const { service } = buildService();

    await expect(service.refreshDailyRates()).resolves.toBeUndefined();
  });

  it("refreshDailyRates upserts today's rates from both providers on success", async () => {
    const fetchSpy = mockFetch({
      frankfurter: frankfurterOk({ USD: 1.08 }),
      jsdelivr: secondaryOk({ UAH: 41.5, RUB: 98.6 }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { service, prisma } = buildService();

    await service.refreshDailyRates();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const frankfurterCall = fetchSpy.mock.calls.find(([url]: [string]) =>
      url.includes('frankfurter.dev'),
    );
    expect(frankfurterCall?.[0]).toContain('api.frankfurter.dev/v1/latest');
    const jsdelivrCall = fetchSpy.mock.calls.find(([url]: [string]) =>
      url.includes('jsdelivr.net'),
    );
    expect(jsdelivrCall?.[0]).toContain('@fawazahmed0/currency-api@latest');
    expect(prisma.exchangeRate.upsert).toHaveBeenCalledTimes(3); // USD + UAH + RUB
  });
});
