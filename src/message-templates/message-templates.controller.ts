import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CurrentUserService } from '../auth/current-user';
import { MessageTemplatesService } from './message-templates.service';
import {
  CreateMessageTemplateDto,
  ListMessageTemplatesQueryDto,
  MessageTemplateList,
  MessageTemplateRow,
  UpdateMessageTemplateDto,
} from './dto/message-template.dto';

/**
 * Settings → Communication → Templates, under `/api/message-templates`.
 *
 * `SUPERADMIN` for the whole controller, reads included — the same model
 * `LeadSourcesController`, `CategoriesController` and `SettingsController` use. Templates
 * are company communication policy, so reading the catalogue is as administrative as
 * editing it.
 *
 * Thin by design: the DTO validates, the service owns every rule.
 */
@Controller('message-templates')
@Roles(UserRole.SUPERADMIN)
export class MessageTemplatesController {
  constructor(
    private readonly service: MessageTemplatesService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** GET /api/message-templates — one page, searched and filtered server-side. */
  @Get()
  list(
    @Query() query: ListMessageTemplatesQueryDto,
  ): Promise<MessageTemplateList> {
    return this.service.list(query);
  }

  /** POST /api/message-templates — the author comes from the session, never the body. */
  @Post()
  async create(
    @Body() dto: CreateMessageTemplateDto,
  ): Promise<MessageTemplateRow> {
    const actor = await this.currentUser.resolve();
    return this.service.create(dto, actor.id);
  }

  /** PATCH /api/message-templates/:id — edits the row in place. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMessageTemplateDto,
  ): Promise<MessageTemplateRow> {
    return this.service.update(id, dto);
  }

  /** DELETE /api/message-templates/:id — soft delete. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ id: string }> {
    return this.service.remove(id);
  }
}
