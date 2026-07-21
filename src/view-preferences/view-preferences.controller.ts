import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ViewPreferencesService } from './view-preferences.service';
import { ColumnLayout, SaveViewPreferenceDto } from './dto/view-preference.dto';

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
