import { execSync } from 'child_process';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { AppModule } from '../../src/app.module';
import { AppExceptionFilter } from '../../src/common/filters/app-exception.filter';
import { MailService } from '../../src/mail/mail.service';
import { createCookieAgent } from '../helpers/cookie-agent';

describe('Categories flow (integration)', () => {
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

  it('runs the full category lifecycle: create, rename, archive/unarchive, reorder, delete', async () => {
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

    const initialList = await agent
      .get(`/api/spaces/${spaceId}/categories`)
      .expect(200);
    expect(initialList.body).toHaveLength(6);

    const createRes = await agent
      .post(`/api/spaces/${spaceId}/categories`)
      .send({ name: 'Kids', monthlyLimit: 500 })
      .expect(201);
    const categoryId = createRes.body.id as string;
    expect(createRes.body.sortOrder).toBe(6);

    await agent
      .post(`/api/spaces/${spaceId}/categories`)
      .send({ name: 'Kids' })
      .expect(409);

    const updateRes = await agent
      .patch(`/api/spaces/${spaceId}/categories/${categoryId}`)
      .send({ name: 'Kids & Toys', monthlyLimit: 750 })
      .expect(200);
    expect(updateRes.body.name).toBe('Kids & Toys');
    expect(Number(updateRes.body.monthlyLimit)).toBe(750);

    await agent
      .patch(`/api/spaces/${spaceId}/categories/${categoryId}/archive`)
      .expect(200);

    const afterArchive = await agent
      .get(`/api/spaces/${spaceId}/categories`)
      .expect(200);
    expect(afterArchive.body).toHaveLength(6);

    const withArchived = await agent
      .get(`/api/spaces/${spaceId}/categories?includeArchived=true`)
      .expect(200);
    expect(withArchived.body).toHaveLength(7);

    const activeOnlyList = await agent
      .get(`/api/spaces/${spaceId}/categories`)
      .expect(200);
    const activeOnlyIds = (activeOnlyList.body as { id: string }[]).map(
      (c) => c.id,
    );
    await agent
      .patch(`/api/spaces/${spaceId}/categories/reorder`)
      .send({ orderedIds: activeOnlyIds })
      .expect(200);

    await agent
      .patch(`/api/spaces/${spaceId}/categories/${categoryId}/unarchive`)
      .expect(200);

    const fullList = await agent
      .get(`/api/spaces/${spaceId}/categories`)
      .expect(200);
    expect(fullList.body).toHaveLength(7);
    const allIds = (fullList.body as { id: string }[]).map((c) => c.id);
    const reversedIds = [...allIds].reverse();

    const reorderRes = await agent
      .patch(`/api/spaces/${spaceId}/categories/reorder`)
      .send({ orderedIds: reversedIds })
      .expect(200);
    expect((reorderRes.body as { id: string }[]).map((c) => c.id)).toEqual(
      reversedIds,
    );

    const badReorder = await agent
      .patch(`/api/spaces/${spaceId}/categories/reorder`)
      .send({ orderedIds: reversedIds.slice(1) })
      .expect(400);
    expect(badReorder.body.code).toBe('INVALID_REORDER');

    await agent
      .delete(`/api/spaces/${spaceId}/categories/${categoryId}`)
      .expect(204);

    const afterDelete = await agent
      .get(`/api/spaces/${spaceId}/categories`)
      .expect(200);
    expect(afterDelete.body).toHaveLength(6);

    const res = await agent
      .get(`/api/spaces/${spaceId}/categories/${categoryId}`)
      .expect(404);
    expect(res.body.code).toBe('CATEGORY_NOT_FOUND');
  });
});
