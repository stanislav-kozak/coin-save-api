import { execSync } from 'child_process';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { TransactionType, RecurringFrequency } from '@prisma/client';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { AppModule } from '../../src/app.module';
import { AppExceptionFilter } from '../../src/common/filters/app-exception.filter';
import { MailService } from '../../src/mail/mail.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationService } from '../../src/notifications/notifications.service';
import { createCookieAgent } from '../helpers/cookie-agent';

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + days,
    ),
  );
}

describe('Notifications flow (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  const capturedEmails: { to: string; vars: Record<string, string> }[] = [];

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('coinsave_test')
      .withUsername('postgres')
      .withPassword('postgres')
      .start();

    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.FRONTEND_URL = 'http://localhost:3001';
    process.env.RESEND_API_KEY = 'unused-in-tests';
    process.env.GOOGLE_CLIENT_ID = 'unused-in-tests';
    process.env.GOOGLE_CLIENT_SECRET = 'unused-in-tests';

    execSync('npx prisma migrate deploy', {
      env: process.env,
      stdio: 'inherit',
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({
        send: (
          to: string,
          _locale: string,
          _template: string,
          _subject: string,
          vars: Record<string, string>,
        ): Promise<void> => {
          capturedEmails.push({ to, vars });
          return Promise.resolve();
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new AppExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  it('sends a reminder exactly 3 days before the next occurrence, is idempotent, skips off-target and paused recurrings', async () => {
    const agent = createCookieAgent(app);
    const email = 'reminders@example.com';
    const password = 'super-secret-1';

    await agent.post('/api/auth/signup').send({ email, password }).expect(201);
    const user = await prisma.user.findUnique({ where: { email } });

    const notificationService = app.get(NotificationService);

    const today = startOfUtcDay(new Date());
    const target = addUtcDays(today, 3);
    const lastGeneratedAtMonthStart = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() - 1, 1),
    );
    const farPastStartDate = new Date(
      Date.UTC(target.getUTCFullYear() - 1, 0, 1),
    );

    const space = await prisma.space.create({
      data: {
        name: 'Family',
        slug: 'family-notifications-test',
        ownerId: user!.id,
        primaryCurrency: 'EUR',
      },
    });
    await prisma.membership.create({
      data: { userId: user!.id, spaceId: space.id, role: 'OWNER' },
    });
    const wallet = await prisma.wallet.create({
      data: {
        spaceId: space.id,
        name: 'Моно',
        currency: 'EUR',
        icon: '💳',
        initialBalance: 0,
      },
    });
    const category = await prisma.category.create({
      data: { spaceId: space.id, name: 'Subscriptions', icon: '🎬' },
    });

    const dueRecurring = await prisma.recurringTransaction.create({
      data: {
        spaceId: space.id,
        walletId: wallet.id,
        categoryId: category.id,
        type: TransactionType.EXPENSE,
        amount: 249,
        currency: 'EUR',
        name: 'Netflix',
        frequency: RecurringFrequency.MONTHLY,
        dayOfMonth: target.getUTCDate(),
        startDate: farPastStartDate,
        lastGeneratedAt: lastGeneratedAtMonthStart,
        active: true,
        createdById: user!.id,
      },
    });

    const offDayOfMonth = target.getUTCDate() === 1 ? 2 : 1;
    await prisma.recurringTransaction.create({
      data: {
        spaceId: space.id,
        walletId: wallet.id,
        categoryId: category.id,
        type: TransactionType.EXPENSE,
        amount: 10,
        currency: 'EUR',
        name: 'Not due yet',
        frequency: RecurringFrequency.MONTHLY,
        dayOfMonth: offDayOfMonth,
        startDate: farPastStartDate,
        lastGeneratedAt: lastGeneratedAtMonthStart,
        active: true,
        createdById: user!.id,
      },
    });

    await prisma.recurringTransaction.create({
      data: {
        spaceId: space.id,
        walletId: wallet.id,
        categoryId: category.id,
        type: TransactionType.EXPENSE,
        amount: 5,
        currency: 'EUR',
        name: 'Paused',
        frequency: RecurringFrequency.MONTHLY,
        dayOfMonth: target.getUTCDate(),
        startDate: farPastStartDate,
        lastGeneratedAt: lastGeneratedAtMonthStart,
        active: false,
        createdById: user!.id,
      },
    });

    capturedEmails.length = 0;
    await notificationService.sendRecurringReminders();

    expect(capturedEmails).toHaveLength(1);
    expect(capturedEmails[0].to).toBe(email);
    expect(capturedEmails[0].vars.recurringName).toBe('Netflix');
    expect(capturedEmails[0].vars.amount).toBe('249.00');

    const logsAfterFirstRun = await prisma.recurringNotificationLog.findMany({
      where: { recurringId: dueRecurring.id },
    });
    expect(logsAfterFirstRun).toHaveLength(1);

    await notificationService.sendRecurringReminders();

    expect(capturedEmails).toHaveLength(1);
    const logsAfterSecondRun = await prisma.recurringNotificationLog.findMany({
      where: { recurringId: dueRecurring.id },
    });
    expect(logsAfterSecondRun).toHaveLength(1);
  });
});
