import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../auth/roles.decorator';
import { UsersService } from './users.service';
import {
  CreateUserDto,
  ListUsersQueryDto,
  PERMISSION_CATALOG,
  SetUserPasswordDto,
  UpdateUserDto,
  UserDetailResponse,
  UserResponse,
} from './dto/user.dto';

/**
 * Team member administration (Settings → Users & Access), under `/api/users`.
 *
 * **Every route is `SUPERADMIN`, including the reads.** The roster is the full staff
 * directory and the wizard's option lists exist only to build accounts, so none of it
 * is a surface an ordinary agent may enumerate — and permission grants therefore can
 * never be self-service. Static segments (`roles`, `lead-forms`, `permission-catalog`)
 * are declared before `:id` so they win over the UUID param route.
 */
@Controller('users')
@Roles(UserRole.SUPERADMIN)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  /** GET /api/users — one page of the roster, with search and the Role filter. */
  @Get()
  list(
    @Query() query: ListUsersQueryDto,
  ): Promise<{ rows: UserResponse[]; total: number }> {
    return this.service.list(query);
  }

  /** GET /api/users/roles — the wizard's named-role options. */
  @Get('roles')
  roles(): Promise<{ id: string; name: string; baseRole: UserRole }[]> {
    return this.service.roles();
  }

  /** GET /api/users/lead-forms — the wizard's "Assign Lead Form" options. */
  @Get('lead-forms')
  leadForms(): Promise<{ id: string; name: string }[]> {
    return this.service.leadForms();
  }

  /** GET /api/users/permission-catalog — matrix rows, labels and applicable cells. */
  @Get('permission-catalog')
  permissionCatalog(): typeof PERMISSION_CATALOG {
    return this.service.permissionCatalog();
  }

  /** GET /api/users/:id — the full wizard configuration, for the edit drawer. */
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<UserDetailResponse> {
    return this.service.detail(id);
  }

  /** POST /api/users — create a team member with their full configuration. */
  @Post()
  create(@Body() dto: CreateUserDto): Promise<UserDetailResponse> {
    return this.service.create(dto);
  }

  /** POST /api/users/:id/avatar — store the profile picture (PNG/JPG ≤ 5MB). */
  @Post(':id/avatar')
  @UseInterceptors(FileInterceptor('file'))
  setAvatar(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ id: string; avatarUrl: string }> {
    return this.service.setAvatar(id, file);
  }

  /** PATCH /api/users/:id — edit a team member's profile, role, access or matrix. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserDetailResponse> {
    return this.service.update(id, dto);
  }

  /** PATCH /api/users/:id/password — set a team member's password. */
  @Patch(':id/password')
  setPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserPasswordDto,
  ): Promise<{ id: string }> {
    return this.service.setPassword(id, dto.password);
  }

  /** DELETE /api/users/:id — soft-delete a team member and end their sessions. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ id: string }> {
    return this.service.remove(id);
  }
}
