import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TransactionType } from '@prisma/client';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';

describe('ExpensesController', () => {
  let app: INestApplication;
  const expensesService = {
    createExpense: vi.fn(),
    listExpenses: vi.fn(),
    getExpense: vi.fn(),
    updateExpense: vi.fn(),
    deleteExpense: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ExpensesController],
      providers: [{ provide: ExpensesService, useValue: expensesService }],
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

  it('POST /spaces/:spaceId/expenses creates an expense with createdById from the current user', async () => {
    expensesService.createExpense.mockResolvedValue({ id: 'e1' });

    await request(app.getHttpServer())
      .post('/spaces/s1/expenses')
      .send({
        walletId: 'w1',
        type: TransactionType.EXPENSE,
        amount: 100,
        occurredAt: '2026-06-10T00:00:00.000Z',
      })
      .expect(201);

    expect(expensesService.createExpense).toHaveBeenCalledWith('s1', 'u1', {
      walletId: 'w1',
      type: TransactionType.EXPENSE,
      amount: 100,
      occurredAt: '2026-06-10T00:00:00.000Z',
    });
  });

  it('GET /spaces/:spaceId/expenses forwards query filters', async () => {
    expensesService.listExpenses.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/spaces/s1/expenses?walletId=w1&type=EXPENSE')
      .expect(200);

    expect(expensesService.listExpenses).toHaveBeenCalledWith('s1', {
      walletId: 'w1',
      type: TransactionType.EXPENSE,
    });
  });

  it('GET /spaces/:spaceId/expenses/:expenseId returns one expense', async () => {
    expensesService.getExpense.mockResolvedValue({ id: 'e1' });

    await request(app.getHttpServer())
      .get('/spaces/s1/expenses/e1')
      .expect(200);

    expect(expensesService.getExpense).toHaveBeenCalledWith('s1', 'e1');
  });

  it('PATCH /spaces/:spaceId/expenses/:expenseId updates an expense', async () => {
    expensesService.updateExpense.mockResolvedValue({ id: 'e1' });

    await request(app.getHttpServer())
      .patch('/spaces/s1/expenses/e1')
      .send({ note: 'Updated' })
      .expect(200);

    expect(expensesService.updateExpense).toHaveBeenCalledWith('s1', 'e1', {
      note: 'Updated',
    });
  });

  it('DELETE /spaces/:spaceId/expenses/:expenseId returns 204', async () => {
    expensesService.deleteExpense.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .delete('/spaces/s1/expenses/e1')
      .expect(204);

    expect(expensesService.deleteExpense).toHaveBeenCalledWith('s1', 'e1');
  });

  it('rejects a negative amount with 400', async () => {
    await request(app.getHttpServer())
      .post('/spaces/s1/expenses')
      .send({
        walletId: 'w1',
        type: TransactionType.EXPENSE,
        amount: -5,
        occurredAt: '2026-06-10T00:00:00.000Z',
      })
      .expect(400);
  });
});
