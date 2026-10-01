import { ApiProperty } from '@nestjs/swagger';
import { RecurringFrequency, TransactionType } from '@prisma/client';
import {
  ApiDateTimeProperty,
  ApiDecimalProperty,
} from '../../common/decorators/api-property.decorator';

export class RecurringTransactionResponseDto {
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

  @ApiDecimalProperty()
  amount!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ enum: RecurringFrequency, enumName: 'RecurringFrequency' })
  frequency!: RecurringFrequency;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 31 })
  dayOfMonth!: number;

  @ApiDateTimeProperty()
  startDate!: string;

  @ApiDateTimeProperty({ nullable: true })
  endDate!: string | null;

  @ApiDateTimeProperty({ nullable: true })
  lastGeneratedAt!: string | null;

  @ApiProperty()
  active!: boolean;

  @ApiProperty()
  createdById!: string;

  @ApiDateTimeProperty()
  createdAt!: string;

  @ApiDateTimeProperty()
  updatedAt!: string;
}
