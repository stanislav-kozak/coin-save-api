import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { EventsModule } from '../events/events.module';
import { CurrenciesModule } from '../currencies/currencies.module';

@Module({
  imports: [EventsModule, CurrenciesModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
