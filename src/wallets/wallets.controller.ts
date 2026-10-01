import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { WalletsService } from './wallets.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { ListWalletsQueryDto } from './dto/list-wallets-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { EventBus } from '../events/event-bus.service';
import { WalletResponseDto } from './dto/wallet-response.dto';
import { ApiErrorResponse } from '../common/decorators/api-error-response.decorator';

@Controller('spaces/:spaceId/wallets')
@UseGuards(JwtAuthGuard, SpaceMemberGuard)
@ApiErrorResponse(HttpStatus.UNAUTHORIZED, 'HTTP_ERROR')
@ApiErrorResponse(HttpStatus.FORBIDDEN, 'FORBIDDEN_NOT_MEMBER')
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly events: EventBus,
  ) {}

  @Post()
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR')
  @ApiCreatedResponse({ type: WalletResponseDto })
  async create(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWalletDto,
  ) {
    const wallet = await this.walletsService.createWallet(spaceId, dto);
    this.events.emitToSpace(spaceId, 'wallet.changed', user.id);
    return wallet;
  }

  @Get()
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR')
  @ApiOkResponse({ type: [WalletResponseDto] })
  list(@Param('spaceId') spaceId: string, @Query() query: ListWalletsQueryDto) {
    return this.walletsService.listWallets(
      spaceId,
      query.includeArchived ?? false,
    );
  }

  @Get(':walletId')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'WALLET_NOT_FOUND')
  @ApiOkResponse({ type: WalletResponseDto })
  get(@Param('spaceId') spaceId: string, @Param('walletId') walletId: string) {
    return this.walletsService.getWallet(spaceId, walletId);
  }

  @Patch(':walletId')
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'WALLET_NOT_FOUND')
  @ApiOkResponse({ type: WalletResponseDto })
  async update(
    @Param('spaceId') spaceId: string,
    @Param('walletId') walletId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateWalletDto,
  ) {
    const wallet = await this.walletsService.updateWallet(
      spaceId,
      walletId,
      dto,
    );
    this.events.emitToSpace(spaceId, 'wallet.changed', user.id);
    return wallet;
  }

  @Patch(':walletId/archive')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'WALLET_NOT_FOUND')
  @ApiOkResponse({ type: WalletResponseDto })
  async archive(
    @Param('spaceId') spaceId: string,
    @Param('walletId') walletId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const wallet = await this.walletsService.archiveWallet(spaceId, walletId);
    this.events.emitToSpace(spaceId, 'wallet.changed', user.id);
    return wallet;
  }

  @Patch(':walletId/unarchive')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'WALLET_NOT_FOUND')
  @ApiOkResponse({ type: WalletResponseDto })
  async unarchive(
    @Param('spaceId') spaceId: string,
    @Param('walletId') walletId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const wallet = await this.walletsService.unarchiveWallet(spaceId, walletId);
    this.events.emitToSpace(spaceId, 'wallet.changed', user.id);
    return wallet;
  }
}
