import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { GetAnalyticsQueryDto } from './dto/get-analytics-query.dto';
import { ExportExpensesCsvQueryDto } from './dto/export-expenses-csv-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';

@Controller('spaces/:spaceId')
@UseGuards(JwtAuthGuard, SpaceMemberGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('analytics')
  getAnalytics(
    @Param('spaceId') spaceId: string,
    @Query() query: GetAnalyticsQueryDto,
  ) {
    return this.analyticsService.getAnalytics(spaceId, query);
  }

  @Get('expenses.csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="expenses.csv"')
  exportExpensesCsv(
    @Param('spaceId') spaceId: string,
    @Query() query: ExportExpensesCsvQueryDto,
  ): Promise<string> {
    return this.analyticsService.exportExpensesCsv(spaceId, query);
  }
}
