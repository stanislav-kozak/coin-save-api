import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
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
  async exportExpensesCsv(
    @Param('spaceId') spaceId: string,
    @Query() query: ExportExpensesCsvQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.analyticsService.exportExpensesCsv(spaceId, query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="expenses.csv"');
    return csv;
  }
}
