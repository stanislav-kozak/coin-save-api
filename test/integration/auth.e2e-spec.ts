import { execSync } from 'child_process';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { AppModule } from '../../src/app.module';
import { AppExceptionFilter } from '../../src/common/filters/app-exception.filter';
import { MailService } from '../../src/mail/mail.service';

describe('Auth flow (integration)', () => {
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

  it('completes signup -> verify -> login -> refresh -> logout -> password reset', async () => {
    const email = 'family@example.com';
    const password = 'super-secret-1';

    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password })
      .expect(201);

    const verifyEmail = capturedEmails.find((e) => e.to === email);
    expect(verifyEmail).toBeDefined();
    const verifyToken = new URL(verifyEmail!.vars.verifyUrl).searchParams.get(
      'token',
    );

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: verifyToken })
      .expect(200);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const cookies = loginRes.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('access='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('refresh='))).toBe(true);

    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);
    const refreshedCookies = refreshRes.headers[
      'set-cookie'
    ] as unknown as string[];

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', refreshedCookies)
      .expect(200);

    capturedEmails.length = 0;
    await request(app.getHttpServer())
      .post('/auth/request-password-reset')
      .send({ email })
      .expect(200);

    const resetEmail = capturedEmails.find((e) => e.to === email);
    const resetToken = new URL(resetEmail!.vars.resetUrl).searchParams.get(
      'token',
    );

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: resetToken, newPassword: 'new-super-secret-1' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'new-super-secret-1' })
      .expect(200);
  });

  it('rejects reuse of an already-rotated refresh token', async () => {
    const email = 'reuse-test@example.com';
    const password = 'super-secret-1';

    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password })
      .expect(201);
    const verifyEmail = capturedEmails.find((e) => e.to === email);
    const verifyToken = new URL(verifyEmail!.vars.verifyUrl).searchParams.get(
      'token',
    );
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: verifyToken })
      .expect(200);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const originalCookies = loginRes.headers[
      'set-cookie'
    ] as unknown as string[];

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', originalCookies)
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', originalCookies)
      .expect(401);

    expect(res.body.code).toBe('REFRESH_TOKEN_REUSE_DETECTED');
  });
});
