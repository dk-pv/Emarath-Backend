import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';

const sha = (raw: string) => createHash('sha256').update(raw).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function makeService() {
  const create = jest.fn().mockResolvedValue({ id: 'new-row' });
  const findUnique = jest.fn();
  const update = jest.fn().mockResolvedValue({});
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const txCreate = jest.fn().mockResolvedValue({ id: 'replacement-row' });
  const txUpdate = jest.fn().mockResolvedValue({});
  const $transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ refreshToken: { create: txCreate, update: txUpdate } }),
  );
  const prisma = {
    refreshToken: { create, findUnique, update, updateMany },
    $transaction,
  } as unknown as PrismaService;
  const config = {
    getOrThrow: () => ({ refreshTtlSec: 604800 }),
  } as unknown as ConfigService;
  return {
    service: new RefreshTokenService(prisma, config),
    create,
    findUnique,
    updateMany,
    txCreate,
    txUpdate,
  };
}

describe('RefreshTokenService (AUTH-01.3)', () => {
  it('issue() stores only the sha-256 hash, a new family, and a future expiry', async () => {
    const { service, create } = makeService();
    const raw = await service.issue('user-1', undefined, 'agent');

    const data = (
      (create.mock.calls as unknown[][])[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(data.userId).toBe('user-1');
    expect(data.tokenHash).toBe(sha(raw));
    expect(data.tokenHash).not.toBe(raw); // raw never stored
    expect(String(data.familyId)).toMatch(UUID); // new family
    expect((data.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('issue() continues an existing family when one is given (rotation/device)', async () => {
    const { service, create } = makeService();
    await service.issue('user-1', 'family-x');
    const data = (
      (create.mock.calls as unknown[][])[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(data.familyId).toBe('family-x');
  });

  it('verify() rejects an unknown token', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);
    await expect(service.verify('nope')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('verify() rejects an expired token', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      id: 't',
      userId: 'u',
      familyId: 'f',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.verify('old')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('verify() treats a revoked token as theft: revokes the whole family, then rejects', async () => {
    const { service, findUnique, updateMany } = makeService();
    findUnique.mockResolvedValue({
      id: 't',
      userId: 'u',
      familyId: 'fam-1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
    });
    await expect(service.verify('reused')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const args = (updateMany.mock.calls as unknown[][])[0][0] as {
      where: { familyId: string; revokedAt: null };
      data: { revokedAt: Date };
    };
    expect(args.where).toEqual({ familyId: 'fam-1', revokedAt: null });
    expect(args.data.revokedAt).toBeInstanceOf(Date);
  });

  it('verify() returns the token identity when live', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue({
      id: 'tok-9',
      userId: 'user-9',
      familyId: 'fam-9',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 100000),
    });
    await expect(service.verify('good')).resolves.toEqual({
      id: 'tok-9',
      userId: 'user-9',
      familyId: 'fam-9',
    });
  });

  it('rotate() issues a replacement in the same family and revokes the old row with its successor', async () => {
    const { service, txCreate, txUpdate } = makeService();
    const raw = await service.rotate(
      { id: 'old-1', userId: 'user-1', familyId: 'fam-1' },
      'agent',
    );

    const created = (
      (txCreate.mock.calls as unknown[][])[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(created.familyId).toBe('fam-1');
    expect(created.tokenHash).toBe(sha(raw));

    const updateArgs = (txUpdate.mock.calls as unknown[][])[0][0] as {
      where: { id: string };
      data: { revokedAt: Date; replacedById: string };
    };
    expect(updateArgs.where).toEqual({ id: 'old-1' });
    expect(updateArgs.data.replacedById).toBe('replacement-row');
    expect(updateArgs.data.revokedAt).toBeInstanceOf(Date);
  });

  it('revokeByRawToken() revokes the token’s family (AUTH-01.5 logout)', async () => {
    const { service, findUnique, updateMany } = makeService();
    findUnique.mockResolvedValue({ id: 't', familyId: 'fam-3' });
    await service.revokeByRawToken('raw');

    const lookup = (findUnique.mock.calls as unknown[][])[0][0] as {
      where: { tokenHash: string };
    };
    expect(lookup.where.tokenHash).toBe(sha('raw')); // looked up by hash, not raw
    const args = (updateMany.mock.calls as unknown[][])[0][0] as {
      where: { familyId: string };
    };
    expect(args.where.familyId).toBe('fam-3');
  });

  it('revokeByRawToken() is a no-op for an unknown token (idempotent logout)', async () => {
    const { service, findUnique, updateMany } = makeService();
    findUnique.mockResolvedValue(null);
    await expect(service.revokeByRawToken('gone')).resolves.toBeUndefined();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('revokeFamily() revokes every live token in the family', async () => {
    const { service, updateMany } = makeService();
    await service.revokeFamily('fam-2');
    const args = (updateMany.mock.calls as unknown[][])[0][0] as {
      where: { familyId: string; revokedAt: null };
      data: { revokedAt: Date };
    };
    expect(args.where).toEqual({ familyId: 'fam-2', revokedAt: null });
    expect(args.data.revokedAt).toBeInstanceOf(Date);
  });
});
