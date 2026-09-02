import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Team member administration (Settings → Users & Access). PrismaModule and AuthModule are
 * both global, so `PrismaService`, `CurrentUserService` and `RefreshTokenService` resolve
 * without imports. Nothing is exported: no other module administers accounts.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
