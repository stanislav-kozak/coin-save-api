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
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { EventBus } from '../events/event-bus.service';
import { ExpenseResponseDto } from './dto/expense-response.dto';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';

@Controller('spaces/:spaceId/expenses')
@UseGuards(JwtAuthGuard, SpaceMemberGuard)
@ApiErrorResponse(HttpStatus.UNAUTHORIZED, 'HTTP_ERROR')
@ApiErrorResponse(HttpStatus.FORBIDDEN, 'FORBIDDEN_NOT_MEMBER')
export class ExpensesController {
  constructor(
    private readonly expensesService: ExpensesService,
    private readonly events: EventBus,
  ) {}

  @Post()
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_ERROR',
    'INVALID_OCCURRED_AT',
    'CURRENCY_NOT_SUPPORTED',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    'WALLET_NOT_FOUND',
    'CATEGORY_NOT_FOUND',
  )
  @ApiErrorResponse(HttpStatus.CONFLICT, 'WALLET_ARCHIVED', 'CATEGORY_ARCHIVED')
  @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE, 'CURRENCY_API_UNAVAILABLE')
  @ApiCreatedResponse({ type: ExpenseResponseDto })
  async create(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExpenseDto,
  ) {
    const expense = await this.expensesService.createExpense(
      spaceId,
      user.id,
      dto,
    );
    this.events.emitToSpace(spaceId, 'expense.changed', user.id);
    return expense;
  }

  @Get()
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR')
  @ApiOkResponse({ type: [ExpenseResponseDto] })
  list(
    @Param('spaceId') spaceId: string,
    @Query() query: ListExpensesQueryDto,
  ) {
    return this.expensesService.listExpenses(spaceId, query);
  }

  @Get(':expenseId')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'EXPENSE_NOT_FOUND')
  @ApiOkResponse({ type: ExpenseResponseDto })
  get(
    @Param('spaceId') spaceId: string,
    @Param('expenseId') expenseId: string,
  ) {
    return this.expensesService.getExpense(spaceId, expenseId);
  }

  @Patch(':expenseId')
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_ERROR',
    'INVALID_OCCURRED_AT',
    'CURRENCY_NOT_SUPPORTED',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    'EXPENSE_NOT_FOUND',
    'WALLET_NOT_FOUND',
    'CATEGORY_NOT_FOUND',
  )
  @ApiErrorResponse(HttpStatus.CONFLICT, 'WALLET_ARCHIVED', 'CATEGORY_ARCHIVED')
  @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE, 'CURRENCY_API_UNAVAILABLE')
  @ApiOkResponse({ type: ExpenseResponseDto })
  async update(
    @Param('spaceId') spaceId: string,
    @Param('expenseId') expenseId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateExpenseDto,
  ) {
    const expense = await this.expensesService.updateExpense(
      spaceId,
      expenseId,
      dto,
    );
    this.events.emitToSpace(spaceId, 'expense.changed', user.id);
    return expense;
  }

  @Delete(':expenseId')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'EXPENSE_NOT_FOUND')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('spaceId') spaceId: string,
    @Param('expenseId') expenseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.expensesService.deleteExpense(spaceId, expenseId);
    this.events.emitToSpace(spaceId, 'expense.changed', user.id);
  }
}
