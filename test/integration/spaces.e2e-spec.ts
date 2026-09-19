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

// `request.agent()`'s built-in cookie jar refuses to replay `Secure`-flagged
// cookies over a plain-http connection (see `cookiejar`'s
// `access_info.secure` check), and the auth cookies set by `AuthController`
// are always `secure: true`. Since this test server runs over http, the
// stock agent silently drops the session after login. This minimal
// hand-rolled jar captures `Set-Cookie` headers (honoring each cookie's
// `Path` attribute, the way a real cookie jar would) and replays them
// regardless of the `Secure` attribute, which is what we want for an http
// test server standing in for a real https deployment.
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

describe('Spaces flow (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  const capturedEmails: {
    to: string;
    template: string;
    vars: Record<string, string>;
  }[] = [];

  function tokenFor(to: string, template: string, urlKey: string): string {
    const email = [...capturedEmails]
      .reverse()
      .find((e) => e.to === to && e.template === template);
    if (!email) {
      throw new Error(`No ${template} email captured for ${to}`);
    }
    return new URL(email.vars[urlKey]).searchParams.get('token')!;
  }

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
          template: string,
          _subject: string,
          vars: Record<string, string>,
        ): Promise<void> => {
          capturedEmails.push({ to, template, vars });
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

  it('runs the full space lifecycle: create, invite, accept, promote, leave', async () => {
    const ownerAgent = createCookieAgent(app);
    const inviteeAgent = createCookieAgent(app);

    const ownerEmail = 'owner@example.com';
    const inviteeEmail = 'invitee@example.com';
    const password = 'super-secret-1';

    await ownerAgent
      .post('/api/auth/signup')
      .send({ email: ownerEmail, password })
      .expect(201);
    await ownerAgent
      .post('/api/auth/verify-email')
      .send({ token: tokenFor(ownerEmail, 'verify-email', 'verifyUrl') })
      .expect(200);
    await ownerAgent
      .post('/api/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);

    const createRes = await ownerAgent
      .post('/api/spaces')
      .send({ name: 'Family' })
      .expect(201);
    const spaceId = createRes.body.id as string;
    expect(createRes.body.name).toBe('Family');

    await ownerAgent
      .post(`/api/spaces/${spaceId}/invitations`)
      .send({ email: inviteeEmail })
      .expect(201);

    await inviteeAgent
      .post('/api/auth/signup')
      .send({ email: inviteeEmail, password })
      .expect(201);
    await inviteeAgent
      .post('/api/auth/verify-email')
      .send({ token: tokenFor(inviteeEmail, 'verify-email', 'verifyUrl') })
      .expect(200);
    await inviteeAgent
      .post('/api/auth/login')
      .send({ email: inviteeEmail, password })
      .expect(200);

    const invitationToken = tokenFor(inviteeEmail, 'invitation', 'acceptUrl');
    await inviteeAgent
      .post('/api/invitations/accept')
      .send({ token: invitationToken })
      .expect(200);

    const membersRes = await ownerAgent
      .get(`/api/spaces/${spaceId}/members`)
      .expect(200);
    expect(membersRes.body).toHaveLength(2);
    const members = membersRes.body as {
      email: string;
      role: string;
      membershipId: string;
    }[];
    const inviteeMembership = members.find((m) => m.email === inviteeEmail)!;
    expect(inviteeMembership.role).toBe('MEMBER');

    await ownerAgent
      .patch(`/api/spaces/${spaceId}/members/${inviteeMembership.membershipId}`)
      .send({ role: 'OWNER' })
      .expect(200);

    await ownerAgent.post(`/api/spaces/${spaceId}/leave`).expect(200);

    const membersAfterLeave = await inviteeAgent
      .get(`/api/spaces/${spaceId}/members`)
      .expect(200);
    expect(membersAfterLeave.body).toHaveLength(1);
    expect(membersAfterLeave.body[0].email).toBe(inviteeEmail);

    const res = await inviteeAgent
      .post(`/api/spaces/${spaceId}/leave`)
      .expect(403);
    expect(res.body.code).toBe('CANNOT_REMOVE_LAST_OWNER');
  });
});
