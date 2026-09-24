import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  RecurringFrequency,
  RecurringTransaction,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';

export interface CreateRecurringTransactionInput {
  walletId: string;
  categoryId?: string;
  type: TransactionType;
  amount: number;
  name: string;
  note?: string;
  frequency: RecurringFrequency;
  dayOfMonth: number;
  startDate: string;
  endDate?: string;
}

@Injectable()
export class RecurringService {
  constructor(private readonly prisma: PrismaService) {}

  async createRecurringTransaction(
    spaceId: string,
    createdById: string,
    input: CreateRecurringTransactionInput,
  ): Promise<RecurringTransaction> {
    const wallet = await this.assertWalletInSpace(spaceId, input.walletId);
    if (input.categoryId) {
      await this.assertCategoryInSpace(spaceId, input.categoryId);
    }

    const startDate = new Date(input.startDate);
    const endDate = input.endDate ? new Date(input.endDate) : undefined;
    if (endDate && endDate.getTime() <= startDate.getTime()) {
      throw new AppException(
        ERROR_CODES.INVALID_RECURRING_DATE_RANGE,
        HttpStatus.BAD_REQUEST,
        'endDate must be after startDate',
      );
    }

    return this.prisma.recurringTransaction.create({
      data: {
        spaceId,
        walletId: input.walletId,
        categoryId: input.categoryId,
        type: input.type,
        amount: input.amount,
        currency: wallet.currency,
        name: input.name,
        note: input.note,
        frequency: input.frequency,
        dayOfMonth: input.dayOfMonth,
        startDate,
        endDate,
        createdById,
      },
    });
  }

  private async assertWalletInSpace(
    spaceId: string,
    walletId: string,
  ): Promise<{ id: string; currency: string }> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
    });
    if (!wallet || wallet.spaceId !== spaceId) {
      throw new AppException(
        ERROR_CODES.WALLET_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Wallet not found',
      );
    }
    return wallet;
  }

  private async assertCategoryInSpace(
    spaceId: string,
    categoryId: string,
  ): Promise<void> {
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
  }
}
