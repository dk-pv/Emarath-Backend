import { Module } from '@nestjs/common';
import { LeadCustomFieldsModule } from '../lead-custom-fields/lead-custom-fields.module';
import { AssignmentRulesModule } from '../assignment-rules/assignment-rules.module';
import { SettingsModule } from '../settings/settings.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadsRepository } from './leads.repository';

@Module({
  // LeadCustomFieldsModule exports the service that validates + persists per-lead
  // custom values on create/update (LEAD-05.1, ADR-0051).
  // SettingsModule exports the service that decides what happens when a new enquiry
  // duplicates an existing lead (Settings → Sales & CRM → Duplicate Settings).
  // AssignmentRulesModule exports the engine that picks an assignee for a new lead
  // when the form named none (Settings → Assignment → General Settings/Rules).
  imports: [LeadCustomFieldsModule, SettingsModule, AssignmentRulesModule],
  controllers: [LeadsController],
  providers: [LeadsService, LeadsRepository],
})
export class LeadsModule {}
