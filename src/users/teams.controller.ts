import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../auth/roles.decorator';
import { TeamsService } from './teams.service';
import {
  AssignTeamDto,
  CreateTeamDto,
  RenameTeamDto,
  TeamsOverview,
} from './dto/team.dto';

/**
 * Teams (Settings → Users & Access → Teams, Teams v1), under `/api/teams`. Super Admin only, like
 * the member administration it extends: a team decides what a Sales Manager sees and which Tag
 * Permissions apply, so it is never self-service. A team is addressed by name in the body rather
 * than the path, so any name — one with a slash or dots included — works.
 */
@Controller('teams')
@Roles(UserRole.SUPERADMIN)
export class TeamsController {
  constructor(private readonly service: TeamsService) {}

  /** GET /api/teams — every live team, and the accounts the screen places in them. */
  @Get()
  overview(): Promise<TeamsOverview> {
    return this.service.overview();
  }

  /** POST /api/teams — a new team with its first members. */
  @Post()
  create(@Body() dto: CreateTeamDto): Promise<TeamsOverview> {
    return this.service.create(dto);
  }

  /** POST /api/teams/rename — a new name for a team, its members and its tag permissions. */
  @Post('rename')
  @HttpCode(200)
  rename(@Body() dto: RenameTeamDto): Promise<TeamsOverview> {
    return this.service.rename(dto);
  }

  /** POST /api/teams/assign — move people into a team, or out of theirs (`team: null`). */
  @Post('assign')
  @HttpCode(200)
  assign(@Body() dto: AssignTeamDto): Promise<TeamsOverview> {
    return this.service.assign(dto);
  }
}
