import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LeadSourcesController } from './lead-sources.controller';
import { LeadSourcesService } from './lead-sources.service';

/**
 * The lead source catalogue. PrismaModule is global; AuthModule supplies the
 * `CurrentUserService` binding used to stamp a new source's author. Nothing is
 * exported — `LookupsService` reads the table directly, as it does for categories.
 */
@Module({
  imports: [AuthModule],
  controllers: [LeadSourcesController],
  providers: [LeadSourcesService],
})
export class LeadSourcesModule {}
