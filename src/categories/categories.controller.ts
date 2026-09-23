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
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpaceMemberGuard } from '../common/guards/space-member.guard';

@Controller('spaces/:spaceId/categories')
@UseGuards(JwtAuthGuard, SpaceMemberGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  create(@Param('spaceId') spaceId: string, @Body() dto: CreateCategoryDto) {
    return this.categoriesService.createCategory(spaceId, dto);
  }

  @Get()
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
  @HttpCode(HttpStatus.OK)
  reorder(
    @Param('spaceId') spaceId: string,
    @Body() dto: ReorderCategoriesDto,
  ) {
    return this.categoriesService.reorderCategories(spaceId, dto.orderedIds);
  }

  @Get(':categoryId')
  get(
    @Param('spaceId') spaceId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.categoriesService.getCategory(spaceId, categoryId);
  }

  @Patch(':categoryId')
  update(
    @Param('spaceId') spaceId: string,
    @Param('categoryId') categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.updateCategory(spaceId, categoryId, dto);
  }

  @Patch(':categoryId/archive')
  archive(
    @Param('spaceId') spaceId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.categoriesService.archiveCategory(spaceId, categoryId);
  }

  @Patch(':categoryId/unarchive')
  unarchive(
    @Param('spaceId') spaceId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.categoriesService.unarchiveCategory(spaceId, categoryId);
  }

  @Delete(':categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('spaceId') spaceId: string,
    @Param('categoryId') categoryId: string,
  ): Promise<void> {
    await this.categoriesService.deleteCategory(spaceId, categoryId);
  }
}
