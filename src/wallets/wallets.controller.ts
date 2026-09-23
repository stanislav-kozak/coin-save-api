import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { ListWalletsQueryDto } from './dto/list-wallets-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';

@Controller('spaces/:spaceId/wallets')
@UseGuards(JwtAuthGuard, SpaceMemberGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post()
  create(@Param('spaceId') spaceId: string, @Body() dto: CreateWalletDto) {
    return this.walletsService.createWallet(spaceId, dto);
  }

  @Get()
  list(@Param('spaceId') spaceId: string, @Query() query: ListWalletsQueryDto) {
    return this.walletsService.listWallets(
      spaceId,
      query.includeArchived ?? false,
    );
  }

  @Get(':walletId')
  get(@Param('spaceId') spaceId: string, @Param('walletId') walletId: string) {
    return this.walletsService.getWallet(spaceId, walletId);
  }

  @Patch(':walletId')
  update(
    @Param('spaceId') spaceId: string,
    @Param('walletId') walletId: string,
    @Body() dto: UpdateWalletDto,
  ) {
    return this.walletsService.updateWallet(spaceId, walletId, dto);
  }

  @Patch(':walletId/archive')
  archive(
    @Param('spaceId') spaceId: string,
    @Param('walletId') walletId: string,
  ) {
    return this.walletsService.archiveWallet(spaceId, walletId);
  }

  @Patch(':walletId/unarchive')
  unarchive(
    @Param('spaceId') spaceId: string,
    @Param('walletId') walletId: string,
  ) {
    return this.walletsService.unarchiveWallet(spaceId, walletId);
  }
}
