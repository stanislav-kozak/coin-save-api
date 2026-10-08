import { Prisma } from '@prisma/client';
import { NotificationService } from './notifications.service';
import {
  buildPrismaMock,
  type PrismaMock,
} from '../../test/helpers/prisma-mock';

function buildService(
  overrides: {
    prisma?: Partial<{ [K in keyof PrismaMock]: Partial<PrismaMock[K]> }>;
    configValue?: string;
  } = {},
) {
  const prisma = buildPrismaMock(
    {
      recurringTransaction: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      recurringNotificationLog: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
    },
    overrides.prisma,
  );
  const mail = { send: vi.fn().mockResolvedValue(undefined) };
  const config = {
    get: vi
      .fn()
      .mockReturnValue(overrides.configValue ?? 'http://localhost:3001'),
  };
  const service = new NotificationService(
    prisma as never,
    mail as never,
    config as never,
  );
  return { service, prisma, mail, config };
}

const baseRecurring = {
  id: 'r1',
  name: 'Netflix',
  amount: new Prisma.Decimal('249.00'),
  currency: 'UAH',
  dayOfMonth: 15,
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  endDate: null,
  lastGeneratedAt: new Date('2026-05-15T00:00:00.000Z'),
  active: true,
  wallet: { icon: '💳', name: 'Моно' },
  category: { icon: '🎬' },
  createdBy: { email: 'user@example.com', locale: 'uk' },
};

describe('NotificationService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T09:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries only active recurrings with the wallet/category/createdBy relations', async () => {
    const { service, prisma } = buildService();

    await service.sendRecurringReminders();

    expect(prisma.recurringTransaction.findMany).toHaveBeenCalledWith({
      where: { active: true },
      include: { createdBy: true, wallet: true, category: true },
    });
  });

  it('sends a reminder email and logs it when the next occurrence is exactly 3 days out', async () => {
    const { service, prisma, mail, config } = buildService({
      prisma: {
        recurringTransaction: {
          findMany: vi.fn().mockResolvedValue([baseRecurring]),
        },
      },
    });

    await service.sendRecurringReminders();

    const expectedOccurrenceDate = new Intl.DateTimeFormat('uk-UA', {
      day: 'numeric',
      month: 'long',
    }).format(new Date('2026-06-15T00:00:00.000Z'));

    expect(mail.send).toHaveBeenCalledWith(
      'user@example.com',
      'uk',
      'recurring-reminder',
      {
        walletIcon: '💳',
        walletName: 'Моно',
        categoryIcon: '🎬',
        recurringName: 'Netflix',
        amount: '249.00',
        currency: 'UAH',
        occurrenceDate: expectedOccurrenceDate,
        manageUrl: 'http://localhost:3001/recurring',
      },
    );
    expect(prisma.recurringNotificationLog.create).toHaveBeenCalledWith({
      data: {
        recurringId: 'r1',
        forDate: new Date('2026-06-15T00:00:00.000Z'),
        channel: 'email',
      },
    });
    expect(config.get).toHaveBeenCalledWith('FRONTEND_URL');
  });

  it('does not send when the next occurrence is not exactly 3 days out', async () => {
    const { service, mail } = buildService({
      prisma: {
        recurringTransaction: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ ...baseRecurring, dayOfMonth: 20 }]),
        },
      },
    });

    await service.sendRecurringReminders();

    expect(mail.send).not.toHaveBeenCalled();
  });

  it('does not send when a notification log already exists for that date', async () => {
    const { service, mail, prisma } = buildService({
      prisma: {
        recurringTransaction: {
          findMany: vi.fn().mockResolvedValue([baseRecurring]),
        },
        recurringNotificationLog: {
          findUnique: vi.fn().mockResolvedValue({ id: 'log1' }),
        },
      },
    });

    await service.sendRecurringReminders();

    expect(mail.send).not.toHaveBeenCalled();
    expect(prisma.recurringNotificationLog.create).not.toHaveBeenCalled();
  });

  it('does not send when the next occurrence would fall after endDate', async () => {
    const { service, mail } = buildService({
      prisma: {
        recurringTransaction: {
          findMany: vi.fn().mockResolvedValue([
            {
              ...baseRecurring,
              endDate: new Date('2026-06-01T00:00:00.000Z'),
            },
          ]),
        },
      },
    });

    await service.sendRecurringReminders();

    expect(mail.send).not.toHaveBeenCalled();
  });

  it('writes in English unless the user chose Ukrainian', async () => {
    const { service, mail } = buildService({
      prisma: {
        recurringTransaction: {
          findMany: vi.fn().mockResolvedValue([
            {
              ...baseRecurring,
              createdBy: { email: 'en-user@example.com', locale: 'de' },
            },
          ]),
        },
      },
    });

    await service.sendRecurringReminders();

    expect(mail.send).toHaveBeenCalledWith(
      'en-user@example.com',
      'en',
      'recurring-reminder',
      expect.any(Object),
    );
  });

  it('logs and continues when one recurring fails, still sending for the next', async () => {
    const secondRecurring = {
      ...baseRecurring,
      id: 'r2',
      createdBy: { email: 'second@example.com', locale: 'uk' },
    };
    const findUnique = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(null);
    const { service, mail } = buildService({
      prisma: {
        recurringTransaction: {
          findMany: vi.fn().mockResolvedValue([baseRecurring, secondRecurring]),
        },
        recurringNotificationLog: { findUnique },
      },
    });

    await expect(service.sendRecurringReminders()).resolves.toBeUndefined();

    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(mail.send).toHaveBeenCalledWith(
      'second@example.com',
      'uk',
      'recurring-reminder',
      expect.any(Object),
    );
  });
});
