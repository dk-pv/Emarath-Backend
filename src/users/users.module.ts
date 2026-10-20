import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

/**
 * Team member administration (Settings → Users & Access), Teams included. PrismaModule and
 * AuthModule are both global, so `PrismaService`, `CurrentUserService` and `RefreshTokenService`
 * resolve without imports. Nothing is exported: no other module administers accounts.
 */
@Module({
  controllers: [UsersController, TeamsController],
  providers: [UsersService, TeamsService],
})
export class UsersModule {}
