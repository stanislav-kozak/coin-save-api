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
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
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
import { EventBus } from '../events/event-bus.service';
import {
  InvitationResponseDto,
  MemberResponseDto,
  MembershipResponseDto,
  SpaceResponseDto,
  SpaceWithRoleResponseDto,
} from './dto/space-response.dto';
import { MessageResponseDto } from '../common/dto/message-response.dto';

@Controller('spaces')
@UseGuards(JwtAuthGuard)
export class SpacesController {
  constructor(
    private readonly spacesService: SpacesService,
    private readonly events: EventBus,
  ) {}

  // No realtime event on creation: a brand-new space has no room with any
  // other subscriber yet, so emitting here would always be a no-op.
  @Post()
  @ApiCreatedResponse({ type: SpaceResponseDto })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSpaceDto) {
    return this.spacesService.createSpace(user.id, dto.name);
  }

  @Get()
  @ApiOkResponse({ type: [SpaceWithRoleResponseDto] })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.spacesService.listSpacesForUser(user.id);
  }

  @Get(':spaceId')
  @ApiOkResponse({ type: SpaceResponseDto })
  @UseGuards(SpaceMemberGuard)
  get(@Param('spaceId') spaceId: string) {
    return this.spacesService.getSpace(spaceId);
  }

  @Patch(':spaceId')
  @ApiOkResponse({ type: SpaceResponseDto })
  @UseGuards(SpaceOwnerGuard)
  async update(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSpaceDto,
  ) {
    const space = await this.spacesService.updateSpace(spaceId, dto);
    this.events.emitToSpace(spaceId, 'space.changed', user.id);
    return space;
  }

  @Delete(':spaceId')
  @UseGuards(SpaceOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.spacesService.deleteSpace(spaceId);
    this.events.emitToSpace(spaceId, 'space.changed', user.id);
  }

  @Get(':spaceId/members')
  @ApiOkResponse({ type: [MemberResponseDto] })
  @UseGuards(SpaceMemberGuard)
  listMembers(@Param('spaceId') spaceId: string) {
    return this.spacesService.listMembers(spaceId);
  }

  @Patch(':spaceId/members/:membershipId')
  @ApiOkResponse({ type: MembershipResponseDto })
  @UseGuards(SpaceOwnerGuard)
  async changeMemberRole(
    @Param('spaceId') spaceId: string,
    @Param('membershipId') membershipId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangeMemberRoleDto,
  ) {
    const membership = await this.spacesService.changeMemberRole(
      spaceId,
      membershipId,
      dto.role,
    );
    this.events.emitToSpace(spaceId, 'space.changed', user.id);
    return membership;
  }

  @Delete(':spaceId/members/:membershipId')
  @UseGuards(SpaceOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Param('spaceId') spaceId: string,
    @Param('membershipId') membershipId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.spacesService.removeMember(spaceId, membershipId);
    this.events.emitToSpace(spaceId, 'space.changed', user.id);
  }

  @Post(':spaceId/leave')
  @ApiOkResponse({ type: MessageResponseDto })
  @UseGuards(SpaceMemberGuard)
  @HttpCode(HttpStatus.OK)
  async leave(
    @Param('spaceId') spaceId: string,
    @CurrentMembership() membership: Membership,
  ) {
    await this.spacesService.leaveSpace(spaceId, membership);
    this.events.emitToSpace(spaceId, 'space.changed', membership.userId);
    return { message: 'Left the space' };
  }

  @Post(':spaceId/invitations')
  @ApiCreatedResponse({ type: MessageResponseDto })
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
  @ApiOkResponse({ type: [InvitationResponseDto] })
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
