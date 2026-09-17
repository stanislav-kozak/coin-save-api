import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { Membership } from '@prisma/client';
import { SpacesService } from './spaces.service';
import { CreateSpaceDto } from './dto/create-space.dto';
import { UpdateSpaceDto } from './dto/update-space.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { ChangeMemberRoleDto } from './dto/change-member-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';
import { SpaceOwnerGuard } from '../common/guards/space-owner.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentMembership } from '../common/decorators/current-membership.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

@Controller('spaces')
@UseGuards(JwtAuthGuard)
export class SpacesController {
  constructor(private readonly spacesService: SpacesService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSpaceDto) {
    return this.spacesService.createSpace(user.id, dto.name);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.spacesService.listSpacesForUser(user.id);
  }

  @Get(':spaceId')
  @UseGuards(SpaceMemberGuard)
  get(@Param('spaceId') spaceId: string) {
    return this.spacesService.getSpace(spaceId);
  }

  @Patch(':spaceId')
  @UseGuards(SpaceOwnerGuard)
  update(@Param('spaceId') spaceId: string, @Body() dto: UpdateSpaceDto) {
    return this.spacesService.updateSpace(spaceId, dto);
  }

  @Delete(':spaceId')
  @UseGuards(SpaceOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('spaceId') spaceId: string): Promise<void> {
    await this.spacesService.deleteSpace(spaceId);
  }

  @Get(':spaceId/members')
  @UseGuards(SpaceMemberGuard)
  listMembers(@Param('spaceId') spaceId: string) {
    return this.spacesService.listMembers(spaceId);
  }

  @Patch(':spaceId/members/:membershipId')
  @UseGuards(SpaceOwnerGuard)
  changeMemberRole(
    @Param('spaceId') spaceId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: ChangeMemberRoleDto,
  ) {
    return this.spacesService.changeMemberRole(spaceId, membershipId, dto.role);
  }

  @Delete(':spaceId/members/:membershipId')
  @UseGuards(SpaceOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Param('spaceId') spaceId: string,
    @Param('membershipId') membershipId: string,
  ): Promise<void> {
    await this.spacesService.removeMember(spaceId, membershipId);
  }

  @Post(':spaceId/leave')
  @UseGuards(SpaceMemberGuard)
  @HttpCode(HttpStatus.OK)
  async leave(
    @Param('spaceId') spaceId: string,
    @CurrentMembership() membership: Membership,
  ) {
    await this.spacesService.leaveSpace(spaceId, membership);
    return { message: 'Left the space' };
  }

  @Post(':spaceId/invitations')
  @UseGuards(SpaceMemberGuard)
  @HttpCode(HttpStatus.CREATED)
  async invite(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteMemberDto,
  ) {
    await this.spacesService.inviteMember(spaceId, user.id, dto.email);
    return { message: 'Invitation sent' };
  }

  @Get(':spaceId/invitations')
  @UseGuards(SpaceMemberGuard)
  listInvitations(@Param('spaceId') spaceId: string) {
    return this.spacesService.listInvitations(spaceId);
  }

  @Delete(':spaceId/invitations/:invitationId')
  @UseGuards(SpaceOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvitation(
    @Param('spaceId') spaceId: string,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    await this.spacesService.revokeInvitation(spaceId, invitationId);
  }
}
