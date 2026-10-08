import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { USER_LOCALES, type UserLocale } from '../../users/dto/update-me.dto';

export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  // The UI language the user signed up in; becomes the account (and email)
  // language. Defaults to English.
  @ApiPropertyOptional({
    enum: USER_LOCALES,
    enumName: 'UserLocale',
    default: 'en',
  })
  @IsOptional()
  @IsIn(USER_LOCALES)
  locale?: UserLocale;
}
