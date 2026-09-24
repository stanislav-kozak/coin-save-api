import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';

@Module({
  imports: [PrismaModule, CurrenciesModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
})
export class ExpensesModule {}
