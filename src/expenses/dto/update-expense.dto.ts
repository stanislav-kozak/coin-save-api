import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiPositiveAmountProperty } from '../../common/decorators/api-property.decorator';

export class UpdateExpenseDto {
  @ValidateIf((o: UpdateExpenseDto) => o.walletId !== undefined)
  @IsString()
  walletId?: string;

  // null is accepted deliberately to clear the field (Uncategorized):
  // IsOptional skips the string check for null.
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Omit to keep; null makes the expense uncategorized',
  })
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @ValidateIf((o: UpdateExpenseDto) => o.amount !== undefined)
  @IsNumber({ maxDecimalPlaces: 4 })
  @ApiPositiveAmountProperty({ required: false })
  @IsPositive()
  @Max(1_000_000_000)
  amount?: number;

  @ValidateIf((o: UpdateExpenseDto) => o.occurredAt !== undefined)
  @IsISO8601()
  occurredAt?: string;

  // null is accepted deliberately to clear the field.
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    description: 'Omit to keep; null removes the note',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
