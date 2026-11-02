import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, TransactionType, type Expense } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrencyService } from '../currencies/currencies.service';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';
import { parseOccurredAt } from '../common/utils/occurred-at';
import {
  toTransactionResponse,
  transactionInclude,
  type TransactionResponse,
} from '../expenses/transaction-response';

export interface CreateTransferInput {
  fromWalletId: string;
  toWalletId: string;
  amount: number;
  toAmount?: number;
  occurredAt: string;
  note?: string;
}

export interface UpdateTransferInput {
  fromWalletId?: string;
  toWalletId?: string;
  amount?: number;
  toAmount?: number;
  occurredAt?: string;
  note?: string | null;
}

// A transfer is one Expense row of type TRANSFER: walletId/amount is the
// source side, toWalletId/toAmount the destination. amountInPrimary/fxRate
// are filled like for an expense (source side) but never enter totals.
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currencyService: CurrencyService,
  ) {}

  async createTransfer(
    spaceId: string,
    createdById: string,
    input: CreateTransferInput,
  ): Promise<TransactionResponse> {
    const occurredAt = parseOccurredAt(input.occurredAt);
    this.assertDifferentWallets(input.fromWalletId, input.toWalletId);
    const from = await this.assertWalletInSpace(spaceId, input.fromWalletId);
    const to = await this.assertWalletInSpace(spaceId, input.toWalletId);
    const space = await this.findSpaceOrThrow(spaceId);

    const fxRate = await this.rateToPrimary(
      from.currency,
      space.primaryCurrency,
      occurredAt,
    );
    const toAmount = await this.resolveToAmount(
      from.currency,
      to.currency,
      input.amount,
      input.toAmount,
      occurredAt,
    );

    const transfer = await this.prisma.expense.create({
      data: {
        spaceId,
        walletId: from.id,
        type: TransactionType.TRANSFER,
        amount: input.amount,
        walletCurrency: from.currency,
        amountInPrimary: new Prisma.Decimal(input.amount).times(fxRate),
        fxRate,
        toWalletId: to.id,
        toAmount,
        toWalletCurrency: to.currency,
        note: input.note,
        occurredAt,
        createdById,
      },
      include: transactionInclude,
    });
    return toTransactionResponse(transfer);
  }

  async updateTransfer(
    spaceId: string,
    transferId: string,
    input: UpdateTransferInput,
  ): Promise<TransactionResponse> {
    const existing = await this.findTransferOrThrow(spaceId, transferId);

    const fromWalletId = input.fromWalletId ?? existing.walletId;
    const toWalletId = input.toWalletId ?? existing.toWalletId!;
    this.assertDifferentWallets(fromWalletId, toWalletId);

    // Only a newly chosen wallet has to be usable (not archived); the ones
    // the transfer already uses keep their snapshot currency.
    const fromCurrency = input.fromWalletId
      ? (await this.assertWalletInSpace(spaceId, input.fromWalletId)).currency
      : existing.walletCurrency;
    const toCurrency = input.toWalletId
      ? (await this.assertWalletInSpace(spaceId, input.toWalletId)).currency
      : existing.toWalletCurrency!;

    const occurredAt = input.occurredAt
      ? parseOccurredAt(input.occurredAt)
      : existing.occurredAt;
    const amount = input.amount ?? existing.amount;

    const data: Prisma.ExpenseUncheckedUpdateInput = {
      walletId: fromWalletId,
      walletCurrency: fromCurrency,
      amount,
      toWalletId,
      toWalletCurrency: toCurrency,
      occurredAt,
      note: input.note,
    };

    if (
      input.amount !== undefined ||
      input.occurredAt !== undefined ||
      input.fromWalletId !== undefined
    ) {
      const space = await this.findSpaceOrThrow(spaceId);
      const fxRate = await this.rateToPrimary(
        fromCurrency,
        space.primaryCurrency,
        occurredAt,
      );
      data.fxRate = fxRate;
      data.amountInPrimary = new Prisma.Decimal(amount).times(fxRate);
    }

    // The received amount is converted again only when what it depends on
    // changed; a date-only edit keeps an amount the user entered by hand.
    if (
      input.toAmount !== undefined ||
      input.amount !== undefined ||
      input.fromWalletId !== undefined ||
      input.toWalletId !== undefined
    ) {
      data.toAmount = await this.resolveToAmount(
        fromCurrency,
        toCurrency,
        amount,
        input.toAmount,
        occurredAt,
      );
    }

    const updated = await this.prisma.expense.update({
      where: { id: transferId },
      data,
      include: transactionInclude,
    });
    return toTransactionResponse(updated);
  }

  async deleteTransfer(spaceId: string, transferId: string): Promise<void> {
    await this.findTransferOrThrow(spaceId, transferId);
    await this.prisma.expense.delete({ where: { id: transferId } });
  }

  private assertDifferentWallets(fromWalletId: string, toWalletId: string) {
    if (fromWalletId === toWalletId) {
      throw new AppException(
        ERROR_CODES.TRANSFER_SAME_WALLET,
        HttpStatus.BAD_REQUEST,
        'Cannot transfer to the same wallet',
      );
    }
  }

  private async rateToPrimary(
    currency: string,
    primaryCurrency: string,
    occurredAt: Date,
  ): Promise<Prisma.Decimal> {
    return (
      await this.currencyService.getRate(currency, primaryCurrency, occurredAt)
    ).toDecimalPlaces(8);
  }

  private async resolveToAmount(
    fromCurrency: string,
    toCurrency: string,
    amount: Prisma.Decimal.Value,
    toAmount: number | undefined,
    occurredAt: Date,
  ): Promise<Prisma.Decimal> {
    const sent = new Prisma.Decimal(amount);
    if (fromCurrency === toCurrency) {
      if (toAmount !== undefined && !sent.equals(toAmount)) {
        throw new AppException(
          ERROR_CODES.TRANSFER_AMOUNT_MISMATCH,
          HttpStatus.BAD_REQUEST,
          'toAmount must equal amount for wallets in the same currency',
        );
      }
      return sent;
    }
    if (toAmount !== undefined) {
      return new Prisma.Decimal(toAmount);
    }
    const rate = await this.currencyService.getRate(
      fromCurrency,
      toCurrency,
      occurredAt,
    );
    return sent.times(rate).toDecimalPlaces(4);
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
    if (wallet.archived) {
      throw new AppException(
        ERROR_CODES.WALLET_ARCHIVED,
        HttpStatus.CONFLICT,
        'Cannot use an archived wallet',
      );
    }
    return wallet;
  }

  private async findSpaceOrThrow(
    spaceId: string,
  ): Promise<{ id: string; primaryCurrency: string }> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
    });
    if (!space) {
      throw new AppException(
        ERROR_CODES.SPACE_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Space not found',
      );
    }
    return space;
  }

  private async findTransferOrThrow(
    spaceId: string,
    transferId: string,
  ): Promise<Expense> {
    const transfer = await this.prisma.expense.findUnique({
      where: { id: transferId },
    });
    if (
      !transfer ||
      transfer.spaceId !== spaceId ||
      transfer.type !== TransactionType.TRANSFER
    ) {
      throw new AppException(
        ERROR_CODES.TRANSFER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'Transfer not found',
      );
    }
    return transfer;
  }
}
