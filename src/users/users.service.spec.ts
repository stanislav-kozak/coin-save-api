import { UsersService } from './users.service';

describe('UsersService', () => {
  it('creates a local user with the given email and password hash', async () => {
    const created = { id: 'u1', email: 'a@b.com', passwordHash: 'hash' };
    const prisma = { user: { create: vi.fn().mockResolvedValue(created) } };
    const service = new UsersService(prisma as never);

    const result = await service.createLocal('a@b.com', 'hash');

    expect(result).toBe(created);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { email: 'a@b.com', passwordHash: 'hash' },
    });
  });

  it('finds a user by email', async () => {
    const found = { id: 'u1', email: 'a@b.com' };
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue(found) } };
    const service = new UsersService(prisma as never);

    const result = await service.findByEmail('a@b.com');

    expect(result).toBe(found);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.com' } });
  });
});
