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
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

describe('Auth flow (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  const capturedEmails: { to: string; vars: Record<string, string> }[] = [];
  const failingRecipients = new Set<string>();

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
          if (failingRecipients.has(to)) {
            return Promise.reject(new Error('450 domain is not verified'));
          }
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

  // Each test is its own scenario: don't let earlier tests' signups/logins
  // count against the per-IP auth rate limits (covered in rate-limit.e2e-spec).
  beforeEach(() => {
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear();
  });

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  it('completes signup -> verify -> login -> refresh -> logout -> password reset', async () => {
    const email = 'family@example.com';
    const password = 'super-secret-1';

    await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email, password, name: 'Olena' })
      .expect(201);

    const verifyEmail = capturedEmails.find((e) => e.to === email);
    expect(verifyEmail).toBeDefined();
    const verifyToken = new URL(verifyEmail!.vars.verifyUrl).searchParams.get(
      'token',
    );

    await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ token: verifyToken })
      .expect(200);

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    const cookies = loginRes.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('access='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('refresh='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('session=1;'))).toBe(true);

    const meRes = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookies)
      .expect(200);
    expect(meRes.body).not.toHaveProperty('passwordHash');
    expect(Object.keys(meRes.body).sort()).toEqual([
      'avatarUrl',
      'createdAt',
      'email',
      'emailVerified',
      'id',
      'locale',
      'name',
      'updatedAt',
    ]);
    expect(meRes.body.email).toBe(email);
    expect(meRes.body.name).toBe('Olena');

    const refreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);
    const refreshedCookies = refreshRes.headers[
      'set-cookie'
    ] as unknown as string[];

    const logoutRes = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', refreshedCookies)
      .expect(200);
    const logoutCookies = logoutRes.headers[
      'set-cookie'
    ] as unknown as string[];
    expect(logoutCookies.some((c) => c.startsWith('session=;'))).toBe(true);

    capturedEmails.length = 0;
    await request(app.getHttpServer())
      .post('/api/auth/request-password-reset')
      .send({ email })
      .expect(200);

    const resetEmail = capturedEmails.find((e) => e.to === email);
    const resetToken = new URL(resetEmail!.vars.resetUrl).searchParams.get(
      'token',
    );

    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: 'new-super-secret-1' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'new-super-secret-1' })
      .expect(200);
  });

  it('resends a verification link that replaces the previous one', async () => {
    const email = 'resend-test@example.com';
    const password = 'super-secret-1';
    const tokenFromEmail = (index: number): string | null => {
      const sent = capturedEmails.filter((e) => e.to === email);
      return new URL(sent[index].vars.verifyUrl).searchParams.get('token');
    };

    await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email, password })
      .expect(201);
    const firstToken = tokenFromEmail(0);

    await request(app.getHttpServer())
      .post('/api/auth/resend-verification')
      .send({ email })
      .expect(200);
    const secondToken = tokenFromEmail(1);

    await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ token: firstToken })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ token: secondToken })
      .expect(200);

    // Once verified, further resends are accepted but send nothing.
    await request(app.getHttpServer())
      .post('/api/auth/resend-verification')
      .send({ email })
      .expect(200);
    expect(capturedEmails.filter((e) => e.to === email)).toHaveLength(2);
  });

  it('lets the user retry signup when the verification email could not be sent', async () => {
    const email = 'mail-down@example.com';
    const password = 'super-secret-1';

    failingRecipients.add(email);
    const failed = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email, password })
      .expect(503);
    expect(failed.body.code).toBe('EMAIL_DELIVERY_FAILED');

    // The half-created account was rolled back, so this is not a 409.
    failingRecipients.delete(email);
    await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email, password })
      .expect(201);
    expect(capturedEmails.some((e) => e.to === email)).toBe(true);
  });

  it('ends existing sessions when the password is reset', async () => {
    const email = 'reset-revokes@example.com';
    const password = 'super-secret-1';

    await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email, password })
      .expect(201);
    const verifyToken = new URL(
      capturedEmails.find((e) => e.to === email)!.vars.verifyUrl,
    ).searchParams.get('token');
    await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ token: verifyToken })
      .expect(200);

    // A session on another device, e.g. a stolen one.
    const otherDevice = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    const otherCookies = otherDevice.headers[
      'set-cookie'
    ] as unknown as string[];

    await request(app.getHttpServer())
      .post('/api/auth/request-password-reset')
      .send({ email })
      .expect(200);
    const resetToken = new URL(
      capturedEmails.filter((e) => e.to === email).at(-1)!.vars.resetUrl,
    ).searchParams.get('token');
    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: 'brand-new-secret-1' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', otherCookies)
      .expect(401);
  });

  it('rejects reuse of an already-rotated refresh token', async () => {
    const email = 'reuse-test@example.com';
    const password = 'super-secret-1';

    await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ email, password })
      .expect(201);
    const verifyEmail = capturedEmails.find((e) => e.to === email);
    const verifyToken = new URL(verifyEmail!.vars.verifyUrl).searchParams.get(
      'token',
    );
    await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ token: verifyToken })
      .expect(200);

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    const originalCookies = loginRes.headers[
      'set-cookie'
    ] as unknown as string[];

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', originalCookies)
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', originalCookies)
      .expect(401);

    expect(res.body.code).toBe('REFRESH_TOKEN_REUSE_DETECTED');
    // The session hint must go too, or the frontend would loop between the
    // app and /login with a dead session.
    const rejectedCookies = res.headers['set-cookie'] as unknown as string[];
    expect(rejectedCookies.some((c) => c.startsWith('session=;'))).toBe(true);
  });
});
