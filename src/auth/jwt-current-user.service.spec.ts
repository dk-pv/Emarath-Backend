import { UnauthorizedException } from '@nestjs/common';
import { JwtCurrentUserService } from './jwt-current-user.service';
import { authContext } from './auth-context';
import { UserRole } from '../generated/prisma/client';

describe('JwtCurrentUserService (AUTH-01.4)', () => {
  const service = new JwtCurrentUserService();

  it('resolves the user the guard placed in the request store', async () => {
    const user = { id: 'u1', role: UserRole.SUPERADMIN };
    const resolved = await authContext.run({ user }, () => service.resolve());
    expect(resolved).toEqual(user);
  });

  it('throws when the store holds no user (unauthenticated)', async () => {
    await expect(
      authContext.run({}, () => service.resolve()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws when there is no request store at all', async () => {
    await expect(service.resolve()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
