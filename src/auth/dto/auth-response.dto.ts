import { ApiProperty } from '@nestjs/swagger';
import { ApiDateTimeProperty } from '../../common/decorators/api-property.decorator';

export class AuthenticatedUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;
}

export class LoginResponseDto {
  @ApiProperty({ type: AuthenticatedUserDto })
  user!: AuthenticatedUserDto;
}

export class UserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiDateTimeProperty({ nullable: true })
  emailVerified!: string | null;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ example: 'uk' })
  locale!: string;

  @ApiDateTimeProperty()
  createdAt!: string;

  @ApiDateTimeProperty()
  updatedAt!: string;
}
