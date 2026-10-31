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

export class CreateTransferDto {
  @IsString()
  fromWalletId!: string;

  @IsString()
  toWalletId!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @ApiPositiveAmountProperty({
    description: 'Amount sent, in the source wallet currency',
  })
  @IsPositive()
  @Max(1_000_000_000)
  amount!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @ApiPositiveAmountProperty({
    required: false,
    description:
      'Amount received, in the destination wallet currency. Omitted: ' +
      "converted at occurredAt's rate. Wallets in the same currency: must " +
      'equal amount (else TRANSFER_AMOUNT_MISMATCH) or be omitted.',
  })
  @IsPositive()
  @Max(1_000_000_000)
  toAmount?: number;

  @IsISO8601()
  occurredAt!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
