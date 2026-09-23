import { HttpStatus } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { AppException } from '../common/exceptions/app.exception';

function buildService(
  overrides: {
    prisma?: { category?: Record<string, unknown>; $transaction?: unknown };
  } = {},
) {
  const prisma = {
    category: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: null } }),
      ...overrides.prisma?.category,
    },
    $transaction:
      overrides.prisma?.$transaction ?? vi.fn().mockResolvedValue([]),
  };
  const service = new CategoriesService(prisma as never);
  return { service, prisma };
}

describe('CategoriesService', () => {
  it('creates a category with sortOrder one past the current max', async () => {
    const { service, prisma } = buildService({
      prisma: {
        category: {
          aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: 2 } }),
          create: vi.fn().mockResolvedValue({
            id: 'c1',
            spaceId: 's1',
            name: 'Kids',
            sortOrder: 3,
          }),
        },
      },
    });

    const result = await service.createCategory('s1', { name: 'Kids' });

    expect(prisma.category.create).toHaveBeenCalledWith({
      data: {
        spaceId: 's1',
        name: 'Kids',
        icon: undefined,
        color: undefined,
        monthlyLimit: undefined,
        sortOrder: 3,
      },
    });
    expect(result.sortOrder).toBe(3);
  });

  it('rejects creating a category with a name already used in the space', async () => {
    const { service } = buildService({
      prisma: {
        category: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: 'existing', spaceId: 's1', name: 'Kids' }),
        },
      },
    });

    try {
      await service.createCategory('s1', { name: 'Kids' });
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.CONFLICT);
    }
  });

  it('rejects renaming a category to a name used by a different category', async () => {
    const { service, prisma } = buildService({
      prisma: {
        category: {
          findUnique: vi
            .fn()
            .mockResolvedValueOnce({ id: 'c1', spaceId: 's1', name: 'Old' })
            .mockResolvedValueOnce({ id: 'c2', spaceId: 's1', name: 'New' }),
        },
      },
    });

    try {
      await service.updateCategory('s1', 'c1', { name: 'New' });
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.CONFLICT);
    }
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it('deletes a category after confirming it exists in the space', async () => {
    const { service, prisma } = buildService({
      prisma: {
        category: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: 'c1', spaceId: 's1', name: 'Kids' }),
        },
      },
    });

    await service.deleteCategory('s1', 'c1');

    expect(prisma.category.delete).toHaveBeenCalledWith({
      where: { id: 'c1' },
    });
  });

  it("rejects reordering when orderedIds does not match the space's current categories", async () => {
    const { service, prisma } = buildService({
      prisma: {
        category: {
          findMany: vi.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]),
        },
      },
    });

    try {
      await service.reorderCategories('s1', ['c1', 'c3']);
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reassigns sortOrder for every category in the provided order', async () => {
    const { service, prisma } = buildService({
      prisma: {
        category: {
          findMany: vi
            .fn()
            .mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }])
            .mockResolvedValueOnce([
              { id: 'c2', sortOrder: 0 },
              { id: 'c1', sortOrder: 1 },
            ]),
          update: vi.fn(),
        },
        $transaction: vi.fn().mockResolvedValue([]),
      },
    });

    const result = await service.reorderCategories('s1', ['c2', 'c1']);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result[0].id).toBe('c2');
    expect(result[1].id).toBe('c1');
  });
});
