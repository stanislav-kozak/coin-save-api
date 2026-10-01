import { ApiProperty } from '@nestjs/swagger';

// Prisma.Decimal serializes to JSON as a string (e.g. "1250.5"), so money
// fields are documented as strings to keep the generated client lossless.
export const ApiDecimalProperty = (
  options: { nullable?: boolean; description?: string } = {},
): PropertyDecorator =>
  ApiProperty({
    type: String,
    format: 'decimal',
    example: '1250.5',
    ...options,
  });

export const ApiDateTimeProperty = (
  options: { nullable?: boolean; description?: string } = {},
): PropertyDecorator =>
  ApiProperty({ type: String, format: 'date-time', ...options });
