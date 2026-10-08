import { ApiProperty } from '@nestjs/swagger';
import { TransactionType } from '@prisma/client';
import {
  ApiDateTimeProperty,
  ApiDecimalProperty,
  ApiCurrencyProperty,
} from '../../common/decorators/api-property.decorator';

export class AnalyticsPeriodDto {
  @ApiProperty({ example: '2026-09-01' })
  from!: string;

  @ApiProperty({ example: '2026-09-30' })
  to!: string;
}

export class AnalyticsByCategoryDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'null for the "Uncategorized" bucket',
  })
  categoryId!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;

  @ApiProperty({ type: String, nullable: true })
  color!: string | null;

  @ApiDecimalProperty({ description: 'In the space currency' })
  spent!: string;

  @ApiCurrencyProperty({
    description: "The category's budget currency (the space's if it has none)",
  })
  currency!: string;

  @ApiDecimalProperty({
    description:
      "Spent in `currency`: each expense converted at its own day's rate " +
      '(equals `spent` when `currency` is the space currency)',
  })
  spentInCurrency!: string;

  @ApiDecimalProperty({ nullable: true, description: 'In `currency`' })
  limit!: string | null;

  @ApiProperty({
    type: 'integer',
    description: 'spent / limit as a rounded percentage; 0 when no limit',
  })
  pct!: number;
}

export class AnalyticsByDayDto {
  @ApiProperty({ example: '2026-09-15' })
  date!: string;

  @ApiDecimalProperty()
  expense!: string;

  @ApiDecimalProperty()
  income!: string;
}

export class AnalyticsExpenseItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: TransactionType, enumName: 'TransactionType' })
  type!: TransactionType;

  @ApiDecimalProperty()
  amount!: string;

  @ApiProperty()
  walletCurrency!: string;

  @ApiDecimalProperty()
  amountInPrimary!: string;

  @ApiDecimalProperty()
  fxRate!: string;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiDateTimeProperty()
  occurredAt!: string;

  @ApiProperty()
  walletId!: string;

  @ApiProperty()
  walletName!: string;

  @ApiProperty({ type: String, nullable: true })
  categoryId!: string | null;

  @ApiProperty()
  categoryName!: string;

  @ApiProperty()
  createdById!: string;

  @ApiProperty()
  createdByName!: string;
}

export class AnalyticsResponseDto {
  @ApiProperty({ description: "The space's primary currency" })
  currency!: string;

  @ApiProperty({ type: AnalyticsPeriodDto })
  period!: AnalyticsPeriodDto;

  @ApiProperty({
    example: 'Europe/Kyiv',
    description: 'Time zone the period and byDay dates were computed in',
  })
  timeZone!: string;

  @ApiDecimalProperty()
  totalExpense!: string;

  @ApiDecimalProperty()
  totalIncome!: string;

  @ApiDecimalProperty()
  previousPeriodExpense!: string;

  @ApiDecimalProperty()
  previousPeriodIncome!: string;

  @ApiProperty({ type: [AnalyticsByCategoryDto] })
  byCategory!: AnalyticsByCategoryDto[];

  @ApiProperty({ type: [AnalyticsByDayDto] })
  byDay!: AnalyticsByDayDto[];

  @ApiProperty({ type: [AnalyticsExpenseItemDto] })
  expenses!: AnalyticsExpenseItemDto[];
}
