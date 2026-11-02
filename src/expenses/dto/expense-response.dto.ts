import { ApiProperty } from '@nestjs/swagger';
import { TransactionType } from '@prisma/client';
import {
  ApiDateTimeProperty,
  ApiDecimalProperty,
} from '../../common/decorators/api-property.decorator';

export class ExpenseResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  spaceId!: string;

  @ApiProperty()
  walletId!: string;

  @ApiProperty({ type: String, nullable: true })
  categoryId!: string | null;

  @ApiProperty({
    enum: TransactionType,
    enumName: 'TransactionType',
    description:
      'TRANSFER moves money between two wallets: not an expense or income, ' +
      'excluded from totals, categories and budgets',
  })
  type!: TransactionType;

  @ApiDecimalProperty({ description: 'In walletCurrency' })
  amount!: string;

  @ApiProperty()
  walletCurrency!: string;

  @ApiDecimalProperty({ description: "In the space's primary currency" })
  amountInPrimary!: string;

  @ApiDecimalProperty({ description: 'Exchange rate used for conversion' })
  fxRate!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'TRANSFER only: destination wallet (walletId is the source); null otherwise',
  })
  toWalletId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'TRANSFER only: destination wallet name (even if archived)',
  })
  toWalletName!: string | null;

  @ApiDecimalProperty({
    nullable: true,
    description: 'TRANSFER only: amount received, in toWalletCurrency',
  })
  toAmount!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'TRANSFER only: destination wallet currency (snapshot)',
  })
  toWalletCurrency!: string | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiDateTimeProperty()
  occurredAt!: string;

  @ApiProperty()
  createdById!: string;

  @ApiProperty({ type: String, nullable: true })
  recurringId!: string | null;

  @ApiDateTimeProperty()
  createdAt!: string;

  @ApiDateTimeProperty()
  updatedAt!: string;
}
