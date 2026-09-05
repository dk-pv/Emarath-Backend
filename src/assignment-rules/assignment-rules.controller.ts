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
import { AssignmentRulesService } from './assignment-rules.service';
import {
  AssignmentRuleList,
  AssignmentRuleRow,
  CreateAssignmentRuleDto,
  ListAssignmentRulesQueryDto,
  UpdateAssignmentRuleDto,
} from './dto/assignment-rule.dto';

/**
 * Settings → Assignment → Assignment Rules, under `/api/assignment-rules`.
 *
 * `SUPERADMIN` for the whole controller, reads included — the same model every other
 * Settings screen uses. These rules decide which agent receives which lead, so reading
 * them is as administrative as editing them.
 *
 * Thin by design: the DTO validates, the service owns every rule.
 */
@Controller('assignment-rules')
@Roles(UserRole.SUPERADMIN)
export class AssignmentRulesController {
  constructor(
    private readonly service: AssignmentRulesService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** GET /api/assignment-rules — one page, searched and filtered server-side. */
  @Get()
  list(
    @Query() query: ListAssignmentRulesQueryDto,
  ): Promise<AssignmentRuleList> {
    return this.service.list(query);
  }

  /** GET /api/assignment-rules/:id — one rule with its groups, in order. */
  @Get(':id')
  byId(@Param('id', ParseUUIDPipe) id: string): Promise<AssignmentRuleRow> {
    return this.service.byId(id);
  }

  /** POST /api/assignment-rules — the author comes from the session, never the body. */
  @Post()
  async create(
    @Body() dto: CreateAssignmentRuleDto,
  ): Promise<AssignmentRuleRow> {
    const actor = await this.currentUser.resolve();
    return this.service.create(dto, actor.id);
  }

  /** PATCH /api/assignment-rules/:id — edits the rule in place. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssignmentRuleDto,
  ): Promise<AssignmentRuleRow> {
    return this.service.update(id, dto);
  }

  /** DELETE /api/assignment-rules/:id — soft delete. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ id: string }> {
    return this.service.remove(id);
  }
}
