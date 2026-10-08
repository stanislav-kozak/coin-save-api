import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';
import { ApiCurrencyProperty } from '../../common/decorators/api-property.decorator';

export class CurrencyRateQueryDto {
  @ApiCurrencyProperty()
  @IsIn(SUPPORTED_CURRENCIES)
  from!: string;

  @ApiCurrencyProperty()
  @IsIn(SUPPORTED_CURRENCIES)
  to!: string;
}

export class CurrencyRateResponseDto {
  @ApiCurrencyProperty()
  from!: string;

  @ApiCurrencyProperty()
  to!: string;

  @ApiProperty({
    type: String,
    format: 'decimal',
    example: '0.0241',
    description: '1 unit of `from` in `to`',
  })
  rate!: string;

  @ApiProperty({
    example: '2026-10-08',
    description: 'Day (Kyiv) the rate applies to',
  })
  date!: string;
}
