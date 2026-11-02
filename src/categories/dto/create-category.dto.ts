import {
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  ApiPositiveAmountProperty,
  ApiCurrencyProperty,
} from '../../common/decorators/api-property.decorator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';
import {
  ColorProperty,
  IconProperty,
} from '../../common/decorators/appearance.decorator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IconProperty()
  icon?: string;

  @ColorProperty()
  color?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @ApiPositiveAmountProperty({ required: false })
  @IsPositive()
  @Max(1_000_000_000)
  monthlyLimit?: number;

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
