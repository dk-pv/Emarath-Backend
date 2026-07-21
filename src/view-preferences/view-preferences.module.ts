import { Module } from '@nestjs/common';
import { ViewPreferencesController } from './view-preferences.controller';
import { ViewPreferencesService } from './view-preferences.service';

/**
 * Owns per-user table layouts (LEAD-05.1). PrismaModule and AuthModule are global,
 * so the service resolves the caller and reaches the DB without importing either.
 */
@Module({
  controllers: [ViewPreferencesController],
  providers: [ViewPreferencesService],
})
export class ViewPreferencesModule {}
