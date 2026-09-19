import { IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class ChangeMemberRoleDto {
  @IsEnum(Role)
  role!: Role;
}
