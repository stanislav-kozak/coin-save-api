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

@Controller('spaces/:spaceId/expenses')
@UseGuards(JwtAuthGuard, SpaceMemberGuard)
export class ExpensesController {
  constructor(
    private readonly expensesService: ExpensesService,
    private readonly events: EventBus,
  ) {}

  @Post()
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
  @ApiOkResponse({ type: [ExpenseResponseDto] })
  list(
    @Param('spaceId') spaceId: string,
    @Query() query: ListExpensesQueryDto,
  ) {
    return this.expensesService.listExpenses(spaceId, query);
  }

  @Get(':expenseId')
  @ApiOkResponse({ type: ExpenseResponseDto })
  get(
    @Param('spaceId') spaceId: string,
    @Param('expenseId') expenseId: string,
  ) {
    return this.expensesService.getExpense(spaceId, expenseId);
  }

  @Patch(':expenseId')
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
