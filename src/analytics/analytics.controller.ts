import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiProduces } from '@nestjs/swagger';
import type { Response } from 'express';
import { AnalyticsService } from './analytics.service';
import { GetAnalyticsQueryDto } from './dto/get-analytics-query.dto';
import { ExportExpensesCsvQueryDto } from './dto/export-expenses-csv-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';
import { AnalyticsResponseDto } from './dto/analytics-response.dto';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';

@Controller('spaces/:spaceId')
@UseGuards(JwtAuthGuard, SpaceMemberGuard)
@ApiErrorResponse(HttpStatus.UNAUTHORIZED, 'HTTP_ERROR')
@ApiErrorResponse(HttpStatus.FORBIDDEN, 'FORBIDDEN_NOT_MEMBER')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('analytics')
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_ERROR',
    'INVALID_PERIOD',
  )
  @ApiOkResponse({ type: AnalyticsResponseDto })
  getAnalytics(
    @Param('spaceId') spaceId: string,
    @Query() query: GetAnalyticsQueryDto,
  ) {
    return this.analyticsService.getAnalytics(spaceId, query);
  }

  @Get('expenses.csv')
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_ERROR',
    'INVALID_PERIOD',
  )
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'UTF-8 CSV with BOM',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
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
