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
  Query,
  UseGuards,
} from '@nestjs/common';
import { RecurringService } from './recurring.service';
import { CreateRecurringTransactionDto } from './dto/create-recurring-transaction.dto';
import { UpdateRecurringTransactionDto } from './dto/update-recurring-transaction.dto';
import { ListRecurringQueryDto } from './dto/list-recurring-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { EventBus } from '../events/event-bus.service';

@Controller('spaces/:spaceId/recurring')
@UseGuards(JwtAuthGuard, SpaceMemberGuard)
export class RecurringController {
  constructor(
    private readonly recurringService: RecurringService,
    private readonly events: EventBus,
  ) {}

  @Post()
  async create(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRecurringTransactionDto,
  ) {
    const recurring = await this.recurringService.createRecurringTransaction(
      spaceId,
      user.id,
      dto,
    );
    this.events.emitToSpace(spaceId, 'recurring.changed', user.id);
    return recurring;
  }

  @Get()
  list(
    @Param('spaceId') spaceId: string,
    @Query() query: ListRecurringQueryDto,
  ) {
    return this.recurringService.listRecurringTransactions(
      spaceId,
      query.includeInactive ?? false,
    );
  }

  @Get(':recurringId')
  get(
    @Param('spaceId') spaceId: string,
    @Param('recurringId') recurringId: string,
  ) {
    return this.recurringService.getRecurringTransaction(spaceId, recurringId);
  }

  @Patch(':recurringId')
  async update(
    @Param('spaceId') spaceId: string,
    @Param('recurringId') recurringId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateRecurringTransactionDto,
  ) {
    const recurring = await this.recurringService.updateRecurringTransaction(
      spaceId,
      recurringId,
      dto,
    );
    this.events.emitToSpace(spaceId, 'recurring.changed', user.id);
    return recurring;
  }

  @Patch(':recurringId/pause')
  async pause(
    @Param('spaceId') spaceId: string,
    @Param('recurringId') recurringId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const recurring = await this.recurringService.pauseRecurringTransaction(
      spaceId,
      recurringId,
    );
    this.events.emitToSpace(spaceId, 'recurring.changed', user.id);
    return recurring;
  }

  @Patch(':recurringId/resume')
  async resume(
    @Param('spaceId') spaceId: string,
    @Param('recurringId') recurringId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const recurring = await this.recurringService.resumeRecurringTransaction(
      spaceId,
      recurringId,
    );
    this.events.emitToSpace(spaceId, 'recurring.changed', user.id);
    return recurring;
  }

  @Delete(':recurringId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('spaceId') spaceId: string,
    @Param('recurringId') recurringId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.recurringService.deleteRecurringTransaction(
      spaceId,
      recurringId,
    );
    this.events.emitToSpace(spaceId, 'recurring.changed', user.id);
  }
}
