import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { EventsModule } from '../events/events.module';
import { CurrenciesModule } from '../currencies/currencies.module';

@Module({
  imports: [EventsModule, CurrenciesModule],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
