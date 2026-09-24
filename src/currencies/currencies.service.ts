import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';
import {
  FRANKFURTER_CURRENCIES,
  SECONDARY_PROVIDER_CURRENCIES,
  SUPPORTED_CURRENCIES,
} from '../common/constants/currencies';

const KYIV_TZ = 'Europe/Kyiv';
const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev/v1';
const SECONDARY_JSDELIVR_BASE =
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api';
const SECONDARY_CLOUDFLARE_HOST_SUFFIX = 'currency-api.pages.dev';
const REFERENCE_CURRENCY = 'EUR';

interface FrankfurterResponse {
  rates: Record<string, number>;
}

interface SecondaryProviderResponse {
  date: string;
  eur: Record<string, number>;
}

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  supportedCurrencies(): readonly string[] {
    return SUPPORTED_CURRENCIES;
  }

  async convert(
    amount: Prisma.Decimal,
    from: string,
    to: string,
    date: Date,
  ): Promise<Prisma.Decimal> {
    const rate = await this.getRate(from, to, date);
    return amount.times(rate);
  }

  async getRate(from: string, to: string, date: Date): Promise<Prisma.Decimal> {
    const unsupported = [from, to].filter(
      (currency) =>
        !(SUPPORTED_CURRENCIES as readonly string[]).includes(currency),
    );
    if (unsupported.length > 0) {
      throw new AppException(
        ERROR_CODES.CURRENCY_NOT_SUPPORTED,
        HttpStatus.BAD_REQUEST,
        `Unsupported currency code(s): ${unsupported.join(', ')}`,
      );
    }

    if (from === to) {
      return new Prisma.Decimal(1);
    }

    const dateStr = this.toKyivDateString(date);
    const dateOnly = new Date(`${dateStr}T00:00:00.000Z`);

    const direct = await this.prisma.exchangeRate.findUnique({
      where: {
        date_fromCurrency_toCurrency: {
          date: dateOnly,
          fromCurrency: from,
          toCurrency: to,
        },
      },
    });
    if (direct) {
      return direct.rate;
    }

    let eurToFrom = await this.getCachedEurRate(from, dateOnly);
    let eurToTo = await this.getCachedEurRate(to, dateOnly);

    if (!eurToFrom || !eurToTo) {
      try {
        const rates = await this.fetchAllRates(dateStr);
        await this.upsertRates(dateOnly, rates);
        eurToFrom = eurToFrom ?? this.rateFromFetched(from, rates);
        eurToTo = eurToTo ?? this.rateFromFetched(to, rates);
      } catch (error) {
        this.logger.warn(
          `Failed to fetch historical rates for ${dateOnly.toISOString()}: ${(error as Error).message}`,
        );
      }
    }

    if (!eurToFrom) {
      eurToFrom = await this.getMostRecentEurRate(from);
      if (eurToFrom) {
        this.logger.warn(
          `Using stale/fallback cached EUR rate for ${from} (most recent available, not for the requested date)`,
        );
      }
    }
    if (!eurToTo) {
      eurToTo = await this.getMostRecentEurRate(to);
      if (eurToTo) {
        this.logger.warn(
          `Using stale/fallback cached EUR rate for ${to} (most recent available, not for the requested date)`,
        );
      }
    }

    if (!eurToFrom || !eurToTo) {
      throw new AppException(
        ERROR_CODES.CURRENCY_API_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        `Exchange rate unavailable for ${from} -> ${to}`,
      );
    }

    return eurToTo.dividedBy(eurToFrom);
  }

  @Cron('0 2 * * *', { name: 'refreshDailyRates', timeZone: KYIV_TZ })
  async refreshDailyRates(): Promise<void> {
    const today = this.toKyivDateOnly(new Date());
    try {
      const rates = await this.fetchAllRates('latest');
      await this.upsertRates(today, rates);
    } catch (error) {
      this.logger.warn(
        `Failed to refresh daily exchange rates: ${(error as Error).message}`,
      );
    }
  }

  private async getCachedEurRate(
    currency: string,
    date: Date,
  ): Promise<Prisma.Decimal | null> {
    if (currency === REFERENCE_CURRENCY) {
      return new Prisma.Decimal(1);
    }
    const row = await this.prisma.exchangeRate.findUnique({
      where: {
        date_fromCurrency_toCurrency: {
          date,
          fromCurrency: REFERENCE_CURRENCY,
          toCurrency: currency,
        },
      },
    });
    return row?.rate ?? null;
  }

  private rateFromFetched(
    currency: string,
    rates: Record<string, number>,
  ): Prisma.Decimal | null {
    if (currency === REFERENCE_CURRENCY) {
      return new Prisma.Decimal(1);
    }
    const value = rates[currency];
    return value === undefined ? null : new Prisma.Decimal(value);
  }

  private async getMostRecentEurRate(
    currency: string,
  ): Promise<Prisma.Decimal | null> {
    if (currency === REFERENCE_CURRENCY) {
      return new Prisma.Decimal(1);
    }
    const row = await this.prisma.exchangeRate.findFirst({
      where: { fromCurrency: REFERENCE_CURRENCY, toCurrency: currency },
      orderBy: { date: 'desc' },
    });
    return row?.rate ?? null;
  }

  private async fetchAllRates(
    dateSegment: string,
  ): Promise<Record<string, number>> {
    const [frankfurterResult, secondaryResult] = await Promise.allSettled([
      this.fetchFrankfurterRates(dateSegment),
      this.fetchSecondaryRates(dateSegment),
    ]);

    const combined: Record<string, number> = {};
    if (frankfurterResult.status === 'fulfilled') {
      Object.assign(combined, frankfurterResult.value);
    } else {
      this.logger.warn(
        `frankfurter.dev fetch failed: ${(frankfurterResult.reason as Error).message}`,
      );
    }
    if (secondaryResult.status === 'fulfilled') {
      Object.assign(combined, secondaryResult.value);
    } else {
      this.logger.warn(
        `Secondary currency provider fetch failed: ${(secondaryResult.reason as Error).message}`,
      );
    }

    if (
      frankfurterResult.status === 'rejected' &&
      secondaryResult.status === 'rejected'
    ) {
      throw new Error('Both currency rate providers failed');
    }

    return combined;
  }

  private async fetchFrankfurterRates(
    dateSegment: string,
  ): Promise<Record<string, number>> {
    const targets = FRANKFURTER_CURRENCIES.filter(
      (currency) => currency !== REFERENCE_CURRENCY,
    );
    const url = `${FRANKFURTER_BASE_URL}/${dateSegment}?from=${REFERENCE_CURRENCY}&to=${targets.join(',')}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) {
      throw new Error(`frankfurter.dev responded with ${res.status}`);
    }
    const body = (await res.json()) as FrankfurterResponse;
    const returned = new Set(Object.keys(body.rates));
    const missing = targets.filter((currency) => !returned.has(currency));
    if (missing.length > 0) {
      this.logger.warn(
        `frankfurter.dev response is missing requested currency codes: ${missing.join(', ')}`,
      );
    }
    return body.rates;
  }

  private async fetchSecondaryRates(
    dateSegment: string,
  ): Promise<Record<string, number>> {
    const jsdelivrUrl = `${SECONDARY_JSDELIVR_BASE}@${dateSegment}/v1/currencies/eur.json`;
    const cloudflareUrl = `https://${dateSegment}.${SECONDARY_CLOUDFLARE_HOST_SUFFIX}/v1/currencies/eur.json`;

    let body: SecondaryProviderResponse;
    try {
      body = await this.fetchSecondaryJson(jsdelivrUrl);
    } catch (jsdelivrError) {
      this.logger.warn(
        `Secondary provider jsdelivr host failed (${(jsdelivrError as Error).message}), trying Cloudflare fallback`,
      );
      body = await this.fetchSecondaryJson(cloudflareUrl);
    }

    const rates: Record<string, number> = {};
    for (const currency of SECONDARY_PROVIDER_CURRENCIES) {
      const value = body.eur[currency.toLowerCase()];
      if (value === undefined) {
        this.logger.warn(
          `Secondary currency provider response is missing requested currency code: ${currency}`,
        );
        continue;
      }
      rates[currency] = value;
    }
    return rates;
  }

  private async fetchSecondaryJson(
    url: string,
  ): Promise<SecondaryProviderResponse> {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) {
      throw new Error(
        `secondary currency provider responded with ${res.status}`,
      );
    }
    return (await res.json()) as SecondaryProviderResponse;
  }

  private async upsertRates(
    date: Date,
    rates: Record<string, number>,
  ): Promise<void> {
    for (const [toCurrency, rate] of Object.entries(rates)) {
      await this.prisma.exchangeRate.upsert({
        where: {
          date_fromCurrency_toCurrency: {
            date,
            fromCurrency: REFERENCE_CURRENCY,
            toCurrency,
          },
        },
        create: { date, fromCurrency: REFERENCE_CURRENCY, toCurrency, rate },
        update: { rate, fetchedAt: new Date() },
      });
    }
  }

  private toKyivDateOnly(date: Date): Date {
    const dateStr = this.toKyivDateString(date);
    return new Date(`${dateStr}T00:00:00.000Z`);
  }

  private toKyivDateString(date: Date): string {
    return formatInTimeZone(date, KYIV_TZ, 'yyyy-MM-dd');
  }
}
