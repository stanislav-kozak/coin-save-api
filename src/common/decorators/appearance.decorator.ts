import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// An icon is an emoji (default categories use '🛒', '🚌', ...) or a short
// id from the frontend's icon set, never image data. 50 UTF-16 units leave
// room for the longest emoji sequences (family/flag ZWJ, ~11 units).
export const ICON_MAX_LENGTH = 50;

// `resettable` (update DTOs): null resets to the frontend default. Absent
// keeps the current value either way (IsOptional skips null and undefined).
export const IconProperty = (
  options: { resettable?: boolean } = {},
): PropertyDecorator =>
  applyDecorators(
    ApiPropertyOptional({
      type: String,
      maxLength: ICON_MAX_LENGTH,
      example: '💳',
      ...(options.resettable
        ? {
            nullable: true,
            description:
              'Emoji or icon id; omit to keep, null resets to the default',
          }
        : { description: 'Emoji or icon id' }),
    }),
    IsOptional(),
    IsString(),
    MaxLength(ICON_MAX_LENGTH),
  );

export const ColorProperty = (
  options: { resettable?: boolean } = {},
): PropertyDecorator =>
  applyDecorators(
    ApiPropertyOptional({
      type: String,
      pattern: '^#[0-9A-Fa-f]{6}$',
      example: '#F97350',
      ...(options.resettable
        ? {
            nullable: true,
            description: 'Hex color; omit to keep, null resets to the default',
          }
        : { description: 'Hex color' }),
    }),
    IsOptional(),
    IsString(),
    Matches(/^#[0-9A-Fa-f]{6}$/, {
      message: 'color must be a 6-digit hex code, e.g. #F97350',
    }),
  );
