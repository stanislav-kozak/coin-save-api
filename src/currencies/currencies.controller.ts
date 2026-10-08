import { Controller, Get, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { CurrencyService } from './currencies.service';
import {
  CurrencyRateQueryDto,
  CurrencyRateResponseDto,
} from './dto/currency-rate.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';
import { DEFAULT_TIME_ZONE, toZonedDate } from '../common/utils/time-zone';

@Controller('currencies')
@UseGuards(JwtAuthGuard)
@ApiErrorResponse(HttpStatus.UNAUTHORIZED, 'HTTP_ERROR')
export class CurrenciesController {
  constructor(private readonly currency: CurrencyService) {}

  // Today's rate from the same service and cache that currency changes use,
  // so a preview matches what the change will apply.
  @Get('rate')
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR')
  @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE, 'CURRENCY_API_UNAVAILABLE')
  @ApiOkResponse({ type: CurrencyRateResponseDto })
  async rate(
    @Query() query: CurrencyRateQueryDto,
  ): Promise<CurrencyRateResponseDto> {
    const now = new Date();
    const rate = await this.currency.getRate(query.from, query.to, now);
    return {
      from: query.from,
      to: query.to,
      rate: rate.toString(),
      date: toZonedDate(now, DEFAULT_TIME_ZONE),
    };
  }
}
