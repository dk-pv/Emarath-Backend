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
import { TagsService } from './tags.service';
import { CreateTagDto, TagNode, UpdateTagDto } from './dto/tag.dto';

/**
 * The Tags catalogue, under `/api/tags`.
 *
 * `SUPERADMIN` for the whole controller, reads included — the same model every other
 * Settings screen uses (`CategoriesController`, `LeadSourcesController`). Agents still
 * get the tags they need through `GET /api/lookups/tags` and the per-lead tag routes
 * (`/api/leads/:id/tags`, LEAD-12.1), neither of which this controller replaces.
 */
@Controller('tags')
@Roles(UserRole.SUPERADMIN)
export class TagsController {
  constructor(private readonly service: TagsService) {}

  /** GET /api/tags — the catalogue with live lead counts, in name order. */
  @Get()
  list(): Promise<TagNode[]> {
    return this.service.list();
  }

  /** POST /api/tags — add a tag. */
  @Post()
  create(@Body() dto: CreateTagDto): Promise<TagNode> {
    return this.service.create(dto);
  }

  /** PATCH /api/tags/:id — rename and/or change status; keeps every lead link. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTagDto,
  ): Promise<TagNode> {
    return this.service.update(id, dto);
  }

  /** DELETE /api/tags/:id — soft delete; the leads carrying the tag are untouched. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ id: string }> {
    return this.service.remove(id);
  }
}
