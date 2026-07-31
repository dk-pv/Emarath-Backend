import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import { PasswordResetService } from './password-reset.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

function makeService() {
  const create = jest.fn().mockResolvedValue({ id: 'row-1' });
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const findUnique = jest.fn();
  const $transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ passwordResetToken: { create, updateMany } }),
  );
  const prisma = {
    $transaction,
    passwordResetToken: { create, updateMany, findUnique },
  } as unknown as PrismaService;
  const config = {
    getOrThrow: jest.fn().mockReturnValue({ resetTokenTtlSec: 3600 }),
  } as unknown as ConfigService;
  return {
    service: new PasswordResetService(prisma, config),
    create,
    updateMany,
    findUnique,
  };
}

describe('PasswordResetService.issueFor (AUTH-03.1)', () => {
  it('invalidates prior unused tokens then stores only the hash of a fresh one', async () => {
    const { service, create, updateMany } = makeService();

    const raw = await service.issueFor('user-1');

    // Earlier unused tokens for the user are marked used first (one live link at a time).
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', usedAt: null },
      data: { usedAt: expect.any(Date) as unknown },
    });
    const data = (create.mock.calls as unknown[][])[0][0] as {
      data: { userId: string; tokenHash: string; expiresAt: Date };
    };
    expect(data.data.userId).toBe('user-1');
    // The stored value is the sha-256 of the raw token — never the raw token itself.
    expect(data.data.tokenHash).toBe(sha256(raw));
    expect(data.data.tokenHash).not.toBe(raw);
    expect(data.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('PasswordResetService.consume (AUTH-03.1)', () => {
  it('returns the user id and atomically marks an unused, unexpired token used', async () => {
    const { service, findUnique, updateMany } = makeService();
    findUnique.mockResolvedValue({ userId: 'user-1' });
    updateMany.mockResolvedValue({ count: 1 });

    await expect(service.consume('raw')).resolves.toBe('user-1');

    // The guarded update only spends a token that is still unused and unexpired.
    const args = (updateMany.mock.calls as unknown[][])[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({
      tokenHash: sha256('raw'),
      usedAt: null,
    });
    expect(args.where.expiresAt).toEqual({ gt: expect.any(Date) as unknown });
  });

  it('rejects an unknown token generically (AC4)', async () => {
    const { service, findUnique } = makeService();
    findUnique.mockResolvedValue(null);
    await expect(service.consume('nope')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a used/expired token — the guarded update matches no row (AC4)', async () => {
    const { service, findUnique, updateMany } = makeService();
    findUnique.mockResolvedValue({ userId: 'user-1' });
    updateMany.mockResolvedValue({ count: 0 }); // already used or expired

    await expect(service.consume('raw')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
