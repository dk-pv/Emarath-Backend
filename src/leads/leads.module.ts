import { Module } from '@nestjs/common';
import { LeadCustomFieldsModule } from '../lead-custom-fields/lead-custom-fields.module';
import { SettingsModule } from '../settings/settings.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadsRepository } from './leads.repository';

@Module({
  // LeadCustomFieldsModule exports the service that validates + persists per-lead
  // custom values on create/update (LEAD-05.1, ADR-0051).
  // SettingsModule exports the service that decides what happens when a new enquiry
  // duplicates an existing lead (Settings → Sales & CRM → Duplicate Settings).
  imports: [LeadCustomFieldsModule, SettingsModule],
  controllers: [LeadsController],
  providers: [LeadsService, LeadsRepository],
})
export class LeadsModule {}
