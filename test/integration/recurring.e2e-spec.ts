import { execSync } from 'child_process';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { RecurringFrequency, TransactionType } from '@prisma/client';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { AppModule } from '../../src/app.module';
import { AppExceptionFilter } from '../../src/common/filters/app-exception.filter';
import { MailService } from '../../src/mail/mail.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RecurringGeneratorService } from '../../src/recurring/recurring-generator.service';
import { createCookieAgent } from '../helpers/cookie-agent';

describe('Recurring flow (integration)', () => {
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

  it('creates a recurring transaction, deriving currency from the wallet, and 404s on a foreign wallet', async () => {
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
    await agent.post('/api/auth/login').send({ email, password }).expect(200);

    const spaceRes = await agent
      .post('/api/spaces')
      .send({ name: 'Family' })
      .expect(201);
    const spaceId = spaceRes.body.id as string;

    const walletRes = await agent
      .post(`/api/spaces/${spaceId}/wallets`)
      .send({ name: 'Cash', currency: 'USD', initialBalance: 1000 })
      .expect(201);
    const walletId = walletRes.body.id as string;

    const createRes = await agent
      .post(`/api/spaces/${spaceId}/recurring`)
      .send({
        walletId,
        type: TransactionType.EXPENSE,
        amount: 15.99,
        name: 'Netflix',
        frequency: RecurringFrequency.MONTHLY,
        dayOfMonth: 5,
        startDate: '2026-07-01T00:00:00.000Z',
      })
      .expect(201);
    expect(createRes.body.currency).toBe('USD');
    expect(createRes.body.active).toBe(true);

    const otherSpaceRes = await agent
      .post('/api/spaces')
      .send({ name: 'Other' })
      .expect(201);
    const otherWalletRes = await agent
      .post(`/api/spaces/${otherSpaceRes.body.id}/wallets`)
      .send({ name: 'Other wallet', currency: 'PLN', initialBalance: 0 })
      .expect(201);

    const notFoundRes = await agent
      .post(`/api/spaces/${spaceId}/recurring`)
      .send({
        walletId: otherWalletRes.body.id,
        type: TransactionType.EXPENSE,
        amount: 10,
        name: 'Cross-space wallet',
        frequency: RecurringFrequency.MONTHLY,
        dayOfMonth: 1,
        startDate: '2026-07-01T00:00:00.000Z',
      })
      .expect(404);
    expect(notFoundRes.body.code).toBe('WALLET_NOT_FOUND');
  });

  it('generates missed Expense rows on demand, is idempotent on re-run, and advances lastGeneratedAt', async () => {
    const agent = createCookieAgent(app);
    const email = 'generator@example.com';
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

    // Currency matches the space's default primaryCurrency (EUR), so
    // CurrencyService.getRate short-circuits without any network call —
    // no fetch mocking needed for this test.
    const walletRes = await agent
      .post(`/api/spaces/${spaceId}/wallets`)
      .send({ name: 'Cash', currency: 'EUR', initialBalance: 0 })
      .expect(201);
    const walletId = walletRes.body.id as string;

    const recurring = await prisma.recurringTransaction.create({
      data: {
        spaceId,
        walletId,
        type: TransactionType.EXPENSE,
        amount: 15.99,
        currency: 'EUR',
        name: 'Netflix',
        frequency: RecurringFrequency.MONTHLY,
        dayOfMonth: 5,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        lastGeneratedAt: new Date('2026-01-05T00:00:00.000Z'),
        active: true,
        createdById: userId,
      },
    });

    const generatorService = app.get(RecurringGeneratorService);
    await generatorService.generateForRecurring(
      recurring.id,
      new Date('2026-04-10T00:00:00.000Z'),
    );

    const generated = await prisma.expense.findMany({
      where: { recurringId: recurring.id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(generated).toHaveLength(3);
    expect(
      generated.map((e) => e.occurredAt.toISOString().slice(0, 10)),
    ).toEqual(['2026-02-05', '2026-03-05', '2026-04-05']);
    expect(Number(generated[0].fxRate)).toBe(1);
    expect(Number(generated[0].amountInPrimary)).toBeCloseTo(15.99, 4);

    const updatedRecurring = await prisma.recurringTransaction.findUnique({
      where: { id: recurring.id },
    });
    expect(updatedRecurring?.lastGeneratedAt?.toISOString().slice(0, 10)).toBe(
      '2026-04-05',
    );

    // Idempotent re-run: no duplicates.
    await generatorService.generateForRecurring(
      recurring.id,
      new Date('2026-04-10T00:00:00.000Z'),
    );
    const generatedAgain = await prisma.expense.findMany({
      where: { recurringId: recurring.id },
    });
    expect(generatedAgain).toHaveLength(3);
  });

  it('pauses, resumes, updates, and deletes a recurring transaction via the API, leaving generated expenses with recurringId=null after delete', async () => {
    const agent = createCookieAgent(app);
    const email = 'crud@example.com';
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

    const createRes = await agent
      .post(`/api/spaces/${spaceId}/recurring`)
      .send({
        walletId,
        type: TransactionType.EXPENSE,
        amount: 15.99,
        name: 'Netflix',
        frequency: RecurringFrequency.MONTHLY,
        dayOfMonth: 5,
        startDate: '2020-01-01T00:00:00.000Z',
      })
      .expect(201);
    const recurringId = createRes.body.id as string;

    const generatorService = app.get(RecurringGeneratorService);
    await generatorService.generateForRecurring(recurringId, new Date());
    const backfilledExpenses = await prisma.expense.findMany({
      where: { recurringId },
    });
    expect(backfilledExpenses).toEqual([]);

    await agent
      .patch(`/api/spaces/${spaceId}/recurring/${recurringId}/pause`)
      .expect(200);
    const afterPause = await agent
      .get(`/api/spaces/${spaceId}/recurring/${recurringId}`)
      .expect(200);
    expect(afterPause.body.active).toBe(false);

    const listActiveOnly = await agent
      .get(`/api/spaces/${spaceId}/recurring`)
      .expect(200);
    expect(listActiveOnly.body).toHaveLength(0);
    const listAll = await agent
      .get(`/api/spaces/${spaceId}/recurring?includeInactive=true`)
      .expect(200);
    expect(listAll.body).toHaveLength(1);

    await agent
      .patch(`/api/spaces/${spaceId}/recurring/${recurringId}/resume`)
      .expect(200);

    const updateRes = await agent
      .patch(`/api/spaces/${spaceId}/recurring/${recurringId}`)
      .send({ amount: 20 })
      .expect(200);
    expect(Number(updateRes.body.amount)).toBe(20);

    const generatedExpense = await prisma.expense.create({
      data: {
        spaceId,
        walletId,
        type: TransactionType.EXPENSE,
        amount: 20,
        walletCurrency: 'EUR',
        amountInPrimary: 20,
        fxRate: 1,
        occurredAt: new Date(),
        createdById: userId,
        recurringId,
      },
    });

    await agent
      .delete(`/api/spaces/${spaceId}/recurring/${recurringId}`)
      .expect(204);

    const afterDeleteExpense = await prisma.expense.findUnique({
      where: { id: generatedExpense.id },
    });
    expect(afterDeleteExpense?.recurringId).toBeNull();

    const notFoundRes = await agent
      .get(`/api/spaces/${spaceId}/recurring/${recurringId}`)
      .expect(404);
    expect(notFoundRes.body.code).toBe('RECURRING_NOT_FOUND');
  });
});
