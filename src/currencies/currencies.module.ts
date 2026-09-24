import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CurrencyService } from './currencies.service';

@Module({
  imports: [PrismaModule],
  providers: [CurrencyService],
  exports: [CurrencyService],
})
export class CurrenciesModule {}
