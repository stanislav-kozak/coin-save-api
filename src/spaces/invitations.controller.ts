import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { SpacesService } from './spaces.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { EventBus } from '../events/event-bus.service';
import { MembershipResponseDto } from './dto/space-response.dto';

@Controller('invitations')
@UseGuards(JwtAuthGuard)
export class InvitationsController {
  constructor(
    private readonly spacesService: SpacesService,
    private readonly events: EventBus,
  ) {}

  @Post('accept')
  @ApiOkResponse({ type: MembershipResponseDto })
  @HttpCode(HttpStatus.OK)
  async accept(
    @Body() dto: AcceptInvitationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const membership = await this.spacesService.acceptInvitation(
      user.id,
      user.email,
      dto.token,
    );
    this.events.emitToSpace(membership.spaceId, 'member.joined', user.id);
    return membership;
  }
}
