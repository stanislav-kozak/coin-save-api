import { publicUserSelect, UsersService } from './users.service';

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

  it('creates a local user with an optional display name', async () => {
    const prisma = { user: { create: vi.fn().mockResolvedValue({}) } };
    const service = new UsersService(prisma as never);

    await service.createLocal('a@b.com', 'hash', 'Olena');

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { email: 'a@b.com', passwordHash: 'hash', name: 'Olena' },
    });
  });

  it('finds a public user profile by id without selecting the password hash', async () => {
    const found = { id: 'u1', email: 'a@b.com' };
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue(found) } };
    const service = new UsersService(prisma as never);

    const result = await service.findPublicById('u1');

    expect(result).toBe(found);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: publicUserSelect,
    });
    expect(publicUserSelect).not.toHaveProperty('passwordHash');
  });

  it('updates only the given profile fields and returns the public profile', async () => {
    const updated = { id: 'u1', email: 'a@b.com', name: null, locale: 'en' };
    const prisma = { user: { update: vi.fn().mockResolvedValue(updated) } };
    const service = new UsersService(prisma as never);

    const result = await service.updateProfile('u1', {
      name: null,
      locale: 'en',
    });

    expect(result).toBe(updated);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: null, locale: 'en' },
      select: publicUserSelect,
    });
    expect(publicUserSelect).not.toHaveProperty('passwordHash');
  });

  it('deletes a user by id', async () => {
    const prisma = { user: { delete: vi.fn().mockResolvedValue({}) } };
    const service = new UsersService(prisma as never);

    await service.deleteById('u1');

    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });

  it('finds a user by email regardless of letter case', async () => {
    const found = { id: 'u1', email: 'a@b.com' };
    const prisma = { user: { findFirst: vi.fn().mockResolvedValue(found) } };
    const service = new UsersService(prisma as never);

    const result = await service.findByEmail('A@B.com');

    expect(result).toBe(found);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'a@b.com', mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
    });
  });
});
