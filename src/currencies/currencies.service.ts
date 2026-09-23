import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';
import { SUPPORTED_CURRENCIES } from '../common/constants/currencies';

const KYIV_TZ = 'Europe/Kyiv';
const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev/v1';
const REFERENCE_CURRENCY = 'EUR';

interface FrankfurterResponse {
  rates: Record<string, number>;
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
    if (from === to) {
      return new Prisma.Decimal(1);
    }

    const dateOnly = this.toKyivDateOnly(date);

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
        const dateStr = formatInTimeZone(dateOnly, KYIV_TZ, 'yyyy-MM-dd');
        const rates = await this.fetchRates(
          `${FRANKFURTER_BASE_URL}/${dateStr}`,
        );
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
    }
    if (!eurToTo) {
      eurToTo = await this.getMostRecentEurRate(to);
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

  @Cron('0 2 * * *', { timeZone: KYIV_TZ })
  async refreshDailyRates(): Promise<void> {
    const today = this.toKyivDateOnly(new Date());
    try {
      const rates = await this.fetchRates(`${FRANKFURTER_BASE_URL}/latest`);
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

  private async fetchRates(baseUrl: string): Promise<Record<string, number>> {
    const targets = SUPPORTED_CURRENCIES.filter(
      (currency) => currency !== REFERENCE_CURRENCY,
    ).join(',');
    const url = `${baseUrl}?from=${REFERENCE_CURRENCY}&to=${targets}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`frankfurter.dev responded with ${res.status}`);
    }
    const body = (await res.json()) as FrankfurterResponse;
    return body.rates;
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
        update: { rate },
      });
    }
  }

  private toKyivDateOnly(date: Date): Date {
    const dateStr = formatInTimeZone(date, KYIV_TZ, 'yyyy-MM-dd');
    return new Date(`${dateStr}T00:00:00.000Z`);
  }
}
