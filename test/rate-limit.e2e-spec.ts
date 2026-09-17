import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, Throttle } from '@nestjs/throttler';
import request from 'supertest';

@Controller('probe')
class ProbeController {
  @Get()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  ping() {
    return { ok: true };
  }
}

describe('Rate limiting', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 after exceeding the per-route limit', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).get('/probe').expect(200);
    }
    await request(app.getHttpServer()).get('/probe').expect(429);
  });
});
