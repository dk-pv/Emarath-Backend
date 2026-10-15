import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { SALES_MODULE_ROLES } from '../auth/role-groups';
import { Roles } from '../auth/roles.decorator';
import {
  MAX_TEAM,
  SaveTeamTagAccessDto,
  SaveUserTagAccessDto,
  TagAccessOverview,
} from './dto/tag-access.dto';
import { MyTagAccess, TagAccessService } from './tag-access.service';
import { TagPermissionsService } from './tag-permissions.service';

/**
 * Tag Permissions (ADR-0091), under `/api/tag-access`.
 *
 * `GET me` is the one route a sales user reaches: it answers what *they* may do, so the
 * pickers can show only the tags they may select. Everything else is the Admin's matrix and
 * is SUPERADMIN-only — a user can neither widen their own permissions nor read anyone's.
 */
@Controller('tag-access')
@Roles(UserRole.SUPERADMIN)
export class TagAccessController {
  constructor(
    private readonly access: TagAccessService,
    private readonly permissions: TagPermissionsService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** GET /api/tag-access/me — the caller's effective permissions and selectable tags. */
  @Get('me')
  @Roles(...SALES_MODULE_ROLES)
  async me(): Promise<MyTagAccess> {
    return this.access.mine(await this.currentUser.resolve());
  }

  /** GET /api/tag-access — every team and user with what they currently get. */
  @Get()
  overview(): Promise<TagAccessOverview> {
    return this.permissions.overview();
  }

  /** PUT /api/tag-access/teams — set a team's default. */
  @Put('teams')
  saveTeam(@Body() dto: SaveTeamTagAccessDto): Promise<TagAccessOverview> {
    return this.permissions.saveTeam(dto);
  }

  /** DELETE /api/tag-access/teams?team=… — back to the pre-feature default. */
  @Delete('teams')
  resetTeam(@Query('team') team?: string): Promise<TagAccessOverview> {
    const name = team?.trim();
    if (!name || name.length > MAX_TEAM) {
      throw new BadRequestException('A team is required.');
    }
    return this.permissions.resetTeam(name);
  }

  /** PUT /api/tag-access/users/:userId — set (or, with nothing overridden, clear) an override. */
  @Put('users/:userId')
  saveUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SaveUserTagAccessDto,
  ): Promise<TagAccessOverview> {
    return this.permissions.saveUser(userId, dto);
  }

  /** DELETE /api/tag-access/users/:userId — the user inherits their team again. */
  @Delete('users/:userId')
  resetUser(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<TagAccessOverview> {
    return this.permissions.resetUser(userId);
  }
}
