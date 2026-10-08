import { ApiProperty } from '@nestjs/swagger';
import {
  ApiDateTimeProperty,
  ApiDecimalProperty,
  ApiCurrencyProperty,
} from '../../common/decorators/api-property.decorator';

export class CategoryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  spaceId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;

  @ApiProperty({ type: String, nullable: true })
  color!: string | null;

  @ApiDecimalProperty({
    nullable: true,
    description: 'In `currency`, or the space currency when that is null',
  })
  monthlyLimit!: string | null;

  @ApiCurrencyProperty({
    nullable: true,
    description: 'Own budget currency; null follows the space',
  })
  currency!: string | null;

  @ApiProperty()
  archived!: boolean;

  @ApiProperty({ type: 'integer' })
  sortOrder!: number;

  @ApiDateTimeProperty()
  createdAt!: string;

  @ApiDateTimeProperty()
  updatedAt!: string;
}
