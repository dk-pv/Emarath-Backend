import { Module } from '@nestjs/common';
import { TagAccessController } from './tag-access.controller';
import { TagAccessService } from './tag-access.service';
import { TagPermissionsService } from './tag-permissions.service';

/**
 * Tag Permissions (ADR-0091). `TagAccessService` is exported because every path that writes
 * a lead's tags or creates a tag asks it before writing; PrismaModule and AuthModule are
 * global, so the database and the caller resolve without importing either.
 */
@Module({
  controllers: [TagAccessController],
  providers: [TagAccessService, TagPermissionsService],
  exports: [TagAccessService],
})
export class TagAccessModule {}
