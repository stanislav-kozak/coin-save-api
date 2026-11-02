import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';
import {
  ColorProperty,
  IconProperty,
} from '../../common/decorators/appearance.decorator';

export class CreateWalletDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsIn(SUPPORTED_CURRENCIES)
  currency!: string;

  @IconProperty()
  icon?: string;

  @ColorProperty()
  color?: string;

  // Explicit: the swagger plugin silently drops properties whose validators
  // take a negative literal (@Min(-1_000_000_000)).
  @ApiProperty({
    type: Number,
    minimum: -1_000_000_000,
    maximum: 1_000_000_000,
    example: 1250.5,
    description: 'Up to 4 decimal places; may be negative (e.g. a credit card)',
  })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(-1_000_000_000)
  @Max(1_000_000_000)
  initialBalance!: number;
}
