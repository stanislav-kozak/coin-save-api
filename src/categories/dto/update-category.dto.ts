import {
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  ApiPositiveAmountProperty,
  ApiCurrencyProperty,
} from '../../common/decorators/api-property.decorator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'color must be a 6-digit hex code, e.g. #F97350',
  })
  color?: string;

  // Absent: unchanged. null: removes the limit (IsOptional skips the number
  // checks for null). A number: sets it.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @ApiPositiveAmountProperty({
    required: false,
    nullable: true,
    description: 'Omit to keep the current limit; null removes it',
  })
  @IsPositive()
  @Max(1_000_000_000)
  monthlyLimit?: number | null;

  // null = follow the space currency (default).
  @ApiCurrencyProperty({
    required: false,
    nullable: true,
    description:
      "Currency of this category's budget; null follows the space. " +
      "Changing it converts monthlyLimit at today's rate (whole units) " +
      'unless monthlyLimit is sent too, taken as given in the new currency.',
  })
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string | null;
}
