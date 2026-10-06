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
import { bootstrapSwagger } from '../../src/swagger';
import {
  ERROR_CODES,
  GENERIC_ERROR_CODES,
} from '../../src/common/constants/error-codes';

describe('OpenAPI contract (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;

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
    bootstrapSwagger(app);
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  it('serves a valid OpenAPI 3.x document at /api/docs.json covering a known route', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs.json')
      .expect(200);

    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info.title).toBe('CoinSave API');
    expect(typeof res.body.paths).toBe('object');
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(0);
    expect(res.body.paths['/api/auth/signup']).toBeDefined();
  });

  it('documents a response schema for every operation so the generated client is fully typed', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs.json')
      .expect(200);

    type Responses = Record<
      string,
      { content?: Record<string, { schema?: unknown }> }
    >;
    const paths = res.body.paths as Record<
      string,
      Record<string, { responses: Responses }>
    >;

    // 204 (no body) and 302 (OAuth redirects) legitimately have no schema.
    const bodylessStatuses = new Set(['204', '302']);
    const undocumented: string[] = [];
    for (const [path, operations] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const documented = Object.entries(operation.responses).some(
          ([status, response]) =>
            bodylessStatuses.has(status) ||
            Object.values(response.content ?? {}).some(
              (media) => media.schema !== undefined,
            ),
        );
        if (!documented) {
          undocumented.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    expect(undocumented).toEqual([]);
    expect(
      paths['/api/spaces/{spaceId}/wallets'].get.responses['200'].content?.[
        'application/json'
      ].schema,
    ).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/WalletResponseDto' },
    });
    expect(
      res.body.components.schemas.WalletResponseDto.properties.balance,
    ).toMatchObject({ type: 'string', format: 'decimal' });
  });

  it('documents money inputs as strictly positive, not minimum 1', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs.json')
      .expect(200);
    const schemas = res.body.components.schemas as Record<
      string,
      { properties: Record<string, unknown> }
    >;

    const moneyInputs: [string, string][] = [
      ['CreateExpenseDto', 'amount'],
      ['UpdateExpenseDto', 'amount'],
      ['CreateRecurringTransactionDto', 'amount'],
      ['UpdateRecurringTransactionDto', 'amount'],
      ['CreateCategoryDto', 'monthlyLimit'],
      ['UpdateCategoryDto', 'monthlyLimit'],
    ];
    for (const [schema, property] of moneyInputs) {
      expect(schemas[schema].properties[property]).toMatchObject({
        type: 'number',
        minimum: 0,
        exclusiveMinimum: true,
        maximum: 1_000_000_000,
      });
    }
  });

  it('documents the wallet initialBalance (required on create, optional on update)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs.json')
      .expect(200);
    const schemas = res.body.components.schemas;

    for (const name of ['CreateWalletDto', 'UpdateWalletDto']) {
      expect(schemas[name].properties.initialBalance).toMatchObject({
        type: 'number',
        minimum: -1_000_000_000,
        maximum: 1_000_000_000,
      });
    }
    expect(schemas.CreateWalletDto.required).toContain('initialBalance');
    expect(schemas.UpdateWalletDto.required ?? []).not.toContain(
      'initialBalance',
    );
  });

  it('documents the error envelope with every API error code', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs.json')
      .expect(200);
    const errorSchema = res.body.components.schemas.ErrorResponseDto;

    expect(errorSchema.required).toEqual(
      expect.arrayContaining(['statusCode', 'code', 'message']),
    );
    expect(errorSchema.properties.code.allOf).toEqual([
      { $ref: '#/components/schemas/ErrorCode' },
    ]);
    expect([...res.body.components.schemas.ErrorCode.enum].sort()).toEqual(
      [
        ...Object.values(ERROR_CODES),
        ...Object.values(GENERIC_ERROR_CODES),
      ].sort(),
    );
  });

  it('documents at least one error response for every operation that can fail', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs.json')
      .expect(200);
    const paths = res.body.paths as Record<
      string,
      Record<
        string,
        {
          responses: Record<
            string,
            { content?: Record<string, { schema?: { $ref?: string } }> }
          >;
        }
      >
    >;

    // These cannot fail with an API error envelope: hello-world, logout
    // (always clears cookies), and the Google OAuth redirects.
    const neverFails = new Set([
      'GET /api',
      'POST /api/auth/logout',
      'GET /api/auth/google',
      'GET /api/auth/google/callback',
    ]);
    const missing: string[] = [];
    for (const [path, operations] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const key = `${method.toUpperCase()} ${path}`;
        if (neverFails.has(key)) continue;
        const hasError = Object.entries(operation.responses).some(
          ([status, response]) =>
            Number(status) >= 400 &&
            response.content?.['application/json']?.schema?.$ref ===
              '#/components/schemas/ErrorResponseDto',
        );
        if (!hasError) missing.push(key);
      }
    }
    expect(missing).toEqual([]);

    expect(
      Object.keys(paths['/api/spaces/{spaceId}/wallets'].post.responses).sort(),
    ).toEqual(['201', '400', '401', '403']);
  });

  it('serves the interactive Swagger UI at /api/docs', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs').expect(200);

    expect(res.headers['content-type']).toContain('text/html');
  });
});
