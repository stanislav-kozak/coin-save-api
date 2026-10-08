import { Body, Controller, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';
import { UserResponseDto } from '../auth/dto/auth-response.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiErrorResponse(HttpStatus.UNAUTHORIZED, 'HTTP_ERROR')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Only ever the caller's own profile; returns the same shape as GET /auth/me.
  @Patch('me')
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR')
  @ApiOkResponse({ type: UserResponseDto })
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return this.usersService.updateProfile(user.id, dto);
  }
}
