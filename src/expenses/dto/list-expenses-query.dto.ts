import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';
import { TransactionType } from '@prisma/client';
import { TimeZoneQuery } from '../../common/decorators/time-zone-query.decorator';

export class ListExpensesQueryDto {
  @IsOptional()
  @IsString()
  walletId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @TimeZoneQuery()
  tz?: string;
}
