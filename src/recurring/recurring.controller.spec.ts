import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RecurringFrequency, TransactionType } from '@prisma/client';
import { RecurringController } from './recurring.controller';
import { RecurringService } from './recurring.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';

describe('RecurringController', () => {
  let app: INestApplication;
  const recurringService = {
    createRecurringTransaction: vi.fn(),
    listRecurringTransactions: vi.fn(),
    getRecurringTransaction: vi.fn(),
    updateRecurringTransaction: vi.fn(),
    pauseRecurringTransaction: vi.fn(),
    resumeRecurringTransaction: vi.fn(),
    deleteRecurringTransaction: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RecurringController],
      providers: [{ provide: RecurringService, useValue: recurringService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: never) => {
          const req = (
            context as {
              switchToHttp: () => { getRequest: () => Record<string, unknown> };
            }
          )
            .switchToHttp()
            .getRequest();
          req.user = { id: 'u1', email: 'u1@example.com' };
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

  it('POST /spaces/:spaceId/recurring creates with createdById from the current user', async () => {
    recurringService.createRecurringTransaction.mockResolvedValue({ id: 'r1' });

    await request(app.getHttpServer())
      .post('/spaces/s1/recurring')
      .send({
        walletId: 'w1',
        type: TransactionType.EXPENSE,
        amount: 15.99,
        name: 'Netflix',
        frequency: RecurringFrequency.MONTHLY,
        dayOfMonth: 5,
        startDate: '2026-07-01T00:00:00.000Z',
      })
      .expect(201);

    expect(recurringService.createRecurringTransaction).toHaveBeenCalledWith(
      's1',
      'u1',
      expect.objectContaining({ name: 'Netflix' }),
    );
  });

  it('GET /spaces/:spaceId/recurring forwards includeInactive', async () => {
    recurringService.listRecurringTransactions.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/spaces/s1/recurring?includeInactive=true')
      .expect(200);

    expect(recurringService.listRecurringTransactions).toHaveBeenCalledWith(
      's1',
      true,
    );
  });

  it('GET /spaces/:spaceId/recurring/:id returns one', async () => {
    recurringService.getRecurringTransaction.mockResolvedValue({ id: 'r1' });

    await request(app.getHttpServer())
      .get('/spaces/s1/recurring/r1')
      .expect(200);

    expect(recurringService.getRecurringTransaction).toHaveBeenCalledWith(
      's1',
      'r1',
    );
  });

  it('PATCH /spaces/:spaceId/recurring/:id updates', async () => {
    recurringService.updateRecurringTransaction.mockResolvedValue({ id: 'r1' });

    await request(app.getHttpServer())
      .patch('/spaces/s1/recurring/r1')
      .send({ amount: 20 })
      .expect(200);

    expect(recurringService.updateRecurringTransaction).toHaveBeenCalledWith(
      's1',
      'r1',
      { amount: 20 },
    );
  });

  it('PATCH /spaces/:spaceId/recurring/:id/pause pauses', async () => {
    recurringService.pauseRecurringTransaction.mockResolvedValue({
      id: 'r1',
      active: false,
    });

    await request(app.getHttpServer())
      .patch('/spaces/s1/recurring/r1/pause')
      .expect(200);

    expect(recurringService.pauseRecurringTransaction).toHaveBeenCalledWith(
      's1',
      'r1',
    );
  });

  it('PATCH /spaces/:spaceId/recurring/:id/resume resumes', async () => {
    recurringService.resumeRecurringTransaction.mockResolvedValue({
      id: 'r1',
      active: true,
    });

    await request(app.getHttpServer())
      .patch('/spaces/s1/recurring/r1/resume')
      .expect(200);

    expect(recurringService.resumeRecurringTransaction).toHaveBeenCalledWith(
      's1',
      'r1',
    );
  });

  it('DELETE /spaces/:spaceId/recurring/:id returns 204', async () => {
    recurringService.deleteRecurringTransaction.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .delete('/spaces/s1/recurring/r1')
      .expect(204);

    expect(recurringService.deleteRecurringTransaction).toHaveBeenCalledWith(
      's1',
      'r1',
    );
  });
});
