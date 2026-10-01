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
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { RecurringService } from './recurring.service';
import { CreateRecurringTransactionDto } from './dto/create-recurring-transaction.dto';
import { UpdateRecurringTransactionDto } from './dto/update-recurring-transaction.dto';
import { ListRecurringQueryDto } from './dto/list-recurring-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { EventBus } from '../events/event-bus.service';
import { RecurringTransactionResponseDto } from './dto/recurring-transaction-response.dto';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';

@Controller('spaces/:spaceId/recurring')
@UseGuards(JwtAuthGuard, SpaceMemberGuard)
@ApiErrorResponse(HttpStatus.UNAUTHORIZED, 'HTTP_ERROR')
@ApiErrorResponse(HttpStatus.FORBIDDEN, 'FORBIDDEN_NOT_MEMBER')
export class RecurringController {
  constructor(
    private readonly recurringService: RecurringService,
    private readonly events: EventBus,
  ) {}

  @Post()
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_ERROR',
    'INVALID_RECURRING_DATE_RANGE',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    'WALLET_NOT_FOUND',
    'CATEGORY_NOT_FOUND',
  )
  @ApiErrorResponse(HttpStatus.CONFLICT, 'WALLET_ARCHIVED', 'CATEGORY_ARCHIVED')
  @ApiCreatedResponse({ type: RecurringTransactionResponseDto })
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
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR')
  @ApiOkResponse({ type: [RecurringTransactionResponseDto] })
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
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'RECURRING_NOT_FOUND')
  @ApiOkResponse({ type: RecurringTransactionResponseDto })
  get(
    @Param('spaceId') spaceId: string,
    @Param('recurringId') recurringId: string,
  ) {
    return this.recurringService.getRecurringTransaction(spaceId, recurringId);
  }

  @Patch(':recurringId')
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_ERROR',
    'INVALID_RECURRING_DATE_RANGE',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    'RECURRING_NOT_FOUND',
    'WALLET_NOT_FOUND',
    'CATEGORY_NOT_FOUND',
  )
  @ApiErrorResponse(HttpStatus.CONFLICT, 'WALLET_ARCHIVED', 'CATEGORY_ARCHIVED')
  @ApiOkResponse({ type: RecurringTransactionResponseDto })
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
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'RECURRING_NOT_FOUND')
  @ApiOkResponse({ type: RecurringTransactionResponseDto })
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
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'RECURRING_NOT_FOUND')
  @ApiOkResponse({ type: RecurringTransactionResponseDto })
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
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'RECURRING_NOT_FOUND')
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
