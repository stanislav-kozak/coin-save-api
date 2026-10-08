import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CurrencyService } from './currencies.service';
import { CurrenciesController } from './currencies.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CurrenciesController],
  providers: [CurrencyService],
  exports: [CurrencyService],
})
export class CurrenciesModule {}
