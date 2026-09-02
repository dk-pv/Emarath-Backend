import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { Prisma, UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserService } from '../auth/current-user';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { StorageService } from '../storage/storage.service';
import { extensionOf } from '../storage/storage-policy';
import { LOOKUP_DATA } from '../lookups/lookups.data';
import {
  CreateUserDto,
  ListUsersQueryDto,
  PERMISSION_CATALOG,
  PermissionEntryDto,
  PermissionEntryResponse,
  UpdateUserDto,
  UserDetailResponse,
  UserResponse,
} from './dto/user.dto';

/** Matches the work factor the rest of auth uses (auth.service.ts). */
const BCRYPT_ROUNDS = 10;

/** The reference's profile-picture rule: PNG/JPG up to 5MB. */
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);

/** The pipeline values the wizard may store — the same lookup the Lead form reads. */
const PIPELINE_VALUES = new Set(
  LOOKUP_DATA.pipelines.map((option) => option.value),
);

/**
 * Columns the roster returns. `passwordHash` is not listed, so no response built from
 * this select can leak it — the guarantee is structural rather than a strip-after-read.
 */
const USER_SELECT = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  email: true,
  username: true,
  role: true,
  roleId: true,
  orgRole: { select: { name: true } },
  jobTitle: true,
  phone: true,
  team: true,
  isActive: true,
  colorCode: true,
  avatarKey: true,
  lastLoginAt: true,
  lastSeenAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const USER_DETAIL_SELECT = {
  ...USER_SELECT,
  reportingToId: true,
  reportingTo: { select: { name: true } },
  leadFormId: true,
  pipelines: true,
  appAccess: true,
  trackCheckInOut: true,
  trackMeetingLocation: true,
  includeInReporting: true,
  autoFollowUpPrompt: true,
  whatsappInboxAccess: true,
  monthlyGoalAmount: true,
  modulePermissions: {
    select: { module: true, canView: true, canAdd: true, canEdit: true },
  },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;
type UserDetailRow = Prisma.UserGetPayload<{
  select: typeof USER_DETAIL_SELECT;
}>;

/**
 * Team member administration (Settings → Users & Access → Team Members, ADR-0055).
 *
 * One `User` model, not a parallel record — the roster is the accounts that log in.
 * The wizard's named role (Role table) resolves onto the `UserRole` enum through
 * `Role.baseRole`, and the enum stays the JWT claim and the guard/scoping input, so
 * authorization is untouched by anything here.
 *
 * Soft delete has no automatic filter yet (CLAUDE.md §11), so every query names
 * `deletedAt: null`.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly currentUser: CurrentUserService,
    private readonly storage: StorageService,
  ) {}

  /** One page of the roster plus the total, so the pager can size itself. */
  async list(
    query: ListUsersQueryDto,
  ): Promise<{ rows: UserResponse[]; total: number }> {
    const where: Prisma.UserWhereInput = { deletedAt: null };

    if (query.role) where.role = query.role;

    const search = query.search?.trim();
    if (search) {
      const contains = { contains: search, mode: 'insensitive' } as const;
      where.OR = [
        { name: contains },
        { email: contains },
        { username: contains },
        { jobTitle: contains },
        { phone: contains },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { [query.sort]: query.direction },
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      rows: await Promise.all(rows.map((r) => this.toResponse(r))),
      total,
    };
  }

  /** The wizard's Role dropdown: the live named roles, built-ins first-seeded order. */
  roles(): Promise<{ id: string; name: string; baseRole: UserRole }[]> {
    return this.prisma.role.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, baseRole: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** The wizard's "Assign Lead Form" options. */
  leadForms(): Promise<{ id: string; name: string }[]> {
    return this.prisma.leadForm.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** The permission matrix's shape: modules, labels and which cells are applicable. */
  permissionCatalog(): typeof PERMISSION_CATALOG {
    return PERMISSION_CATALOG;
  }

  /** The full wizard configuration for the edit drawer. */
  async detail(id: string): Promise<UserDetailResponse> {
    const row = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: USER_DETAIL_SELECT,
    });
    if (!row) throw new NotFoundException('Team member not found.');
    return this.toDetailResponse(row);
  }

  async create(dto: CreateUserDto): Promise<UserDetailResponse> {
    // Derived rather than required: the reference's create form has no username field,
    // and the model needs a second unique credential (AUTH-01.1 AC5).
    const username = dto.username?.trim() || dto.email.split('@')[0];
    const name = `${dto.firstName} ${dto.lastName}`.trim();

    await this.assertCredentialsFree(dto.email, username);
    const baseRole = await this.resolveBaseRole(dto.roleId);
    await this.validateConfig(dto, null);

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          username,
          passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
          role: baseRole,
          roleId: dto.roleId,
          jobTitle: dto.jobTitle ?? null,
          phone: dto.phone,
          team: dto.team ?? null,
          isActive: dto.isActive ?? true,
          reportingToId: dto.reportingToId ?? null,
          leadFormId: dto.leadFormId ?? null,
          pipelines: dto.pipelines ?? [],
          appAccess: dto.appAccess ?? false,
          trackCheckInOut: dto.trackCheckInOut ?? false,
          trackMeetingLocation: dto.trackMeetingLocation ?? false,
          includeInReporting: dto.includeInReporting ?? false,
          autoFollowUpPrompt: dto.autoFollowUpPrompt ?? false,
          whatsappInboxAccess: dto.whatsappInboxAccess ?? null,
          colorCode: dto.colorCode ?? null,
          monthlyGoalAmount: dto.monthlyGoalAmount ?? null,
        },
        select: { id: true },
      });

      await this.writePermissions(tx, created.id, dto.permissions);

      return tx.user.findUniqueOrThrow({
        where: { id: created.id },
        select: USER_DETAIL_SELECT,
      });
    });

    return this.toDetailResponse(row);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserDetailResponse> {
    const existing = await this.findLive(id);
    const { id: actorId } = await this.currentUser.resolve();

    // Locking yourself out is not recoverable from this screen, so it is refused here
    // rather than left to be discovered at the next login.
    if (id === actorId && dto.isActive === false) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }
    if (
      id === actorId &&
      dto.roleId !== undefined &&
      dto.roleId !== existing.roleId
    ) {
      throw new BadRequestException('You cannot change your own role.');
    }

    if (dto.email && dto.email !== existing.email) {
      await this.assertCredentialsFree(dto.email, null, id);
    }

    const baseRole =
      dto.roleId !== undefined
        ? await this.resolveBaseRole(dto.roleId)
        : undefined;
    await this.validateConfig(dto, id);

    // `name` stays the canonical display value, recomposed from whichever halves the
    // edit supplied plus the stored ones it did not.
    const firstName = dto.firstName ?? existing.firstName;
    const lastName = dto.lastName ?? existing.lastName;
    const name =
      dto.firstName !== undefined || dto.lastName !== undefined
        ? `${firstName ?? ''} ${lastName ?? ''}`.trim() || existing.name
        : undefined;

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          name,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          role: baseRole,
          roleId: dto.roleId,
          jobTitle: dto.jobTitle,
          team: dto.team,
          isActive: dto.isActive,
          reportingToId: dto.reportingToId,
          leadFormId: dto.leadFormId,
          pipelines: dto.pipelines,
          appAccess: dto.appAccess,
          trackCheckInOut: dto.trackCheckInOut,
          trackMeetingLocation: dto.trackMeetingLocation,
          includeInReporting: dto.includeInReporting,
          autoFollowUpPrompt: dto.autoFollowUpPrompt,
          whatsappInboxAccess: dto.whatsappInboxAccess,
          colorCode: dto.colorCode,
          monthlyGoalAmount: dto.monthlyGoalAmount,
        },
        select: { id: true },
      });

      if (dto.permissions !== undefined) {
        await tx.userModulePermission.deleteMany({ where: { userId: id } });
        await this.writePermissions(tx, id, dto.permissions);
      }

      return tx.user.findUniqueOrThrow({
        where: { id },
        select: USER_DETAIL_SELECT,
      });
    });

    // A deactivated account must not keep working on an existing session.
    if (dto.isActive === false) {
      await this.refreshTokens.revokeAllForUser(id);
    }

    return this.toDetailResponse(row);
  }

  /**
   * Stores the profile picture (PNG/JPG ≤ 5MB, the reference's rule) through the shared
   * storage port and replaces any previous one. Responses carry a signed URL only.
   */
  async setAvatar(
    id: string,
    file: Express.Multer.File | undefined,
  ): Promise<{ id: string; avatarUrl: string }> {
    if (!file) throw new BadRequestException('An image file is required.');

    const extension = extensionOf(file.originalname);
    if (!AVATAR_EXTENSIONS.has(extension)) {
      throw new BadRequestException(
        'Profile pictures must be PNG or JPG images.',
      );
    }
    if (file.size > AVATAR_MAX_BYTES) {
      throw new BadRequestException('Profile pictures must be 5MB or smaller.');
    }

    const existing = await this.findLive(id);

    const stored = await this.storage.put({
      body: file.buffer,
      originalFileName: file.originalname,
      contentType: file.mimetype,
      keyPrefix: 'avatars',
    });

    await this.prisma.user.update({
      where: { id },
      data: { avatarKey: stored.key },
    });

    // Replaced, not orphaned — the old picture has no remaining reference.
    if (existing.avatarKey) {
      await this.storage.delete(existing.avatarKey);
    }

    const avatarUrl = await this.storage.getSignedDownloadUrl(stored.key, {
      inline: true,
    });
    return { id, avatarUrl };
  }

  /**
   * Soft-deletes a team member and kills their sessions, so removal takes effect at
   * once rather than whenever their access token happens to expire.
   */
  async remove(id: string): Promise<{ id: string }> {
    const { id: actorId } = await this.currentUser.resolve();
    if (id === actorId) {
      throw new BadRequestException('You cannot delete your own account.');
    }
    await this.findLive(id);

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.refreshTokens.revokeAllForUser(id);

    return { id };
  }

  /**
   * Sets another user's password (the roster's Change Password action). Every session
   * of that account is revoked, matching `resetPassword`: a password change the user
   * did not perform must not leave a live session behind.
   */
  async setPassword(id: string, password: string): Promise<{ id: string }> {
    await this.findLive(id);

    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) },
    });
    await this.refreshTokens.revokeAllForUser(id);

    return { id };
  }

  private async findLive(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        role: true,
        roleId: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        avatarKey: true,
      },
    });
    if (!user) throw new NotFoundException('Team member not found.');
    return user;
  }

  /** A named role must exist and be live; its baseRole is what authorization stores. */
  private async resolveBaseRole(roleId: string): Promise<UserRole> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, deletedAt: null },
      select: { baseRole: true },
    });
    if (!role) throw new BadRequestException('That role does not exist.');
    return role.baseRole;
  }

  /**
   * Cross-field checks the DTO cannot do alone: referenced rows must exist and be
   * live, pipeline values must come from the lookup, a member cannot report to
   * themselves, and no permission row may set a flag its module's catalogue marks
   * inapplicable — the server-side half of the matrix's disabled cells.
   */
  private async validateConfig(
    dto: {
      reportingToId?: string | null;
      leadFormId?: string | null;
      pipelines?: string[];
      permissions?: PermissionEntryDto[];
    },
    selfId: string | null,
  ): Promise<void> {
    if (dto.reportingToId) {
      if (selfId && dto.reportingToId === selfId) {
        throw new BadRequestException(
          'A team member cannot report to themselves.',
        );
      }
      const manager = await this.prisma.user.findFirst({
        where: { id: dto.reportingToId, deletedAt: null },
        select: { id: true },
      });
      if (!manager) {
        throw new BadRequestException('That reporting-to user does not exist.');
      }
    }

    if (dto.leadFormId) {
      const form = await this.prisma.leadForm.findFirst({
        where: { id: dto.leadFormId, deletedAt: null },
        select: { id: true },
      });
      if (!form) {
        throw new BadRequestException('That lead form does not exist.');
      }
    }

    for (const pipeline of dto.pipelines ?? []) {
      if (!PIPELINE_VALUES.has(pipeline)) {
        throw new BadRequestException(`"${pipeline}" is not a known pipeline.`);
      }
    }

    for (const entry of dto.permissions ?? []) {
      const catalog = PERMISSION_CATALOG.find(
        (row) => row.module === entry.module,
      );
      if (!catalog) {
        throw new BadRequestException(
          `"${entry.module}" is not a known module.`,
        );
      }
      if (
        (entry.canView && !catalog.view) ||
        (entry.canAdd && !catalog.add) ||
        (entry.canEdit && !catalog.edit)
      ) {
        throw new BadRequestException(
          `${catalog.label} does not support that permission.`,
        );
      }
    }
  }

  /** Persists the matrix rows that carry at least one flag; empty rows are not stored. */
  private async writePermissions(
    tx: Prisma.TransactionClient,
    userId: string,
    permissions: PermissionEntryDto[] | undefined,
  ): Promise<void> {
    const rows = (permissions ?? [])
      .filter((entry) => entry.canView || entry.canAdd || entry.canEdit)
      .map((entry) => ({
        userId,
        module: entry.module,
        canView: entry.canView ?? false,
        canAdd: entry.canAdd ?? false,
        canEdit: entry.canEdit ?? false,
      }));
    if (rows.length > 0) {
      await tx.userModulePermission.createMany({ data: rows });
    }
  }

  /**
   * Rejects a duplicate email or username before the write (AUTH-01.1 AC5).
   *
   * **Soft-deleted accounts are included deliberately.** `email` and `username` are
   * UNIQUE indexes on the table, and a soft delete only sets `deletedAt` — the row
   * keeps its credentials. Filtering them out here would report the address as free
   * and then hand Prisma a P2002 the caller sees as a 500.
   */
  private async assertCredentialsFree(
    email: string,
    username: string | null,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.prisma.user.findFirst({
      where: {
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
        OR: [{ email }, ...(username ? [{ username }] : [])],
      },
      select: { email: true, username: true, deletedAt: true },
    });
    if (!clash) return;

    const field = clash.email === email ? 'email address' : 'username';
    throw new ConflictException(
      clash.deletedAt
        ? `That ${field} belonged to a removed team member and cannot be reused.`
        : `That ${field} is already in use.`,
    );
  }

  private async toResponse(row: UserRow): Promise<UserResponse> {
    const { orgRole, avatarKey, ...rest } = row;
    return {
      ...rest,
      roleName: orgRole?.name ?? null,
      avatarUrl: avatarKey
        ? await this.storage.getSignedDownloadUrl(avatarKey, { inline: true })
        : null,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async toDetailResponse(
    row: UserDetailRow,
  ): Promise<UserDetailResponse> {
    const {
      reportingTo,
      modulePermissions,
      monthlyGoalAmount,
      whatsappInboxAccess,
      ...core
    } = row;
    const base = await this.toResponse(core);
    return {
      ...base,
      reportingToId: row.reportingToId,
      reportingToName: reportingTo?.name ?? null,
      leadFormId: row.leadFormId,
      pipelines: row.pipelines,
      appAccess: row.appAccess,
      trackCheckInOut: row.trackCheckInOut,
      trackMeetingLocation: row.trackMeetingLocation,
      includeInReporting: row.includeInReporting,
      autoFollowUpPrompt: row.autoFollowUpPrompt,
      whatsappInboxAccess:
        (whatsappInboxAccess as UserDetailResponse['whatsappInboxAccess']) ??
        null,
      monthlyGoalAmount: monthlyGoalAmount?.toString() ?? null,
      permissions: modulePermissions.map((entry): PermissionEntryResponse => ({
        module: entry.module as PermissionEntryResponse['module'],
        canView: entry.canView,
        canAdd: entry.canAdd,
        canEdit: entry.canEdit,
      })),
    };
  }
}
