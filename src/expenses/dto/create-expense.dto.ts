import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';
import { TransactionType } from '@prisma/client';

export class CreateExpenseDto {
  @IsString()
  walletId!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsEnum(TransactionType)
  type!: TransactionType;

  @IsNumber({ maxDecimalPlaces: 4 })
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
