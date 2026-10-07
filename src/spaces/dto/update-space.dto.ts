import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class UpdateSpaceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    enum: SUPPORTED_CURRENCIES,
    description:
      'Changing it re-converts every transaction (amountInPrimary, fxRate) ' +
      "at its own day's rate and category limits at today's rate, rounded.",
  })
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  primaryCurrency?: string;
}
