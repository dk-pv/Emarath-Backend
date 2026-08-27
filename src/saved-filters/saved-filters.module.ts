import { Module } from '@nestjs/common';
import { SavedFiltersController } from './saved-filters.controller';
import { SavedFiltersService } from './saved-filters.service';

/**
 * Owns the caller's saved filter presets (ADR-0052). PrismaModule and AuthModule are
 * global, so the service resolves the caller and reaches the DB without importing either.
 */
@Module({
  controllers: [SavedFiltersController],
  providers: [SavedFiltersService],
})
export class SavedFiltersModule {}
