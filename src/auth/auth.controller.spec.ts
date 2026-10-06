import {
  ExecutionContext,
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

describe('AuthController', () => {
  let app: INestApplication;
  const authService = {
    signup: vi.fn().mockResolvedValue(undefined),
    login: vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    }),
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
});
