import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * App-global Settings screens. PrismaModule is global; AuthModule supplies the
 * `CurrentUserService` binding that attributes a Duplicate Settings change to its author. Nothing is exported yet — the settings have no consumer
 * beyond their own screen until the modules that read them are approved tasks.
 */
@Module({
  imports: [AuthModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  // LeadsService reads the duplicate policy on every create.
  exports: [SettingsService],
})
export class SettingsModule {}
