import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { EventBus } from '../events/event-bus.service';
import { CategoryResponseDto } from './dto/category-response.dto';

@Controller('spaces/:spaceId/categories')
@UseGuards(JwtAuthGuard, SpaceMemberGuard)
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly events: EventBus,
  ) {}

  @Post()
  @ApiCreatedResponse({ type: CategoryResponseDto })
  async create(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCategoryDto,
  ) {
    const category = await this.categoriesService.createCategory(spaceId, dto);
    this.events.emitToSpace(spaceId, 'category.changed', user.id);
    return category;
  }

  @Get()
  @ApiOkResponse({ type: [CategoryResponseDto] })
  list(
    @Param('spaceId') spaceId: string,
    @Query() query: ListCategoriesQueryDto,
  ) {
    return this.categoriesService.listCategories(
      spaceId,
      query.includeArchived ?? false,
    );
  }

  // This static route MUST stay declared before the dynamic `:categoryId`
  // route below — Nest matches routes in declaration order, and a
  // dynamic-param route declared first would swallow `/reorder` as if it
  // were a categoryId.
  @Patch('reorder')
  @ApiOkResponse({ type: [CategoryResponseDto] })
  @HttpCode(HttpStatus.OK)
  async reorder(
    @Param('spaceId') spaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReorderCategoriesDto,
  ) {
    const categories = await this.categoriesService.reorderCategories(
      spaceId,
      dto.orderedIds,
    );
    this.events.emitToSpace(spaceId, 'category.changed', user.id);
    return categories;
  }

  @Get(':categoryId')
  @ApiOkResponse({ type: CategoryResponseDto })
  get(
    @Param('spaceId') spaceId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.categoriesService.getCategory(spaceId, categoryId);
  }

  @Patch(':categoryId')
  @ApiOkResponse({ type: CategoryResponseDto })
  async update(
    @Param('spaceId') spaceId: string,
    @Param('categoryId') categoryId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCategoryDto,
  ) {
    const category = await this.categoriesService.updateCategory(
      spaceId,
      categoryId,
      dto,
    );
    this.events.emitToSpace(spaceId, 'category.changed', user.id);
    return category;
  }

  @Patch(':categoryId/archive')
  @ApiOkResponse({ type: CategoryResponseDto })
  async archive(
    @Param('spaceId') spaceId: string,
    @Param('categoryId') categoryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const category = await this.categoriesService.archiveCategory(
      spaceId,
      categoryId,
    );
    this.events.emitToSpace(spaceId, 'category.changed', user.id);
    return category;
  }

  @Patch(':categoryId/unarchive')
  @ApiOkResponse({ type: CategoryResponseDto })
  async unarchive(
    @Param('spaceId') spaceId: string,
    @Param('categoryId') categoryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const category = await this.categoriesService.unarchiveCategory(
      spaceId,
      categoryId,
    );
    this.events.emitToSpace(spaceId, 'category.changed', user.id);
    return category;
  }

  @Delete(':categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('spaceId') spaceId: string,
    @Param('categoryId') categoryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.categoriesService.deleteCategory(spaceId, categoryId);
    this.events.emitToSpace(spaceId, 'category.changed', user.id);
  }
}
