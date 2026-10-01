import { HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { ApiErrorCode } from '../constants/error-codes';
import { ErrorResponseDto } from '../dto/error-response.dto';

// Documents an error response in the { statusCode, code, message, details }
// envelope, listing the codes the endpoint can actually return.
export const ApiErrorResponse = (
  status: HttpStatus,
  ...codes: ApiErrorCode[]
): MethodDecorator & ClassDecorator =>
  ApiResponse({
    status,
    type: ErrorResponseDto,
    description: codes.length > 0 ? `Codes: ${codes.join(', ')}` : undefined,
  });
