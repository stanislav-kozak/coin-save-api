import { execSync } from 'child_process';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { TransactionType } from '@prisma/client';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { AppModule } from '../../src/app.module';
import { AppExceptionFilter } from '../../src/common/filters/app-exception.filter';
import { MailService } from '../../src/mail/mail.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createCookieAgent } from '../helpers/cookie-agent';

describe('Analytics flow (integration)', () => {
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

  it('computes totals, byCategory (incl. Uncategorized), byDay, previous period, and exports a matching CSV', async () => {
    const agent = createCookieAgent(app);
    const email = 'owner@example.com';
    const password = 'super-secret-1';

    await agent.post('/api/auth/signup').send({ email, password }).expect(201);
    const verifyEmail = capturedEmails.find((e) => e.to === email);
    const verifyToken = new URL(verifyEmail!.vars.verifyUrl).searchParams.get(
      'token',
    );
    await agent
      .post('/api/auth/verify-email')
      .send({ token: verifyToken })
      .expect(200);
    const loginRes = await agent
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    const userId = loginRes.body.user.id as string;

    const spaceRes = await agent
      .post('/api/spaces')
      .send({ name: 'Family' })
      .expect(201);
    const spaceId = spaceRes.body.id as string;

    const walletRes = await agent
      .post(`/api/spaces/${spaceId}/wallets`)
      .send({ name: 'Cash', currency: 'EUR', initialBalance: 0 })
      .expect(201);
    const walletId = walletRes.body.id as string;

    const categoriesRes = await agent
      .get(`/api/spaces/${spaceId}/categories`)
      .expect(200);
    const categoryId = (categoriesRes.body as { id: string }[])[0].id;
    await agent
      .patch(`/api/spaces/${spaceId}/categories/${categoryId}`)
      .send({ monthlyLimit: 100 })
      .expect(200);

    // In period (2026-06-01..2026-06-03): two categorized expenses (day 1
    // and day 3), one uncategorized expense (day 1), one income (day 2).
    await prisma.expense.create({
      data: {
        spaceId,
        walletId,
        categoryId,
        type: TransactionType.EXPENSE,
        amount: 60,
        walletCurrency: 'EUR',
        amountInPrimary: 60,
        fxRate: 1,
        note: 'Rent share, groceries',
        occurredAt: new Date('2026-06-01T10:00:00.000Z'),
        createdById: userId,
      },
    });
    await prisma.expense.create({
      data: {
        spaceId,
        walletId,
        categoryId: null,
        type: TransactionType.EXPENSE,
        amount: 15,
        walletCurrency: 'EUR',
        amountInPrimary: 15,
        fxRate: 1,
        note: null,
        occurredAt: new Date('2026-06-01T18:00:00.000Z'),
        createdById: userId,
      },
    });
    await prisma.expense.create({
      data: {
        spaceId,
        walletId,
        categoryId: null,
        type: TransactionType.INCOME,
        amount: 500,
        walletCurrency: 'EUR',
        amountInPrimary: 500,
        fxRate: 1,
        note: null,
        occurredAt: new Date('2026-06-02T09:00:00.000Z'),
        createdById: userId,
      },
    });
    await prisma.expense.create({
      data: {
        spaceId,
        walletId,
        categoryId,
        type: TransactionType.EXPENSE,
        amount: 30,
        walletCurrency: 'EUR',
        amountInPrimary: 30,
        fxRate: 1,
        note: null,
        occurredAt: new Date('2026-06-03T12:00:00.000Z'),
        createdById: userId,
      },
    });
    // Outside the period (previous period, 2026-05-29..2026-05-31, since the
    // tested period 2026-06-01..2026-06-03 spans ~3 days).
    await prisma.expense.create({
      data: {
        spaceId,
        walletId,
        categoryId,
        type: TransactionType.EXPENSE,
        amount: 25,
        walletCurrency: 'EUR',
        amountInPrimary: 25,
        fxRate: 1,
        note: null,
        occurredAt: new Date('2026-05-30T12:00:00.000Z'),
        createdById: userId,
      },
    });
    // Well outside any relevant window — must never appear.
    await prisma.expense.create({
      data: {
        spaceId,
        walletId,
        categoryId,
        type: TransactionType.EXPENSE,
        amount: 999,
        walletCurrency: 'EUR',
        amountInPrimary: 999,
        fxRate: 1,
        note: null,
        occurredAt: new Date('2026-01-01T12:00:00.000Z'),
        createdById: userId,
      },
    });

    const analyticsRes = await agent
      .get(`/api/spaces/${spaceId}/analytics?from=2026-06-01&to=2026-06-03`)
      .expect(200);

    expect(analyticsRes.body.currency).toBe('EUR');
    expect(Number(analyticsRes.body.totalExpense)).toBe(105); // 60+15+30
    expect(Number(analyticsRes.body.totalIncome)).toBe(500);
    expect(Number(analyticsRes.body.previousPeriodExpense)).toBe(25);
    expect(Number(analyticsRes.body.previousPeriodIncome)).toBe(0);

    const byCategory = analyticsRes.body.byCategory as {
      categoryId: string | null;
      name: string;
      spent: string;
      limit: string | null;
      pct: number;
    }[];
    const limited = byCategory.find((c) => c.categoryId === categoryId)!;
    expect(Number(limited.spent)).toBe(90); // 60+30
    expect(Number(limited.limit)).toBe(100);
    expect(limited.pct).toBe(90);
    const uncategorized = byCategory.find((c) => c.categoryId === null)!;
    expect(uncategorized.name).toBe('Uncategorized');
    expect(Number(uncategorized.spent)).toBe(15);

    const byDay = analyticsRes.body.byDay as {
      date: string;
      expense: string;
      income: string;
    }[];
    expect(byDay).toHaveLength(3);
    expect(byDay[0]).toMatchObject({ date: '2026-06-01' });
    expect(Number(byDay[0].expense)).toBe(75); // 60+15
    expect(Number(byDay[1].income)).toBe(500);
    expect(Number(byDay[2].expense)).toBe(30);

    expect(analyticsRes.body.expenses).toHaveLength(4); // 3 expenses + 1 income, in-period only

    const csvRes = await agent
      .get(`/api/spaces/${spaceId}/expenses.csv?from=2026-06-01&to=2026-06-03`)
      .expect(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.headers['content-disposition']).toBe(
      'attachment; filename="expenses.csv"',
    );
    const csvLines = csvRes.text.split('\r\n');
    expect(csvLines[0]).toBe(
      'Date,Wallet,Category,Amount,Currency,AmountInPrimary,PrimaryCurrency,Note,CreatedBy',
    );
    expect(csvLines).toHaveLength(5); // header + 4 in-period rows
    const rentRow = csvLines.find((line) => line.includes('Rent share'));
    expect(rentRow).toContain('"Rent share, groceries"');
    expect(csvLines.some((line) => line.includes('999'))).toBe(false);
  });
});
