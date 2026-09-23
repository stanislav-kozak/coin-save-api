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

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(-1_000_000_000)
  @Max(1_000_000_000)
  initialBalance?: number;
}
