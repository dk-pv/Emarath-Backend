import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ViewPreferencesService } from './view-preferences.service';
import {
  ColumnLayout,
  KanbanPins,
  SaveViewPreferenceDto,
  SetKanbanPinDto,
} from './dto/view-preference.dto';

/**
 * Per-user table layout endpoints (LEAD-05.1), under `/api/view-preferences`.
 *
 * Generic on the view (`:viewKey`) so the Leads Manage Columns drawer and, later,
 * the Activities/Kanban ones share one contract. Thin by design: the DTO validates
 * the layout, the service scopes it to the caller.
 */
@Controller('view-preferences')
export class ViewPreferencesController {
  constructor(private readonly service: ViewPreferencesService) {}

  /**
   * GET /api/view-preferences/kanban-pins — the caller's Kanban stage pins (KAN-05.2),
   * a per-pipeline map. Declared before `:viewKey` so the static segment is never
   * captured as a view key.
   */
  @Get('kanban-pins')
  getKanbanPins(): Promise<KanbanPins> {
    return this.service.getKanbanPins();
  }

  /**
   * PUT /api/view-preferences/kanban-pins — pin (or unpin) one stage of a pipeline for
   * the caller; returns the updated map. One pin per pipeline.
   */
  @Put('kanban-pins')
  setKanbanPin(@Body() dto: SetKanbanPinDto): Promise<KanbanPins> {
    return this.service.setKanbanPin(dto.pipeline, dto.stage ?? null);
  }

  /** GET /api/view-preferences/:viewKey — the caller's saved layout, or null. */
  @Get(':viewKey')
  get(
    @Param('viewKey') viewKey: string,
  ): Promise<{ layout: ColumnLayout | null }> {
    return this.service.get(viewKey);
  }

  /** PUT /api/view-preferences/:viewKey — save the caller's layout for a view. */
  @Put(':viewKey')
  save(
    @Param('viewKey') viewKey: string,
    @Body() dto: SaveViewPreferenceDto,
  ): Promise<{ layout: ColumnLayout }> {
    return this.service.save(viewKey, dto);
  }
}
