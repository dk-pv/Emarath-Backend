import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserService } from '../auth/current-user';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { StorageService } from '../storage/storage.service';
import { UserRole } from '../generated/prisma/client';
import { UsersService } from './users.service';
import { ListUsersQueryDto } from './dto/user.dto';

const ACTOR = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const ROLE_ID = '33333333-3333-3333-3333-333333333333';
const FORM_ID = '44444444-4444-4444-4444-444444444444';

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OTHER,
    name: 'Sales Agent One',
    firstName: 'Sales',
    lastName: 'Agent One',
    email: 'agent1@emarath.com',
    username: 'agent1',
    role: UserRole.SALES_AGENT,
    roleId: ROLE_ID,
    orgRole: { name: 'Sales Agent' },
    jobTitle: 'BDE',
    phone: '971500000000',
    team: 'Sales',
    isActive: true,
    colorCode: null,
    avatarKey: null,
    lastLoginAt: new Date('2026-08-29T07:06:00.000Z'),
    lastSeenAt: new Date('2026-09-01T10:00:00.000Z'),
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    ...userRow(),
    reportingToId: null,
    reportingTo: null,
    leadFormId: FORM_ID,
    pipelines: ['Lead Pipeline'],
    appAccess: false,
    trackCheckInOut: true,
    trackMeetingLocation: false,
    includeInReporting: false,
    autoFollowUpPrompt: false,
    whatsappInboxAccess: 'RESTRICTED',
    monthlyGoalAmount: null,
    modulePermissions: [
      { module: 'LEADS', canView: true, canAdd: true, canEdit: true },
    ],
    ...overrides,
  };
}

/** The live row `findLive` selects. */
function liveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OTHER,
    role: UserRole.SALES_AGENT,
    roleId: ROLE_ID,
    email: 'agent1@emarath.com',
    name: 'Sales Agent One',
    firstName: 'Sales',
    lastName: 'Agent One',
    avatarKey: null,
    ...overrides,
  };
}

function makeService(actorId = ACTOR) {
  const findMany = jest.fn();
  const findFirst = jest.fn();
  const count = jest.fn();
  const create = jest.fn();
  const update = jest.fn();
  const findUniqueOrThrow = jest.fn();
  const roleFindFirst = jest.fn();
  const leadFormFindFirst = jest.fn();
  // Pipelines are a managed catalogue now (ADR-0059), so the wizard's grants are checked
  // against the table. The mock answers with whichever requested names actually exist.
  const KNOWN_PIPELINES = new Set([
    'Lead Pipeline',
    'Complaints',
    'LOGISTICS',
    'QC',
  ]);
  const pipelineFindMany = jest.fn(
    (args: { where: { name: { in: string[] } } }) =>
      Promise.resolve(
        args.where.name.in
          .filter((name) => KNOWN_PIPELINES.has(name))
          .map((name) => ({ name })),
      ),
  );
  const permissionDeleteMany = jest.fn();
  const permissionCreateMany = jest.fn();
  const revokeAllForUser = jest.fn().mockResolvedValue(undefined);
  const storagePut = jest.fn().mockResolvedValue({
    key: 'avatars/x.png',
    sizeBytes: 10,
    contentType: 'image/png',
  });
  const storageDelete = jest.fn().mockResolvedValue(undefined);
  const signedUrl = jest.fn().mockResolvedValue('https://signed/avatar');

  const tx = {
    user: { create, update, findUniqueOrThrow },
    userModulePermission: {
      deleteMany: permissionDeleteMany,
      createMany: permissionCreateMany,
    },
  };

  const prisma = {
    user: { findMany, findFirst, count, create, update, findUniqueOrThrow },
    role: { findFirst: roleFindFirst },
    leadForm: { findFirst: leadFormFindFirst },
    pipeline: { findMany: pipelineFindMany },
    userModulePermission: {
      deleteMany: permissionDeleteMany,
      createMany: permissionCreateMany,
    },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const refreshTokens = { revokeAllForUser } as unknown as RefreshTokenService;
  const currentUser = {
    resolve: jest
      .fn()
      .mockResolvedValue({ id: actorId, role: UserRole.SUPERADMIN }),
  } as unknown as CurrentUserService;
  const storage = {
    put: storagePut,
    getSignedDownloadUrl: signedUrl,
    delete: storageDelete,
  } as unknown as StorageService;

  const service = new UsersService(prisma, refreshTokens, currentUser, storage);
  return {
    service,
    findMany,
    findFirst,
    count,
    create,
    update,
    findUniqueOrThrow,
    roleFindFirst,
    leadFormFindFirst,
    pipelineFindMany,
    permissionDeleteMany,
    permissionCreateMany,
    revokeAllForUser,
    storagePut,
    storageDelete,
    signedUrl,
  };
}

function query(overrides: Partial<ListUsersQueryDto> = {}): ListUsersQueryDto {
  return Object.assign(new ListUsersQueryDto(), overrides);
}

const CREATE_DTO = {
  firstName: 'New',
  lastName: 'Member',
  email: 'new@emarath.com',
  phone: '971500000123',
  password: 'Str0ngPass!',
  roleId: ROLE_ID,
  pipelines: ['Lead Pipeline'],
  leadFormId: FORM_ID,
};

describe('UsersService.list', () => {
  it('returns a page plus the total, excluding soft-deleted accounts', async () => {
    const { service, findMany, count } = makeService();
    findMany.mockResolvedValue([userRow()]);
    count.mockResolvedValue(7);

    const result = await service.list(query({ page: 2, size: 10 }));

    expect(result.total).toBe(7);
    expect(result.rows[0].roleName).toBe('Sales Agent');

    const args = (findMany.mock.calls as unknown[][])[0][0] as {
      where: Record<string, unknown>;
      skip: number;
      take: number;
    };
    expect(args.where).toMatchObject({ deletedAt: null });
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
  });

  it('never selects the password hash', async () => {
    const { service, findMany, count } = makeService();
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await service.list(query());

    const args = (findMany.mock.calls as unknown[][])[0][0] as {
      select: Record<string, boolean>;
    };
    expect(args.select).not.toHaveProperty('passwordHash');
    expect(args.select.email).toBe(true);
  });

  it('filters by role and searches five profile fields', async () => {
    const { service, findMany, count } = makeService();
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await service.list(
      query({ role: UserRole.SALES_MANAGER, search: 'ansar' }),
    );

    const args = (findMany.mock.calls as unknown[][])[0][0] as {
      where: { role: UserRole; OR?: Record<string, unknown>[] };
    };
    expect(args.where.role).toBe(UserRole.SALES_MANAGER);
    expect(args.where.OR).toHaveLength(5);
  });
});

describe('UsersService.create', () => {
  function arrange(overrides: Record<string, unknown> = {}) {
    const mocks = makeService();
    mocks.findFirst.mockResolvedValue(null); // no credential clash
    mocks.roleFindFirst.mockResolvedValue({ baseRole: UserRole.SALES_AGENT });
    mocks.leadFormFindFirst.mockResolvedValue({ id: FORM_ID });
    mocks.create.mockResolvedValue({ id: OTHER });
    mocks.findUniqueOrThrow.mockResolvedValue(detailRow(overrides));
    return mocks;
  }

  it('composes name from first + last and resolves the enum from the named role', async () => {
    const { service, create } = arrange();

    await service.create({ ...CREATE_DTO });

    const args = (create.mock.calls as unknown[][])[0][0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.name).toBe('New Member');
    expect(args.data.firstName).toBe('New');
    expect(args.data.role).toBe(UserRole.SALES_AGENT);
    expect(args.data.roleId).toBe(ROLE_ID);
  });

  it('hashes the password and never stores plaintext', async () => {
    const { service, create } = arrange();

    await service.create({ ...CREATE_DTO });

    const args = (create.mock.calls as unknown[][])[0][0] as {
      data: { passwordHash: string };
    };
    expect(args.data.passwordHash).not.toBe(CREATE_DTO.password);
    expect(args.data.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('persists the permission matrix inside the create transaction', async () => {
    const { service, permissionCreateMany } = arrange();

    await service.create({
      ...CREATE_DTO,
      permissions: [
        { module: 'LEADS', canView: true, canAdd: true, canEdit: false },
        { module: 'DASHBOARD', canView: true },
        { module: 'REPORTS' }, // all-off rows are not stored
      ],
    });

    const args = (permissionCreateMany.mock.calls as unknown[][])[0][0] as {
      data: { module: string }[];
    };
    expect(args.data.map((row) => row.module)).toEqual(['LEADS', 'DASHBOARD']);
  });

  it('rejects a permission flag the catalogue marks inapplicable', async () => {
    const { service, create } = arrange();

    await expect(
      service.create({
        ...CREATE_DTO,
        // Dashboard's Add cell is disabled in the reference.
        permissions: [{ module: 'DASHBOARD', canAdd: true }],
      }),
    ).rejects.toThrow(/does not support/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a pipeline that is not in the catalogue', async () => {
    const { service, create } = arrange();

    await expect(
      service.create({ ...CREATE_DTO, pipelines: ['Not A Pipeline'] }),
    ).rejects.toThrow(/not a known pipeline/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an unknown lead form id', async () => {
    const mocks = arrange();
    mocks.leadFormFindFirst.mockResolvedValue(null);

    await expect(mocks.service.create({ ...CREATE_DTO })).rejects.toThrow(
      /lead form does not exist/i,
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown role id', async () => {
    const mocks = arrange();
    mocks.roleFindFirst.mockResolvedValue(null);

    await expect(mocks.service.create({ ...CREATE_DTO })).rejects.toThrow(
      /role does not exist/i,
    );
  });

  it('rejects an email held by a soft-deleted account, not the unique index', async () => {
    const mocks = arrange();
    mocks.findFirst.mockResolvedValue({
      email: CREATE_DTO.email,
      username: 'new',
      deletedAt: new Date(),
    });

    await expect(
      mocks.service.create({ ...CREATE_DTO }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('UsersService.update', () => {
  function arrange() {
    const mocks = makeService();
    mocks.findFirst.mockResolvedValue(liveRow());
    mocks.findUniqueOrThrow.mockResolvedValue(detailRow());
    mocks.update.mockResolvedValue({ id: OTHER });
    return mocks;
  }

  it('refuses to let an admin deactivate their own account', async () => {
    const mocks = makeService();
    mocks.findFirst.mockResolvedValue(liveRow({ id: ACTOR }));

    await expect(
      mocks.service.update(ACTOR, { isActive: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('refuses to let an admin change their own role', async () => {
    const mocks = makeService();
    mocks.findFirst.mockResolvedValue(liveRow({ id: ACTOR }));

    await expect(
      mocks.service.update(ACTOR, {
        roleId: '55555555-5555-5555-5555-555555555555',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('refuses a member reporting to themselves', async () => {
    const mocks = arrange();

    await expect(
      mocks.service.update(OTHER, { reportingToId: OTHER }),
    ).rejects.toThrow(/report to themselves/i);
  });

  it('replaces the permission matrix in one transaction', async () => {
    const mocks = arrange();

    await mocks.service.update(OTHER, {
      permissions: [{ module: 'CALLS', canView: true, canAdd: true }],
    });

    expect(mocks.permissionDeleteMany).toHaveBeenCalledWith({
      where: { userId: OTHER },
    });
    const args = (
      mocks.permissionCreateMany.mock.calls as unknown[][]
    )[0][0] as {
      data: { module: string; canView: boolean }[];
    };
    expect(args.data).toEqual([
      {
        userId: OTHER,
        module: 'CALLS',
        canView: true,
        canAdd: true,
        canEdit: false,
      },
    ]);
  });

  it('leaves the matrix alone when the edit does not send permissions', async () => {
    const mocks = arrange();

    await mocks.service.update(OTHER, { jobTitle: 'QC' });

    expect(mocks.permissionDeleteMany).not.toHaveBeenCalled();
    expect(mocks.permissionCreateMany).not.toHaveBeenCalled();
  });

  it('recomposes name when a half changes and revokes sessions on deactivation', async () => {
    const mocks = arrange();

    await mocks.service.update(OTHER, {
      firstName: 'Renamed',
      isActive: false,
    });

    const args = (mocks.update.mock.calls as unknown[][])[0][0] as {
      data: { name?: string };
    };
    expect(args.data.name).toBe('Renamed Agent One');
    expect(mocks.revokeAllForUser).toHaveBeenCalledWith(OTHER);
  });

  it('404s an unknown team member', async () => {
    const mocks = makeService();
    mocks.findFirst.mockResolvedValue(null);

    await expect(
      mocks.service.update(OTHER, { jobTitle: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService.setAvatar', () => {
  const png = {
    originalname: 'me.png',
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('x'),
  } as Express.Multer.File;

  it('stores a PNG through the storage port and saves the key', async () => {
    const mocks = makeService();
    mocks.findFirst.mockResolvedValue(liveRow());
    mocks.update.mockResolvedValue({ id: OTHER });

    const result = await mocks.service.setAvatar(OTHER, png);

    expect(mocks.storagePut).toHaveBeenCalledWith(
      expect.objectContaining({ keyPrefix: 'avatars' }),
    );
    expect(result.avatarUrl).toBe('https://signed/avatar');
    expect(mocks.storageDelete).not.toHaveBeenCalled();
  });

  it('replaces (deletes) a previous picture', async () => {
    const mocks = makeService();
    mocks.findFirst.mockResolvedValue(
      liveRow({ avatarKey: 'avatars/old.png' }),
    );
    mocks.update.mockResolvedValue({ id: OTHER });

    await mocks.service.setAvatar(OTHER, png);

    expect(mocks.storageDelete).toHaveBeenCalledWith('avatars/old.png');
  });

  it('rejects a non-image type before touching storage', async () => {
    const mocks = makeService();

    await expect(
      mocks.service.setAvatar(OTHER, {
        ...png,
        originalname: 'notes.pdf',
      }),
    ).rejects.toThrow(/PNG or JPG/i);
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it('rejects a file over 5MB before touching storage', async () => {
    const mocks = makeService();

    await expect(
      mocks.service.setAvatar(OTHER, {
        ...png,
        size: 5 * 1024 * 1024 + 1,
      }),
    ).rejects.toThrow(/5MB or smaller/i);
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });
});

describe('UsersService.remove / setPassword', () => {
  it('refuses to let an admin delete their own account', async () => {
    const { service, update } = makeService();

    await expect(service.remove(ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('soft-deletes and revokes sessions rather than hard-deleting', async () => {
    const mocks = makeService();
    mocks.findFirst.mockResolvedValue(liveRow());
    mocks.update.mockResolvedValue(userRow());

    await mocks.service.remove(OTHER);

    const args = (mocks.update.mock.calls as unknown[][])[0][0] as {
      data: { deletedAt: Date };
    };
    expect(args.data.deletedAt).toBeInstanceOf(Date);
    expect(mocks.revokeAllForUser).toHaveBeenCalledWith(OTHER);
  });

  it('setPassword stores a hash and revokes every session of that account', async () => {
    const mocks = makeService();
    mocks.findFirst.mockResolvedValue(liveRow());
    mocks.update.mockResolvedValue(userRow());

    await mocks.service.setPassword(OTHER, 'BrandNewPass1');

    const args = (mocks.update.mock.calls as unknown[][])[0][0] as {
      data: { passwordHash: string };
    };
    expect(args.data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(mocks.revokeAllForUser).toHaveBeenCalledWith(OTHER);
  });
});

describe('UsersService.detail', () => {
  it('returns the full wizard configuration including the matrix', async () => {
    const mocks = makeService();
    mocks.findFirst.mockResolvedValue(detailRow());

    const detail = await mocks.service.detail(OTHER);

    expect(detail.pipelines).toEqual(['Lead Pipeline']);
    expect(detail.whatsappInboxAccess).toBe('RESTRICTED');
    expect(detail.trackCheckInOut).toBe(true);
    expect(detail.permissions).toEqual([
      { module: 'LEADS', canView: true, canAdd: true, canEdit: true },
    ]);
    expect(JSON.stringify(detail)).not.toContain('passwordHash');
  });

  it('404s an unknown or removed member', async () => {
    const mocks = makeService();
    mocks.findFirst.mockResolvedValue(null);

    await expect(mocks.service.detail(OTHER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
