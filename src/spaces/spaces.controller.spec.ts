import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Role } from '@prisma/client';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';
import { SpaceOwnerGuard } from '../common/guards/space-owner.guard';
import { EventBus } from '../events/event-bus.service';

describe('SpacesController', () => {
  let app: INestApplication;
  const spacesService = {
    createSpace: vi.fn().mockResolvedValue({ id: 's1', name: 'Family' }),
    listMembers: vi.fn(),
    leaveSpace: vi.fn().mockResolvedValue(undefined),
  };
  const events = { emitToSpace: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SpacesController],
      providers: [
        { provide: SpacesService, useValue: spacesService },
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
      .useValue({
        canActivate: (context: import('@nestjs/common').ExecutionContext) => {
          context
            .switchToHttp()
            .getRequest<{ membership?: unknown }>().membership = {
            id: 'm1',
            role: Role.MEMBER,
            userId: 'u1',
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
    expect(events.emitToSpace).not.toHaveBeenCalled();
  });

  it('POST /spaces/:spaceId/leave calls leaveSpace with the guard-attached membership', async () => {
    await request(app.getHttpServer()).post('/spaces/s1/leave').expect(200);
    expect(spacesService.leaveSpace).toHaveBeenCalledWith('s1', {
      id: 'm1',
      role: Role.MEMBER,
      userId: 'u1',
    });
    expect(events.emitToSpace).toHaveBeenCalledWith(
      's1',
      'space.changed',
      'u1',
    );
  });
});
