import { IsISO8601 } from 'class-validator';
import { TimeZoneQuery } from '../../common/decorators/time-zone-query.decorator';

export class ExportExpensesCsvQueryDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;

  @TimeZoneQuery()
  tz?: string;
}
