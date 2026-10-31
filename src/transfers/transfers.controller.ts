import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { TransfersService } from './transfers.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { EventBus } from '../events/event-bus.service';
import { ExpenseResponseDto } from '../expenses/dto/expense-response.dto';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';

// Transfers are listed with the other transactions (GET .../expenses and
// analytics, type TRANSFER); these endpoints create, edit and delete them.
@Controller('spaces/:spaceId/transfers')
@UseGuards(JwtAuthGuard, SpaceMemberGuard)
@ApiErrorResponse(HttpStatus.UNAUTHORIZED, 'HTTP_ERROR')
@ApiErrorResponse(HttpStatus.FORBIDDEN, 'FORBIDDEN_NOT_MEMBER')
export class TransfersController {
  constructor(
    private readonly transfersService: TransfersService,
    private readonly events: EventBus,
  ) {}

  @Post()
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_ERROR',
    'INVALID_OCCURRED_AT',
    'TRANSFER_SAME_WALLET',
    'TRANSFER_AMOUNT_MISMATCH',
  )
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'WALLET_NOT_FOUND')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'WALLET_ARCHIVED')
  @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE, 'CURRENCY_API_UNAVAILABLE')
  @ApiCreatedResponse({ type: ExpenseResponseDto })
  async create(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTransferDto,
  ) {
    const transfer = await this.transfersService.createTransfer(
      spaceId,
      user.id,
      dto,
    );
    this.emitChanged(spaceId, user.id);
    return transfer;
  }

  @Patch(':transferId')
  @ApiErrorResponse(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_ERROR',
    'INVALID_OCCURRED_AT',
    'TRANSFER_SAME_WALLET',
    'TRANSFER_AMOUNT_MISMATCH',
  )
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    'TRANSFER_NOT_FOUND',
    'WALLET_NOT_FOUND',
  )
  @ApiErrorResponse(HttpStatus.CONFLICT, 'WALLET_ARCHIVED')
  @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE, 'CURRENCY_API_UNAVAILABLE')
  @ApiOkResponse({ type: ExpenseResponseDto })
  async update(
    @Param('spaceId') spaceId: string,
    @Param('transferId') transferId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTransferDto,
  ) {
    const transfer = await this.transfersService.updateTransfer(
      spaceId,
      transferId,
      dto,
    );
    this.emitChanged(spaceId, user.id);
    return transfer;
  }

  @Delete(':transferId')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'TRANSFER_NOT_FOUND')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('spaceId') spaceId: string,
    @Param('transferId') transferId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.transfersService.deleteTransfer(spaceId, transferId);
    this.emitChanged(spaceId, user.id);
  }

  private emitChanged(spaceId: string, userId: string): void {
    this.events.emitToSpace(spaceId, 'expense.changed', userId);
    this.events.emitToSpace(spaceId, 'wallet.changed', userId);
  }
}
