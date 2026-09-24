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
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

@Controller('spaces/:spaceId/expenses')
@UseGuards(JwtAuthGuard, SpaceMemberGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  create(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.expensesService.createExpense(spaceId, user.id, dto);
  }

  @Get()
  list(
    @Param('spaceId') spaceId: string,
    @Query() query: ListExpensesQueryDto,
  ) {
    return this.expensesService.listExpenses(spaceId, query);
  }

  @Get(':expenseId')
  get(
    @Param('spaceId') spaceId: string,
    @Param('expenseId') expenseId: string,
  ) {
    return this.expensesService.getExpense(spaceId, expenseId);
  }

  @Patch(':expenseId')
  update(
    @Param('spaceId') spaceId: string,
    @Param('expenseId') expenseId: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expensesService.updateExpense(spaceId, expenseId, dto);
  }

  @Delete(':expenseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('spaceId') spaceId: string,
    @Param('expenseId') expenseId: string,
  ): Promise<void> {
    await this.expensesService.deleteExpense(spaceId, expenseId);
  }
}
