import { execSync } from 'child_process';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';
import { AppExceptionFilter } from '../../src/common/filters/app-exception.filter';
import { MailService } from '../../src/mail/mail.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createCookieAgent } from '../helpers/cookie-agent';

function extractAccessToken(setCookieHeader: string[] | undefined): string {
  const cookie = (setCookieHeader ?? []).find((c) => c.startsWith('access='));
  if (!cookie) {
    throw new Error('access cookie not found in Set-Cookie header');
  }
  return cookie.split(';')[0].split('=')[1];
}

function waitForEvent<T>(
  socket: Socket,
  event: string,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function waitForNoEvent(
  socket: Socket,
  event: string,
  timeoutMs = 1500,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, timeoutMs);
    socket.once(event, () => {
      clearTimeout(timer);
      reject(new Error(`Unexpectedly received "${event}"`));
    });
  });
}

describe('Events flow (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let baseUrl: string;

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
      .useValue({ send: (): Promise<void> => Promise.resolve() })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new AppExceptionFilter());
    await app.init();
    await app.listen(0);
    baseUrl = await app.getUrl();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  async function signupAndGetToken(email: string): Promise<string> {
    const agent = createCookieAgent(app);
    const password = 'super-secret-1';
    await agent.post('/api/auth/signup').send({ email, password }).expect(201);

    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUnique({ where: { email } });
    await prisma.user.update({
      where: { id: user!.id },
      data: { emailVerified: new Date() },
    });

    const loginRes = await agent
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);

    return extractAccessToken(
      loginRes.headers['set-cookie'] as unknown as string[],
    );
  }

  it('delivers wallet.changed only to a client subscribed to that space, and rejects unauthenticated/non-member access', async () => {
    const memberToken = await signupAndGetToken('member@example.com');
    const outsiderToken = await signupAndGetToken('outsider@example.com');

    const agent = createCookieAgent(app);
    await agent
      .post('/api/auth/login')
      .send({ email: 'member@example.com', password: 'super-secret-1' })
      .expect(200);
    const spaceRes = await agent
      .post('/api/spaces')
      .send({ name: 'Family' })
      .expect(201);
    const spaceId = spaceRes.body.id as string;

    // (a) invalid token gets disconnected
    const badSocket = io(baseUrl, { auth: { token: 'not-a-real-token' } });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('expected disconnect on bad token')),
        5000,
      );
      badSocket.once('disconnect', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    badSocket.close();

    // (b) member subscribes and receives wallet.changed
    const memberSocket = io(baseUrl, { auth: { token: memberToken } });
    await new Promise<void>((resolve) => memberSocket.on('connect', resolve));
    memberSocket.emit('space.subscribe', { spaceId });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const eventPromise = waitForEvent<{ spaceId: string; actorId: string }>(
      memberSocket,
      'wallet.changed',
    );

    await agent
      .post(`/api/spaces/${spaceId}/wallets`)
      .send({ name: 'Cash', currency: 'EUR', initialBalance: 0 })
      .expect(201);

    const payload = await eventPromise;
    expect(payload).toEqual({ spaceId, actorId: expect.any(String) as string });
    memberSocket.close();

    // (c) an outsider who is not a member of the space never receives it,
    // even after subscribing (the gateway silently refuses to join them).
    const outsiderSocket = io(baseUrl, { auth: { token: outsiderToken } });
    await new Promise<void>((resolve) => outsiderSocket.on('connect', resolve));
    outsiderSocket.emit('space.subscribe', { spaceId });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const noEventPromise = waitForNoEvent(outsiderSocket, 'wallet.changed');

    const walletsListRes = await agent
      .get(`/api/spaces/${spaceId}/wallets`)
      .expect(200);
    const walletId = walletsListRes.body[0].id as string;
    await agent
      .patch(`/api/spaces/${spaceId}/wallets/${walletId}`)
      .send({ name: 'Renamed' })
      .expect(200);

    await noEventPromise;
    outsiderSocket.close();
  }, 30_000);
});
