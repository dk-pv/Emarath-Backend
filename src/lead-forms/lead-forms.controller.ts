import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { LeadFormsService } from './lead-forms.service';
import {
  AvailableFormField,
  LeadFormItem,
  LeadFormPage,
  ListLeadFormsQueryDto,
  SaveLeadFormDto,
} from './dto/lead-form.dto';

/**
 * Configured lead forms (Settings > Data & Schema Management > Form Customization,
 * ADR-0072), under `/api/lead-forms`.
 *
 * `SUPERADMIN` for the whole controller — arranging the form every user fills in is
 * administrative — with one exception: `GET /lead-forms/default`, which the New Lead
 * drawer reads on every open and therefore must be readable by whoever is filling it in.
 * Static segments are declared before `:id` so neither is ever read as an id.
 */
@Controller('lead-forms')
@Roles(UserRole.SUPERADMIN)
export class LeadFormsController {
  constructor(
    private readonly service: LeadFormsService,
    private readonly currentUser: CurrentUserService,
    private readonly prisma: PrismaService,
  ) {}

  /** GET /api/lead-forms — the Settings list: searched and paged. */
  @Get()
  page(@Query() query: ListLeadFormsQueryDto): Promise<LeadFormPage> {
    return this.service.page(query);
  }

  /**
   * GET /api/lead-forms/default — the arrangement the New Lead drawer renders.
   * Open to any signed-in user: a form cannot honour a configuration it may not read.
   */
  @Get('default')
  @Roles(...Object.values(UserRole))
  default(): Promise<LeadFormItem | null> {
    return this.service.defaultForm('LEAD');
  }

  /** GET /api/lead-forms/fields — every field a form may arrange. */
  @Get('fields')
  fields(): Promise<AvailableFormField[]> {
    return this.service.availableFields();
  }

  /** GET /api/lead-forms/:id — one form's complete configuration. */
  @Get(':id')
  byId(@Param('id', ParseUUIDPipe) id: string): Promise<LeadFormItem> {
    return this.service.byId(id);
  }

  /** POST /api/lead-forms — create a form. */
  @Post()
  async create(@Body() dto: SaveLeadFormDto): Promise<LeadFormItem> {
    const actor = await this.currentUser.resolve();
    // The Created By column prints a person, so the name is captured at creation —
    // the same way the Duplicate Settings log and a Follow Up Type capture theirs.
    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { name: true },
    });
    return this.service.create(dto, user?.name ?? 'ADMIN');
  }

  /** PATCH /api/lead-forms/:id — update the existing form, never a copy of it. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveLeadFormDto,
  ): Promise<LeadFormItem> {
    return this.service.update(id, dto);
  }

  /** DELETE /api/lead-forms/:id — soft-delete a form that is neither default nor in use. */
  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.service.remove(id);
    return { id };
  }
}
