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
  update(
    @Param('spaceId') spaceId: string,
    @Param('recurringId') recurringId: string,
    @Body() dto: UpdateRecurringTransactionDto,
  ) {
    return this.recurringService.updateRecurringTransaction(
      spaceId,
      recurringId,
      dto,
    );
  }

  @Patch(':recurringId/pause')
  pause(
    @Param('spaceId') spaceId: string,
    @Param('recurringId') recurringId: string,
  ) {
    return this.recurringService.pauseRecurringTransaction(
      spaceId,
      recurringId,
    );
  }

  @Patch(':recurringId/resume')
  resume(
    @Param('spaceId') spaceId: string,
    @Param('recurringId') recurringId: string,
  ) {
    return this.recurringService.resumeRecurringTransaction(
      spaceId,
      recurringId,
    );
  }

  @Delete(':recurringId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('spaceId') spaceId: string,
    @Param('recurringId') recurringId: string,
  ): Promise<void> {
    await this.recurringService.deleteRecurringTransaction(
      spaceId,
      recurringId,
    );
  }
}
