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
import { RolesService } from './roles.service';
import {
  CreateRoleDto,
  MoveRoleDto,
  RoleNode,
  UpdateRoleDto,
} from './dto/role.dto';

/**
 * Settings → Users & Access → Roles & Permissions (ADR-0056), under `/api/roles`.
 *
 * `SUPERADMIN` at the controller, reads included, matching `UsersController`: the whole
 * Users & Access area is administration, and the hierarchy exposes who holds which
 * privilege level across the org. The existing `GET /api/users/roles` is untouched —
 * that is the Team Members wizard's flat option list, a different consumer with a
 * different shape.
 */
@Controller('roles')
@Roles(UserRole.SUPERADMIN)
export class RolesController {
  constructor(private readonly service: RolesService) {}

  /** GET /api/roles — the whole hierarchy, shallowest level first. */
  @Get()
  list(): Promise<RoleNode[]> {
    return this.service.list();
  }

  /** POST /api/roles — add a root role, or a child of `parentId`. */
  @Post()
  create(@Body() dto: CreateRoleDto): Promise<RoleNode> {
    return this.service.create(dto);
  }

  /** PATCH /api/roles/:id — rename, re-point at another base role, or re-parent. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleNode> {
    return this.service.update(id, dto);
  }

  /**
   * PATCH /api/roles/:id/move — where a drag ended.
   *
   * Returns the whole tree rather than the moved row: one reorder renumbers every
   * sibling, so a single-row response would leave the client's copy stale.
   */
  @Patch(':id/move')
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveRoleDto,
  ): Promise<RoleNode[]> {
    return this.service.move(id, dto);
  }

  /** DELETE /api/roles/:id — refused while the role has children or assigned members. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ id: string }> {
    return this.service.remove(id);
  }
}
