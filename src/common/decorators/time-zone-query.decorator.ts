import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsTimeZone } from 'class-validator';
import { DEFAULT_TIME_ZONE } from '../utils/time-zone';

// `tz` query parameter: IANA zone in which from/to calendar days are read
// (the browser's Intl.DateTimeFormat().resolvedOptions().timeZone).
export const TimeZoneQuery = (): PropertyDecorator =>
  applyDecorators(
    ApiPropertyOptional({
      example: 'Europe/Kyiv',
      default: DEFAULT_TIME_ZONE,
      description:
        "IANA time zone for day boundaries of from/to (the browser's zone). " +
        `Defaults to ${DEFAULT_TIME_ZONE}.`,
    }),
    IsOptional(),
    IsTimeZone(),
  );
