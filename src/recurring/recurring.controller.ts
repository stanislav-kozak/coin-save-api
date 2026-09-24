import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { RecurringService } from './recurring.service';
import { CreateRecurringTransactionDto } from './dto/create-recurring-transaction.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

@Controller('spaces/:spaceId/recurring')
@UseGuards(JwtAuthGuard, SpaceMemberGuard)
export class RecurringController {
  constructor(private readonly recurringService: RecurringService) {}

  @Post()
  create(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRecurringTransactionDto,
  ) {
    return this.recurringService.createRecurringTransaction(
      spaceId,
      user.id,
      dto,
    );
  }
}
