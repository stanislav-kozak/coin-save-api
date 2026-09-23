import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';

describe('CategoriesController', () => {
  let app: INestApplication;
  const categoriesService = {
    createCategory: vi.fn().mockResolvedValue({ id: 'c1', name: 'Kids' }),
    listCategories: vi.fn().mockResolvedValue([]),
    reorderCategories: vi.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CategoriesController],
      providers: [{ provide: CategoriesService, useValue: categoriesService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
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

  it('POST /spaces/:spaceId/categories creates a category in the given space', async () => {
    await request(app.getHttpServer())
      .post('/spaces/s1/categories')
      .send({ name: 'Kids' })
      .expect(201);

    expect(categoriesService.createCategory).toHaveBeenCalledWith('s1', {
      name: 'Kids',
    });
  });

  it('PATCH /spaces/:spaceId/categories/reorder routes to reorderCategories, not :categoryId', async () => {
    await request(app.getHttpServer())
      .patch('/spaces/s1/categories/reorder')
      .send({ orderedIds: ['c1', 'c2'] })
      .expect(200);

    expect(categoriesService.reorderCategories).toHaveBeenCalledWith('s1', [
      'c1',
      'c2',
    ]);
  });

  it('POST /spaces/:spaceId/categories rejects a non-positive monthlyLimit with 400', async () => {
    await request(app.getHttpServer())
      .post('/spaces/s1/categories')
      .send({ name: 'Kids', monthlyLimit: -5 })
      .expect(400);
  });

  it('PATCH /spaces/:spaceId/categories/reorder rejects a duplicate id with 400', async () => {
    await request(app.getHttpServer())
      .patch('/spaces/s1/categories/reorder')
      .send({ orderedIds: ['c1', 'c2', 'c1'] })
      .expect(400);

    expect(categoriesService.reorderCategories).not.toHaveBeenCalledWith('s1', [
      'c1',
      'c2',
      'c1',
    ]);
  });
});
