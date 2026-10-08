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
import { CurrencyService } from '../../src/currencies/currencies.service';
import { MailService } from '../../src/mail/mail.service';
import { createCookieAgent } from '../helpers/cookie-agent';
import {
  failing,
  frankfurterOk,
  mockFetch,
} from '../helpers/currency-fetch-mock';

describe('Expenses flow (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let currencyService: CurrencyService;
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

    currencyService = moduleRef.get(CurrencyService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs the full expense lifecycle: create, FX conversion, list filters, update with recompute, update without recompute, delete, 404', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ frankfurter: frankfurterOk({ USD: 1.1, PLN: 4.3 }) }),
    );

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

    // Space.primaryCurrency defaults to EUR; a USD wallet forces a real
    // EUR<->USD cross-rate computation on create.
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

    const categoriesRes = await agent
      .get(`/api/spaces/${spaceId}/categories`)
      .expect(200);
    const categoryId = (categoriesRes.body as { id: string }[])[0].id;

    const createRes = await agent
      .post(`/api/spaces/${spaceId}/expenses`)
      .send({
        walletId,
        categoryId,
        type: TransactionType.EXPENSE,
        amount: 100,
        occurredAt: '2026-06-10T00:00:00.000Z',
        note: 'Groceries',
      })
      .expect(201);
    const expenseId = createRes.body.id as string;
    expect(createRes.body.walletCurrency).toBe('USD');
    expect(Number(createRes.body.fxRate)).toBeCloseTo(1 / 1.1, 6);
    expect(Number(createRes.body.amountInPrimary)).toBeCloseTo(100 / 1.1, 2);

    await agent
      .post(`/api/spaces/${spaceId}/expenses`)
      .send({
        walletId,
        type: TransactionType.INCOME,
        amount: 500,
        occurredAt: '2026-06-11T00:00:00.000Z',
      })
      .expect(201);

    const listRes = await agent
      .get(`/api/spaces/${spaceId}/expenses?type=EXPENSE`)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].id).toBe(expenseId);

    const getRes = await agent
      .get(`/api/spaces/${spaceId}/expenses/${expenseId}`)
      .expect(200);
    expect(getRes.body.note).toBe('Groceries');

    const getRateSpy = vi.spyOn(currencyService, 'getRate');
    const noteUpdateRes = await agent
      .patch(`/api/spaces/${spaceId}/expenses/${expenseId}`)
      .send({ note: 'Weekly groceries' })
      .expect(200);
    expect(getRateSpy).not.toHaveBeenCalled();
    getRateSpy.mockRestore();
    expect(noteUpdateRes.body.note).toBe('Weekly groceries');
    expect(Number(noteUpdateRes.body.fxRate)).toBeCloseTo(1 / 1.1, 6);
    expect(Number(noteUpdateRes.body.amountInPrimary)).toBeCloseTo(
      100 / 1.1,
      2,
    );

    // null clears the category («Без категорії») and the note; absent fields
    // stay as they are.
    expect(noteUpdateRes.body.categoryId).toBe(categoryId);
    const clearedRes = await agent
      .patch(`/api/spaces/${spaceId}/expenses/${expenseId}`)
      .send({ categoryId: null, note: null })
      .expect(200);
    expect(clearedRes.body.categoryId).toBeNull();
    expect(clearedRes.body.note).toBeNull();
    expect(Number(clearedRes.body.amount)).toBe(100);

    const amountUpdateRes = await agent
      .patch(`/api/spaces/${spaceId}/expenses/${expenseId}`)
      .send({ amount: 200 })
      .expect(200);
    expect(Number(amountUpdateRes.body.amount)).toBe(200);
    expect(Number(amountUpdateRes.body.amountInPrimary)).toBeCloseTo(
      200 / 1.1,
      2,
    );

    await agent
      .delete(`/api/spaces/${spaceId}/expenses/${expenseId}`)
      .expect(204);

    const notFoundRes = await agent
      .get(`/api/spaces/${spaceId}/expenses/${expenseId}`)
      .expect(404);
    expect(notFoundRes.body.code).toBe('EXPENSE_NOT_FOUND');
  });

  it('re-converts transactions and limits when the primary currency changes', async () => {
    // Rates per EUR: 1 EUR = 1.1 USD = 4.3 PLN (same for every day here).
    vi.stubGlobal(
      'fetch',
      mockFetch({ frankfurter: frankfurterOk({ USD: 1.1, PLN: 4.3 }) }),
    );

    const agent = createCookieAgent(app);
    const email = 'currency-owner@example.com';
    const password = 'super-secret-1';
    await agent.post('/api/auth/signup').send({ email, password }).expect(201);
    const verifyToken = new URL(
      capturedEmails.find((e) => e.to === email)!.vars.verifyUrl,
    ).searchParams.get('token');
    await agent
      .post('/api/auth/verify-email')
      .send({ token: verifyToken })
      .expect(200);
    await agent.post('/api/auth/login').send({ email, password }).expect(200);

    const spaceId = (
      await agent.post('/api/spaces').send({ name: 'FX' }).expect(201)
    ).body.id as string; // primaryCurrency EUR
    const walletId = (
      await agent
        .post(`/api/spaces/${spaceId}/wallets`)
        .send({ name: 'Dollars', currency: 'USD', initialBalance: 0 })
        .expect(201)
    ).body.id as string;
    const categoryId = (
      (await agent.get(`/api/spaces/${spaceId}/categories`).expect(200))
        .body as { id: string }[]
    )[0].id;
    await agent
      .patch(`/api/spaces/${spaceId}/categories/${categoryId}`)
      .send({ monthlyLimit: 100 })
      .expect(200);
    const expenseId = (
      await agent
        .post(`/api/spaces/${spaceId}/expenses`)
        .send({
          walletId,
          categoryId,
          type: TransactionType.EXPENSE,
          amount: 110,
          occurredAt: '2026-06-10T12:00:00.000Z',
        })
        .expect(201)
    ).body.id as string;

    // More rows across days and wallet currencies, to exercise the batched
    // rate lookup and set-based updates.
    const plnWalletId = (
      await agent
        .post(`/api/spaces/${spaceId}/wallets`)
        .send({ name: 'Zloty', currency: 'PLN', initialBalance: 0 })
        .expect(201)
    ).body.id as string;
    const plnExpenseId = (
      await agent
        .post(`/api/spaces/${spaceId}/expenses`)
        .send({
          walletId: plnWalletId,
          type: TransactionType.EXPENSE,
          amount: 43,
          occurredAt: '2026-06-11T09:00:00.000Z',
        })
        .expect(201)
    ).body.id as string;
    const secondUsdExpenseId = (
      await agent
        .post(`/api/spaces/${spaceId}/expenses`)
        .send({
          walletId,
          type: TransactionType.INCOME,
          amount: 22,
          occurredAt: '2026-06-12T09:00:00.000Z',
        })
        .expect(201)
    ).body.id as string;

    await agent
      .patch(`/api/spaces/${spaceId}`)
      .send({ primaryCurrency: 'XYZ' })
      .expect(400);

    const changed = await agent
      .patch(`/api/spaces/${spaceId}`)
      .send({ primaryCurrency: 'PLN' })
      .expect(200);
    expect(changed.body.primaryCurrency).toBe('PLN');

    const expense = await agent
      .get(`/api/spaces/${spaceId}/expenses/${expenseId}`)
      .expect(200);
    expect(Number(expense.body.amountInPrimary)).toBeCloseTo(430, 2); // 110 USD
    expect(Number(expense.body.fxRate)).toBeCloseTo(4.3 / 1.1, 6);
    const plnExpense = await agent
      .get(`/api/spaces/${spaceId}/expenses/${plnExpenseId}`)
      .expect(200);
    expect(Number(plnExpense.body.amountInPrimary)).toBe(43); // PLN -> PLN
    expect(Number(plnExpense.body.fxRate)).toBe(1);
    const secondUsd = await agent
      .get(`/api/spaces/${spaceId}/expenses/${secondUsdExpenseId}`)
      .expect(200);
    expect(Number(secondUsd.body.amountInPrimary)).toBeCloseTo(86, 2); // 22 USD
    expect(new Date(secondUsd.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(changed.body.updatedAt).getTime() - 1000,
    );

    const category = await agent
      .get(`/api/spaces/${spaceId}/categories/${categoryId}`)
      .expect(200);
    expect(Number(category.body.monthlyLimit)).toBe(430); // 100 EUR

    const analytics = await agent
      .get(`/api/spaces/${spaceId}/analytics?from=2026-06-01&to=2026-06-30`)
      .expect(200);
    expect(analytics.body.currency).toBe('PLN');
    expect(Number(analytics.body.totalExpense)).toBeCloseTo(473, 2); // 430 + 43 PLN

    // No CHF rate cached and the provider is down: nothing may change.
    vi.stubGlobal('fetch', mockFetch({ frankfurter: failing() }));
    const unavailable = await agent
      .patch(`/api/spaces/${spaceId}`)
      .send({ primaryCurrency: 'CHF' })
      .expect(503);
    expect(unavailable.body.code).toBe('CURRENCY_API_UNAVAILABLE');
    const after = await agent.get(`/api/spaces/${spaceId}`).expect(200);
    expect(after.body.primaryCurrency).toBe('PLN');
    const expenseAfter = await agent
      .get(`/api/spaces/${spaceId}/expenses/${expenseId}`)
      .expect(200);
    expect(Number(expenseAfter.body.amountInPrimary)).toBeCloseTo(430, 2);
  });

  it("GET /api/currencies/rate returns today's rate from the same cache", async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ frankfurter: frankfurterOk({ USD: 1.1, PLN: 4.3 }) }),
    );
    const agent = createCookieAgent(app);
    const email = 'rate@example.com';
    const password = 'super-secret-1';
    await agent.post('/api/auth/signup').send({ email, password }).expect(201);
    const verifyToken = new URL(
      capturedEmails.find((e) => e.to === email)!.vars.verifyUrl,
    ).searchParams.get('token');
    await agent
      .post('/api/auth/verify-email')
      .send({ token: verifyToken })
      .expect(200);

    await agent.get('/api/currencies/rate?from=USD&to=PLN').expect(401);
    await agent.post('/api/auth/login').send({ email, password }).expect(200);

    const res = await agent
      .get('/api/currencies/rate?from=USD&to=PLN')
      .expect(200);
    expect(res.body).toMatchObject({ from: 'USD', to: 'PLN' });
    expect(typeof res.body.rate).toBe('string');
    expect(Number(res.body.rate)).toBeCloseTo(4.3 / 1.1, 6);
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const same = await agent
      .get('/api/currencies/rate?from=EUR&to=EUR')
      .expect(200);
    expect(same.body.rate).toBe('1');

    const unknown = await agent
      .get('/api/currencies/rate?from=XYZ&to=EUR')
      .expect(400);
    expect(unknown.body.code).toBe('VALIDATION_ERROR');
  });
});
