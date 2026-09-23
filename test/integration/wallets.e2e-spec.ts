import { execSync } from 'child_process';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { TransactionType } from '@prisma/client';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { AppModule } from '../../src/app.module';
import { AppExceptionFilter } from '../../src/common/filters/app-exception.filter';
import { MailService } from '../../src/mail/mail.service';
import { PrismaService } from '../../src/prisma/prisma.service';

// `request.agent()`'s built-in cookie jar refuses to replay `Secure`-flagged
// cookies over a plain-http connection (see `cookiejar`'s
// `access_info.secure` check), and the auth cookies set by `AuthController`
// are always `secure: true`. Since this test server runs over http, the
// stock agent silently drops the session after login. This minimal
// hand-rolled jar captures `Set-Cookie` headers (honoring each cookie's
// `Path` attribute, the way a real cookie jar would) and replays them
// regardless of the `Secure` attribute, which is what we want for an http
// test server standing in for a real https deployment.
// (Same fix as `test/integration/spaces.e2e-spec.ts`.)
interface CapturedCookie {
  name: string;
  value: string;
  path: string;
}

function cookieAppliesToPath(cookiePath: string, requestPath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

function createCookieAgent(
  app: INestApplication,
): Record<'post' | 'get' | 'patch', (path: string) => request.Test> {
  const cookies: CapturedCookie[] = [];

  function captureCookies(res: request.Response): void {
    const setCookie = res.headers['set-cookie'] as unknown as
      string[] | undefined;
    if (!setCookie) return;
    for (const raw of setCookie) {
      const [namePair, ...attrs] = raw.split(';').map((part) => part.trim());
      const eq = namePair.indexOf('=');
      if (eq === -1) continue;
      const name = namePair.slice(0, eq);
      const value = namePair.slice(eq + 1);
      const pathAttr = attrs.find((a) => a.toLowerCase().startsWith('path='));
      const path = pathAttr ? pathAttr.slice('path='.length) : '/';
      const existing = cookies.find((c) => c.name === name && c.path === path);
      if (existing) {
        existing.value = value;
      } else {
        cookies.push({ name, value, path });
      }
    }
  }

  function build(method: 'post' | 'get' | 'patch') {
    return (path: string): request.Test => {
      const req = request(app.getHttpServer())[method](path);
      const applicable = cookies.filter((c) =>
        cookieAppliesToPath(c.path, path),
      );
      if (applicable.length > 0) {
        const header = applicable.map((c) => `${c.name}=${c.value}`).join('; ');
        req.set('Cookie', header);
      }
      type EndCallback = (err: Error | null, res: request.Response) => void;
      const originalEnd = req.end.bind(req) as (cb?: EndCallback) => void;
      req.end = (callback?: EndCallback): request.Test => {
        originalEnd((err, res) => {
          if (res) captureCookies(res);
          callback?.(err, res);
        });
        return req;
      };
      return req;
    };
  }

  return { post: build('post'), get: build('get'), patch: build('patch') };
}

describe('Wallets flow (integration)', () => {
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

  it('runs the full wallet lifecycle: create, balance from seeded expenses, archive/unarchive, 404', async () => {
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

    const createRes = await agent
      .post(`/api/spaces/${spaceId}/wallets`)
      .send({ name: 'Cash', currency: 'UAH', initialBalance: 1000 })
      .expect(201);
    const walletId = createRes.body.id as string;
    expect(Number(createRes.body.balance)).toBe(1000);
    expect(createRes.body.archived).toBe(false);

    await prisma.expense.create({
      data: {
        spaceId,
        walletId,
        type: TransactionType.INCOME,
        amount: 200,
        walletCurrency: 'UAH',
        amountInPrimary: 200,
        fxRate: 1,
        occurredAt: new Date(),
        createdById: userId,
      },
    });
    await prisma.expense.create({
      data: {
        spaceId,
        walletId,
        type: TransactionType.EXPENSE,
        amount: 150,
        walletCurrency: 'UAH',
        amountInPrimary: 150,
        fxRate: 1,
        occurredAt: new Date(),
        createdById: userId,
      },
    });

    const afterExpensesRes = await agent
      .get(`/api/spaces/${spaceId}/wallets/${walletId}`)
      .expect(200);
    expect(Number(afterExpensesRes.body.balance)).toBe(1050);

    await agent
      .patch(`/api/spaces/${spaceId}/wallets/${walletId}/archive`)
      .expect(200);

    const listDefault = await agent
      .get(`/api/spaces/${spaceId}/wallets`)
      .expect(200);
    expect(listDefault.body).toHaveLength(0);

    const listWithArchived = await agent
      .get(`/api/spaces/${spaceId}/wallets?includeArchived=true`)
      .expect(200);
    expect(listWithArchived.body).toHaveLength(1);
    expect(listWithArchived.body[0].archived).toBe(true);

    const unarchiveRes = await agent
      .patch(`/api/spaces/${spaceId}/wallets/${walletId}/unarchive`)
      .expect(200);
    expect(unarchiveRes.body.archived).toBe(false);

    const res = await agent
      .get(`/api/spaces/${spaceId}/wallets/does-not-exist`)
      .expect(404);
    expect(res.body.code).toBe('WALLET_NOT_FOUND');
  });
});
