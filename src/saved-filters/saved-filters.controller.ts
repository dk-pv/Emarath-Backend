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
import { SavedFiltersService } from './saved-filters.service';
import {
  CreateSavedFilterDto,
  SavedFilterResponse,
  UpdateSavedFilterDto,
} from './dto/saved-filter.dto';

/**
 * The caller's saved filter presets (ADR-0052), under `/api/saved-filters`.
 *
 * One shared resource for both surfaces on purpose: a preset saved on the Leads list
 * is the same record the Kanban board offers (KAN-07.1 AC5). Thin by design — the DTOs
 * validate shape, the service validates the conditions and scopes every row to the caller.
 */
@Controller('saved-filters')
export class SavedFiltersController {
  constructor(private readonly service: SavedFiltersService) {}

  /** GET /api/saved-filters — the caller's own presets. */
  @Get()
  list(): Promise<SavedFilterResponse[]> {
    return this.service.list();
  }

  /** POST /api/saved-filters — "Save & Filter": store the current conditions. */
  @Post()
  create(@Body() dto: CreateSavedFilterDto): Promise<SavedFilterResponse> {
    return this.service.create(dto.name, dto.conditions);
  }

  /** PATCH /api/saved-filters/:id — "Update & Filter": overwrite the selected preset. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSavedFilterDto,
  ): Promise<SavedFilterResponse> {
    return this.service.update(id, {
      name: dto.name,
      conditions: dto.conditions,
    });
  }

  /** DELETE /api/saved-filters/:id — remove one of the caller's own presets. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ id: string }> {
    return this.service.remove(id);
  }
}
