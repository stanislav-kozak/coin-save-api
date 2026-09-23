import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, TransactionType, type Wallet } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { ERROR_CODES } from '../common/constants/error-codes';

export interface WalletWithBalance {
  id: string;
  spaceId: string;
  name: string;
  currency: string;
  icon: string | null;
  color: string | null;
  initialBalance: Prisma.Decimal;
  balance: Prisma.Decimal;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWalletInput {
  name: string;
  currency: string;
  icon?: string;
  color?: string;
  initialBalance: number;
}

export interface UpdateWalletInput {
  name?: string;
  icon?: string;
  color?: string;
  initialBalance?: number;
}

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  async createWallet(
    spaceId: string,
    input: CreateWalletInput,
  ): Promise<WalletWithBalance> {
    const wallet = await this.prisma.wallet.create({
      data: {
        spaceId,
        name: input.name,
        currency: input.currency,
        icon: input.icon,
        color: input.color,
        initialBalance: input.initialBalance,
      },
    });

    return this.toWalletWithBalance(wallet, new Prisma.Decimal(0));
  }

  async listWallets(
    spaceId: string,
    includeArchived: boolean,
  ): Promise<WalletWithBalance[]> {
    const wallets = await this.prisma.wallet.findMany({
      where: { spaceId, ...(includeArchived ? {} : { archived: false }) },
      orderBy: { createdAt: 'asc' },
    });

    const movements = await this.sumMovements(wallets.map((w) => w.id));

    return wallets.map((wallet) =>
      this.toWalletWithBalance(
        wallet,
        movements.get(wallet.id) ?? new Prisma.Decimal(0),
      ),
    );
  }

  async getWallet(
    spaceId: string,
    walletId: string,
  ): Promise<WalletWithBalance> {
    const wallet = await this.findWalletOrThrow(spaceId, walletId);
    const movements = await this.sumMovements([wallet.id]);
    return this.toWalletWithBalance(
      wallet,
      movements.get(wallet.id) ?? new Prisma.Decimal(0),
    );
  }

  async updateWallet(
    spaceId: string,
    walletId: string,
    input: UpdateWalletInput,
  ): Promise<WalletWithBalance> {
    await this.findWalletOrThrow(spaceId, walletId);

    const wallet = await this.prisma.wallet.update({
      where: { id: walletId },
      data: input,
    });

    const movements = await this.sumMovements([wallet.id]);
    return this.toWalletWithBalance(
      wallet,
      movements.get(wallet.id) ?? new Prisma.Decimal(0),
    );
  }

  archiveWallet(spaceId: string, walletId: string): Promise<WalletWithBalance> {
    return this.setArchived(spaceId, walletId, true);
  }

  unarchiveWallet(
    spaceId: string,
    walletId: string,
  ): Promise<WalletWithBalance> {
    return this.setArchived(spaceId, walletId, false);
  }

  private async setArchived(
    spaceId: string,
    walletId: string,
    archived: boolean,
  ): Promise<WalletWithBalance> {
    await this.findWalletOrThrow(spaceId, walletId);

    const wallet = await this.prisma.wallet.update({
      where: { id: walletId },
      data: { archived },
    });

    const movements = await this.sumMovements([wallet.id]);
    return this.toWalletWithBalance(
      wallet,
      movements.get(wallet.id) ?? new Prisma.Decimal(0),
    );
  }

  private async findWalletOrThrow(
    spaceId: string,
    walletId: string,
  ): Promise<Wallet> {
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

  private async sumMovements(
    walletIds: string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    const movements = new Map<string, Prisma.Decimal>();
    for (const walletId of walletIds) {
      movements.set(walletId, new Prisma.Decimal(0));
    }

    if (walletIds.length === 0) {
      return movements;
    }

    const sums = await this.prisma.expense.groupBy({
      by: ['walletId', 'type'],
      where: { walletId: { in: walletIds } },
      _sum: { amount: true },
    });

    for (const row of sums) {
      const current = movements.get(row.walletId) ?? new Prisma.Decimal(0);
      const amount = row._sum.amount ?? new Prisma.Decimal(0);
      const signed =
        row.type === TransactionType.INCOME ? amount : amount.negated();
      movements.set(row.walletId, current.plus(signed));
    }

    return movements;
  }

  private toWalletWithBalance(
    wallet: Wallet,
    movement: Prisma.Decimal,
  ): WalletWithBalance {
    return {
      id: wallet.id,
      spaceId: wallet.spaceId,
      name: wallet.name,
      currency: wallet.currency,
      icon: wallet.icon,
      color: wallet.color,
      initialBalance: wallet.initialBalance,
      balance: new Prisma.Decimal(wallet.initialBalance).plus(movement),
      archived: wallet.archived,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }
}
