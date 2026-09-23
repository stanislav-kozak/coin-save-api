import { ArrayNotEmpty, ArrayUnique, IsArray, IsString } from 'class-validator';

export class ReorderCategoriesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  orderedIds!: string[];
}
