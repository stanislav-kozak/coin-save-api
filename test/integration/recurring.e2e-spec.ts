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
import { createCookieAgent } from '../helpers/cookie-agent';

describe('Recurring flow (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
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
});
