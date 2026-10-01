import { ApiProperty } from '@nestjs/swagger';
import {
  ApiDateTimeProperty,
  ApiDecimalProperty,
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
    description: "In the space's primary currency",
  })
  monthlyLimit!: string | null;

  @ApiProperty()
  archived!: boolean;

  @ApiProperty({ type: 'integer' })
  sortOrder!: number;

  @ApiDateTimeProperty()
  createdAt!: string;

  @ApiDateTimeProperty()
  updatedAt!: string;
}
