import {
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateExpenseDto {
  @ValidateIf((o: UpdateExpenseDto) => o.walletId !== undefined)
  @IsString()
  walletId?: string;

  // null is accepted deliberately to clear the field (Uncategorized).
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ValidateIf((o: UpdateExpenseDto) => o.amount !== undefined)
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  @Max(1_000_000_000)
  amount?: number;

  @ValidateIf((o: UpdateExpenseDto) => o.occurredAt !== undefined)
  @IsISO8601()
  occurredAt?: string;

  // null is accepted deliberately to clear the field.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
