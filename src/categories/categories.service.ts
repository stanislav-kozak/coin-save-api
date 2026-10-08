import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Category } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyService } from '../currencies/currencies.service';
import { convertMonthlyLimit } from '../common/utils/money';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';

export interface CreateCategoryInput {
  name: string;
  icon?: string;
  color?: string;
  monthlyLimit?: number;
  currency?: string | null;
}

export interface UpdateCategoryInput {
  name?: string;
  icon?: string;
  color?: string;
  monthlyLimit?: number | null;
  currency?: string | null;
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  async createCategory(
    spaceId: string,
    input: CreateCategoryInput,
  ): Promise<Category> {
    await this.assertNameAvailable(spaceId, input.name);

    const maxSortOrder = await this.prisma.category.aggregate({
      where: { spaceId },
      _max: { sortOrder: true },
    });
    const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

    return this.prisma.category.create({
      data: {
        spaceId,
        name: input.name,
        icon: input.icon,
        color: input.color,
        monthlyLimit: input.monthlyLimit,
        currency: input.currency ?? null,
        sortOrder: nextSortOrder,
      },
    });
  }

  listCategories(
    spaceId: string,
    includeArchived: boolean,
  ): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: { spaceId, ...(includeArchived ? {} : { archived: false }) },
      orderBy: { sortOrder: 'asc' },
    });
  }

  getCategory(spaceId: string, categoryId: string): Promise<Category> {
    return this.findCategoryOrThrow(spaceId, categoryId);
  }

  async updateCategory(
    spaceId: string,
    categoryId: string,
    input: UpdateCategoryInput,
  ): Promise<Category> {
    const category = await this.findCategoryOrThrow(spaceId, categoryId);

    if (input.name) {
      await this.assertNameAvailable(spaceId, input.name, categoryId);
    }

    // Changing the budget currency (null = the space's) converts the limit
    // at today's rate, unless a limit is sent along: then it's taken as
    // given, in the new currency.
    let monthlyLimit: number | null | Prisma.Decimal | undefined =
      input.monthlyLimit;
    if (
      input.currency !== undefined &&
      monthlyLimit === undefined &&
      category.monthlyLimit
    ) {
      const space = await this.prisma.space.findUniqueOrThrow({
        where: { id: spaceId },
        select: { primaryCurrency: true },
      });
      const from = category.currency ?? space.primaryCurrency;
      const to = input.currency ?? space.primaryCurrency;
      if (from !== to) {
        const rate = await this.currency.getRate(from, to, new Date());
        monthlyLimit = convertMonthlyLimit(category.monthlyLimit, rate);
      }
    }

    return this.prisma.category.update({
      where: { id: categoryId },
      data: {
        name: input.name,
        icon: input.icon,
        color: input.color,
        monthlyLimit,
        currency: input.currency,
      },
    });
  }

  archiveCategory(spaceId: string, categoryId: string): Promise<Category> {
    return this.setArchived(spaceId, categoryId, true);
  }

  unarchiveCategory(spaceId: string, categoryId: string): Promise<Category> {
    return this.setArchived(spaceId, categoryId, false);
  }

  async deleteCategory(spaceId: string, categoryId: string): Promise<void> {
    await this.findCategoryOrThrow(spaceId, categoryId);
    await this.prisma.category.delete({ where: { id: categoryId } });
  }

  async reorderCategories(
    spaceId: string,
    orderedIds: string[],
  ): Promise<Category[]> {
    const existing = await this.prisma.category.findMany({
      where: { spaceId, archived: false },
    });
    const existingIds = new Set(existing.map((c) => c.id));
    const providedIds = new Set(orderedIds);

    const sameSize = existingIds.size === providedIds.size;
    const sameLength = orderedIds.length === existing.length;
    const sameMembers = [...existingIds].every((id) => providedIds.has(id));
    if (!sameSize || !sameLength || !sameMembers) {
      throw new AppException(
        ERROR_CODES.INVALID_REORDER,
        HttpStatus.BAD_REQUEST,
        'orderedIds must contain exactly the category ids currently in this space',
      );
    }

    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.category.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );

    return this.listCategories(spaceId, false);
  }

  private async setArchived(
    spaceId: string,
    categoryId: string,
    archived: boolean,
  ): Promise<Category> {
    await this.findCategoryOrThrow(spaceId, categoryId);
    return this.prisma.category.update({
      where: { id: categoryId },
      data: { archived },
    });
  }

  private async findCategoryOrThrow(
    spaceId: string,
    categoryId: string,
  ): Promise<Category> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category || category.spaceId !== spaceId) {
      throw new AppException(
        ERROR_CODES.CATEGORY_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Category not found',
      );
    }
    return category;
  }

  private async assertNameAvailable(
    spaceId: string,
    name: string,
    excludeCategoryId?: string,
  ): Promise<void> {
    const existing = await this.prisma.category.findUnique({
      where: { spaceId_name: { spaceId, name } },
    });
    if (existing && existing.id !== excludeCategoryId) {
      throw new AppException(
        ERROR_CODES.CATEGORY_NAME_TAKEN,
        HttpStatus.CONFLICT,
        'A category with this name already exists',
      );
    }
  }
}
