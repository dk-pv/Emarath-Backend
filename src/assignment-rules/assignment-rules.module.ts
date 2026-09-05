import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { AssignmentRulesController } from './assignment-rules.controller';
import { AssignmentRulesService } from './assignment-rules.service';
import { LeadAssignmentEngine } from './lead-assignment.engine';

/**
 * Settings → Assignment → Assignment Rules, and the engine that reads them.
 *
 * PrismaModule is global; AuthModule supplies the `CurrentUserService` binding that stamps
 * a rule's author. `LeadAssignmentEngine` is exported because `LeadsService` consults it
 * whenever a lead is created with no assignee of its own.
 */
@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [AssignmentRulesController],
  providers: [AssignmentRulesService, LeadAssignmentEngine],
  exports: [LeadAssignmentEngine],
})
export class AssignmentRulesModule {}
