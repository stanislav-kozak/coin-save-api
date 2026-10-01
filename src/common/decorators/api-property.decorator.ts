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

// The swagger CLI plugin maps @IsPositive() to `minimum: 1`, which would make
// generated clients reject valid amounts such as 0.5. Document the real rule
// (> 0) explicitly; validation itself stays on the class-validator decorators.
export const ApiPositiveAmountProperty = (
  options: { required?: boolean } = {},
): PropertyDecorator =>
  ApiProperty({
    type: Number,
    minimum: 0,
    exclusiveMinimum: true,
    maximum: 1_000_000_000,
    example: 12.5,
    required: options.required ?? true,
  });
