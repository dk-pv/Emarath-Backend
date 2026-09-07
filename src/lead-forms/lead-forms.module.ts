import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LeadFormsController } from './lead-forms.controller';
import { LeadFormsService } from './lead-forms.service';

/**
 * Form Customization (Settings > Data & Schema Management, ADR-0072). PrismaModule is
 * global; AuthModule supplies the `CurrentUserService` binding that names a form's
 * creator. Nothing is exported — no other module reads a form definition yet.
 */
@Module({
  imports: [AuthModule],
  controllers: [LeadFormsController],
  providers: [LeadFormsService],
})
export class LeadFormsModule {}
