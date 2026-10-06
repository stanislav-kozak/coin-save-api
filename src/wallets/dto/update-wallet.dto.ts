import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateWalletDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'color must be a 6-digit hex code, e.g. #F97350',
  })
  color?: string;

  // Explicit: the swagger plugin silently drops properties whose validators
  // take a negative literal (@Min(-1_000_000_000)).
  @ApiPropertyOptional({
    type: Number,
    minimum: -1_000_000_000,
    maximum: 1_000_000_000,
    example: 1250.5,
    description: 'Up to 4 decimal places; may be negative (e.g. a credit card)',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(-1_000_000_000)
  @Max(1_000_000_000)
  initialBalance?: number;
}
