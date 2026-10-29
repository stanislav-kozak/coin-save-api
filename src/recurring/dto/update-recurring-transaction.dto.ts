import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiPositiveAmountProperty } from '../../common/decorators/api-property.decorator';

export class UpdateRecurringTransactionDto {
  @IsOptional()
  @IsString()
  walletId?: string;

  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @ApiPositiveAmountProperty({ required: false })
  @IsPositive()
  @Max(1_000_000_000)
  amount?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null)
  @IsISO8601()
  endDate?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    example: '2026-12-20',
    description:
      'Moves the next payment to this calendar day (YYYY-MM-DD), which must ' +
      'be tomorrow or later in the `tz` time zone. Later payments then fall ' +
      "on this day's number (it overrides `dayOfMonth`); payments already " +
      'recorded stay as they are. Earlier dates fail with ' +
      'NEXT_PAYMENT_DATE_IN_PAST.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'nextPaymentDate must be a date in YYYY-MM-DD format',
  })
  @IsISO8601({ strict: true })
  nextPaymentDate?: string;
}
