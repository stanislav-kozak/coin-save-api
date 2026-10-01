import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ApiDateTimeProperty } from '../../common/decorators/api-property.decorator';

export class SpaceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  ownerId!: string;

  @ApiProperty()
  primaryCurrency!: string;

  @ApiDateTimeProperty()
  createdAt!: string;

  @ApiDateTimeProperty()
  updatedAt!: string;
}

export class SpaceWithRoleResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  primaryCurrency!: string;

  @ApiProperty({ enum: Role, enumName: 'Role', description: "Caller's role" })
  role!: Role;

  @ApiDateTimeProperty()
  createdAt!: string;

  @ApiDateTimeProperty()
  updatedAt!: string;
}

export class MemberResponseDto {
  @ApiProperty()
  membershipId!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role!: Role;

  @ApiDateTimeProperty()
  joinedAt!: string;
}

export class MembershipResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  spaceId!: string;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role!: Role;

  @ApiDateTimeProperty()
  joinedAt!: string;
}

export class InvitationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role!: Role;

  @ApiProperty()
  invitedById!: string;

  @ApiDateTimeProperty()
  expiresAt!: string;

  @ApiDateTimeProperty()
  createdAt!: string;
}
