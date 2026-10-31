import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { EventsModule } from '../events/events.module';
import { TransfersService } from './transfers.service';
import { TransfersController } from './transfers.controller';

@Module({
  imports: [PrismaModule, CurrenciesModule, EventsModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
