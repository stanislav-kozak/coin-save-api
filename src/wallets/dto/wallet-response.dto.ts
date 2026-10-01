import { ApiProperty } from '@nestjs/swagger';
import {
  ApiDateTimeProperty,
  ApiDecimalProperty,
} from '../../common/decorators/api-property.decorator';

export class WalletResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  spaceId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'ISO 4217 currency code' })
  currency!: string;

  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;

  @ApiProperty({ type: String, nullable: true })
  color!: string | null;

  @ApiDecimalProperty()
  initialBalance!: string;

  @ApiDecimalProperty({
    description: 'initialBalance plus incomes minus expenses',
  })
  balance!: string;

  @ApiProperty()
  archived!: boolean;

  @ApiDateTimeProperty()
  createdAt!: string;

  @ApiDateTimeProperty()
  updatedAt!: string;
}
