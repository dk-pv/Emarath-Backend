import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * App-global Settings screens. PrismaModule is global and the store needs no user scope,
 * so nothing else is imported. Nothing is exported yet — the settings have no consumer
 * beyond their own screen until the modules that read them are approved tasks.
 */
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
