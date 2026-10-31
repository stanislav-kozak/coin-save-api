import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiPositiveAmountProperty } from '../../common/decorators/api-property.decorator';

export class UpdateTransferDto {
  @IsOptional()
  @IsString()
  fromWalletId?: string;

  @IsOptional()
  @IsString()
  toWalletId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @ApiPositiveAmountProperty({ required: false })
  @IsPositive()
  @Max(1_000_000_000)
  amount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @ApiPositiveAmountProperty({
    required: false,
    description:
      'Amount received, in the destination wallet currency. Omitted while ' +
      'amount or a wallet changes: converted again at the rate of the ' +
      'transfer date (equals amount for wallets in the same currency).',
  })
  @IsPositive()
  @Max(1_000_000_000)
  toAmount?: number;

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    description: 'Omit to keep; null removes the note',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
