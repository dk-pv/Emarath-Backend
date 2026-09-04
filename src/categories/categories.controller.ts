import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CategoriesService } from './categories.service';
import {
  CategoryNode,
  CreateCategoryDto,
  MoveCategoryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

/**
 * The Category catalogue, under `/api/categories`.
 *
 * `SUPERADMIN` for the whole controller, reads included — the same model every other
 * Settings screen uses (`SettingsController`, `RolesController`, `UsersController`).
 * Agents still see the category options they need through `GET /api/lookups/categories`,
 * which reads this same table without exposing the management surface.
 *
 * Thin by design: the DTO validates, the service owns every structural rule.
 */
@Controller('categories')
@Roles(UserRole.SUPERADMIN)
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  /** GET /api/categories — the whole catalogue, in tree order. */
  @Get()
  list(): Promise<CategoryNode[]> {
    return this.service.list();
  }

  /** POST /api/categories — add a root category, or a child when `parentId` is sent. */
  @Post()
  create(@Body() dto: CreateCategoryDto): Promise<CategoryNode> {
    return this.service.create(dto);
  }

  /** PATCH /api/categories/:id — rename, change status, or re-parent. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryNode> {
    return this.service.update(id, dto);
  }

  /** PATCH /api/categories/:id/move — drag/drop landing; returns the whole tree. */
  @Patch(':id/move')
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveCategoryDto,
  ): Promise<CategoryNode[]> {
    return this.service.move(id, dto);
  }

  /** DELETE /api/categories/:id — refused while it has children or leads. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ id: string }> {
    return this.service.remove(id);
  }
}
