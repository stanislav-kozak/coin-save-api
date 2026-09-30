import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';
import { EventBus } from '../events/event-bus.service';

describe('WalletsController', () => {
  let app: INestApplication;
  const walletsService = {
    createWallet: vi.fn().mockResolvedValue({ id: 'w1', name: 'Cash' }),
    listWallets: vi.fn().mockResolvedValue([]),
  };
  const events = { emitToSpace: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WalletsController],
      providers: [
        { provide: WalletsService, useValue: walletsService },
        { provide: EventBus, useValue: events },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: import('@nestjs/common').ExecutionContext) => {
          context.switchToHttp().getRequest<{ user?: unknown }>().user = {
            id: 'u1',
            email: 'a@b.com',
          };
          return true;
        },
      })
      .overrideGuard(SpaceMemberGuard)
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

  it('POST /spaces/:spaceId/wallets creates a wallet in the given space', async () => {
    await request(app.getHttpServer())
      .post('/spaces/s1/wallets')
      .send({ name: 'Cash', currency: 'PLN', initialBalance: 100 })
      .expect(201);

    expect(walletsService.createWallet).toHaveBeenCalledWith('s1', {
      name: 'Cash',
      currency: 'PLN',
      initialBalance: 100,
    });
    expect(events.emitToSpace).toHaveBeenCalledWith(
      's1',
      'wallet.changed',
      'u1',
    );
  });

  it('GET /spaces/:spaceId/wallets?includeArchived=true forwards the parsed boolean', async () => {
    await request(app.getHttpServer())
      .get('/spaces/s1/wallets?includeArchived=true')
      .expect(200);

    expect(walletsService.listWallets).toHaveBeenCalledWith('s1', true);
  });

  it('POST /spaces/:spaceId/wallets rejects an unsupported currency with 400', async () => {
    await request(app.getHttpServer())
      .post('/spaces/s1/wallets')
      .send({ name: 'Cash', currency: 'XYZ', initialBalance: 100 })
      .expect(400);
  });
});
