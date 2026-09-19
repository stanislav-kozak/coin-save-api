import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Role } from '@prisma/client';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';
import { SpaceOwnerGuard } from '../common/guards/space-owner.guard';

describe('SpacesController', () => {
  let app: INestApplication;
  const spacesService = {
    createSpace: vi.fn().mockResolvedValue({ id: 's1', name: 'Family' }),
    listMembers: vi.fn(),
    leaveSpace: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SpacesController],
      providers: [{ provide: SpacesService, useValue: spacesService }],
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
      .useValue({
        canActivate: (context: import('@nestjs/common').ExecutionContext) => {
          context
            .switchToHttp()
            .getRequest<{ membership?: unknown }>().membership = {
            id: 'm1',
            role: Role.MEMBER,
          };
          return true;
        },
      })
      .overrideGuard(SpaceOwnerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /spaces creates a space for the current user', async () => {
    await request(app.getHttpServer())
      .post('/spaces')
      .send({ name: 'Family' })
      .expect(201);
    expect(spacesService.createSpace).toHaveBeenCalledWith('u1', 'Family');
  });

  it('POST /spaces/:spaceId/leave calls leaveSpace with the guard-attached membership', async () => {
    await request(app.getHttpServer()).post('/spaces/s1/leave').expect(200);
    expect(spacesService.leaveSpace).toHaveBeenCalledWith('s1', {
      id: 'm1',
      role: Role.MEMBER,
    });
  });
});
