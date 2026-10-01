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

  @ApiProperty({ enum: TransactionType, enumName: 'TransactionType' })
  type!: TransactionType;

  @ApiDecimalProperty({ description: 'In walletCurrency' })
  amount!: string;

  @ApiProperty()
  walletCurrency!: string;

  @ApiDecimalProperty({ description: "In the space's primary currency" })
  amountInPrimary!: string;

  @ApiDecimalProperty({ description: 'Exchange rate used for conversion' })
  fxRate!: string;

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
