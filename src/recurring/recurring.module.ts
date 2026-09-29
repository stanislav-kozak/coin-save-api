import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { RecurringService } from './recurring.service';
import { RecurringGeneratorService } from './recurring-generator.service';
import { RecurringController } from './recurring.controller';

@Module({
  imports: [PrismaModule, CurrenciesModule],
  controllers: [RecurringController],
  providers: [RecurringService, RecurringGeneratorService],
})
export class RecurringModule {}
