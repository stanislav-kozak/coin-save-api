import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ERROR_CODES,
  GENERIC_ERROR_CODES,
  type ApiErrorCode,
} from '../constants/error-codes';

export const API_ERROR_CODES: ApiErrorCode[] = [
  ...Object.values(ERROR_CODES),
  ...Object.values(GENERIC_ERROR_CODES),
];

// Mirrors the body written by AppExceptionFilter.
export class ErrorResponseDto {
  @ApiProperty({ type: 'integer', example: 404 })
  statusCode!: number;

  @ApiProperty({
    enum: API_ERROR_CODES,
    enumName: 'ErrorCode',
    description: 'Stable machine-readable code; localize on the client',
  })
  code!: ApiErrorCode;

  @ApiProperty({ description: 'Developer-facing English message' })
  message!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
  })
  details?: Record<string, unknown>;
}
