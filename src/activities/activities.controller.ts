import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { ListActivitiesQueryDto } from './dto/list-activities-query.dto';
import {
  ActivityItem,
  ActivityListResponse,
} from './dto/activity-response.dto';

/** Thin by design: validation is the DTO's job, scoping the service's. */
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  /** GET /api/activities — one scoped worklist page + tab counts (ACT-02.1). */
  @Get()
  list(@Query() query: ListActivitiesQueryDto): Promise<ActivityListResponse> {
    return this.activities.list(query);
  }

  /** POST /api/activities — create a follow-up on a lead (ACT-03.1). */
  @Post()
  create(@Body() dto: CreateActivityDto): Promise<ActivityItem> {
    return this.activities.create(dto);
  }

  /** POST /api/activities/:id/duplicate — copy a follow-up (ACT-08.1). */
  @Post(':id/duplicate')
  duplicate(@Param('id', ParseUUIDPipe) id: string): Promise<ActivityItem> {
    return this.activities.duplicate(id);
  }

  /** PATCH /api/activities/:id/complete — mark a follow-up complete (ACT-04.1). */
  @Patch(':id/complete')
  complete(@Param('id', ParseUUIDPipe) id: string): Promise<ActivityItem> {
    return this.activities.complete(id);
  }

  /** PATCH /api/activities/:id — edit a follow-up (ACT-05.1). */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateActivityDto,
  ): Promise<ActivityItem> {
    return this.activities.update(id, dto);
  }

  /** DELETE /api/activities/:id — soft-delete a follow-up (ACT-06.1). */
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ id: string }> {
    return this.activities.delete(id);
  }
}
