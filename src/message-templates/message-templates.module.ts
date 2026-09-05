import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessageTemplatesController } from './message-templates.controller';
import { MessageTemplatesService } from './message-templates.service';

/**
 * Settings → Communication → Templates. PrismaModule is global; AuthModule supplies the
 * `CurrentUserService` binding that stamps a new template's author. Nothing is exported —
 * no other module reads templates yet (the WhatsApp composer's list is the BSP's, not
 * this one; see ADR-0068).
 */
@Module({
  imports: [AuthModule],
  controllers: [MessageTemplatesController],
  providers: [MessageTemplatesService],
})
export class MessageTemplatesModule {}
