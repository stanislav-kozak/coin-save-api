import { Transform } from 'class-transformer';
import { IsArray, IsISO8601, IsOptional, IsString } from 'class-validator';
import { TimeZoneQuery } from '../../common/decorators/time-zone-query.decorator';

export class GetAnalyticsQueryDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id: string) => id.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @IsString({ each: true })
  walletIds?: string[];

  @TimeZoneQuery()
  tz?: string;
}
