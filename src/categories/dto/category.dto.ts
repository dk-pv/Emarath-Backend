import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Matches `categories.name` and `Lead.category`, which the name is written into. */
export const MAX_CATEGORY_NAME = 120;

/** One category as `GET /api/categories` returns it. */
export interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  /** 1-based depth, so the tree can indent without walking parents in the browser. */
  level: number;
  isActive: boolean;
  hasChildren: boolean;
  /** Live leads carrying this category's name — what blocks a delete. */
  leadCount: number;
  createdByName: string | null;
  createdAt: Date;
}

export class CreateCategoryDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Category name is required.' })
  @MaxLength(MAX_CATEGORY_NAME)
  name!: string;

  /** Omitted creates a root; the inline "+ Add Category" sends the row's own id. */
  @IsOptional()
  @IsUUID('all')
  parentId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCategoryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Category name is required.' })
  @MaxLength(MAX_CATEGORY_NAME)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Present re-parents (null promotes to a root); absent leaves the parent untouched.
   * This is the drawer's Move path — the same shape `PATCH /api/roles/:id` uses.
   */
  @IsOptional()
  @IsUUID('all')
  parentId?: string | null;
}

/** Where a drag ended: the new parent, and the slot among its children. */
export class MoveCategoryDto {
  @IsOptional()
  @IsUUID('all')
  parentId?: string | null;

  @IsInt()
  @Min(0)
  position!: number;
}
