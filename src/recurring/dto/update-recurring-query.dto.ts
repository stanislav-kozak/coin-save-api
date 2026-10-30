import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsTimeZone } from 'class-validator';
import { DEFAULT_TIME_ZONE } from '../../common/utils/time-zone';

export class UpdateRecurringQueryDto {
  @ApiPropertyOptional({
    example: 'Europe/Kyiv',
    default: DEFAULT_TIME_ZONE,
    description:
      "IANA time zone in which `nextPaymentDate` is checked against today (the browser's zone). " +
      `Defaults to ${DEFAULT_TIME_ZONE}.`,
  })
  @IsOptional()
  @IsTimeZone()
  tz?: string;
}
