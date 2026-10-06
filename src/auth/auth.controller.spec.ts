import {
  ExecutionContext,
  HttpStatus,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';

describe('AuthController', () => {
  let app: INestApplication;
  const authService = {
    signup: vi.fn().mockResolvedValue(undefined),
    resendVerification: vi.fn().mockResolvedValue(undefined),
    login: vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),
  };
  const usersService = { findPublicById: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: UsersService, useValue: usersService },
      ],
    })
      .overrideGuard(LocalAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest<{ user?: unknown }>();
          req.user = { id: 'u1', email: 'a@b.com' };
          return true;
        },
      })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/signup returns 201 and calls AuthService.signup', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: 'a@b.com', password: 'password123' })
      .expect(201);

    expect(authService.signup).toHaveBeenCalledWith(
      'a@b.com',
      'password123',
      undefined,
    );
  });

  it('POST /auth/signup passes a trimmed display name to AuthService.signup', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: 'n@b.com', password: 'password123', name: '  Olena  ' })
      .expect(201);

    expect(authService.signup).toHaveBeenCalledWith(
      'n@b.com',
      'password123',
      'Olena',
    );
  });

  it('POST /auth/signup rejects a blank or over-long name with 400', async () => {
    for (const name of ['   ', 'x'.repeat(101)]) {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ email: 'n@b.com', password: 'password123', name })
        .expect(400);
    }
  });

  it('POST /auth/resend-verification answers 200 with a non-revealing message', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: 'a@b.com' })
      .expect(200);

    expect(authService.resendVerification).toHaveBeenCalledWith('a@b.com');
    expect(res.body).toEqual({
      message: 'If the account exists and is not verified, a new link was sent',
    });
  });

  it('POST /auth/resend-verification rejects an invalid email with 400', async () => {
    await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: 'nope' })
      .expect(400);
  });

  it('POST /auth/signup rejects an invalid email with 400', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: 'not-an-email', password: 'password123' })
      .expect(400);
  });

  it('POST /auth/login sets access and refresh cookies', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'a@b.com', password: 'password123' })
      .expect(200);

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('access=access-token'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('refresh=refresh-token'))).toBe(
      true,
    );
  });

  const THIRTY_DAYS_S = 30 * 24 * 60 * 60;
  const setCookies = (res: request.Response): string[] =>
    res.headers['set-cookie'] as unknown as string[];
  const cleared = (cookies: string[], name: string, path: string): boolean =>
    cookies.some(
      (c) =>
        c.startsWith(`${name}=;`) &&
        c.includes(`Path=${path}`) &&
        c.includes('Expires=Thu, 01 Jan 1970'),
    );

  it('POST /auth/login sets an httpOnly session hint cookie for the whole site, living as long as the refresh token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'a@b.com', password: 'password123' })
      .expect(200);

    const session = setCookies(res).find((c) => c.startsWith('session=1;'));
    expect(session).toBeDefined();
    expect(session).toContain('Path=/;');
    expect(session).toContain(`Max-Age=${THIRTY_DAYS_S}`);
    expect(session).toContain('HttpOnly');
    expect(session).toContain('Secure');
    expect(session).toContain('SameSite=Lax');
  });

  it('POST /auth/refresh re-issues the session hint cookie on success', async () => {
    authService.refresh.mockResolvedValueOnce({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'refresh-token' })
      .expect(200);

    expect(setCookies(res).some((c) => c.startsWith('session=1;'))).toBe(true);
  });

  it('POST /auth/logout clears access, refresh and session cookies', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: 'refresh-token' })
      .expect(200);

    const cookies = setCookies(res);
    expect(cleared(cookies, 'access', '/')).toBe(true);
    expect(cleared(cookies, 'refresh', '/api/auth')).toBe(true);
    expect(cleared(cookies, 'session', '/')).toBe(true);
  });

  it('POST /auth/refresh clears all auth cookies when the refresh token is rejected', async () => {
    authService.refresh.mockRejectedValueOnce(
      new AppException(
        ERROR_CODES.REFRESH_TOKEN_REUSE_DETECTED,
        HttpStatus.UNAUTHORIZED,
        'Refresh token reuse detected',
      ),
    );

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'stolen-token' })
      .expect(401);

    const cookies = setCookies(res);
    expect(cleared(cookies, 'access', '/')).toBe(true);
    expect(cleared(cookies, 'refresh', '/api/auth')).toBe(true);
    expect(cleared(cookies, 'session', '/')).toBe(true);
  });

  it('POST /auth/refresh clears all auth cookies when no refresh token is presented', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .expect(401);

    expect(cleared(setCookies(res), 'session', '/')).toBe(true);
  });
});
