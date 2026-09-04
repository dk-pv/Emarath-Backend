import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * Roles & Permissions (ADR-0056). PrismaModule is global; AuthModule supplies the
 * `CurrentUserService` binding used to stamp a new role's author. Nothing is exported —
 * the Team Members wizard reads its role options through `UsersService`, not this module.
 */
@Module({
  imports: [AuthModule],
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}
