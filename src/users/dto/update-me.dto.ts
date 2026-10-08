import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const USER_LOCALES = ['uk', 'en'] as const;
export type UserLocale = (typeof USER_LOCALES)[number];

export class UpdateMeDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: 100,
    description: 'Display name, trimmed; null removes it',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string | null;

  // Not nullable: every user has a language (it picks the email templates).
  @ApiPropertyOptional({ enum: USER_LOCALES, enumName: 'UserLocale' })
  @ValidateIf((o: UpdateMeDto) => o.locale !== undefined)
  @IsIn(USER_LOCALES)
  locale?: UserLocale;
}
