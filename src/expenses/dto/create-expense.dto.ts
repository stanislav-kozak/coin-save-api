import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ApiPositiveAmountProperty } from '../../common/decorators/api-property.decorator';
import {
  ENTRY_TYPES,
  type EntryType,
} from '../../common/constants/transaction-types';

export class CreateExpenseDto {
  @IsString()
  walletId!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ enum: ENTRY_TYPES, enumName: 'EntryType' })
  @IsIn(ENTRY_TYPES)
  type!: EntryType;

  @IsNumber({ maxDecimalPlaces: 4 })
  @ApiPositiveAmountProperty()
  @IsPositive()
  @Max(1_000_000_000)
  amount!: number;

  @IsISO8601()
  occurredAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
